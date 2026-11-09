import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readPdfTextLayer } from "../ingest/pdfText.ts";
import { extractWithRules } from "../extract/rulesExtractor.ts";
import { groundResult } from "../extract/grounding.ts";
import { tryD } from "../../shared/money.ts";
import type { ExtractionResult } from "../../shared/schemas.ts";

export const FIXTURE_DIR = join(import.meta.dirname, "..", "..", "fixtures");

export interface Manifest {
  orgs: { id: string; name: string; timezone: string; baseCurrency: string; settings: Record<string, unknown>; users: { id: string; name: string; role: "clerk" | "controller" | "purchasing" }[] }[];
  bundles: {
    id: string; n: number; orgId: string; title: string;
    files: { po?: string; grn?: string; invoice: string };
    gold: Record<"po" | "grn" | "invoice", { docType: string; fields: Record<string, string | null>; lines: Record<string, string | null>[] } | undefined>;
    expectedExceptions: string[]; expectedRecommendation: string;
  }[];
}
export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as Manifest;
}
export function fixtureBytes(file: string): Buffer {
  return readFileSync(join(FIXTURE_DIR, "pdf", file));
}

const NUMERIC = new Set(["subtotal", "discountTotal", "freight", "taxTotal", "total", "taxRate", "qty", "unitPrice", "discountPct", "amount"]);
function equal(key: string, a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == b;
  if (NUMERIC.has(key)) {
    const x = tryD(a), y = tryD(b);
    return !!x && !!y && x.eq(y);
  }
  return a === b;
}

