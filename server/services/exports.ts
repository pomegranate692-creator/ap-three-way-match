import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "../context.ts";
import { audit, conflict, forbidden, notFound, unprocessable } from "../context.ts";
import { all, get, newId, run, tx } from "../db.ts";
import { canExport } from "../../shared/permissions.ts";
import { ENGINE_VERSION } from "../engine/match.ts";
import { buildXlsx, EXPORT_DISCLAIMER, inZone, sheetToCsv, type Cell, type ExportBundleData, type Sheet } from "../export/build.ts";
import { sha256 } from "./common.ts";
import { getBundleDetail, listBundles } from "./queries.ts";

export interface ExportRequest { kind: "approved_register" | "exception_record"; format: "csv" | "xlsx"; bundleIds?: string[] | undefined; preview?: boolean | undefined }

function selectBundles(ctx: Ctx, req: ExportRequest): string[] {
  const all_ = listBundles(ctx);
  const eligible = req.kind === "approved_register"
    ? all_.filter((b) => b.state === "approved" || b.state === "exported")
    : all_.filter((b) => ["matched", "held", "incomplete"].includes(b.state) && b.open > 0);
  if (!req.bundleIds) return eligible.map((b) => b.id);
  const ok = new Set(eligible.map((b) => b.id));
  const bad = req.bundleIds.filter((id) => !ok.has(id));
  if (bad.length) throw conflict(req.kind === "approved_register" ? "Only approved bundles can go into the approved register." : "Only bundles with open exceptions can go into an exception record.", { notEligible: bad });
  return req.bundleIds;
}

export function buildExportData(ctx: Ctx, kind: ExportRequest["kind"], bundleIds: string[]): ExportBundleData {
  const details = bundleIds.map((id) => getBundleDetail(ctx, id));
  const tz = details[0]?.org.timezone ?? "UTC";
  const generatedAt = ctx.now();
  const sum: Sheet = {
    name: "Summary",
    headers: ["Bundle", "Supplier", "PO number", "Invoice number", "Invoice date", "Currency", "Invoice total", "System recommendation", "Workflow state", "Decision by", "Decision role", "Decision time (UTC)", "Decision time (org tz)", "Decision note", "Open exceptions", "Closed exceptions", "Human corrections", "Corrected fields", "Run version", "Engine", "Invoice file SHA-256", "Payment executed"],
    numeric: [6, 14, 15, 16], rows: [],
  };
  const lines: Sheet = { name: "Line match", headers: ["Bundle", "SKU", "Description", "PO qty", "Received qty", "Billed earlier", "Invoiced qty", "PO net price", "Invoice net price", "Invoice amount", "Status", "Exception codes"], numeric: [3, 4, 5, 6, 7, 8, 9], rows: [] };
  const exc: Sheet = { name: "Exceptions", headers: ["Bundle", "Supplier", "Invoice number", "Exception", "Severity", "Status", "Title", "Expected", "Actual", "Delta", "Currency", "Owner role", "Resolution note", "Resolved by", "Resolved role", "Resolved (UTC)", "Explanation"], numeric: [7, 8, 9], rows: [] };
  const aud: Sheet = { name: "Audit trail", headers: ["Bundle", "Event time (UTC)", "Event time (org tz)", "Actor", "Actor kind", "Role", "Action", "Entity", "Note"], numeric: [], rows: [] };

  for (const d of details) {
    const inv = d.documents.find((x) => x.role === "invoice");
    const f = (k: string) => inv?.fields.find((x) => x.key === k)?.value ?? null;
    const appr = d.approvals.find((a) => a.status === "approved" || a.status === "executed");
    const corrected = d.documents.flatMap((x) => x.fields.filter((y) => y.corrected).map((y) => `${x.docType}.${y.key}: ${y.originalValue ?? "(blank)"} → ${y.value}`));
    sum.rows.push([
      d.bundle.label, f("supplierName"), d.bundle.poNumber, f("docNumber"), f("docDate"), f("currency"), f("total"), d.bundle.recommendation, d.bundle.state,
      appr?.decidedBy as string ?? null, appr?.decidedRole as string ?? null, appr?.decidedAt as string ?? null, inZone(appr?.decidedAt as string | undefined, tz), appr?.reason as string ?? null,
      d.exceptions.filter((e) => e.status === "open").length, d.exceptions.filter((e) => e.status !== "open").length, d.corrections.length, corrected.join(" | "),
      d.run?.version ?? null, d.run?.engineVersion ?? ENGINE_VERSION, inv?.sha256 ?? null, "NO - this system never pays",
    ]);
    for (const l of d.run?.result?.lines ?? []) {
      lines.rows.push([d.bundle.label, l.sku, l.description, l.ordered, l.received, l.priorBilled, l.invoiced, l.poNetPrice, l.invNetPrice, l.invAmount, l.status, l.codes.join(", ")]);
    }
    for (const e of d.exceptions) {
      exc.rows.push([d.bundle.label, f("supplierName"), f("docNumber"), e.code, e.severity, e.status, e.title, e.expected, e.actual, e.delta, e.currency, e.ownerRole, e.note, e.resolvedBy, e.resolvedRole, e.resolvedAt, e.explanation]);
    }
    for (const a of [...d.audit].reverse()) {
      aud.rows.push([d.bundle.label, a.at, inZone(a.at, tz), a.actorName, a.actorKind, a.actorRole, a.action, `${a.entityType}${a.entityId ? ` ${a.entityId}` : ""}`, a.note]);
    }
  }
  const meta: [string, string][] = [
    ["Export kind", kind === "approved_register" ? "Approved register (review record)" : "Exception record (for approval routing)"],
    ["Organisation", details[0]?.org.name ?? ""], ["Bundles", String(details.length)], ["Generated (UTC)", generatedAt], ["Generated by", `${ctx.actor.name} (${ctx.actor.role})`],
    ["Engine", ENGINE_VERSION], ["Time zone for 'org tz' columns", tz], ["Data", "Synthetic"],
    ["Amounts", "Decimal strings in CSV; numeric cells in XLSX (display precision only)"],
  ];
  return { summary: sum, lines, exceptions: exc, audit: aud, meta };
}

