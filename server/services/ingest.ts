import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Ctx } from "../context.ts";
import { audit } from "../context.ts";
import { all, get, newId, run, tx } from "../db.ts";
import { IngestError, LIMITS } from "../ingest/pdfText.ts";
import { analyzePdf } from "../pipeline/analyze.ts";
import { normDocNumber } from "../../shared/normalize.ts";
import { getSettings, sha256, sameRef, type DocRow } from "./common.ts";
import { runMatch } from "./matching.ts";

export interface IngestResult {
  filename: string;
  status: "created" | "duplicate_file" | "rejected";
  documentId?: string;
  docType?: string;
  bundleIds: string[];
  message?: string;
  code?: string;
  warnings?: string[];
}

export function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (base || "document.pdf").slice(0, 120);
}

export async function ingestFile(ctx: Ctx, file: { name: string; bytes: Uint8Array }, source: "upload" | "demo"): Promise<IngestResult> {
  const filename = safeName(file.name);
  const settings = getSettings(ctx.db, ctx.orgId);
  const hash = sha256(file.bytes);

  // exact-bytes dedupe (idempotent re-upload)
  const dup = get<{ id: string; doc_type: string }>(ctx.db, "SELECT id, doc_type FROM documents WHERE org_id=? AND sha256=?", ctx.orgId, hash);
  if (dup) {
    const bundles = all<{ bundle_id: string }>(ctx.db, "SELECT bundle_id FROM bundle_docs WHERE document_id=?", dup.id).map((r) => r.bundle_id);
    audit(ctx, { action: "document.duplicate_file", entityType: "document", entityId: dup.id, note: `Identical file "${filename}" already ingested; no new record created`, kind: "system" });
    return { filename, status: "duplicate_file", documentId: dup.id, docType: dup.doc_type, bundleIds: bundles, message: "This exact file was already uploaded; the existing record was reused." };
  }

  let analysis;
  try {
    analysis = await analyzePdf(file.bytes, {
      numberLocale: settings.numberLocale, dateOrder: settings.dateOrder,
      ...(settings.llm.extraction && ctx.llm.extract ? { llmExtract: ctx.llm.extract } : {}),
    });
  } catch (e) {
    const code = e instanceof IngestError ? e.code : "ANALYSIS_FAILED";
    const message = e instanceof IngestError ? e.message : `Analysis failed: ${(e as Error).message}`;
    audit(ctx, { action: "document.rejected", entityType: "document", note: `${filename}: ${message}`, kind: "system", after: { code } });
    return { filename, status: "rejected", bundleIds: [], message, code };
  }
  const ex = analysis.extraction;
  if (ex.classification.confidence === 0) {
    audit(ctx, { action: "document.rejected", entityType: "document", note: `${filename}: could not classify`, kind: "system" });
    return { filename, status: "rejected", bundleIds: [], message: "Could not tell whether this is a purchase order, receiving record or invoice (no recognisable title).", code: "UNCLASSIFIED", warnings: ex.warnings };
  }

  const fieldVal = (k: string) => ex.fields.find((f) => f.key === k)?.value ?? null;
  const docNumber = fieldVal("docNumber");
  const poRef = ex.docType === "PO" ? docNumber : fieldVal("poRef");
  const id = newId("doc");
  const dir = join(ctx.dataDir, "uploads", ctx.orgId);
  mkdirSync(dir, { recursive: true });
  const storedPath = join(dir, `${id}.pdf`);

  return tx(ctx.db, () => {
    writeFileSync(storedPath, file.bytes, { flag: "wx" });
    const now = ctx.now();
    run(
      ctx.db,
      `INSERT INTO documents(id,org_id,doc_type,filename,sha256,size,page_count,stored_path,doc_number,po_ref,classification_conf,classification_reason,text_layer_json,risk_flags_json,extractors,warnings_json,source,uploaded_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.orgId, ex.docType, filename, hash, file.bytes.byteLength, analysis.pageCount, storedPath, docNumber, poRef, ex.classification.confidence, ex.classification.reason,
      JSON.stringify(analysis.layer), JSON.stringify(analysis.riskFlags), analysis.extractorsUsed.join(","), JSON.stringify([...ex.warnings]), source, ctx.actor.id, now,
    );
    for (const f of ex.fields) {
      run(
        ctx.db,
        `INSERT INTO fields(id,document_id,key,value,raw,bbox_json,word_ids_json,confidence,reason,extractor,corrected,original_value,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,0,NULL,?,NULL)`,
        newId("fld"), id, f.key, f.value, f.raw, f.bbox ? JSON.stringify(f.bbox) : null, JSON.stringify(f.wordIds), f.confidence, f.reason, f.extractor, now,
      );
    }
    run(ctx.db, `INSERT INTO decisions(id,org_id,bundle_id,document_id,run_id,kind,actor,model,input_hash,output_json,created_at) VALUES (?,?,NULL,?,NULL,'classification','rules@1.0',NULL,?,?,?)`,
      newId("dec"), ctx.orgId, id, hash, JSON.stringify({ docType: ex.docType, confidence: ex.classification.confidence, reason: ex.classification.reason }), now);
    run(ctx.db, `INSERT INTO decisions(id,org_id,bundle_id,document_id,run_id,kind,actor,model,input_hash,output_json,created_at) VALUES (?,?,NULL,?,NULL,'extraction',?,?,?,?,?)`,
      newId("dec"), ctx.orgId, id, analysis.extractorsUsed.join(","), analysis.extractorsUsed.find((e) => e.startsWith("claude:"))?.slice(7) ?? null, hash,
      JSON.stringify({ fieldCount: ex.fields.length, lineCount: ex.lineCount, rejectedByGrounding: analysis.rejected, warnings: ex.warnings }), now);
    audit(ctx, { action: source === "demo" ? "document.loaded_demo" : "document.uploaded", entityType: "document", entityId: id, note: `${filename} → ${ex.docType} ${docNumber ?? "(no number)"}`, after: { sha256: hash, size: file.bytes.byteLength, pages: analysis.pageCount } });
    audit(ctx, { action: "document.extracted", entityType: "document", entityId: id, kind: "agent", after: { extractors: analysis.extractorsUsed, fields: ex.fields.length, lines: ex.lineCount, risks: analysis.riskFlags.map((r) => r.code) }, note: ex.classification.reason });

    const doc = get<DocRow>(ctx.db, "SELECT * FROM documents WHERE id=?", id)!;
    const bundleIds = linkDocument(ctx, doc);
    return { filename, status: "created" as const, documentId: id, docType: ex.docType, bundleIds, warnings: ex.warnings };
  });
}

/** Attach a newly ingested document to its bundle(s) and (re)run the match. A bundle = one invoice + its PO + receiving record(s). */
export function linkDocument(ctx: Ctx, doc: DocRow): string[] {
  const touched: string[] = [];
  if (doc.doc_type === "INVOICE") {
    const bid = newId("bnd");
    const seq = (get<{ m: number | null }>(ctx.db, "SELECT MAX(seq) m FROM bundles WHERE org_id=?", ctx.orgId)?.m ?? 0) + 1;
    const now = ctx.now();
    run(ctx.db, `INSERT INTO bundles(id,org_id,seq,label,fixture_id,po_number,state,recommendation,current_run_id,source,created_at,updated_at) VALUES (?,?,?,?,NULL,?, 'incomplete', NULL, NULL, ?,?,?)`,
      bid, ctx.orgId, seq, doc.doc_number ?? doc.filename, doc.po_ref, doc.source, now, now);
    run(ctx.db, "INSERT INTO bundle_docs(bundle_id,document_id,role) VALUES (?,?, 'invoice')", bid, doc.id);
    attachByPoRef(ctx, bid, doc.po_ref);
    audit(ctx, { action: "bundle.created", entityType: "bundle", entityId: bid, bundleId: bid, kind: "system", note: `Bundle for invoice ${doc.doc_number ?? doc.filename} (PO ref ${doc.po_ref ?? "none"})` });
    runMatch(ctx, bid, "initial");
    touched.push(bid);
  } else if (doc.doc_type === "PO") {
    for (const b of all<{ id: string; po_number: string | null }>(ctx.db, "SELECT id, po_number FROM bundles WHERE org_id=?", ctx.orgId)) {
      if (!sameRef(b.po_number, doc.doc_number)) continue;
      if (get(ctx.db, "SELECT 1 x FROM bundle_docs WHERE bundle_id=? AND role='po'", b.id)) continue;
      run(ctx.db, "INSERT OR IGNORE INTO bundle_docs(bundle_id,document_id,role) VALUES (?,?, 'po')", b.id, doc.id);
      runMatch(ctx, b.id, "new_document");
      touched.push(b.id);
    }
  } else {
    for (const b of all<{ id: string; po_number: string | null }>(ctx.db, "SELECT id, po_number FROM bundles WHERE org_id=?", ctx.orgId)) {
      if (!sameRef(b.po_number, doc.po_ref)) continue;
      run(ctx.db, "INSERT OR IGNORE INTO bundle_docs(bundle_id,document_id,role) VALUES (?,?, 'grn')", b.id, doc.id);
      runMatch(ctx, b.id, "new_document");
      touched.push(b.id);
    }
  }
  return touched;
}

/** Find the PO and receiving record(s) already on file for a PO reference and link them to the bundle. */
export function attachByPoRef(ctx: Ctx, bundleId: string, poRef: string | null) {
  if (!poRef) return;
  const key = normDocNumber(poRef);
  for (const d of all<DocRow>(ctx.db, "SELECT * FROM documents WHERE org_id=? AND doc_type IN ('PO','GRN') ORDER BY created_at", ctx.orgId)) {
    if (d.doc_type === "PO" && d.doc_number && normDocNumber(d.doc_number) === key) {
      if (!get(ctx.db, "SELECT 1 x FROM bundle_docs WHERE bundle_id=? AND role='po'", bundleId)) run(ctx.db, "INSERT OR IGNORE INTO bundle_docs(bundle_id,document_id,role) VALUES (?,?, 'po')", bundleId, d.id);
    } else if (d.doc_type === "GRN" && d.po_ref && normDocNumber(d.po_ref) === key) {
      run(ctx.db, "INSERT OR IGNORE INTO bundle_docs(bundle_id,document_id,role) VALUES (?,?, 'grn')", bundleId, d.id);
    }
  }
}

export { LIMITS };
