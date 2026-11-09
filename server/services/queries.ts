import type { Ctx } from "../context.ts";
import { notFound } from "../context.ts";
import { all, get } from "../db.ts";
import { canApprove, canCorrectFields, canOverride, canResolveException, canExport } from "../../shared/permissions.ts";
import type { ExceptionItem, MatchResult, RiskFlag } from "../../shared/schemas.ts";
import { tryD } from "../../shared/money.ts";
import { bundleDocs, canonOf, getSettings, type BundleRow, type DocRow, type FieldRow } from "./common.ts";

export interface BundleSummary {
  id: string; label: string; state: string; recommendation: string | null; supplier: string | null; poNumber: string | null; invoiceNumber: string | null;
  invoiceDate: string | null; currency: string | null; total: string | null; open: number; openBlocking: number; closed: number; docs: { po: boolean; grn: number; invoice: boolean };
  source: string; fixtureId: string | null; createdAt: string; updatedAt: string; corrections: number;
}

export function listBundles(ctx: Ctx, filter: { state?: string; recommendation?: string; q?: string } = {}): BundleSummary[] {
  const settings = getSettings(ctx.db, ctx.orgId);
  const rows = all<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE org_id=? ORDER BY seq", ctx.orgId);
  const out: BundleSummary[] = [];
  for (const b of rows) {
    if (filter.state && b.state !== filter.state) continue;
    if (filter.recommendation && b.recommendation !== filter.recommendation) continue;
    const d = bundleDocs(ctx.db, b.id);
    const inv = d.invoice ? canonOf(ctx.db, d.invoice, settings) : null;
    const exc = all<{ status: string; severity: string }>(ctx.db, "SELECT status, severity FROM exceptions WHERE bundle_id=?", b.id);
    const corr = get<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM corrections WHERE bundle_ids_json LIKE ?", `%"${b.id}"%`)?.n ?? 0;
    const row: BundleSummary = {
      id: b.id, label: b.label, state: b.state, recommendation: b.recommendation, supplier: inv?.supplierName ?? null, poNumber: b.po_number, invoiceNumber: inv?.docNumber ?? null,
      invoiceDate: inv?.docDate ?? null, currency: inv?.currency ?? null, total: inv?.total ?? null,
      open: exc.filter((e) => e.status === "open").length, openBlocking: exc.filter((e) => e.status === "open" && e.severity === "blocking").length, closed: exc.filter((e) => e.status !== "open").length,
      docs: { po: !!d.po, grn: d.grns.length, invoice: !!d.invoice }, source: b.source, fixtureId: b.fixture_id, createdAt: b.created_at, updatedAt: b.updated_at, corrections: corr,
    };
    if (filter.q) {
      const q = filter.q.toLowerCase();
      if (![row.label, row.supplier, row.poNumber, row.invoiceNumber, row.fixtureId].some((v) => v?.toLowerCase().includes(q))) continue;
    }
    out.push(row);
  }
  return out;
}

