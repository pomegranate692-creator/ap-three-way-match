import { tryD } from "../../shared/money.ts";
import type { ExtractionResult, TextLayer } from "../../shared/schemas.ts";

/** One OCR reading of an image, taken through the whole rules pipeline. */
export interface Reading {
  layer: TextLayer;
  rulesRaw: ExtractionResult;
  rejected: { key: string; reason: string }[];
  extraction: ExtractionResult;
}

/** Confidence given to a value two readings of the same image disagree on (below the 0.8 review threshold). */
export const DISAGREEMENT_CAP = 0.5;
const NOTE = "two readings of the image disagree on this value";

/** Strength of a reading = total confidence of the fields it produced (rewards finding more fields and finding them reliably). */
export const strength = (e: ExtractionResult): number => e.fields.reduce((s, f) => s + (f.value !== null ? f.confidence : 0), 0);

/** The strongest reading; ties go to the earliest (the original image). */
export function chooseReading(readings: Reading[]): Reading {
  return readings.reduce((best, r) => (strength(r.extraction) > strength(best.extraction) ? r : best));
}

const same = (a: string, b: string) => {
  const x = tryD(a), y = tryD(b);
  return x && y ? x.eq(y) : a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
};

/**
 * Two independent reads of the same pixels that disagree mean at least one is wrong, and we cannot tell which: cap the chosen
 * value's confidence so a person checks it. A field only one reading found keeps its own confidence. Never raises a confidence.
 */
export function capDisagreements(chosen: ExtractionResult, others: ExtractionResult[]): ExtractionResult {
  const disputed = new Set<string>();
  for (const o of others) {
    const theirs = new Map(o.fields.filter((f) => f.value !== null).map((f) => [f.key, f.value!]));
    for (const f of chosen.fields) {
      const t = theirs.get(f.key);
      if (f.value !== null && t !== undefined && !same(f.value, t)) disputed.add(f.key);
    }
  }
  if (disputed.size === 0) return chosen;
  return {
    ...chosen,
    fields: chosen.fields.map((f) => (disputed.has(f.key) && f.confidence > DISAGREEMENT_CAP ? { ...f, confidence: DISAGREEMENT_CAP, reason: `${f.reason}; ${NOTE}` } : f)),
    warnings: [...chosen.warnings, `OCR: ${disputed.size} value${disputed.size === 1 ? "" : "s"} read differently from the original and the enhanced image; marked for review.`],
  };
}
