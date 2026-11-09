/**
 * Reproducible evaluation on the synthetic fixtures. Writes docs/results/eval-results.json and prints a summary.
 * Everything here is MEASURED on this machine against self-authored synthetic data — see docs/METRICS_PLAN.md for caveats.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { evaluateExtraction, fixtureBytes, loadManifest } from "../server/eval/extraction.ts";
import { evaluateMatching } from "../server/eval/matching.ts";
import { analyzePdf } from "../server/pipeline/analyze.ts";

const pct = (x: number) => (x * 100).toFixed(1) + "%";
const OUT = join(import.meta.dirname, "..", "docs", "results");
mkdirSync(OUT, { recursive: true });

// latency: analyse every invoice 3× (first run warms JIT), report median/p95 of the last two
const m = loadManifest();
const times: number[] = [];
for (let rep = 0; rep < 3; rep++) {
  for (const b of m.bundles) {
    const t0 = performance.now();
    await analyzePdf(fixtureBytes(b.files.invoice), { numberLocale: "us", dateOrder: "MDY", docTypeHint: "INVOICE" });
    if (rep > 0) times.push(performance.now() - t0);
  }
}
times.sort((a, b) => a - b);
const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;

const ex = await evaluateExtraction();
const t1 = performance.now();
const mt = await evaluateMatching();
const matchingWallMs = performance.now() - t1;

const result = {
  generatedAt: new Date().toISOString(),
  machine: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length },
  caveat: "Synthetic, self-authored fixtures (the generator and the extractor were written by the same team): treat as an optimistic upper bound, not real-world accuracy.",
  extraction: {
    documents: ex.documents, classificationAccuracy: ex.classificationAccuracy,
    overall: ex.overall, header: ex.header, lineItems: ex.lines,
    lineItemMatchAccuracy: { accurateLines: ex.goldLinesFullyCorrect, goldLines: ex.goldLines, rate: ex.lineItemAccuracy },
    byDocType: ex.byType, mismatches: ex.scores.flatMap((s) => s.mismatches.map((x) => `${s.bundle} ${s.docType}: ${x}`)),
  },
  matching: {
    bundles: mt.bundles, seededDiscrepancies: mt.seeded, cleanBundles: mt.clean,
    engine: mt.engine, baselineTotalOnly: mt.baselineTotalOnly, baselineStrictLines: mt.baselineStrictLines,
    exactExceptionCodeMatches: `${mt.exactCodeMatches}/${mt.bundles}`, recommendationMatches: `${mt.recommendationMatches}/${mt.bundles}`,
    perBundle: mt.details.map((d) => ({ id: d.id, expected: d.expected, got: d.got, recommendation: d.recommendation })),
  },
  latencyMs: { invoiceAnalysisMedian: +q(0.5).toFixed(1), invoiceAnalysisP95: +q(0.95).toFixed(1), samples: times.length, wholeMatchingEvaluation25Bundles: +matchingWallMs.toFixed(0) },
  notMeasured: ["human correction time", "manual-baseline time-on-task", "user satisfaction", "LLM cost per run (no API key; adapters never run live)", "accuracy on real or scanned documents"],
};
writeFileSync(join(OUT, "eval-results.json"), JSON.stringify(result, null, 2));

console.log(`\nEXTRACTION (${ex.documents} documents, native-text PDFs)`);
console.log(`  document-type accuracy   ${pct(ex.classificationAccuracy)}`);
console.log(`  field F1 overall         ${pct(ex.overall.f1)}   header ${pct(ex.header.f1)}   line-item fields ${pct(ex.lines.f1)}`);
console.log(`  line-item match accuracy ${ex.goldLinesFullyCorrect}/${ex.goldLines} = ${pct(ex.lineItemAccuracy)}`);
console.log(`\nMATCHING (${mt.bundles} bundles: ${mt.seeded} seeded discrepancies, ${mt.clean} clean) — bundle-level exception detection`);
const row = (n: string, d: typeof mt.engine) => console.log(`  ${n.padEnd(34)} precision ${pct(d.precision).padStart(6)}  recall ${pct(d.recall).padStart(6)}  F1 ${pct(d.f1).padStart(6)}   TP ${d.tp} FP ${d.fp} FN ${d.fn} TN ${d.tn}`);
row("this engine", mt.engine);
row("baseline B0: total-only compare", mt.baselineTotalOnly);
row("baseline B1: zero-tolerance lines", mt.baselineStrictLines);
console.log(`  exact exception-code matches ${mt.exactCodeMatches}/${mt.bundles}; recommendation matches ${mt.recommendationMatches}/${mt.bundles}`);
console.log(`\nLATENCY  invoice analysis (PDF → fields) median ${q(0.5).toFixed(1)} ms, p95 ${q(0.95).toFixed(1)} ms over ${times.length} runs`);
console.log(`\nNOT MEASURED: ${result.notMeasured.join("; ")}\nWrote docs/results/eval-results.json`);