export function getBundleDetail(ctx: Ctx, bundleId: string) {
  const bundle = get<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE id=? AND org_id=?", bundleId, ctx.orgId);
  if (!bundle) throw notFound("Bundle");
  const settings = getSettings(ctx.db, ctx.orgId);
  const d = bundleDocs(ctx.db, bundleId);
  const docRows: (DocRow & { role: string })[] = [
    ...(d.po ? [{ ...d.po, role: "po" }] : []), ...d.grns.map((g) => ({ ...g, role: "grn" })), ...(d.invoice ? [{ ...d.invoice, role: "invoice" }] : []),
  ];
  const documents = docRows.map((doc) => {
    const fields = all<FieldRow>(ctx.db, "SELECT * FROM fields WHERE document_id=? ORDER BY rowid", doc.id).map((f) => ({
      id: f.id, key: f.key, value: f.value, raw: f.raw, bbox: f.bbox_json ? JSON.parse(f.bbox_json) : null, wordIds: JSON.parse(f.word_ids_json) as string[],
      confidence: f.confidence, reason: f.reason, extractor: f.extractor, corrected: !!f.corrected, originalValue: f.original_value, updatedBy: f.updated_by, updatedAt: f.updated_at,
    }));
    const layer = JSON.parse(doc.text_layer_json) as { pages: { page: number; width: number; height: number }[] };
    return {
      id: doc.id, role: doc.role, docType: doc.doc_type, filename: doc.filename, sha256: doc.sha256, pageCount: doc.page_count, docNumber: doc.doc_number, source: doc.source,
      uploadedBy: doc.uploaded_by, createdAt: doc.created_at, classification: { confidence: doc.classification_conf, reason: doc.classification_reason },
      riskFlags: JSON.parse(doc.risk_flags_json) as RiskFlag[], extractors: doc.extractors.split(","), warnings: JSON.parse(doc.warnings_json) as string[],
      pages: layer.pages.map((p) => ({ page: p.page, width: p.width, height: p.height })), fields,
    };
  });
  const runRow = bundle.current_run_id ? get<{ id: string; version: number; trigger: string; created_at: string; result_json: string; settings_hash: string; engine_version: string }>(ctx.db, "SELECT * FROM runs WHERE id=?", bundle.current_run_id) : undefined;
  const result = runRow ? (JSON.parse(runRow.result_json) as MatchResult) : null;
  const runs = all<{ version: number; trigger: string; created_at: string; recommendation: string; result_json: string }>(ctx.db, "SELECT version, trigger, created_at, recommendation, result_json FROM runs WHERE bundle_id=? ORDER BY version DESC", bundleId)
    .map((r) => ({ version: r.version, trigger: r.trigger, createdAt: r.created_at, recommendation: r.recommendation, exceptionCount: (JSON.parse(r.result_json) as MatchResult).exceptions.length }));

  const role = ctx.actor.role;
  const exceptions = all<{ id: string; status: string; note: string | null; resolved_by: string | null; resolved_role: string | null; resolved_at: string | null; first_run_version: number; data_json: string }>(
    ctx.db, "SELECT * FROM exceptions WHERE bundle_id=? ORDER BY CASE severity WHEN 'blocking' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, fingerprint", bundleId,
  ).map((e) => {
    const item = JSON.parse(e.data_json) as ExceptionItem;
    const resolver = e.resolved_by ? get<{ name: string }>(ctx.db, "SELECT name FROM users WHERE id=?", e.resolved_by)?.name ?? e.resolved_by : null;
    return {
      id: e.id, ...item, status: e.status, note: e.note, resolvedBy: resolver, resolvedRole: e.resolved_role, resolvedAt: e.resolved_at, firstRunVersion: e.first_run_version,
      canResolve: canResolveException(role, item.code, item.severity), canOverride: canOverride(role),
    };
  });
  const open = exceptions.filter((e) => e.status === "open");
  const inv = d.invoice ? canonOf(ctx.db, d.invoice, settings) : null;
  const total = tryD(inv?.total);

  const approvals = all<Record<string, unknown>>(ctx.db, `SELECT a.*, u.name decided_name FROM approvals a LEFT JOIN users u ON u.id=a.decided_by WHERE a.bundle_id=? ORDER BY a.decided_at DESC, a.rowid DESC`, bundleId).map((a) => ({
    id: a.id, action: a.action, status: a.status, proposedBy: a.proposed_by, proposedRecommendation: a.proposed_recommendation, proposedAt: a.proposed_at,
    decidedBy: a.decided_name ?? a.decided_by, decidedRole: a.decided_role, decidedAt: a.decided_at, reason: a.reason, executedAt: a.executed_at, executionRef: a.execution_ref, runId: a.run_id,
  }));
  const corrections = all<Record<string, unknown>>(ctx.db, `SELECT c.*, u.name user_name FROM corrections c LEFT JOIN users u ON u.id=c.user_id WHERE c.bundle_ids_json LIKE ? ORDER BY c.created_at DESC`, `%"${bundleId}"%`).map((c) => ({
    id: c.id, documentId: c.document_id, fieldKey: c.field_key, before: c.before_value, after: c.after_value, reason: c.reason, user: c.user_name ?? c.user_id, at: c.created_at,
  }));
  const audit = listAudit(ctx, { bundleId, limit: 200 });

  const approveGate = canApprove(role);
  let approveBlock: string | null = approveGate.ok ? null : approveGate.reason ?? "Not permitted";
  if (!approveBlock && bundle.state !== "matched") approveBlock = `Bundle is ${bundle.state}.`;
  if (!approveBlock && open.length) approveBlock = `${open.length} open exception(s) must be resolved first.`;
  if (!approveBlock && role === "clerk" && total && total.gt(settings.clerkApprovalLimit)) approveBlock = `Over your approval limit (${settings.clerkApprovalLimit}); needs a Controller.`;
  if (!approveBlock && settings.requireSeparateApprover && corrections.some((c) => (c.user as string) === ctx.actor.name)) approveBlock = "You corrected data on this bundle; someone else must approve (separation of duties).";

  const extractors = new Set(documents.flatMap((x) => x.extractors));
  const llmUsed = [...extractors].some((e) => e.startsWith("claude:"));
  const explanation = get<{ output_json: string; model: string | null; created_at: string }>(ctx.db, "SELECT output_json, model, created_at FROM decisions WHERE bundle_id=? AND kind='explanation' ORDER BY created_at DESC LIMIT 1", bundleId);
  const org = get<{ name: string; timezone: string; base_currency: string }>(ctx.db, "SELECT name, timezone, base_currency FROM organizations WHERE id=?", ctx.orgId)!;

  return {
    bundle: { id: bundle.id, label: bundle.label, state: bundle.state, recommendation: bundle.recommendation, poNumber: bundle.po_number, fixtureId: bundle.fixture_id, source: bundle.source, createdAt: bundle.created_at, updatedAt: bundle.updated_at },
    org: { name: org.name, timezone: org.timezone, baseCurrency: org.base_currency },
    documents,
    run: runRow ? { id: runRow.id, version: runRow.version, trigger: runRow.trigger, createdAt: runRow.created_at, engineVersion: runRow.engine_version, settingsHash: runRow.settings_hash, result } : null,
    runs, exceptions, approvals, corrections, audit,
    permissions: {
      canCorrect: canCorrectFields(role) && !["approved", "exported"].includes(bundle.state),
      approve: { ok: !approveBlock, reason: approveBlock },
      canReject: role !== "purchasing" && ["matched", "held", "incomplete"].includes(bundle.state),
      canHold: ["matched", "incomplete"].includes(bundle.state),
      canReopen: role !== "purchasing" && (["held", "rejected"].includes(bundle.state) || (["approved", "exported"].includes(bundle.state) && role === "controller")),
      canExport: canExport(role),
    },
    limits: { clerkApprovalLimit: settings.clerkApprovalLimit, requireSeparateApprover: settings.requireSeparateApprover, confidenceThreshold: settings.confidenceThreshold },
    ai: {
      stages: [
        { stage: "Document type detection", method: "Deterministic title rules", ai: false },
        { stage: "Field extraction", method: [...extractors].join(" + "), ai: llmUsed },
        { stage: "Value checks (grounding)", method: "Deterministic: every value re-derived from the cited words", ai: false },
        { stage: "Reconciliation, tolerances, tax, duplicates", method: result?.engineVersion ?? "engine", ai: false },
        { stage: "Recommendation", method: "Deterministic policy (blocking → Hold, open review items → Exception review)", ai: false },
        { stage: "Exception wording", method: explanation ? `LLM summary (${explanation.model ?? "model"}), number-verified` : "Templates filled from the computed figures", ai: !!explanation },
        { stage: "Approval", method: "Human decision, role- and limit-gated", ai: false },
      ],
      summary: explanation ? (JSON.parse(explanation.output_json) as { summary: string }).summary : null,
    },
  };
}

