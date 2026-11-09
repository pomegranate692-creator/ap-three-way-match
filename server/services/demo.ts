import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { audit, forbidden, notFound, unprocessable } from "../context.ts";
import type { DB } from "../db.ts";
import { all, get, newId, run, tx } from "../db.ts";
import { SettingsSchema } from "../../shared/schemas.ts";
import { ingestFile } from "./ingest.ts";
import type { BundleRow } from "./common.ts";

interface ManifestOrg { id: string; name: string; timezone: string; baseCurrency: string; settings: Record<string, unknown>; users: { id: string; name: string; role: string }[] }
interface ManifestBundle { id: string; n: number; orgId: string; title: string; files: { po?: string; grn?: string; invoice: string }; expectedExceptions: string[] }
interface Manifest { orgs: ManifestOrg[]; bundles: ManifestBundle[] }

export function readManifest(fixtureDir: string): Manifest {
  return JSON.parse(readFileSync(join(fixtureDir, "manifest.json"), "utf8")) as Manifest;
}

/** Create the three SYNTHETIC organisations + users + settings if they do not exist yet. Idempotent. */
export function seedOrgs(db: DB, manifest: Manifest, now: string): number {
  let created = 0;
  tx(db, () => {
    for (const o of manifest.orgs) {
      if (get(db, "SELECT 1 x FROM organizations WHERE id=?", o.id)) continue;
      run(db, "INSERT INTO organizations(id,name,timezone,base_currency,synthetic,created_at) VALUES (?,?,?,?,1,?)", o.id, `${o.name}`, o.timezone, o.baseCurrency, now);
      for (const u of o.users) run(db, "INSERT INTO users(id,org_id,name,role,created_at) VALUES (?,?,?,?,?)", u.id, o.id, u.name, u.role, now);
      run(db, "INSERT INTO settings(org_id,json,updated_at,updated_by) VALUES (?,?,?,NULL)", o.id, JSON.stringify(SettingsSchema.parse(o.settings)), now);
      created++;
    }
  });
  return created;
}

export async function loadDemoData(ctx: Ctx, fixtureDir: string): Promise<{ bundlesLoaded: number; documentsCreated: number; duplicatesSkipped: number; rejected: number }> {
  const manifest = readManifest(fixtureDir);
  const mine = manifest.bundles.filter((b) => b.orgId === ctx.orgId).sort((a, b) => a.n - b.n);
  if (!mine.length) throw unprocessable("No demo data is defined for this organisation.");
  let bundlesLoaded = 0, documentsCreated = 0, duplicatesSkipped = 0, rejected = 0;
  audit(ctx, { action: "demo.load_started", entityType: "org", entityId: ctx.orgId, kind: "system", note: `Loading ${mine.length} synthetic bundles through the real extraction + matching pipeline` });
  for (const b of mine) {
    for (const [slot, file] of [["po", b.files.po], ["grn", b.files.grn], ["invoice", b.files.invoice]] as const) {
      if (!file) continue;
      const bytes = readFileSync(join(fixtureDir, "pdf", file));
      const r = await ingestFile(ctx, { name: file, bytes }, "demo");
      if (r.status === "created") documentsCreated++;
      else if (r.status === "duplicate_file") duplicatesSkipped++;
      else rejected++;
      if (slot === "invoice" && r.status === "created" && r.bundleIds[0]) {
        run(ctx.db, "UPDATE bundles SET label=?, fixture_id=? WHERE id=?", b.id, b.id, r.bundleIds[0]);
        bundlesLoaded++;
      }
    }
  }
  audit(ctx, { action: "demo.load_finished", entityType: "org", entityId: ctx.orgId, kind: "system", after: { bundlesLoaded, documentsCreated, duplicatesSkipped, rejected } });
  return { bundlesLoaded, documentsCreated, duplicatesSkipped, rejected };
}

export function deleteBundle(ctx: Ctx, bundleId: string) {
  if (ctx.actor.role !== "controller") throw forbidden("Only a Controller can delete a bundle.");
  const b = get<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE id=? AND org_id=?", bundleId, ctx.orgId);
  if (!b) throw notFound("Bundle");
  const docs = all<{ document_id: string }>(ctx.db, "SELECT document_id FROM bundle_docs WHERE bundle_id=?", bundleId).map((d) => d.document_id);
  tx(ctx.db, () => {
    run(ctx.db, "DELETE FROM bundles WHERE id=?", bundleId);
    let removedDocs = 0;
    for (const id of docs) {
      if (get(ctx.db, "SELECT 1 x FROM bundle_docs WHERE document_id=?", id)) continue; // shared with another bundle (e.g. same PO)
      const d = get<{ stored_path: string }>(ctx.db, "SELECT stored_path FROM documents WHERE id=?", id);
      run(ctx.db, "DELETE FROM documents WHERE id=?", id);
      if (d) rmSync(d.stored_path, { force: true });
      removedDocs++;
    }
    audit(ctx, { action: "bundle.deleted", entityType: "bundle", entityId: bundleId, before: { label: b.label, state: b.state }, note: `Bundle ${b.label} deleted with ${removedDocs} unshared document(s) and their stored files` });
  });
  return { deleted: bundleId };
}

