import { beforeAll, describe, expect, it } from "vitest";
import { U, bundleByLabel, makeApp, pdf } from "../helpers.ts";

describe("end-to-end workflow over the real HTTP app (synthetic data)", () => {
  const t = makeApp();
  const dana = t.as(U.harbor, "clerk");
  const marcus = t.as(U.harbor, "controller");
  const priya = t.as(U.harbor, "purchasing");

  beforeAll(async () => {
    const r = await marcus.post("/api/demo/load");
    expect(r.status).toBe(200);
    expect(r.data.bundlesLoaded).toBe(9);
    expect(r.data.rejected).toBe(0);
  }, 120_000);

  it("loads clean bundles as READY and seeded discrepancies as exceptions (AT-1)", async () => {
    const list = (await dana.get("/api/bundles")).data as any[];
    expect(list).toHaveLength(9);
    const byLabel = Object.fromEntries(list.map((b) => [b.label, b]));
    for (const clean of ["B01", "B02", "B03", "B04", "B07", "B09"]) expect(byLabel[clean].recommendation, clean).toBe("READY_FOR_APPROVAL");
    expect(byLabel.B05.recommendation).toBe("EXCEPTION_REVIEW");
    expect(byLabel.B06.recommendation).toBe("EXCEPTION_REVIEW");
    expect(byLabel.B08.recommendation).toBe("EXCEPTION_REVIEW");
  });

  it("field provenance carries a page box and a reason for every extracted value", async () => {
    const d = await bundleByLabel(dana, "B05");
    const inv = d.documents.find((x: any) => x.role === "invoice");
    const qty = inv.fields.find((f: any) => f.key === "line.1.qty");
    expect(qty.bbox).toMatchObject({ page: 1 });
    expect(qty.bbox.w).toBeGreaterThan(0);
    expect(qty.wordIds.length).toBeGreaterThan(0);
    expect(qty.reason).toMatch(/qty/i);
    expect(qty.confidence).toBeGreaterThan(0.9);
  });

  let b05: any;
  it("the quantity-mismatch bundle explains itself with the three numbers (demo scenario)", async () => {
    b05 = await bundleByLabel(dana, "B05");
    const e = b05.exceptions.find((x: any) => x.code === "QTY_OVER_RECEIVED");
    expect(e).toBeTruthy();
    expect(e.expected).toBe("80");
    expect(e.actual).toBe("100");
    expect(e.delta).toBe("20");
    expect(e.explanation).toContain("only 80");
    expect(e.canResolve).toBe(false); // clerk does not own receiving disputes
    expect(b05.permissions.approve.ok).toBe(false);
  });

  it("approval is blocked while exceptions are open, and purchasing can never approve (AT-6)", async () => {
    const a = await dana.post(`/api/bundles/${b05.bundle.id}/decision`, { action: "approve" });
    expect(a.status).toBe(409);
    expect(a.data.error.message).toMatch(/exception/);
    const b = await priya.post(`/api/bundles/${b05.bundle.id}/decision`, { action: "approve" });
    expect(b.status).toBe(403);
  });

  it("a human correction persists, re-runs the match as v2, clears the exception and is audited (AT-5)", async () => {
    const inv = b05.documents.find((x: any) => x.role === "invoice");
    const noReason = await dana.put(`/api/documents/${inv.id}/fields/line.1.qty`, { value: "80", reason: "" });
    expect(noReason.status).toBe(422);
    const bad = await dana.put(`/api/documents/${inv.id}/fields/line.1.qty`, { value: "eighty", reason: "typo test" });
    expect(bad.status).toBe(422);

    const ok = await dana.put(`/api/documents/${inv.id}/fields/line.1.qty`, { value: "80", reason: "Supplier confirmed by phone: 20 units back-ordered" });
    expect(ok.status).toBe(200);
    expect(ok.data.before).toBe("100");
    expect(ok.data.after).toBe("80");
    expect(ok.data.runs[0].version).toBe(2);

    const after = await bundleByLabel(dana, "B05");
    expect(after.run.version).toBe(2);
    // qty corrected to 80, but stated amount (100 × 29.95) no longer equals 80 × 29.95 → line arithmetic now flagged: the engine does not trust a single edit
    expect(after.exceptions.some((e: any) => e.code === "QTY_OVER_RECEIVED")).toBe(false);
    expect(after.exceptions.some((e: any) => e.code === "LINE_ARITHMETIC")).toBe(true);
    const f = after.documents.find((x: any) => x.role === "invoice").fields.find((x: any) => x.key === "line.1.qty");
    expect(f).toMatchObject({ value: "80", corrected: true, originalValue: "100", extractor: "human", confidence: 1 });
    expect(after.corrections[0]).toMatchObject({ fieldKey: "line.1.qty", before: "100", after: "80" });
    expect(after.audit.some((a: any) => a.action === "field.corrected")).toBe(true);
    expect(after.audit.some((a: any) => a.action === "exception.cleared")).toBe(true);
  });

  it("fixing the dependent amount makes the bundle trustworthy, and the corrector cannot approve own work (SoD)", async () => {
    const d = await bundleByLabel(dana, "B05");
    const inv = d.documents.find((x: any) => x.role === "invoice");
    for (const [key, value] of [["line.1.amount", "2396.00"], ["subtotal", "3176.00"], ["taxTotal", "262.02"], ["total", "3438.02"]] as const) {
      const r = await dana.put(`/api/documents/${inv.id}/fields/${key}`, { value, reason: "Re-keyed from supplier's corrected invoice" });
      expect(r.status, key).toBe(200);
    }
    const fixed = await bundleByLabel(dana, "B05");
    expect(fixed.run.result.recommendation).toBe("READY_FOR_APPROVAL");
    expect(fixed.exceptions.filter((e: any) => e.status === "open")).toHaveLength(0);

    const self = await dana.post(`/api/bundles/${d.bundle.id}/decision`, { action: "approve" });
    expect(self.status).toBe(403);
    expect(self.data.error.message).toMatch(/Separation of duties/);

    const ok = await marcus.post(`/api/bundles/${d.bundle.id}/decision`, { action: "approve", reason: "Verified against corrected invoice" }, { "idempotency-key": "k-b05-approve" });
    expect(ok.status).toBe(200);
    expect(ok.data.state).toBe("approved");
    // AT-7: same key → same single approval
    const again = await marcus.post(`/api/bundles/${d.bundle.id}/decision`, { action: "approve", reason: "Verified against corrected invoice" }, { "idempotency-key": "k-b05-approve" });
    expect(again.data.replayed).toBe(true);
    expect(again.data.approvalId).toBe(ok.data.approvalId);
    const final = await bundleByLabel(marcus, "B05");
    expect(final.approvals.filter((a: any) => a.status === "approved")).toHaveLength(1);
    expect(final.approvals[0]).toMatchObject({ proposedBy: "engine", decidedBy: "Marcus Obi", decidedRole: "controller" });
  });

  it("changing data after approval supersedes the approval (no stale sign-off)", async () => {
    const d = await bundleByLabel(dana, "B09");
    expect((await dana.post(`/api/bundles/${d.bundle.id}/decision`, { action: "approve" })).status).toBe(200);
    const inv = d.documents.find((x: any) => x.role === "invoice");
    const r = await marcus.put(`/api/documents/${inv.id}/fields/freight`, { value: "10.00", reason: "test: supplier added freight" });
    expect(r.status).toBe(200);
    const after = await bundleByLabel(marcus, "B09");
    expect(after.bundle.state).toBe("matched");
    expect(after.approvals.some((a: any) => a.status === "superseded")).toBe(true);
    expect(after.audit.some((a: any) => a.action === "approval.superseded")).toBe(true);
    expect(after.exceptions.map((e: any) => e.code).sort()).toEqual(["FREIGHT_NOT_AUTHORIZED", "TOTAL_ARITHMETIC"]);
  });

  it("clerk approval limit and controller approvals; export contains corrected values and provenance (AT-8)", async () => {
    const b07 = await bundleByLabel(dana, "B07");
    expect(Number(b07.documents.find((x: any) => x.role === "invoice").fields.find((f: any) => f.key === "total").value)).toBeGreaterThan(5000);
    const over = await dana.post(`/api/bundles/${b07.bundle.id}/decision`, { action: "approve" });
    expect(over.status).toBe(403);
    expect(over.data.error.message).toMatch(/approval limit/);
    expect((await marcus.post(`/api/bundles/${b07.bundle.id}/decision`, { action: "approve" })).status).toBe(200);

    const b01 = await bundleByLabel(dana, "B01");
    expect((await dana.post(`/api/bundles/${b01.bundle.id}/decision`, { action: "approve" })).status).toBe(200);

    const prev = await marcus.post("/api/exports", { kind: "approved_register", format: "csv", preview: true });
    expect(prev.status).toBe(200);
    expect(prev.data.preview).toBe(true);
    expect(prev.data.count).toBeGreaterThanOrEqual(3);

    const exp = await marcus.post("/api/exports", { kind: "approved_register", format: "csv" }, { "idempotency-key": "exp-1" });
    expect(exp.status).toBe(200);
    const dl = await marcus.get(`/api/exports/${exp.data.exportId}/download`);
    const csv = dl.data.toString("utf8");
    expect(csv).toContain("Payment executed");
    expect(csv).toContain("NO - this system never pays");
    expect(csv).toContain("B05");
    const replay = await marcus.post("/api/exports", { kind: "approved_register", format: "csv" }, { "idempotency-key": "exp-1" });
    expect(replay.data.exportId).toBe(exp.data.exportId);
    expect(replay.data.replayed).toBe(true);

    const xlsx = await marcus.post("/api/exports", { kind: "approved_register", format: "xlsx" });
    expect(xlsx.status).toBe(200);
    const bytes = (await marcus.get(`/api/exports/${xlsx.data.exportId}/download`)).data as Buffer;
    expect(bytes.subarray(0, 2).toString()).toBe("PK"); // zip container

    const b = await bundleByLabel(marcus, "B05");
    expect(b.bundle.state).toBe("exported");
    expect(b.approvals.find((a: any) => a.status === "executed")?.executionRef).toBeTruthy();
  });

  it("exception record export works for unresolved bundles (demo scenario step: 'export an exception record for approval')", async () => {
    const r = await dana.post("/api/exports", { kind: "exception_record", format: "csv" });
    expect(r.status).toBe(200);
    const csv = ((await dana.get(`/api/exports/${r.data.exportId}/download`)).data as Buffer).toString("utf8");
    expect(csv).toContain("PRICE_VARIANCE");
    expect(csv).toContain("TAX_MISMATCH");
  });

  it("re-uploading identical bytes creates nothing new (AT-7)", async () => {
    const before = ((await dana.get("/api/bundles")).data as any[]).length;
    const r = await dana.upload([{ name: "again.pdf", bytes: pdf("B01_INV_INV48137.pdf") }]);
    expect(r.status).toBe(200);
    expect(r.data.results[0].status).toBe("duplicate_file");
    expect(((await dana.get("/api/bundles")).data as any[]).length).toBe(before);
  });

  it("malformed, wrong-type, empty and image uploads are rejected explicitly with no partial bundle (AT-11)", async () => {
    const before = ((await dana.get("/api/bundles")).data as any[]).length;
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const r = await dana.upload([
      { name: "junk.pdf", bytes: Buffer.from("%PDF-1.4 this is not a real pdf at all") },
      { name: "notpdf.pdf", bytes: Buffer.from("hello world") },
      { name: "empty.pdf", bytes: Buffer.alloc(0) },
      { name: "scan.png", bytes: png },
      { name: "../../etc/passwd.pdf", bytes: Buffer.from("nope") },
    ]);
    expect(r.status).toBe(200);
    expect(r.data.results.map((x: any) => x.status)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected"]);
    expect(r.data.results.map((x: any) => x.code)).toEqual(["CORRUPT", "NOT_PDF", "EMPTY", "UNSUPPORTED_IMAGE", "NOT_PDF"]);
    expect(r.data.results[3].message).toMatch(/OCR/);
    expect(r.data.results[4].filename).not.toContain("..");
    expect(((await dana.get("/api/bundles")).data as any[]).length).toBe(before);
  });

  it("upload flow: documents arriving out of order still assemble the same bundle", async () => {
    const t2 = makeApp();
    const s = t2.as(U.harbor, "clerk");
    await s.upload([{ name: "inv.pdf", bytes: pdf("B05_INV_INV48685.pdf") }]); // invoice first
    let list = (await s.get("/api/bundles")).data as any[];
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe("matched");
    let d = (await s.get(`/api/bundles/${list[0].id}`)).data;
    expect(d.exceptions.some((e: any) => e.code === "MISSING_DATA" && e.lineKey === "doc:PO")).toBe(true);
    await s.upload([{ name: "po.pdf", bytes: pdf("B05_PO_PO-HA4035.pdf") }]);
    d = (await s.get(`/api/bundles/${list[0].id}`)).data;
    expect(d.exceptions.some((e: any) => e.code === "MISSING_RECEIPT")).toBe(true);
    await s.upload([{ name: "grn.pdf", bytes: pdf("B05_GRN_GRN-7055.pdf") }]);
    d = (await s.get(`/api/bundles/${list[0].id}`)).data;
    expect(d.exceptions.map((e: any) => e.code)).toEqual(["QTY_OVER_RECEIVED"]);
    expect(d.run.version).toBe(3);
    list = (await s.get("/api/bundles")).data;
    expect(list).toHaveLength(1);
  });
});

describe("controls on the Cobalt Bay organisation (duplicate, injection, missing receipt)", () => {
  const t = makeApp();
  const elena = t.as(U.cobalt, "clerk");
  const samir = t.as(U.cobalt, "controller");
  const grace = t.as(U.cobalt, "purchasing");

  beforeAll(async () => { expect((await samir.post("/api/demo/load")).status).toBe(200); }, 120_000);

  it("flags the re-sent invoice as a blocking duplicate of B11; only a controller can clear it, with a note", async () => {
    const d = await bundleByLabel(elena, "B25");
    const e = d.exceptions.find((x: any) => x.code === "DUPLICATE_INVOICE");
    expect(e.severity).toBe("blocking");
    expect(e.explanation).toContain("B11");
    expect(d.run.result.recommendation).toBe("HOLD");
    expect(d.exceptions.filter((x: any) => x.severity !== "info")).toHaveLength(1);
    expect(d.bundle.state).toBe("matched");

    const asClerk = await elena.post(`/api/exceptions/${e.id}/resolve`, { status: "waived", note: "looks fine" });
    expect(asClerk.status).toBe(403);
    const asPurch = await grace.post(`/api/exceptions/${e.id}/resolve`, { status: "overridden", note: "looks fine" });
    expect(asPurch.status).toBe(403);
    const noNote = await samir.post(`/api/exceptions/${e.id}/resolve`, { status: "overridden", note: "" });
    expect(noNote.status).toBe(422);
    // the rightful action: reject the duplicate
    const rej = await samir.post(`/api/bundles/${d.bundle.id}/decision`, { action: "reject", reason: "Duplicate of B11 — supplier re-sent same invoice" });
    expect(rej.status).toBe(200);
    expect((await bundleByLabel(samir, "B25")).bundle.state).toBe("rejected");
  });

  it("the invoice that carries embedded instructions is held and its numbers are unaffected (AT-4)", async () => {
    const d = await bundleByLabel(elena, "B16");
    const codes = d.exceptions.map((x: any) => x.code);
    expect(codes).toEqual(["SUSPECT_INSTRUCTIONS"]);
    expect(d.run.result.recommendation).toBe("HOLD");
    expect(d.exceptions[0].severity).toBe("blocking");
    expect(d.run.result.lines.every((l: any) => l.status === "matched")).toBe(true);
    const inv = d.documents.find((x: any) => x.role === "invoice");
    expect(inv.riskFlags.length).toBeGreaterThan(0);
    expect(inv.riskFlags.map((r: any) => r.code)).toContain("PAYMENT_REDIRECT");
    // the hidden (1.5pt white) text was detected too, and its words were NOT used as data
    expect(inv.riskFlags.map((r: any) => r.code)).toContain("HIDDEN_TEXT");
    const ok = await elena.post(`/api/bundles/${d.bundle.id}/decision`, { action: "approve" });
    expect(ok.status).toBe(409);
  });

  it("missing receipt holds the bundle", async () => {
    const d = await bundleByLabel(elena, "B12");
    expect(d.run.result.recommendation).toBe("HOLD");
    expect(d.exceptions.map((x: any) => x.code)).toEqual(["MISSING_RECEIPT"]);
  });

  it("settings are role-gated, validated and audited; changing tolerance re-decides open bundles", async () => {
    const s0 = (await elena.get("/api/settings")).data;
    expect((await elena.put("/api/settings", s0)).status).toBe(403);
    expect((await samir.put("/api/settings", { ...s0, priceTolPct: "abc" })).status).toBe(422);
    const b14 = await bundleByLabel(elena, "B14");
    expect(b14.exceptions.map((e: any) => e.code)).toEqual(["TOTAL_ARITHMETIC"]);
    const r = await samir.put("/api/settings", { ...s0, totalTolAbs: "100" });
    expect(r.status).toBe(200);
    const after = await bundleByLabel(elena, "B14");
    expect(after.exceptions).toHaveLength(0); // 90.00 off is now inside a 100.00 tolerance
    expect(after.audit.some((a: any) => a.action === "settings.updated") || ((await samir.get("/api/audit?action=settings")).data as any[]).length > 0).toBe(true);
  });

  it("organisations are isolated: another org's user cannot read this org's bundle", async () => {
    const d = await bundleByLabel(elena, "B10");
    const other = t.as(U.harbor, "controller");
    const r = await other.get(`/api/bundles/${d.bundle.id}`);
    expect(r.status).toBe(404);
    const spoof = await t.api("GET", "/api/bundles", { org: U.cobalt.org, user: U.harbor.controller });
    expect(spoof.status).toBe(401);
  });

  it("deletion: bundles can be deleted by a controller only, and data can be exported", async () => {
    const d = await bundleByLabel(elena, "B17");
    expect((await elena.del(`/api/bundles/${d.bundle.id}`)).status).toBe(403);
    expect((await samir.del(`/api/bundles/${d.bundle.id}`)).status).toBe(200);
    expect((await samir.get(`/api/bundles/${d.bundle.id}`)).status).toBe(404);
    const dump = (await samir.get("/api/data-export")).data as any;
    expect(dump.documents.length).toBeGreaterThan(5);
    expect(dump.bundles.some((b: any) => b.id === d.bundle.id)).toBe(false);
    expect(dump.auditEvents.some((a: any) => a.action === "bundle.deleted")).toBe(true);
    expect((await samir.del("/api/data", { confirm: "nope" })).status).toBe(403);
  });
});

describe("no payment path exists (AT-9)", () => {
  it("the route table has no payment / posting / ledger endpoints", () => {
    const t = makeApp();
    const paths = t.app.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) expect(p.toLowerCase()).not.toMatch(/pay(ment)?s?\b|ledger|erp|post-to|remit|transfer|wire/);
  });
});
