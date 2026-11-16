import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loadManifest } from "../../server/eval/extraction.ts";
import { STRESS_DIR, loadStressTruth, mergeSummaries, scoreStressDoc, summarize, type GoldDoc } from "../../server/eval/stress.ts";
import type { ExtractionResult } from "../../shared/schemas.ts";

const field = (key: string, value: string | null, confidence: number) => ({ key, value, raw: value ?? "", bbox: null, wordIds: [], confidence, reason: "t", extractor: "rules@1.0" });
const result = (fields: ReturnType<typeof field>[]): ExtractionResult => ({ docType: "INVOICE", classification: { confidence: 1, reason: "t" }, fields, lineCount: 0, warnings: [] });
const GOLD: GoldDoc = {
  docType: "INVOICE",
  fields: { docNumber: "A-1", poRef: null, total: "100.5", currency: "USD", supplierName: "Acme Co" },
  lines: [{ sku: "X-1", qty: "2", unitPrice: "10", amount: "20" }, { sku: "X-2", qty: "1", unitPrice: "5", amount: "5" }],
};

describe("synthetic stress fixtures (fixtures/stress)", () => {
  const truth = loadStressTruth();

  it("has 10 invoices across the three damage levels, each with an image on disk", () => {
    expect(truth.docs).toHaveLength(10);
    const count = (l: string) => truth.docs.filter((d) => d.damage === l).length;
    expect([count("light"), count("medium"), count("heavy")]).toEqual([3, 4, 3]);
    for (const d of truth.docs) expect(statSync(join(STRESS_DIR, d.file)).size, d.file).toBeGreaterThan(10_000);
    expect(existsSync(join(STRESS_DIR, "ground_truth.json"))).toBe(true);
  });

  it("ground truth is internally consistent: lines add to the subtotal, and the total adds up exactly", () => {
    for (const d of truth.docs) {
      const f = d.gold.fields;
      const sum = d.gold.lines.reduce((s, l) => s.plus(l.amount!), new Decimal(0));
      expect(sum.toString(), `${d.id} subtotal`).toBe(new Decimal(f.subtotal!).toString());
      const expected = new Decimal(f.subtotal!).minus(f.discountTotal ?? 0).plus(f.freight ?? 0).plus(f.taxTotal!);
      expect(expected.toString(), `${d.id} total`).toBe(new Decimal(f.total!).toString());
    }
  });

  it("uses vendors, invoice numbers and layouts that are not in the original 25-bundle fixtures", () => {
    const m = loadManifest();
    const known = new Set(m.bundles.flatMap((b) => Object.values(b.gold).map((g) => g?.fields.supplierName)).filter(Boolean));
    const knownNumbers = new Set(m.bundles.flatMap((b) => Object.values(b.gold).map((g) => g?.fields.docNumber)).filter(Boolean));
    for (const d of truth.docs) {
      expect(known.has(d.gold.fields.supplierName), d.gold.fields.supplierName!).toBe(false);
      expect(knownNumbers.has(d.gold.fields.docNumber), d.gold.fields.docNumber!).toBe(false);
    }
  });
});

describe("stress scoring", () => {
  it("counts correct, wrong, missed and spurious reads, and which errors were confident (>= 0.8)", () => {
    const r = result([
      field("docNumber", "A-1", 0.95),          // correct
      field("currency", "USD", 0.6),            // correct but flagged for review
      field("total", "100.05", 0.9),            // wrong, confident
      field("poRef", "PO-9", 0.85),             // spurious (truth: absent), confident
      field("line.1.sku", "X-1", 0.9), field("line.1.qty", "2", 0.9), field("line.1.unitPrice", "10.00", 0.9), field("line.1.amount", "21", 0.5), // amount wrong, not confident
      // line 2 entirely missing
    ]);
    const s = summarize(scoreStressDoc(r, GOLD));
    expect(s).toMatchObject({ expected: 12, correct: 5, wrong: 2, missed: 5, spurious: 1, confidentWrong: 1, confidentSpurious: 1, confidentErrors: 2, correctButFlagged: 1 });
    expect(s.correct + s.wrong + s.missed).toBe(s.expected);
  });

  it("still pairs a row whose SKU was misread with the gold row at that position, instead of calling everything missed", () => {
    const r = result([field("line.1.sku", "X-1", 0.9), field("line.1.qty", "2", 0.9), field("line.2.sku", "X-Z", 0.4), field("line.2.qty", "1", 0.9)]);
    const outcomes = scoreStressDoc(r, GOLD);
    expect(outcomes.find((o) => o.key === "line.2.sku")).toMatchObject({ kind: "wrong", got: "X-Z" });
    expect(outcomes.find((o) => o.key === "line.2.qty")).toMatchObject({ kind: "correct" });
  });

  it("compares money by value, not by text, and reports key fields separately", () => {
    const r = result([field("total", "100.50", 0.9), field("docNumber", "A-1", 0.9)]);
    const o = scoreStressDoc(r, GOLD);
    expect(o.find((x) => x.key === "total")?.kind).toBe("correct");
    expect(summarize(o).expected).toBe(12);
    expect(summarize(o, true).expected).toBe(11); // supplierName is not a key field
  });

  it("merges per-document summaries without losing counts", () => {
    const a = summarize(scoreStressDoc(result([field("docNumber", "A-1", 0.9)]), GOLD));
    expect(mergeSummaries([a, a]).correct).toBe(2);
    expect(mergeSummaries([a, a]).expected).toBe(a.expected * 2);
  });
});