export interface ExportResult {
  preview: boolean;
  kind: string;
  format: string;
  count: number;
  bundleIds: string[];
  columns: string[];
  rows: Cell[][];
  exportId?: string;
  filename?: string;
  sha256?: string;
  replayed?: boolean;
  notice: string;
}

export async function createExport(ctx: Ctx, req: ExportRequest, idempotencyKey: string | null): Promise<ExportResult> {
  if (!canExport(ctx.actor.role)) throw forbidden("Your role cannot create exports.");
  const scope = "export";
  if (!req.preview && idempotencyKey) {
    const prev = get<{ response_json: string }>(ctx.db, "SELECT response_json FROM idempotency WHERE scope=? AND key=?", scope, idempotencyKey);
    if (prev) return { ...(JSON.parse(prev.response_json) as ExportResult), replayed: true };
  }
  const ids = selectBundles(ctx, req);
  if (!ids.length) throw unprocessable(req.kind === "approved_register" ? "No approved bundles to export yet. Approve a bundle first." : "No bundles with open exceptions to export.");
  const data = buildExportData(ctx, req.kind, ids);
  const primary = req.kind === "approved_register" ? data.summary : data.exceptions;
  if (req.preview) {
    return { preview: true, kind: req.kind, format: req.format, count: ids.length, bundleIds: ids, columns: primary.headers, rows: primary.rows, notice: EXPORT_DISCLAIMER };
  }

  const sheets: ("summary" | "lines" | "exceptions" | "audit")[] = req.kind === "approved_register" ? ["summary", "lines", "exceptions", "audit"] : ["exceptions", "summary", "lines", "audit"];
  const id = newId("exp");
  const stamp = ctx.now().replace(/[-:]/g, "").slice(0, 13);
  const filename = `${req.kind === "approved_register" ? "approved-register" : "exception-record"}_${stamp}_${id.slice(4)}.${req.format}`;
  const bytes: Buffer = req.format === "xlsx" ? await buildXlsx(data, sheets) : Buffer.from(sheetToCsv(primary), "utf8");
  const hash = sha256(bytes);
  const dir = join(ctx.dataDir, "exports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);

  const result = tx(ctx.db, () => {
    writeFileSync(path, bytes);
    const now = ctx.now();
    run(ctx.db, `INSERT INTO exports(id,org_id,kind,format,created_by,created_at,bundle_ids_json,row_count,sha256,filename,stored_path) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.orgId, req.kind, req.format, ctx.actor.id, now, JSON.stringify(ids), primary.rows.length, hash, filename, path);
    if (req.kind === "approved_register") {
      // "executed" means: the approved record was written to this file. Nothing external happens.
      for (const bid of ids) {
        run(ctx.db, "UPDATE approvals SET status='executed', executed_at=?, execution_ref=? WHERE bundle_id=? AND status='approved'", now, id, bid);
        run(ctx.db, "UPDATE bundles SET state='exported', updated_at=? WHERE id=? AND state='approved'", now, bid);
        audit(ctx, { action: "export.executed", entityType: "export", entityId: id, bundleId: bid, after: { filename, sha256: hash, format: req.format }, note: "Approved record written to a file. No payment or ledger posting occurred." });
      }
    } else {
      for (const bid of ids) audit(ctx, { action: "export.created", entityType: "export", entityId: id, bundleId: bid, after: { filename, sha256: hash, format: req.format }, note: "Exception record exported for approval routing." });
    }
    const out: ExportResult = { preview: false, kind: req.kind, format: req.format, count: ids.length, bundleIds: ids, columns: primary.headers, rows: [], exportId: id, filename, sha256: hash, notice: EXPORT_DISCLAIMER };
    if (idempotencyKey) run(ctx.db, "INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)", scope, idempotencyKey, JSON.stringify(out), now);
    return out;
  });
  return result;
}

export function listExports(ctx: Ctx) {
  return all<{ id: string; kind: string; format: string; created_at: string; row_count: number; filename: string; sha256: string; name: string | null; bundle_ids_json: string }>(
    ctx.db, `SELECT e.*, u.name FROM exports e LEFT JOIN users u ON u.id=e.created_by WHERE e.org_id=? ORDER BY e.created_at DESC`, ctx.orgId,
  ).map((e) => ({ id: e.id, kind: e.kind, format: e.format, createdAt: e.created_at, rows: e.row_count, filename: e.filename, sha256: e.sha256, createdBy: e.name, bundleCount: (JSON.parse(e.bundle_ids_json) as string[]).length }));
}

export function exportFile(ctx: Ctx, exportId: string): { path: string; filename: string; format: string } {
  const row = get<{ stored_path: string; filename: string; format: string }>(ctx.db, "SELECT stored_path, filename, format FROM exports WHERE id=? AND org_id=?", exportId, ctx.orgId);
  if (!row) throw notFound("Export");
  return { path: row.stored_path, filename: row.filename, format: row.format };
}
