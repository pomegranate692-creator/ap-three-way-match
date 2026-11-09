import { createHash } from "node:crypto";
import type { DB } from "../db.ts";
import { all, get } from "../db.ts";
import { SettingsSchema, type DocType, type RiskFlag, type Settings } from "../../shared/schemas.ts";
import { toCanonical } from "../extract/canonical.ts";
import { normDocNumber } from "../../shared/normalize.ts";
import type { CanonDoc } from "../../shared/schemas.ts";

export interface DocRow {
  id: string; org_id: string; doc_type: DocType; filename: string; sha256: string; size: number; page_count: number; stored_path: string;
  doc_number: string | null; po_ref: string | null; classification_conf: number; classification_reason: string;
  text_layer_json: string; risk_flags_json: string; extractors: string; warnings_json: string; source: "upload" | "demo"; uploaded_by: string | null; created_at: string;
}
export interface BundleRow {
  id: string; org_id: string; seq: number; label: string; fixture_id: string | null; po_number: string | null; state: string;
  recommendation: string | null; current_run_id: string | null; source: string; created_at: string; updated_at: string;
}
export interface FieldRow {
  id: string; document_id: string; key: string; value: string | null; raw: string; bbox_json: string | null; word_ids_json: string; confidence: number;
  reason: string; extractor: string; corrected: number; original_value: string | null; updated_at: string; updated_by: string | null;
}

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export function getSettings(db: DB, orgId: string): Settings {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE org_id=?", orgId);
  return SettingsSchema.parse(row ? JSON.parse(row.json) : {});
}

export function bundleDocs(db: DB, bundleId: string): { po?: DocRow; grns: DocRow[]; invoice?: DocRow } {
  const rows = all<DocRow & { role: string }>(
    db, "SELECT d.*, bd.role FROM bundle_docs bd JOIN documents d ON d.id = bd.document_id WHERE bd.bundle_id=? ORDER BY d.created_at, d.id", bundleId,
  );
  return { po: rows.find((r) => r.role === "po"), grns: rows.filter((r) => r.role === "grn"), invoice: rows.find((r) => r.role === "invoice") };
}

export function canonOf(db: DB, doc: DocRow, settings: Settings): CanonDoc {
  const fields = all<FieldRow>(db, "SELECT * FROM fields WHERE document_id=?", doc.id).map((f) => ({ key: f.key, value: f.value, confidence: f.confidence }));
  return toCanonical({ documentId: doc.id, docType: doc.doc_type, fields, riskFlags: JSON.parse(doc.risk_flags_json) as RiskFlag[], confidenceThreshold: settings.confidenceThreshold });
}

export const sameRef = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normDocNumber(a) === normDocNumber(b);

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
