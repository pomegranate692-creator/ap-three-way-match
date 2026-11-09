import type { Ctx } from "../context.ts";
import { audit, badRequest, conflict, forbidden, notFound, unprocessable } from "../context.ts";
import { all, get, newId, run, tx } from "../db.ts";
import { D, tryD } from "../../shared/money.ts";
import { parseDate, parseNumber } from "../../shared/normalize.ts";
import { canApprove, canCorrectFields, canOverride, canResolveException } from "../../shared/permissions.ts";
import type { DecisionAction, ExceptionCode, Settings } from "../../shared/schemas.ts";
import { SettingsSchema } from "../../shared/schemas.ts";
import { bundleDocs, canonOf, getSettings, type BundleRow, type DocRow, type FieldRow } from "./common.ts";
import { attachByPoRef } from "./ingest.ts";
import { runMatch, type RunOutcome } from "./matching.ts";

/* ------------------------------------------------------------------ field correction */
const KEY_RE = /^(docNumber|poRef|supplierName|supplierTaxId|currency|docDate|taxRate|subtotal|discountTotal|freight|taxTotal|total|line\.\d+\.(sku|description|qty|uom|unitPrice|discountPct|amount|date))$/;
const NUMERIC_RE = /^(taxRate|subtotal|discountTotal|freight|taxTotal|total|line\.\d+\.(qty|unitPrice|discountPct|amount))$/;
const DATE_RE = /^(docDate|line\.\d+\.date)$/;
const REQUIRED_RE = /^(docNumber|supplierName|total|subtotal|currency|line\.\d+\.(sku|qty|unitPrice|amount))$/;

function normaliseCorrection(key: string, input: string, settings: Settings): string | null {
  const v = input.trim();
  if (v === "") {
    if (REQUIRED_RE.test(key)) throw unprocessable(`"${key}" cannot be empty.`);
    return null;
  }
  if (NUMERIC_RE.test(key)) {
    const p = parseNumber(v, settings.numberLocale);
    if (!p.ok || p.repaired) throw unprocessable(`"${v}" is not a valid number for ${key}.`);
    return p.value;
  }
  if (DATE_RE.test(key)) {
    const d = parseDate(v, settings.dateOrder);
    if (!d) throw unprocessable(`"${v}" is not a valid date. Use YYYY-MM-DD.`);
    return d;
  }
  if (key === "currency") {
    if (!/^[A-Za-z]{3}$/.test(v)) throw unprocessable("Currency must be a 3-letter ISO code such as USD or EUR.");
    return v.toUpperCase();
  }
  if (v.length > 200) throw unprocessable("Value is too long (max 200 characters).");
  if (/[\u0000-\u001f]/.test(v)) throw unprocessable("Control characters are not allowed.");
  return v;
}

