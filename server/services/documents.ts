import { rmSync } from "node:fs";
import type { Ctx } from "../context.ts";
import { audit, conflict, forbidden, notFound } from "../context.ts";
import { all, get, run, tx } from "../db.ts";
import type { DocRow } from "./common.ts";
import { runMatch } from "./matching.ts";
import { deleteBundle } from "./demo.ts";

export function listDocuments(ctx: Ctx) {
  const docs = all<DocRow>(ctx.db, "SELECT * FROM documents WHERE org_id=? ORDER BY created_at DESC, id", ctx.orgId);
  return docs.map((d) => {
    const links = all<{ bundle_id: string; label: string; state: string; role: string }>(
      ctx.db, "SELECT bd.bundle_id, b.label, b.state, bd.role FROM bundle_docs bd JOIN bundles b ON b.id=bd.bundle_id WHERE bd.document_id=? ORDER BY b.seq", d.id,
    );
    const ms = get<{ output_json: string }>(ctx.db, "SELECT output_json FROM decisions WHERE document_id=? AND kind='extraction' ORDER BY created_at DESC LIMIT 1", d.id);
    const processingMs = ms ? ((JSON.parse(ms.output_json) as { processingMs?: number }).processingMs ?? null) : null;
    return {
      id: d.id, docType: d.doc_type, filename: d.filename, size: d.size, pageCount: d.page_count, docNumber: d.doc_number, poRef: d.po_ref, source: d.source,
      uploadedBy: d.uploaded_by, createdAt: d.created_at, extractors: d.extractors.split(","), riskFlags: (JSON.parse(d.risk_flags_json) as { code: string }[]).map((r) => r.code),
      warnings: (JSON.parse(d.warnings_json) as string[]).length, classificationConfidence: d.classification_conf, processingMs,
      bundles: links.map((l) => ({ id: l.bundle_id, label: l.label, state: l.state, role: l.role })),
    };
  });
}

/**
 * Remove an uploaded document (e.g. a wrong file) and re-run matching for the bundles it fed. Replacement = remove + upload.
 * Refused once any linked bundle is approved/exported: those decisions rest on this evidence.
 */
export function deleteDocument(ctx: Ctx, documentId: string) {
  if (ctx.actor.role !== "controller") throw forbidden("Only a Controller can remove a document.");
  const d = get<DocRow>(ctx.db, "SELECT * FROM documents WHERE id=? AND org_id=?", documentId, ctx.orgId);
  if (!d) throw notFound("Document");
  const links = all<{ bundle_id: string; role: string; state: string }>(ctx.db, "SELECT bd.bundle_id, bd.role, b.state FROM bundle_docs bd JOIN bundles b ON b.id=bd.bundle_id WHERE bd.document_id=?", documentId);
  const locked = links.filter((l) => ["approved", "exported"].includes(l.state));
  if (locked.length) throw conflict("This document supports an approved bundle. Reopen the bundle first (Controller), then remove it.");
  const invoiceBundles = links.filter((l) => l.role === "invoice").map((l) => l.bundle_id);
  const others = links.filter((l) => l.role !== "invoice").map((l) => l.bundle_id);
  tx(ctx.db, () => {
    for (const b of invoiceBundles) deleteBundle(ctx, b); // the invoice IS the bundle; this also removes unshared documents
    if (get(ctx.db, "SELECT 1 x FROM documents WHERE id=?", documentId)) {
      run(ctx.db, "DELETE FROM bundle_docs WHERE document_id=?", documentId);
      run(ctx.db, "DELETE FROM documents WHERE id=?", documentId);
      rmSync(d.stored_path, { force: true });
    }
    for (const b of new Set(others)) if (get(ctx.db, "SELECT 1 x FROM bundles WHERE id=?", b)) runMatch(ctx, b, "relink");
    audit(ctx, { action: "document.removed", entityType: "document", entityId: documentId, before: { filename: d.filename, docType: d.doc_type, docNumber: d.doc_number }, note: `${d.filename} removed; ${new Set([...invoiceBundles, ...others]).size} bundle(s) re-evaluated` });
  });
  return { removed: documentId, bundlesAffected: [...new Set([...invoiceBundles, ...others])] };
}
