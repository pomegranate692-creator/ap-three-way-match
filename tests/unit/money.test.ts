import { describe, expect, it } from "vitest";
import { D, Dec, fixed, percentOf, roundMoney, s, sum, withinTolerance } from "../../shared/money.ts";
import { dice, daysBetween, formatInZone, normDocNumber, normSupplier, parseDate, parseNumber, parsePercent, supplierSimilarity } from "../../shared/normalize.ts";
import { csvCell, neutralise, toCsv } from "../../shared/csvSafe.ts";

describe("decimal money maths (AT-3)", () => {
  it("is exact where JS floats are not", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(s(D("0.1").plus("0.2"))).toBe("0.3");
    expect(s(sum(["19.99", "5.01", "0.10"].map((x) => D(x))))).toBe("25.1");
  });
  it("rounds half-up to the currency's minor unit", () => {
    expect(s(roundMoney(D("2.675"), "USD"))).toBe("2.68"); // float rounding gives 2.67
    expect(s(roundMoney(D("1.005"), "USD"))).toBe("1.01");
    expect(s(roundMoney(D("-2.675"), "USD"))).toBe("-2.68");
    expect(s(roundMoney(D("1234.5"), "JPY"))).toBe("1235");
    expect(fixed(D("3"), 2)).toBe("3.00");
  });
  it("computes tax like an invoice would", () => {
    expect(s(roundMoney(percentOf(D("3775.00"), D("8.25")), "USD"))).toBe("311.44"); // 311.4375
    expect(s(roundMoney(percentOf(D("1503.25"), D("19")), "EUR"))).toBe("285.62");
  });
  it("tolerance boundary is inclusive and uses the larger of abs / pct", () => {
    expect(withinTolerance(D("100.01"), D("100"), D("0.01"), D("0"))).toBe(true);
    expect(withinTolerance(D("100.011"), D("100"), D("0.01"), D("0"))).toBe(false);
    expect(withinTolerance(D("101"), D("100"), D("0"), D("1"))).toBe(true); // exactly 1%
    expect(withinTolerance(D("101.01"), D("100"), D("0"), D("1"))).toBe(false);
    expect(withinTolerance(D("101.5"), D("100"), D("2"), D("1"))).toBe(true); // abs wins
  });
  it("never goes through binary floating point for large values", () => {
    expect(s(D("9007199254740993").plus(1))).toBe("9007199254740994");
    expect(new Dec("0.1").times(3).eq("0.3")).toBe(true);
  });
});

describe("locale-aware number parsing", () => {
  const cases: [string, "us" | "eu", string][] = [
    ["1,234.56", "us", "1234.56"], ["1.234,56", "eu", "1234.56"], ["$3,775.00", "us", "3775.00".replace(/\.00$/, "")],
    ["1.234,56 €", "eu", "1234.56"], ["-$50.00", "us", "-50"], ["(50.00)", "us", "-50"], ["12,5", "eu", "12.5"], ["12.5", "us", "12.5"],
    ["1,234", "us", "1234"], ["1.234", "eu", "1234"], ["1.234", "us", "1.234"], ["EUR 1.000,00", "eu", "1000"], ["USD1,000.00", "us", "1000"], ["0,50", "eu", "0.5"],
    ["1,234,567.89", "us", "1234567.89"], ["1.234.567,89", "eu", "1234567.89"],
  ];
  for (const [input, hint, expected] of cases) {
    it(`${input} (${hint}) → ${expected}`, () => {
      const p = parseNumber(input, hint);
      expect(p.ok).toBe(true);
      expect(D(p.value).eq(D(expected))).toBe(true);
    });
  }
  it("rejects non-numbers and OCR-confusable text is marked as repaired (AT: OCR uncertainty)", () => {
    expect(parseNumber("abc").ok).toBe(false);
    expect(parseNumber("").ok).toBe(false);
    const r = parseNumber("1O0", "us");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("100");
    expect(r.repaired).toBe(true);
    expect(parseNumber("l,2S0.00", "us")).toMatchObject({ repaired: true, value: "1250" });
    expect(parsePercent("8.25%").value).toBe("8.25");
  });
});

describe("dates are calendar dates (no invented timezone)", () => {
  it("parses common formats and respects the organisation's order for ambiguous ones", () => {
    expect(parseDate("2026-03-04")).toBe("2026-03-04");
    expect(parseDate("04.03.2026")).toBe("2026-03-04");
    expect(parseDate("03/04/2026", "MDY")).toBe("2026-03-04");
    expect(parseDate("03/04/2026", "DMY")).toBe("2026-04-03");
    expect(parseDate("25/03/2026", "MDY")).toBe("2026-03-25"); // unambiguous: day > 12
    expect(parseDate("Mar 4, 2026")).toBe("2026-03-04");
    expect(parseDate("4 März 2026")).toBe("2026-03-04");
  });
  it("rejects impossible dates", () => {
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("13/13/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
  it("date arithmetic and time-zone display", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
    expect(daysBetween("2026-03-08", "2026-03-09")).toBe(1); // across a US DST change
    expect(formatInZone("2026-03-10T03:30:00.000Z", "America/Chicago")).toContain("09 Mar"); // still the 9th in Chicago
    expect(formatInZone("2026-03-10T03:30:00.000Z", "Europe/Berlin")).toContain("10 Mar");
  });
});

describe("identity normalisation", () => {
  it("collapses invoice-number formatting so re-sends are caught", () => {
    expect(normDocNumber("INV-49507")).toBe(normDocNumber("inv 49507"));
    expect(normDocNumber("INV 49507")).toBe(normDocNumber("Inv.49507"));
    expect(normDocNumber("INV-49507")).not.toBe(normDocNumber("INV-49508"));
  });
  it("matches suppliers across legal-suffix and punctuation noise but not different entities", () => {
    expect(normSupplier("Summit Tool & Die LLC")).toBe(normSupplier("SUMMIT TOOL AND DIE, L.L.C.".replace("L.L.C.", "LLC")));
    expect(supplierSimilarity("Ironwood Fasteners Inc.", "Ironwood Fasteners, Inc")).toBeGreaterThan(0.95);
    expect(supplierSimilarity("Ironwood Fasteners Inc.", "Summit Tool & Die LLC")).toBeLessThan(0.5);
    expect(supplierSimilarity("Ironwood Fasteners Inc.", "Ironwood Fastners Inc.")).toBeGreaterThan(0.85); // typo tolerated
    expect(dice("night", "nacht")).toBeCloseTo(0.25, 2);
  });
});

describe("spreadsheet formula-injection defence (AT-8)", () => {
  it("neutralises dangerous prefixes", () => {
    for (const bad of ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) expect(neutralise(bad).startsWith("'")).toBe(true);
    expect(neutralise("Normal Supplier Ltd")).toBe("Normal Supplier Ltd");
  });
  it("keeps genuine negative numbers numeric but still quotes hostile text", () => {
    expect(csvCell("-12.50", { numeric: true })).toBe("-12.50");
    expect(csvCell("-12.50")).toBe("'-12.50");
    expect(csvCell('=cmd|"/c calc"!A1')).toBe(`"'=cmd|""/c calc""!A1"`);
  });
  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'he said "hi"'], ["line1\nline2", null]]);
    expect(csv).toContain('"x,y","he said ""hi"""');
    expect(csv).toContain('"line1\nline2",');
    expect(csv.startsWith("﻿")).toBe(true);
  });
});
