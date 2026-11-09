import { describe, expect, it } from "vitest";
import { evaluateMatching } from "../../server/eval/matching.ts";

describe("25-bundle synthetic fixture set (AT-1)", () => {
  it("detects all 8 seeded discrepancies with exactly the intended exception code and no false alarms on the 17 clean bundles", async () => {
    const r = await evaluateMatching();
    expect(r.bundles).toBe(25);
    expect(r.seeded).toBe(8);
    expect(r.clean).toBe(17);
    for (const d of r.details) {
      expect(d.got, `${d.id} ${d.title}`).toEqual(d.expected);
      expect(d.recommendation, `${d.id} recommendation`).toBe(d.expectedRecommendation);
    }
    expect(r.engine).toMatchObject({ tp: 8, fp: 0, fn: 0, tn: 17 });
  }, 180_000);

  it("the deterministic baselines are measurably worse (so the comparison is meaningful)", async () => {
    const r = await evaluateMatching();
    expect(r.baselineTotalOnly.f1).toBeLessThan(r.engine.f1);
    expect(r.baselineStrictLines.f1).toBeLessThan(r.engine.f1);
    expect(r.baselineTotalOnly.fn).toBeGreaterThan(0); // misses real problems (e.g. over-billing that keeps the total equal)
    expect(r.baselineStrictLines.fp + r.baselineTotalOnly.fp).toBeGreaterThan(0); // and raises false alarms on partial receipts
  }, 180_000);
});