export interface Tally { tp: number; fp: number; fn: number }
export const emptyTally = (): Tally => ({ tp: 0, fp: 0, fn: 0 });
export const prf = (t: Tally) => {
  const p = t.tp + t.fp ? t.tp / (t.tp + t.fp) : 1;
  const r = t.tp + t.fn ? t.tp / (t.tp + t.fn) : 1;
  return { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
};
const add = (a: Tally, b: Tally) => { a.tp += b.tp; a.fp += b.fp; a.fn += b.fn; };

export interface DocScore {
  bundle: string; docType: string; file: string; header: Tally; lines: Tally;
  goldLines: number; goldLinesFullyCorrect: number; classifiedAs: string; mismatches: string[];
}

export function scoreDocument(result: ExtractionResult, gold: { docType: string; fields: Record<string, string | null>; lines: Record<string, string | null>[] }, bundle: string, file: string): DocScore {
  const header = emptyTally();
  const lines = emptyTally();
  const mismatches: string[] = [];
  const got = new Map(result.fields.map((f) => [f.key, f.value]));

  for (const [k, gv] of Object.entries(gold.fields)) {
    const ev = got.get(k) ?? null;
    if (gv === null) { if (ev !== null) { header.fp++; mismatches.push(`${k}: expected absent, got ${ev}`); } continue; }
    if (equal(k, ev, gv)) header.tp++;
    else { header.fn++; if (ev !== null) header.fp++; mismatches.push(`${k}: expected ${gv}, got ${ev}`); }
  }
  for (const f of result.fields) {
    if (!f.key.startsWith("line.") && !(f.key in gold.fields) && f.value !== null) { header.fp++; mismatches.push(`${f.key}: unexpected field ${f.value}`); }
  }

  // line alignment by (sku, occurrence)
  const extractedLines = new Map<string, Record<string, string | null>>();
  const occ = new Map<string, number>();
  const idxs = new Set<number>();
  for (const f of result.fields) { const m = f.key.match(/^line\.(\d+)\./); if (m) idxs.add(+m[1]!); }
  for (const i of [...idxs].sort((a, b) => a - b)) {
    const rec: Record<string, string | null> = {};
    for (const f of result.fields) if (f.key.startsWith(`line.${i}.`)) rec[f.key.split(".")[2]!] = f.value;
    const sku = rec.sku ?? `?${i}`;
    const n = (occ.get(sku) ?? 0) + 1; occ.set(sku, n);
    extractedLines.set(`${sku}#${n}`, rec);
  }
  const goldOcc = new Map<string, number>();
  let fullyCorrect = 0;
  const used = new Set<string>();
  const critical = gold.docType === "GRN" ? ["sku", "qty"] : ["sku", "qty", "unitPrice", "amount"];
  for (const gl of gold.lines) {
    const sku = gl.sku!;
    const n = (goldOcc.get(sku) ?? 0) + 1; goldOcc.set(sku, n);
    const key = `${sku}#${n}`;
    const el = extractedLines.get(key);
    used.add(key);
    let allCrit = !!el;
    for (const [k, gv] of Object.entries(gl)) {
      const ev = el?.[k] ?? null;
      if (gv === null) { if (ev !== null) { lines.fp++; mismatches.push(`${key}.${k}: expected absent, got ${ev}`); } continue; }
      if (equal(k, ev, gv)) lines.tp++;
      else { lines.fn++; if (ev !== null) lines.fp++; mismatches.push(`${key}.${k}: expected ${gv}, got ${ev}`); if (critical.includes(k)) allCrit = false; }
    }
    if (allCrit) fullyCorrect++;
  }
  for (const [key, rec] of extractedLines) if (!used.has(key)) { lines.fp += Object.values(rec).filter((v) => v !== null).length; mismatches.push(`extra extracted line ${key}`); }

  return { bundle, docType: gold.docType, file, header, lines, goldLines: gold.lines.length, goldLinesFullyCorrect: fullyCorrect, classifiedAs: result.docType, mismatches };
}

export async function evaluateExtraction() {
  const m = loadManifest();
  const scores: DocScore[] = [];
  const seen = new Set<string>();
  for (const b of m.bundles) {
    const org = m.orgs.find((o) => o.id === b.orgId)!;
    const hint = { numberLocale: (org.settings.numberLocale as "us" | "eu") ?? "us", dateOrder: (org.settings.dateOrder as "MDY" | "DMY") ?? "MDY" };
    for (const [slot, file] of [["po", b.files.po], ["grn", b.files.grn], ["invoice", b.files.invoice]] as const) {
      if (!file || !b.gold[slot]) continue;
      // identical bytes (e.g. bundle 25 re-uses bundle 11's PO/GRN) are deduplicated by the app, so score once
      const bytes = fixtureBytes(file);
      const sig = `${slot}:${bytes.length}:${bytes.subarray(0, 4096).toString("base64").slice(0, 64)}:${b.gold[slot]!.fields.docNumber}`;
      if (seen.has(sig) && b.n === 25 && slot !== "invoice") continue;
      seen.add(sig);
      const { layer } = await readPdfTextLayer(bytes);
      const raw = extractWithRules(layer, hint);
      const grounded = groundResult(raw, layer, hint);
      scores.push(scoreDocument(grounded, b.gold[slot]!, b.id, file));
    }
  }
  const header = emptyTally(), lines = emptyTally();
  let goldLines = 0, fullyCorrect = 0;
  const byType: Record<string, { header: Tally; lines: Tally }> = {};
  for (const s of scores) {
    add(header, s.header); add(lines, s.lines);
    goldLines += s.goldLines; fullyCorrect += s.goldLinesFullyCorrect;
    const t = (byType[s.docType] ??= { header: emptyTally(), lines: emptyTally() });
    add(t.header, s.header); add(t.lines, s.lines);
  }
  const all = emptyTally(); add(all, header); add(all, lines);
  return {
    documents: scores.length,
    overall: prf(all), header: prf(header), lines: prf(lines),
    lineItemAccuracy: goldLines ? fullyCorrect / goldLines : 1, goldLines, goldLinesFullyCorrect: fullyCorrect,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { header: prf(v.header), lines: prf(v.lines) }])),
    classificationAccuracy: scores.filter((s) => s.classifiedAs === s.docType).length / scores.length,
    scores,
  };
}
