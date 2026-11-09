import type { Ctx } from "../context.ts";
import { audit } from "../context.ts";
import { all, get, newId, run, tx } from "../db.ts";
import { matchBundle, type PriorInvoice } from "../engine/match.ts";
import { D, tryD } from "../../shared/money.ts";
import { normSku } from "../../shared/normalize.ts";
import type { ExceptionItem, MatchResult } from "../../shared/schemas.ts";
import { bundleDocs, canonOf, getSettings, sha256, stableJson, type BundleRow } from "./common.ts";

export type Trigger = "initial" | "new_document" | "correction" | "settings" | "manual" | "relink";

export interface RunOutcome {
  bundleId: string;
  runId: string | null;
  version: number | null;
  created: boolean;
  recommendation: string | null;
  state: string;
}

const evidenceHash = (e: ExceptionItem) => sha256(`${e.expected}|${e.actual}|${e.delta}|${e.severity}`).slice(0, 16);

/**
 * (Re)compute the three-way match for one bundle and persist it.
 * Idempotent: if no input changed since the latest run, no new run is written.
 * Exceptions keep their human resolution across runs as long as their evidence is unchanged.
 */
export function runMatch(ctx: Ctx, bundleId: string, trigger: Trigger): RunOutcome {
  return tx(ctx.db, () => {
    const bundle = get<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE id=? AND org_id=?", bundleId, ctx.orgId);
    if (!bundle) throw new Error(`bundle ${bundleId} not found`);
    const settings = getSettings(ctx.db, ctx.orgId);
    const docs = bundleDocs(ctx.db, bundleId);

    if (!docs.invoice) {
      run(ctx.db, "UPDATE bundles SET state='incomplete', updated_at=? WHERE id=?", ctx.now(), bundleId);
      return { bundleId, runId: null, version: null, created: false, recommendation: null, state: "incomplete" };
    }

    const po = docs.po ? canonOf(ctx.db, docs.po, settings) : null;
    const grns = docs.grns.map((g) => canonOf(ctx.db, g, settings));
    const invoice = canonOf(ctx.db, docs.invoice, settings);

    // invoices ingested earlier in this organisation (duplicate detection)
    const earlier = all<{ id: string; label: string; state: string }>(
      ctx.db, "SELECT id, label, state FROM bundles WHERE org_id=? AND seq < ? AND state != 'rejected' ORDER BY seq", ctx.orgId, bundle.seq,
    );
    const priorInvoices: PriorInvoice[] = [];
    const priorBilled: Record<string, ReturnType<typeof D>> = {};
    for (const b of earlier) {
      const d = bundleDocs(ctx.db, b.id);
      if (!d.invoice || d.invoice.id === docs.invoice.id) continue;
      const ci = canonOf(ctx.db, d.invoice, settings);
      priorInvoices.push({ bundleId: b.label, documentId: ci.documentId, supplierName: ci.supplierName, docNumber: ci.docNumber, total: ci.total, currency: ci.currency, docDate: ci.docDate });
      // cumulative billing against the same PO by earlier, non-duplicate invoices
      if (docs.po && d.po && d.po.id === docs.po.id) {
        const lastRun = get<{ result_json: string }>(ctx.db, "SELECT result_json FROM runs WHERE bundle_id=? ORDER BY version DESC LIMIT 1", b.id);
        const wasDup = lastRun ? (JSON.parse(lastRun.result_json) as MatchResult).exceptions.some((e) => e.code === "DUPLICATE_INVOICE") : false;
        if (!wasDup) for (const l of ci.lines) if (l.sku && tryD(l.qty)) priorBilled[normSku(l.sku)] = (priorBilled[normSku(l.sku)] ?? D(0)).plus(D(l.qty));
      }
    }
    const context = { priorInvoices, priorBilledQty: Object.fromEntries(Object.entries(priorBilled).map(([k, v]) => [k, v.toFixed()])) };

    const result = matchBundle({ po, grns, invoice, settings, context });
    const inputHash = sha256(stableJson({ po, grns, invoice, settings: result.settingsHash, context }));

    const last = get<{ id: string; version: number; input_hash: string }>(ctx.db, "SELECT id, version, input_hash FROM runs WHERE bundle_id=? ORDER BY version DESC LIMIT 1", bundleId);
    if (last && last.input_hash === inputHash) {
      return { bundleId, runId: last.id, version: last.version, created: false, recommendation: bundle.recommendation, state: bundle.state };
    }

    const version = (last?.version ?? 0) + 1;
    const runId = newId("run");
    const now = ctx.now();
    run(
      ctx.db,
      `INSERT INTO runs(id,bundle_id,version,engine_version,settings_hash,trigger,input_hash,result_json,recommendation,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      runId, bundleId, version, result.engineVersion, result.settingsHash, trigger, inputHash, JSON.stringify(result), result.recommendation, now, trigger === "correction" || trigger === "manual" ? ctx.actor.id : null,
    );

    // ---- reconcile exceptions with prior human resolutions ----
    const existing = all<{ id: string; fingerprint: string; status: string; evidence_hash: string; note: string | null; code: string; first_run_version: number }>(
      ctx.db, "SELECT id, fingerprint, status, evidence_hash, note, code, first_run_version FROM exceptions WHERE bundle_id=?", bundleId,
    );
    const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
    const seen = new Set<string>();
    for (const ex of result.exceptions) {
      seen.add(ex.fingerprint);
      const eh = evidenceHash(ex);
      const prev = byFp.get(ex.fingerprint);
      if (!prev) {
        run(ctx.db, `INSERT INTO exceptions(id,bundle_id,run_id,fingerprint,code,severity,line_key,title,data_json,evidence_hash,status,first_run_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?,?)`,
          newId("exc"), bundleId, runId, ex.fingerprint, ex.code, ex.severity, ex.lineKey, ex.title, JSON.stringify(ex), eh, version, now);
      } else if (prev.evidence_hash === eh) {
        run(ctx.db, "UPDATE exceptions SET run_id=?, data_json=?, severity=?, title=? WHERE id=?", runId, JSON.stringify(ex), ex.severity, ex.title, prev.id);
      } else {
        // the underlying numbers changed: any earlier human decision no longer applies
        run(ctx.db, "UPDATE exceptions SET run_id=?, data_json=?, severity=?, title=?, evidence_hash=?, status='open', note=NULL, resolved_by=NULL, resolved_role=NULL, resolved_at=NULL WHERE id=?",
          runId, JSON.stringify(ex), ex.severity, ex.title, eh, prev.id);
        if (prev.status !== "open") audit(ctx, { action: "exception.reopened", entityType: "exception", entityId: prev.id, bundleId, kind: "system", before: { status: prev.status }, after: { status: "open" }, note: `${ex.code}: figures changed in run v${version}, earlier resolution no longer applies` });
      }
    }
    for (const prev of existing) {
      if (!seen.has(prev.fingerprint)) {
        run(ctx.db, "DELETE FROM exceptions WHERE id=?", prev.id);
        audit(ctx, { action: "exception.cleared", entityType: "exception", entityId: prev.id, bundleId, kind: "system", before: { code: prev.code, status: prev.status }, note: `${prev.code} no longer present after run v${version}` });
      }
    }

    // ---- bundle state ----
    let state = bundle.state;
    if (state === "approved" || state === "exported") {
      run(ctx.db, "UPDATE approvals SET status='superseded' WHERE bundle_id=? AND status IN ('approved','executed')", bundleId);
      audit(ctx, { action: "approval.superseded", entityType: "bundle", entityId: bundleId, bundleId, kind: "system", before: { state }, after: { state: "matched" }, note: `Data changed (run v${version}); the earlier approval no longer covers the current figures and must be redone.` });
      state = "matched";
    } else if (state === "incomplete") state = "matched";
    run(ctx.db, "UPDATE bundles SET state=?, recommendation=?, current_run_id=?, updated_at=? WHERE id=?", state, result.recommendation, runId, now, bundleId);

    run(ctx.db, `INSERT INTO decisions(id,org_id,bundle_id,document_id,run_id,kind,actor,model,input_hash,output_json,created_at) VALUES (?,?,?,?,?, 'recommendation','engine',NULL,?,?,?)`,
      newId("dec"), ctx.orgId, bundleId, null, runId, inputHash, JSON.stringify({ recommendation: result.recommendation, summary: result.summary, exceptionCodes: result.exceptions.map((e) => e.code) }), now);
    audit(ctx, { action: "match.run", entityType: "run", entityId: runId, bundleId, kind: "system", after: { version, trigger, recommendation: result.recommendation, exceptions: result.exceptions.length, engine: result.engineVersion }, note: `Deterministic three-way match v${version} (${trigger})` });

    return { bundleId, runId, version, created: true, recommendation: result.recommendation, state };
  });
}

export function rematchAll(ctx: Ctx, trigger: Trigger): RunOutcome[] {
  return all<{ id: string }>(ctx.db, "SELECT id FROM bundles WHERE org_id=? ORDER BY seq", ctx.orgId).map((b) => runMatch(ctx, b.id, trigger));
}
