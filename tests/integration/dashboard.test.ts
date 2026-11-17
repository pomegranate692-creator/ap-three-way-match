import { beforeAll, describe, expect, it } from "vitest";
import { U, makeApp, pdf } from "../helpers.ts";

describe("dashboard API when nothing has been loaded", () => {
  const t0 = makeApp();
  const m0 = t0.as(U.harbor, "controller");
  it("is honest when empty: zeros, no rate, no trend arrows", async () => {
    const d = (await m0.get("/api/dashboard?days=30")).data;
    expect(d.kpis.processed.value).toBe(0);
    expect(d.kpis.autoMatchRate.value).toBeNull();
    expect(d.kpis.avgProcessingMs.value).toBeNull();
    expect(d.kpis.processed.delta).toBeNull();
    expect(d.data).toEqual({ demo: 0, upload: 0 });
  });

});

describe("dashboard API: uploaded files", () => {
  const t1 = makeApp();
  const dana1 = t1.as(U.harbor, "clerk");
  it("an uploaded invoice counts as uploaded (not demo) data and gets a measured processing time", async () => {
    const r = await dana1.upload([{ name: "inv.pdf", bytes: pdf("B01_INV_INV48137.pdf") }]);
    expect(r.status).toBe(200);
    const d = (await dana1.get("/api/dashboard?days=30&source=upload")).data;
    expect(d.kpis.processed.value).toBe(1);
    expect(d.kpis.avgProcessingMs.samples).toBe(1);
    expect(d.data).toEqual({ demo: 0, upload: 1 });
    expect((await dana1.get("/api/dashboard?days=30&source=demo")).data.kpis.processed.value).toBe(0);
  });
});

describe("dashboard API: every number is derived from stored records (synthetic demo data)", () => {
  const t = makeApp();
  const marcus = t.as(U.harbor, "controller");
  const dana = t.as(U.harbor, "clerk");

  beforeAll(async () => { expect((await marcus.post("/api/demo/load")).status).toBe(200); }, 120_000);

  it("KPIs, donut and trend agree with each other and with the invoice list", async () => {
    const d = (await marcus.get("/api/dashboard?days=30")).data;
    const list = (await marcus.get("/api/bundles")).data as { recommendation: string }[];
    expect(d.kpis.processed.value).toBe(list.length);
    const b = d.buckets;
    expect(b.matched + b.quantity + b.price + b.other).toBe(d.kpis.processed.value);
    expect(d.kpis.autoMatchRate.matched).toBe(b.matched);
    expect(d.kpis.exceptions.value).toBe(d.kpis.processed.value - b.matched);
    expect(d.trend.reduce((a: number, x: any) => a + x.total, 0)).toBe(d.kpis.processed.value);
    expect(d.trend.reduce((a: number, x: any) => a + x.matched, 0)).toBe(b.matched);
    // seeded harbor discrepancies: B05 qty, B06 price, B08 tax (amount) → 6 clean of 9
    expect(b.matched).toBe(6);
    expect(b.quantity).toBe(1);
    expect(b.price).toBe(2);
  });

  it("measures processing time and reports a sample count", async () => {
    const d = (await marcus.get("/api/dashboard?days=30")).data;
    expect(d.kpis.avgProcessingMs.samples).toBeGreaterThan(0);
    expect(d.kpis.avgProcessingMs.value).toBeGreaterThanOrEqual(0);
  });

  it("does not invent a comparison when the previous period has no history", async () => {
    const d = (await marcus.get("/api/dashboard?days=30")).data;
    expect(d.kpis.processed.delta).toBeNull();
    expect(d.kpis.autoMatchRate.delta).toBeNull();
    expect(d.trendNote).toMatch(/at least 5/);
  });

  it("date range filters: 7 days shows fewer invoices than 30; 'all' shows every invoice", async () => {
    const w = (await marcus.get("/api/dashboard?days=7")).data.kpis.processed.value;
    const m = (await marcus.get("/api/dashboard?days=30")).data.kpis.processed.value;
    const all = (await marcus.get("/api/dashboard?days=0")).data.kpis.processed.value;
    expect(w).toBeLessThan(m);
    expect(all).toBeGreaterThanOrEqual(9);
  });

  it("separates demo from uploaded data", async () => {
    expect((await marcus.get("/api/dashboard?days=0&source=upload")).data.kpis.processed.value).toBe(0);
    expect((await marcus.get("/api/dashboard?days=0&source=demo")).data.kpis.processed.value).toBe(9);
  });

  it("exception categories count open exceptions and filter the exception list", async () => {
    const d = (await marcus.get("/api/dashboard?days=0")).data;
    const cat = Object.fromEntries(d.categories.map((c: any) => [c.key, c.open]));
    expect(cat.quantity).toBeGreaterThanOrEqual(1);
    expect(cat.price).toBeGreaterThanOrEqual(1);
    const q = (await marcus.get("/api/exceptions?category=quantity")).data as { code: string }[];
    expect(q.length).toBe(cat.quantity);
    expect(q.every((e) => e.code.startsWith("QTY") || e.code === "UNORDERED_ITEM")).toBe(true);
  });

  it("demo dates are synthetic, spread over time, and the audit trail keeps the real load time", async () => {
    const list = (await marcus.get("/api/bundles")).data as { createdAt: string }[];
    const days = new Set(list.map((b) => b.createdAt.slice(0, 10)));
    expect(days.size).toBeGreaterThan(4);
  });

  it("missing-PO scenario: invoice without a PO is blocked, categorised as missing PO, and loads only once", async () => {
    const r = await marcus.post("/api/demo/scenario/missing-po");
    expect(r.status).toBe(200);
    const d = (await marcus.get(`/api/bundles/${r.data.bundleId}`)).data;
    expect(d.exceptions.some((e: any) => e.code === "MISSING_DATA" && /purchase order/i.test(e.title))).toBe(true);
    const cat = (await marcus.get("/api/dashboard?days=0")).data.categories.find((c: any) => c.key === "missing_po");
    expect(cat.open).toBeGreaterThanOrEqual(1);
    expect((await marcus.get("/api/exceptions?category=missing_po")).data.length).toBe(cat.open);
    expect((await marcus.post("/api/demo/scenario/missing-po")).status).toBe(422);
  });

  it("documents list and removal: wrong file removed, bundle re-evaluated, audited; clerk cannot remove", async () => {
    const docs = (await marcus.get("/api/documents")).data as any[];
    expect(docs.length).toBeGreaterThan(9);
    const grn = docs.find((d) => d.docType === "GRN" && d.bundles.length === 1);
    expect(grn).toBeTruthy();
    expect((await dana.del(`/api/documents/${grn.id}`)).status).toBe(403);
    const r = await marcus.del(`/api/documents/${grn.id}`);
    expect(r.status).toBe(200);
    expect(r.data.bundlesAffected).toHaveLength(1);
    const after = (await marcus.get("/api/documents")).data as any[];
    expect(after.find((d) => d.id === grn.id)).toBeUndefined();
    const audit = (await marcus.get("/api/audit?action=document.removed")).data as any[];
    expect(audit.length).toBe(1);
    const detail = (await marcus.get(`/api/bundles/${grn.bundles[0].id}`)).data;
    expect(detail.exceptions.some((e: any) => e.code === "MISSING_RECEIPT")).toBe(true);
  });

});