export function correctField(ctx: Ctx, body: { documentId: string; key: string; value: string; reason: string }): { before: string | null; after: string | null; runs: RunOutcome[] } {
  if (!canCorrectFields(ctx.actor.role)) throw forbidden("Your role cannot correct extracted fields. Ask an AP Clerk or Controller.");
  if (!KEY_RE.test(body.key)) throw badRequest(`Unknown field "${body.key}".`);
  if (body.reason.trim().length < 3) throw unprocessable("A reason of at least 3 characters is required.");
  const doc = get<DocRow>(ctx.db, "SELECT * FROM documents WHERE id=? AND org_id=?", body.documentId, ctx.orgId);
  if (!doc) throw notFound("Document");
  const settings = getSettings(ctx.db, ctx.orgId);
  const after = normaliseCorrection(body.key, body.value, settings);

  return tx(ctx.db, () => {
    const existing = get<FieldRow>(ctx.db, "SELECT * FROM fields WHERE document_id=? AND key=?", doc.id, body.key);
    const before = existing?.value ?? null;
    if (before === after) throw unprocessable("The new value is the same as the current value.");
    const now = ctx.now();
    const reason = `Corrected by ${ctx.actor.name}: ${body.reason.trim()}`;
    if (existing) {
      run(ctx.db, "UPDATE fields SET value=?, confidence=1, reason=?, extractor='human', corrected=1, original_value=COALESCE(original_value, ?), updated_at=?, updated_by=? WHERE id=?",
        after, reason, existing.value, now, ctx.actor.id, existing.id);
    } else {
      run(ctx.db, `INSERT INTO fields(id,document_id,key,value,raw,bbox_json,word_ids_json,confidence,reason,extractor,corrected,original_value,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,'[]',1,?,'human',1,NULL,?,?)`,
        newId("fld"), doc.id, body.key, after, after ?? "", reason, now, ctx.actor.id);
    }
    if (body.key === "docNumber") run(ctx.db, "UPDATE documents SET doc_number=? WHERE id=?", after, doc.id);
    if (body.key === "poRef") run(ctx.db, "UPDATE documents SET po_ref=? WHERE id=?", after, doc.id);

    const bundles = all<{ bundle_id: string }>(ctx.db, "SELECT bundle_id FROM bundle_docs WHERE document_id=?", doc.id).map((r) => r.bundle_id);
    run(ctx.db, `INSERT INTO corrections(id,org_id,bundle_ids_json,document_id,field_key,before_value,after_value,reason,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      newId("cor"), ctx.orgId, JSON.stringify(bundles), doc.id, body.key, before, after, body.reason.trim(), ctx.actor.id, now);
    for (const bid of bundles.length ? bundles : [null]) {
      audit(ctx, { action: "field.corrected", entityType: "field", entityId: `${doc.id}:${body.key}`, bundleId: bid, before: { value: before }, after: { value: after }, note: `${doc.doc_type} ${doc.doc_number ?? doc.filename} · ${body.key} — ${body.reason.trim()}` });
    }

    // changing a reference can change which documents belong together
    if (doc.doc_type === "INVOICE" && body.key === "poRef") {
      for (const bid of bundles) {
        run(ctx.db, "UPDATE bundles SET po_number=? WHERE id=?", after, bid);
        run(ctx.db, "DELETE FROM bundle_docs WHERE bundle_id=? AND role IN ('po','grn')", bid);
        attachByPoRef(ctx, bid, after);
      }
    }
    if (doc.doc_type === "PO" && body.key === "docNumber") {
      for (const b of all<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE org_id=?", ctx.orgId)) {
        if (b.po_number && after && b.po_number.toUpperCase().replace(/[^A-Z0-9]/g, "") === after.toUpperCase().replace(/[^A-Z0-9]/g, "")) attachByPoRef(ctx, b.id, after);
      }
    }
    const affected = new Set(bundles);
    for (const b of all<{ id: string }>(ctx.db, "SELECT DISTINCT bundle_id id FROM bundle_docs WHERE document_id=?", doc.id)) affected.add(b.id);
    const runs = [...affected].map((bid) => runMatch(ctx, bid, "correction"));
    return { before, after, runs };
  });
}

/* ------------------------------------------------------------------ exceptions */
export function resolveException(ctx: Ctx, exceptionId: string, body: { status: "resolved" | "waived" | "overridden" | "open"; note: string }) {
  const row = get<{ id: string; bundle_id: string; code: ExceptionCode; severity: "blocking" | "review" | "info"; status: string }>(
    ctx.db, "SELECT e.id, e.bundle_id, e.code, e.severity, e.status FROM exceptions e JOIN bundles b ON b.id=e.bundle_id WHERE e.id=? AND b.org_id=?", exceptionId, ctx.orgId,
  );
  if (!row) throw notFound("Exception");
  const bundle = get<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE id=?", row.bundle_id)!;
  if (["approved", "exported", "rejected"].includes(bundle.state)) throw conflict(`This bundle is ${bundle.state}; reopen it before changing exceptions.`);
  if (body.status === "overridden" && !canOverride(ctx.actor.role)) throw forbidden("Only a Controller can override an exception (accept it despite policy).");
  if (!canResolveException(ctx.actor.role, row.code, row.severity)) {
    throw forbidden(row.severity === "blocking" ? "Blocking exceptions can only be cleared by a Controller." : `Your role cannot resolve ${row.code}; it belongs to another team.`);
  }
  if (row.status === body.status) throw unprocessable(`Exception is already ${row.status}.`);
  const now = ctx.now();
  tx(ctx.db, () => {
    if (body.status === "open") run(ctx.db, "UPDATE exceptions SET status='open', note=?, resolved_by=NULL, resolved_role=NULL, resolved_at=NULL WHERE id=?", body.note.trim(), row.id);
    else run(ctx.db, "UPDATE exceptions SET status=?, note=?, resolved_by=?, resolved_role=?, resolved_at=? WHERE id=?", body.status, body.note.trim(), ctx.actor.id, ctx.actor.role, now, row.id);
    audit(ctx, { action: `exception.${body.status === "open" ? "reopened" : body.status}`, entityType: "exception", entityId: row.id, bundleId: row.bundle_id, before: { status: row.status }, after: { status: body.status }, note: `${row.code} — ${body.note.trim()}` });
  });
  return { id: row.id, status: body.status };
}

/* ------------------------------------------------------------------ approval workflow */
export interface DecideResult { approvalId: string | null; state: string; replayed: boolean }

export function decide(ctx: Ctx, bundleId: string, body: { action: DecisionAction; reason?: string | undefined }, idempotencyKey: string | null): DecideResult {
  const scope = `decide:${bundleId}`;
  if (idempotencyKey) {
    const prev = get<{ response_json: string }>(ctx.db, "SELECT response_json FROM idempotency WHERE scope=? AND key=?", scope, idempotencyKey);
    if (prev) return { ...(JSON.parse(prev.response_json) as DecideResult), replayed: true };
  }
  const bundle = get<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE id=? AND org_id=?", bundleId, ctx.orgId);
  if (!bundle) throw notFound("Bundle");
  const role = ctx.actor.role;
  const reason = body.reason?.trim() ?? "";
  const settings = getSettings(ctx.db, ctx.orgId);

  return tx(ctx.db, () => {
    const now = ctx.now();
    const runRow = bundle.current_run_id ? get<{ id: string; version: number; recommendation: string }>(ctx.db, "SELECT id, version, recommendation FROM runs WHERE id=?", bundle.current_run_id) : undefined;
    let result: DecideResult;

    if (body.action === "approve") {
      const gate = canApprove(role);
      if (!gate.ok) throw forbidden(gate.reason!);
      if (bundle.state !== "matched" || !runRow) throw conflict(`Cannot approve a bundle that is "${bundle.state}".`);
      const open = all<{ id: string; code: string; severity: string; title: string }>(ctx.db, "SELECT id, code, severity, title FROM exceptions WHERE bundle_id=? AND status='open'", bundleId);
      if (open.length) throw conflict(`${open.length} exception(s) are still open. Resolve, waive or override each one first.`, { open });
      const docs = bundleDocs(ctx.db, bundleId);
      const inv = canonOf(ctx.db, docs.invoice!, settings);
      const total = tryD(inv.total);
      if (!total) throw conflict("The invoice total is unreadable; correct it before approving.");
      if (role === "clerk" && total.gt(D(settings.clerkApprovalLimit))) {
        throw forbidden(`Invoice total ${total.toFixed()} ${inv.currency ?? ""} exceeds the clerk approval limit of ${settings.clerkApprovalLimit}. A Controller must approve.`);
      }
      if (settings.requireSeparateApprover) {
        const ids = [docs.po?.id, ...docs.grns.map((g) => g.id), docs.invoice?.id].filter(Boolean) as string[];
        const mine = all<{ id: string }>(ctx.db, `SELECT id FROM corrections WHERE user_id=? AND document_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`, ctx.actor.id, ...ids);
        if (mine.length) throw forbidden("Separation of duties: you corrected data on this bundle, so someone else must approve it.");
      }
      const id = newId("apr");
      run(ctx.db, `INSERT INTO approvals(id,bundle_id,run_id,action,status,proposed_by,proposed_recommendation,proposed_at,decided_by,decided_role,decided_at,reason,idempotency_key) VALUES (?,?,?,'approve','approved','engine',?,?,?,?,?,?,?)`,
        id, bundleId, runRow.id, runRow.recommendation, now, ctx.actor.id, role, now, reason || null, idempotencyKey);
      run(ctx.db, "UPDATE bundles SET state='approved', updated_at=? WHERE id=?", now, bundleId);
      audit(ctx, { action: "approval.approved", entityType: "approval", entityId: id, bundleId, before: { state: "matched", proposal: runRow.recommendation, runVersion: runRow.version }, after: { state: "approved" }, note: reason || "Approved for payment review (this system never pays)" });
      result = { approvalId: id, state: "approved", replayed: false };
    } else if (body.action === "reject") {
      if (role === "purchasing") throw forbidden("Purchasing leads cannot reject invoices.");
      if (reason.length < 3) throw unprocessable("A reason is required to reject.");
      if (!["matched", "held", "incomplete"].includes(bundle.state)) throw conflict(`Cannot reject a bundle that is "${bundle.state}".`);
      const id = newId("apr");
      run(ctx.db, `INSERT INTO approvals(id,bundle_id,run_id,action,status,proposed_by,proposed_recommendation,proposed_at,decided_by,decided_role,decided_at,reason,idempotency_key) VALUES (?,?,?,'reject','rejected','engine',?,?,?,?,?,?,?)`,
        id, bundleId, runRow?.id ?? "-", runRow?.recommendation ?? "n/a", now, ctx.actor.id, role, now, reason, idempotencyKey);
      run(ctx.db, "UPDATE bundles SET state='rejected', updated_at=? WHERE id=?", now, bundleId);
      audit(ctx, { action: "approval.rejected", entityType: "approval", entityId: id, bundleId, before: { state: bundle.state }, after: { state: "rejected" }, note: reason });
      result = { approvalId: id, state: "rejected", replayed: false };
    } else if (body.action === "hold") {
      if (reason.length < 3) throw unprocessable("A reason is required to put a bundle on hold.");
      if (!["matched", "incomplete"].includes(bundle.state)) throw conflict(`Cannot hold a bundle that is "${bundle.state}".`);
      const id = newId("apr");
      run(ctx.db, `INSERT INTO approvals(id,bundle_id,run_id,action,status,proposed_by,proposed_recommendation,proposed_at,decided_by,decided_role,decided_at,reason,idempotency_key) VALUES (?,?,?,'hold','held','engine',?,?,?,?,?,?,?)`,
        id, bundleId, runRow?.id ?? "-", runRow?.recommendation ?? "n/a", now, ctx.actor.id, role, now, reason, idempotencyKey);
      run(ctx.db, "UPDATE bundles SET state='held', updated_at=? WHERE id=?", now, bundleId);
      audit(ctx, { action: "approval.held", entityType: "approval", entityId: id, bundleId, before: { state: bundle.state }, after: { state: "held" }, note: reason });
      result = { approvalId: id, state: "held", replayed: false };
    } else {
      // reopen
      if (!["held", "rejected", "approved", "exported"].includes(bundle.state)) throw conflict(`Nothing to reopen: bundle is "${bundle.state}".`);
      if (["approved", "exported"].includes(bundle.state) && role !== "controller") throw forbidden("Only a Controller can reopen an approved bundle.");
      if (role === "purchasing") throw forbidden("Purchasing leads cannot reopen bundles.");
      if (reason.length < 3) throw unprocessable("A reason is required to reopen.");
      run(ctx.db, "UPDATE approvals SET status='superseded' WHERE bundle_id=? AND status IN ('approved','executed')", bundleId);
      const id = newId("apr");
      run(ctx.db, `INSERT INTO approvals(id,bundle_id,run_id,action,status,proposed_by,proposed_recommendation,proposed_at,decided_by,decided_role,decided_at,reason,idempotency_key) VALUES (?,?,?,'reopen','reopened','engine',?,?,?,?,?,?,?)`,
        id, bundleId, runRow?.id ?? "-", runRow?.recommendation ?? "n/a", now, ctx.actor.id, role, now, reason, idempotencyKey);
      run(ctx.db, "UPDATE bundles SET state='matched', updated_at=? WHERE id=?", now, bundleId);
      audit(ctx, { action: "approval.reopened", entityType: "approval", entityId: id, bundleId, before: { state: bundle.state }, after: { state: "matched" }, note: reason });
      result = { approvalId: id, state: "matched", replayed: false };
    }
    if (idempotencyKey) run(ctx.db, "INSERT INTO idempotency(scope,key,response_json,created_at) VALUES (?,?,?,?)", scope, idempotencyKey, JSON.stringify(result), now);
    return result;
  });
}

/* ------------------------------------------------------------------ settings */
export function saveSettings(ctx: Ctx, input: unknown): { settings: Settings; rerun: RunOutcome[] } {
  if (ctx.actor.role !== "controller") throw forbidden("Only a Controller can change matching settings.");
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) throw unprocessable("Invalid settings.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const before = getSettings(ctx.db, ctx.orgId);
  const next = parsed.data;
  return tx(ctx.db, () => {
    run(ctx.db, "INSERT INTO settings(org_id,json,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
      ctx.orgId, JSON.stringify(next), ctx.now(), ctx.actor.id);
    audit(ctx, { action: "settings.updated", entityType: "settings", entityId: ctx.orgId, before, after: next });
    // Tolerance changes affect bundles still under review. Approved/exported/rejected bundles are NOT silently re-decided:
    // their approval covered the figures and rules in force at the time (a Controller can reopen one explicitly).
    const rerun = all<{ id: string }>(ctx.db, "SELECT id FROM bundles WHERE org_id=? AND state IN ('matched','incomplete','held') ORDER BY seq", ctx.orgId)
      .map((b) => runMatch(ctx, b.id, "settings"));
    return { settings: next, rerun };
  });
}
