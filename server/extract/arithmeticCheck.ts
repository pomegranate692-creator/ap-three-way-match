import { Dec, tryD } from "../../shared/money.ts";
import type { ExtractionResult } from "../../shared/schemas.ts";

/**
 * Cross-check for text read by OCR. A misread digit usually breaks the page's own arithmetic (qty × price ≠ amount,
 * subtotal − discount + freight + tax ≠ total). When it does, we cannot tell WHICH figure is wrong, so every figure in the
 * broken relationship is capped below the review threshold and a person is asked to check it. Deterministic; never raises a confidence.
 */
export const UNRECONCILED_CAP = 0.5;
const TOTAL_TOL = new Dec("0.02");
const LINE_TOL = new Dec("0.011");
const NOTE = "figures on the page do not add up, so one of them may have been misread";

export function capUnreconciledFigures(result: ExtractionResult): ExtractionResult {
  const val = (key: string): Dec | null => tryD(result.fields.find((f) => f.key === key)?.value);
  const suspect = new Set<string>();

  const subtotal = val("subtotal"), tax = val("taxTotal"), total = val("total");
  if (subtotal && tax && total) {
    const expected = subtotal.minus(val("discountTotal") ?? 0).plus(val("freight") ?? 0).plus(tax);
    if (expected.minus(total).abs().gt(TOTAL_TOL)) ["subtotal", "discountTotal", "freight", "taxTotal", "total"].forEach((k) => suspect.add(k));
  }

  const lines = new Set(result.fields.map((f) => f.key.match(/^line\.(\d+)\./)?.[1]).filter((n): n is string => !!n));
  for (const n of lines) {
    const qty = val(`line.${n}.qty`), price = val(`line.${n}.unitPrice`), amount = val(`line.${n}.amount`);
    if (!qty || !price || !amount) continue;
    const disc = val(`line.${n}.discountPct`) ?? new Dec(0);
    const expected = qty.times(price).times(new Dec(100).minus(disc)).div(100).toDecimalPlaces(2);
    if (expected.minus(amount).abs().gt(LINE_TOL)) ["qty", "unitPrice", "discountPct", "amount"].forEach((k) => suspect.add(`line.${n}.${k}`));
  }
  if (suspect.size === 0) return result;

  return {
    ...result,
    fields: result.fields.map((f) => (suspect.has(f.key) && f.confidence > UNRECONCILED_CAP ? { ...f, confidence: UNRECONCILED_CAP, reason: `${f.reason}; ${NOTE}` } : f)),
    warnings: [...result.warnings, `OCR: ${NOTE} (totals or line amounts). The affected values are marked for review.`],
  };
}