export function listExceptions(ctx: Ctx, f: { status?: string; severity?: string; code?: string } = {}) {
  const rows = all<{ id: string; bundle_id: string; label: string; state: string; status: string; severity: string; code: string; title: string; data_json: string; note: string | null; created_at: string }>(
    ctx.db,
    `SELECT e.id, e.bundle_id, b.label, b.state, e.status, e.severity, e.code, e.title, e.data_json, e.note, e.created_at
     FROM exceptions e JOIN bundles b ON b.id=e.bundle_id WHERE b.org_id=? ORDER BY CASE e.severity WHEN 'blocking' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, b.seq`, ctx.orgId,
  );
  return rows
    .filter((r) => (!f.status || r.status === f.status) && (!f.severity || r.severity === f.severity) && (!f.code || r.code === f.code))
    .map((r) => {
      const item = JSON.parse(r.data_json) as ExceptionItem;
      return { id: r.id, bundleId: r.bundle_id, bundleLabel: r.label, bundleState: r.state, status: r.status, severity: r.severity, code: r.code, title: r.title, ownerRole: item.ownerRole, delta: item.delta, currency: item.currency, explanation: item.explanation, note: r.note };
    });
}

export function listAudit(ctx: Ctx, f: { bundleId?: string; action?: string; limit?: number; offset?: number } = {}) {
  const where = ["org_id=?"]; const params: (string | number)[] = [ctx.orgId];
  if (f.bundleId) { where.push("bundle_id=?"); params.push(f.bundleId); }
  if (f.action) { where.push("action LIKE ?"); params.push(`${f.action}%`); }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 1000);
  const rows = all<Record<string, unknown>>(ctx.db, `SELECT * FROM audit_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, f.offset ?? 0);
  return rows.map((r) => ({
    id: r.id as number, at: r.at as string, actorName: r.actor_name as string | null, actorRole: r.actor_role as string | null, actorKind: r.actor_kind as string, action: r.action as string,
    entityType: r.entity_type as string, entityId: r.entity_id as string | null, bundleId: r.bundle_id as string | null,
    before: r.before_json ? JSON.parse(r.before_json as string) : null, after: r.after_json ? JSON.parse(r.after_json as string) : null, note: r.note as string | null,
  }));
}

export function getStats(ctx: Ctx) {
  const bundles = listBundles(ctx);
  const byState: Record<string, number> = {};
  for (const b of bundles) byState[b.state] = (byState[b.state] ?? 0) + 1;
  const exc = all<{ code: string; severity: string; status: string }>(ctx.db, "SELECT e.code, e.severity, e.status FROM exceptions e JOIN bundles b ON b.id=e.bundle_id WHERE b.org_id=?", ctx.orgId);
  const corrections = get<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM corrections WHERE org_id=?", ctx.orgId)?.n ?? 0;
  const fields = get<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM fields f JOIN documents d ON d.id=f.document_id WHERE d.org_id=? AND f.extractor != 'human'", ctx.orgId)?.n ?? 0;
  return {
    bundles: bundles.length, byState,
    byRecommendation: { READY_FOR_APPROVAL: bundles.filter((b) => b.recommendation === "READY_FOR_APPROVAL").length, EXCEPTION_REVIEW: bundles.filter((b) => b.recommendation === "EXCEPTION_REVIEW").length, HOLD: bundles.filter((b) => b.recommendation === "HOLD").length },
    openExceptions: exc.filter((e) => e.status === "open").length, openBlocking: exc.filter((e) => e.status === "open" && e.severity === "blocking").length,
    exceptionsByCode: Object.entries(exc.reduce<Record<string, number>>((m, e) => ((m[e.code] = (m[e.code] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]),
    corrections, extractedFields: fields,
    correctionRate: fields ? corrections / fields : 0,
  };
}
