import type { Ctx } from "../context.ts";
import { audit, conflict } from "../context.ts";
import { newId, run } from "../db.ts";
import { LlmUnavailable } from "../llm/claude.ts";
import { sha256 } from "./common.ts";
import { getBundleDetail } from "./queries.ts";

/**
 * Optional plain-language summary. The deterministic explanations always exist; this only rewords them.
 * It is rejected unless every number in the model's text already appears in the computed evidence.
 */
export async function generateAiSummary(ctx: Ctx, bundleId: string): Promise<{ summary: string; model: string | null }> {
  const status = ctx.llm.status();
  if (!status.enabled || !ctx.llm.explain) throw conflict(`AI summaries are unavailable: ${status.reason} The template explanations on each exception are used instead.`);
  const d = getBundleDetail(ctx, bundleId);
  const open = d.exceptions.filter((e) => e.status === "open");
  if (!open.length) throw conflict("There are no open exceptions to summarise.");
  const input = {
    bundleLabel: d.bundle.label, recommendation: d.bundle.recommendation ?? "n/a",
    exceptions: open.map((e) => ({ code: e.code, severity: e.severity, title: e.title, explanation: e.explanation, expected: e.expected, actual: e.actual, delta: e.delta, currency: e.currency })),
  };
  let summary: string | null;
  try {
    summary = await ctx.llm.explain(input);
  } catch (e) {
    const why = e instanceof LlmUnavailable ? e.reason : "error";
    audit(ctx, { action: "ai.summary_failed", entityType: "bundle", entityId: bundleId, bundleId, kind: "agent", note: `Falling back to templates (${why}: ${(e as Error).message})` });
    throw conflict(`The AI service is unavailable right now (${why}). Template explanations remain available.`);
  }
  if (!summary) {
    audit(ctx, { action: "ai.summary_rejected", entityType: "bundle", entityId: bundleId, bundleId, kind: "agent", note: "Model text quoted a number not present in the computed evidence; discarded." });
    throw conflict("The AI summary was discarded because it contained a figure that is not in the computed evidence. Template explanations remain available.");
  }
  run(ctx.db, `INSERT INTO decisions(id,org_id,bundle_id,document_id,run_id,kind,actor,model,input_hash,output_json,created_at) VALUES (?,?,?,NULL,?,'explanation','llm',?,?,?,?)`,
    newId("dec"), ctx.orgId, bundleId, d.run?.id ?? null, status.model, sha256(JSON.stringify(input)), JSON.stringify({ summary }), ctx.now());
  audit(ctx, { action: "ai.summary_created", entityType: "bundle", entityId: bundleId, bundleId, kind: "agent", note: `Summary by ${status.model}; numbers verified against evidence` });
  return { summary, model: status.model };
}
