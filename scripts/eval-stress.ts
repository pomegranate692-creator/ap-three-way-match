/**
 * SYNTHETIC STRESS TEST evaluation: OCR + extractor on fixtures/stress (degraded photos of invoices from fictional vendors).
 * Writes docs/results/stress-results.json (override the file name with STRESS_OUT). Needs the cached tesseract language data in data/ocr.
 * Not real-world accuracy.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tesseractOcr } from "../server/ingest/ocr.ts";
import { analyzePdf } from "../server/pipeline/analyze.ts";
import { CONFIDENT, STRESS_DIR, loadStressTruth, mergeSummaries, scoreStressDoc, summarize, type Level, type Outcome, type Summary } from "../server/eval/stress.ts";

const root = join(import.meta.dirname, "..");
const ocr = tesseractOcr({ cachePath: join(root, "data", "ocr"), preprocess: process.env.OCR_PREPROCESS !== "0" });
const truth = loadStressTruth();
const perDoc: { id: string; file: string; damage: Level; docTypeRead: string; docTypeRecognised: boolean; ocrMeanConfidence: number | null; riskFlags: string[]; all: Summary; critical: Summary; outcomes: Outcome[] }[] = [];

for (const d of truth.docs) {
  const a = await analyzePdf(readFileSync(join(STRESS_DIR, d.file)), { ...d.hint, ocr });
  const outcomes = scoreStressDoc(a.extraction, d.gold);
  perDoc.push({ id: d.id, file: d.file, damage: d.damage, docTypeRead: a.extraction.docType, docTypeRecognised: !a.extraction.warnings.some((w) => /type could not be determined/i.test(w)), ocrMeanConfidence: a.ocrMeanConfidence === null ? null : +a.ocrMeanConfidence.toFixed(3), riskFlags: a.riskFlags.map((r) => r.code), all: summarize(outcomes), critical: summarize(outcomes, true), outcomes });
}

const levels: Level[] = ["light", "medium", "heavy"];
const roll = (docs: typeof perDoc) => ({ documents: docs.length, all: mergeSummaries(docs.map((x) => x.all)), critical: mergeSummaries(docs.map((x) => x.critical)) });
const byLevel = Object.fromEntries(levels.map((l) => [l, roll(perDoc.filter((x) => x.damage === l))])) as Record<Level, ReturnType<typeof roll>>;
const overall = roll(perDoc);

const row = (name: string, s: Summary) => `${name.padEnd(8)} expected ${String(s.expected).padStart(4)}  correct ${String(s.correct).padStart(4)} (${((100 * s.correct) / s.expected).toFixed(1)}%)  wrong ${String(s.wrong).padStart(3)}  missed ${String(s.missed).padStart(3)}  spurious ${String(s.spurious).padStart(3)}  errors at conf>=${CONFIDENT}: ${s.confidentErrors} (wrong ${s.confidentWrong}, spurious ${s.confidentSpurious})  right-but-flagged ${s.correctButFlagged}`;
console.log("ALL FIELDS\n" + [...levels.map((l) => row(l, byLevel[l].all)), row("overall", overall.all)].join("\n"));
console.log("\nKEY FIELDS (docNumber docDate currency subtotal taxTotal total; line sku qty unitPrice amount)\n" + [...levels.map((l) => row(l, byLevel[l].critical)), row("overall", overall.critical)].join("\n"));
console.log("\nPER DOCUMENT\n" + perDoc.map((p) => `${p.id} ${p.damage.padEnd(6)} type=${p.docTypeRead.padEnd(7)}${p.docTypeRecognised ? "" : "(defaulted)"} ocrConf=${p.ocrMeanConfidence}  correct ${p.all.correct}/${p.all.expected} wrong ${p.all.wrong} missed ${p.all.missed} spurious ${p.all.spurious} confErr ${p.all.confidentErrors} flags=[${p.riskFlags}]`).join("\n"));

const out = join(root, "docs", "results");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, process.env.STRESS_OUT ?? "stress-results.json"), JSON.stringify({ label: "SYNTHETIC STRESS TEST (not real-world accuracy)", note: truth.note, confidenceThreshold: CONFIDENT, overall, byLevel, documents: perDoc }, null, 2) + "\n");
process.exit(0);