export function wipeOrgData(ctx: Ctx, includeAudit: boolean) {
  if (ctx.actor.role !== "controller") throw forbidden("Only a Controller can delete organisation data.");
  const files = all<{ stored_path: string }>(ctx.db, "SELECT stored_path FROM documents WHERE org_id=?", ctx.orgId);
  const exportFiles = all<{ stored_path: string }>(ctx.db, "SELECT stored_path FROM exports WHERE org_id=?", ctx.orgId);
  tx(ctx.db, () => {
    run(ctx.db, "DELETE FROM bundles WHERE org_id=?", ctx.orgId); // cascades runs, exceptions, approvals, bundle_docs
    run(ctx.db, "DELETE FROM decisions WHERE org_id=?", ctx.orgId);
    run(ctx.db, "DELETE FROM corrections WHERE org_id=?", ctx.orgId);
    run(ctx.db, "DELETE FROM documents WHERE org_id=?", ctx.orgId); // cascades fields
    run(ctx.db, "DELETE FROM exports WHERE org_id=?", ctx.orgId);
    run(ctx.db, "DELETE FROM idempotency", );
    if (includeAudit) run(ctx.db, "DELETE FROM audit_events WHERE org_id=?", ctx.orgId);
    audit(ctx, { action: "org.data_wiped", entityType: "org", entityId: ctx.orgId, note: `All documents, bundles, runs and exports for this organisation were deleted${includeAudit ? " including the audit trail" : " (audit trail retained)"}` });
  });
  for (const f of [...files, ...exportFiles]) rmSync(f.stored_path, { force: true });
  return { documentsRemoved: files.length };
}

/** Portable JSON copy of everything held for the organisation (no raw file bytes; hashes identify the originals). */
export function exportOrgData(ctx: Ctx) {
  const q = <T>(sql: string, ...p: (string | number)[]) => all<T>(ctx.db, sql, ...p);
  return {
    exportedAt: ctx.now(), notice: "Synthetic demo data. Raw PDFs are not embedded; their SHA-256 is listed per document.",
    organization: get(ctx.db, "SELECT id,name,timezone,base_currency FROM organizations WHERE id=?", ctx.orgId),
    users: q("SELECT id,name,role FROM users WHERE org_id=?", ctx.orgId),
    settings: JSON.parse(get<{ json: string }>(ctx.db, "SELECT json FROM settings WHERE org_id=?", ctx.orgId)?.json ?? "{}"),
    documents: q("SELECT id,doc_type,filename,sha256,size,page_count,doc_number,po_ref,source,created_at,extractors FROM documents WHERE org_id=?", ctx.orgId),
    fields: q("SELECT f.* FROM fields f JOIN documents d ON d.id=f.document_id WHERE d.org_id=?", ctx.orgId),
    bundles: q("SELECT * FROM bundles WHERE org_id=?", ctx.orgId),
    bundleDocuments: q("SELECT bd.* FROM bundle_docs bd JOIN bundles b ON b.id=bd.bundle_id WHERE b.org_id=?", ctx.orgId),
    runs: q("SELECT r.id,r.bundle_id,r.version,r.engine_version,r.settings_hash,r.trigger,r.created_at,r.recommendation,r.result_json FROM runs r JOIN bundles b ON b.id=r.bundle_id WHERE b.org_id=?", ctx.orgId),
    exceptions: q("SELECT e.* FROM exceptions e JOIN bundles b ON b.id=e.bundle_id WHERE b.org_id=?", ctx.orgId),
    approvals: q("SELECT a.* FROM approvals a JOIN bundles b ON b.id=a.bundle_id WHERE b.org_id=?", ctx.orgId),
    corrections: q("SELECT * FROM corrections WHERE org_id=?", ctx.orgId),
    decisions: q("SELECT * FROM decisions WHERE org_id=?", ctx.orgId),
    exports: q("SELECT id,kind,format,created_at,row_count,sha256,filename FROM exports WHERE org_id=?", ctx.orgId),
    auditEvents: q("SELECT * FROM audit_events WHERE org_id=? ORDER BY id", ctx.orgId),
  };
}

void newId;
