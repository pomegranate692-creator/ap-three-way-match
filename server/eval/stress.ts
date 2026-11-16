import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtractionResult } from "../../shared/schemas.ts";
import { equal, FIXTURE_DIR } from "./extraction.ts";

/**
 * Scoring for the SYNTHETIC STRESS TEST (fixtures/stress): degraded photos of invoices whose ground truth is computed from source data.
 * Every expected (non-null) field is exactly one of correct / wrong (a different value was read) / missed (nothing read).
 * A value read where the truth is "absent" (or an extra line) is "spurious". Confidence is the extractor's own per-field confidence.
 */
export const CONFIDENT = 0.8;
export type Level = "light" | "medium" | "heavy";
export type Kind = "correct" | "wrong" | "missed" | "spurious";

export interface GoldDoc { docType: string; fields: Record<string, string | null>; lines: Record<string, string | null>[] }
export interface StressDoc { id: string; file: string; damage: Level; hint: { numberLocale: "us" | "eu"; dateOrder: "MDY" | "DMY" }; gold: GoldDoc }
export interface StressTruth { note: string; docs: StressDoc[] }
export interface Outcome { key: string; kind: Kind; conf: number | null; expected: string | null; got: string | null; critical: boolean }

export const STRESS_DIR = join(FIXTURE_DIR, "stress");
export const loadStressTruth = (): StressTruth => JSON.parse(readFileSync(join(STRESS_DIR, "ground_truth.json"), "utf8")) as StressTruth;

const CRITICAL_HEADER = new Set(["docNumber", "docDate", "currency", "subtotal", "taxTotal", "total"]);
const CRITICAL_LINE = new Set(["sku", "qty", "unitPrice", "amount"]);
const norm = (v: string | null | undefined) => (v == null ? null : v.replace(/\s+/g, " ").trim());

type Rec = { values: Record<string, string | null>; conf: Record<string, number> };
function extractedLines(r: ExtractionResult): Rec[] {
  const byIdx = new Map<number, Rec>();
  for (const f of r.fields) {
    const m = f.key.match(/^line\.(\d+)\.(\w+)$/);
    if (!m) continue;
    const rec = byIdx.get(+m[1]!) ?? { values: {}, conf: {} };
    rec.values[m[2]!] = f.value;
    rec.conf[m[2]!] = f.confidence;
    byIdx.set(+m[1]!, rec);
  }
  return [...byIdx.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

function judge(key: string, expected: string | null, got: string | null, conf: number | undefined, critical: boolean): Outcome | null {
  const e = norm(expected), g = norm(got);
  if (e === null) return g === null ? null : { key, kind: "spurious", conf: conf ?? null, expected: null, got: g, critical };
  if (g === null) return { key, kind: "missed", conf: null, expected: e, got: null, critical };
  return { key, kind: equal(key.split(".").pop()!, g, e) ? "correct" : "wrong", conf: conf ?? null, expected: e, got: g, critical };
}

/** Lines are paired by exact SKU first, then leftovers by position, so one misread SKU does not wipe out a whole row. */
export function scoreStressDoc(result: ExtractionResult, gold: GoldDoc): Outcome[] {
  const out: Outcome[] = [];
  const push = (o: Outcome | null) => { if (o) out.push(o); };
  const got = new Map(result.fields.map((f) => [f.key, f]));
  for (const [k, gv] of Object.entries(gold.fields)) push(judge(k, gv, got.get(k)?.value ?? null, got.get(k)?.confidence, CRITICAL_HEADER.has(k)));
  for (const f of result.fields) {
    if (!f.key.startsWith("line.") && !(f.key in gold.fields) && f.value !== null) push({ key: f.key, kind: "spurious", conf: f.confidence, expected: null, got: f.value, critical: false });
  }

  const ex = extractedLines(result);
  const pairedTo = new Map<number, number>(); // gold index → extracted index
  const taken = new Set<number>();
  gold.lines.forEach((gl, gi) => {
    const ei = ex.findIndex((e, i) => !taken.has(i) && norm(e.values.sku) === norm(gl.sku));
    if (ei >= 0) { pairedTo.set(gi, ei); taken.add(ei); }
  });
  gold.lines.forEach((_, gi) => {
    if (pairedTo.has(gi)) return;
    const ei = ex.findIndex((__, i) => !taken.has(i));
    if (ei >= 0) { pairedTo.set(gi, ei); taken.add(ei); }
  });
  gold.lines.forEach((gl, gi) => {
    const rec = pairedTo.has(gi) ? ex[pairedTo.get(gi)!] : undefined;
    for (const [k, gv] of Object.entries(gl)) push(judge(`line.${gi + 1}.${k}`, gv, rec?.values[k] ?? null, rec?.conf[k], CRITICAL_LINE.has(k)));
  });
  ex.forEach((rec, ei) => {
    if (taken.has(ei)) return;
    for (const [k, v] of Object.entries(rec.values)) if (v !== null) push({ key: `line.extra${ei + 1}.${k}`, kind: "spurious", conf: rec.conf[k] ?? null, expected: null, got: v, critical: false });
  });
  return out;
}

export interface Summary {
  expected: number; correct: number; wrong: number; missed: number; spurious: number;
  /** wrong or spurious reads whose own confidence was at or above CONFIDENT */
  confidentErrors: number; confidentWrong: number; confidentSpurious: number;
  /** correct values the extractor itself marked below CONFIDENT (a human would be asked to check them) */
  correctButFlagged: number;
}
export const emptySummary = (): Summary => ({ expected: 0, correct: 0, wrong: 0, missed: 0, spurious: 0, confidentErrors: 0, confidentWrong: 0, confidentSpurious: 0, correctButFlagged: 0 });

export function summarize(outcomes: Outcome[], criticalOnly = false): Summary {
  const s = emptySummary();
  for (const o of outcomes) {
    if (criticalOnly && !o.critical) continue;
    const confident = (o.conf ?? 0) >= CONFIDENT;
    if (o.kind !== "spurious") s.expected++;
    if (o.kind === "correct") { s.correct++; if (!confident) s.correctButFlagged++; }
    else if (o.kind === "wrong") { s.wrong++; if (confident) { s.confidentWrong++; s.confidentErrors++; } }
    else if (o.kind === "missed") s.missed++;
    else { s.spurious++; if (confident) { s.confidentSpurious++; s.confidentErrors++; } }
  }
  return s;
}
export const mergeSummaries = (xs: Summary[]): Summary => xs.reduce((a, b) => ({
  expected: a.expected + b.expected, correct: a.correct + b.correct, wrong: a.wrong + b.wrong, missed: a.missed + b.missed, spurious: a.spurious + b.spurious,
  confidentErrors: a.confidentErrors + b.confidentErrors, confidentWrong: a.confidentWrong + b.confidentWrong, confidentSpurious: a.confidentSpurious + b.confidentSpurious,
  correctButFlagged: a.correctButFlagged + b.correctButFlagged,
}), emptySummary());
