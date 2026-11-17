import { describe, expect, it } from "vitest";
import { capUnreconciledFigures, UNRECONCILED_CAP } from "../../server/extract/arithmeticCheck.ts";
import type { ExtractionResult } from "../../shared/schemas.ts";

const f = (key: string, value: string | null, confidence = 0.9) => ({ key, value, raw: value ?? "", bbox: null, wordIds: [], confidence, reason: "t", extractor: "rules@1.0" });
const result = (fields: ReturnType<typeof f>[]): ExtractionResult => ({ docType: "INVOICE", classification: { confidence: 1, reason: "t" }, fields, lineCount: 0, warnings: [] });
const conf = (r: ExtractionResult, key: string) => r.fields.find((x) => x.key === key)!.confidence;

describe("capUnreconciledFigures (OCR guard: figures that do not add up were probably misread)", () => {
  it("leaves consistent figures alone", () => {
    const r = result([f("subtotal", "1000"), f("freight", "20"), f("taxTotal", "82.5"), f("total", "1102.5"), f("line.1.qty", "4"), f("line.1.unitPrice", "250"), f("line.1.amount", "1000")]);
    expect(capUnreconciledFigures(r).fields.map((x) => x.confidence)).toEqual(r.fields.map((x) => x.confidence));
  });

  it("caps every total-section figure when subtotal + freight + tax does not equal the total (a digit was misread somewhere)", () => {
    const out = capUnreconciledFigures(result([f("subtotal", "1000"), f("freight", "20"), f("taxTotal", "82.5"), f("total", "1102.8"), f("currency", "USD")]));
    for (const k of ["subtotal", "freight", "taxTotal", "total"]) expect(conf(out, k)).toBeLessThanOrEqual(UNRECONCILED_CAP);
    expect(conf(out, "currency")).toBe(0.9); // unrelated fields untouched
    expect(out.fields.find((x) => x.key === "total")!.reason).toMatch(/do not add up/);
  });

  it("accounts for a discount, and tolerates a one-cent rounding difference", () => {
    const ok = capUnreconciledFigures(result([f("subtotal", "1000"), f("discountTotal", "50"), f("taxTotal", "78.38"), f("total", "1028.37")]));
    expect(conf(ok, "total")).toBe(0.9);
  });

  it("caps a line whose quantity × price does not equal its amount, but not the other lines", () => {
    const out = capUnreconciledFigures(result([
      f("line.1.qty", "12"), f("line.1.unitPrice", "38.40"), f("line.1.amount", "460.80"),
      f("line.2.qty", "20"), f("line.2.unitPrice", "21.75"), f("line.2.amount", "485.00"),
    ]));
    expect(conf(out, "line.1.amount")).toBe(0.9);
    for (const k of ["line.2.qty", "line.2.unitPrice", "line.2.amount"]) expect(conf(out, k)).toBeLessThanOrEqual(UNRECONCILED_CAP);
  });

  it("applies a line discount percentage", () => {
    const out = capUnreconciledFigures(result([f("line.1.qty", "24"), f("line.1.unitPrice", "14.80"), f("line.1.discountPct", "10"), f("line.1.amount", "319.68")]));
    expect(out.fields.every((x) => x.confidence === 0.9)).toBe(true);
  });

  it("does nothing when a needed figure is missing (nothing to check against)", () => {
    const r = result([f("subtotal", "1000"), f("total", "1102.8"), f("line.1.qty", "2"), f("line.1.amount", "9")]);
    expect(capUnreconciledFigures(r).fields.map((x) => x.confidence)).toEqual(r.fields.map((x) => x.confidence));
  });

  it("never raises a confidence, and does not mutate its input", () => {
    const r = result([f("subtotal", "1000", 0.3), f("taxTotal", "82.5", 0.3), f("total", "9999", 0.3)]);
    const out = capUnreconciledFigures(r);
    expect(conf(out, "total")).toBe(0.3);
    expect(r.fields[2]!.reason).toBe("t");
  });
});
