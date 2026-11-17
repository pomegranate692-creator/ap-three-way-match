import { describe, expect, it } from "vitest";
import { DISAGREEMENT_CAP, capDisagreements, chooseReading, strength, type Reading } from "../../server/extract/readings.ts";
import type { ExtractionResult } from "../../shared/schemas.ts";

const f = (key: string, value: string | null, confidence = 0.9) => ({ key, value, raw: value ?? "", bbox: null, wordIds: [], confidence, reason: "t", extractor: "rules@1.0" });
const ex = (...fields: ReturnType<typeof f>[]): ExtractionResult => ({ docType: "INVOICE", classification: { confidence: 1, reason: "t" }, fields, lineCount: 0, warnings: [] });
const reading = (tag: string, e: ExtractionResult): Reading => ({ layer: { source: "ocr", pages: [] } as never, rulesRaw: e, rejected: [{ key: tag, reason: tag }], extraction: e });

describe("chooseReading", () => {
  it("prefers the reading that found more (and more reliable) fields", () => {
    const orig = reading("orig", ex(f("total", "10", 0.9)));
    const enhanced = reading("enh", ex(f("total", "10", 0.9), f("docNumber", "A-1", 0.8), f("line.1.sku", "X", 0.8)));
    expect(chooseReading([orig, enhanced])).toBe(enhanced);
    expect(chooseReading([enhanced, orig])).toBe(enhanced);
  });
  it("keeps the original on a tie, and ignores fields with no value", () => {
    const orig = reading("orig", ex(f("total", "10", 0.9)));
    const enhanced = reading("enh", ex(f("total", "10", 0.9), f("poRef", null, 0.99)));
    expect(strength(enhanced.extraction)).toBe(strength(orig.extraction));
    expect(chooseReading([orig, enhanced])).toBe(orig);
  });
});

describe("capDisagreements", () => {
  it("caps a value the other reading read differently, and says so", () => {
    const out = capDisagreements(ex(f("total", "3004.08", 0.88), f("docDate", "2026-02-21", 0.9)), [ex(f("total", "3004.05", 0.93), f("docDate", "2026-02-21", 0.8))]);
    expect(out.fields.find((x) => x.key === "total")!.confidence).toBe(DISAGREEMENT_CAP);
    expect(out.fields.find((x) => x.key === "total")!.reason).toMatch(/disagree/);
    expect(out.fields.find((x) => x.key === "docDate")!.confidence).toBe(0.9);
    expect(out.warnings.join(" ")).toMatch(/1 value read differently/);
  });
  it("compares money by value (10.50 equals 10.5) and text with whitespace collapsed", () => {
    const out = capDisagreements(ex(f("total", "10.50"), f("supplierName", "Acme  Co")), [ex(f("total", "10.5"), f("supplierName", "Acme Co"))]);
    expect(out.fields.every((x) => x.confidence === 0.9)).toBe(true);
  });
  it("leaves a field alone when the other reading did not find it", () => {
    const out = capDisagreements(ex(f("total", "10")), [ex(f("docNumber", "A-1"))]);
    expect(out.fields[0]!.confidence).toBe(0.9);
  });
  it("never raises a confidence and does not mutate its input", () => {
    const chosen = ex(f("total", "10", 0.3));
    const out = capDisagreements(chosen, [ex(f("total", "11"))]);
    expect(out.fields[0]!.confidence).toBe(0.3);
    expect(chosen.fields[0]!.reason).toBe("t");
  });
});
