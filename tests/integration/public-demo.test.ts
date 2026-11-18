import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app.ts";
import { openDb } from "../../server/db.ts";
import { disabledAdapters } from "../../server/llm/adapters.ts";
import { readManifest, resetAllDemo, seedOrgs } from "../../server/services/demo.ts";
import { FIXTURES, U, makeApp } from "../helpers.ts";

const basic = (pw: string) => ({ authorization: `Basic ${Buffer.from(`demo:${pw}`).toString("base64")}` });

describe("public demo: password gate", () => {
  const db = openDb(":memory:");
  seedOrgs(db, readManifest(FIXTURES), new Date().toISOString());
  const app = createApp({ db, dataDir: mkdtempSync(join(tmpdir(), "ap-gate-")), fixtureDir: FIXTURES, llm: disabledAdapters("t"), accessPassword: "correct-horse-battery" });
  const hdr = { "x-org-id": U.harbor.org, "x-user-id": U.harbor.controller };

  it("blocks every route without the password, with a Basic challenge", async () => {
    for (const path of ["/api/bundles", "/api/dashboard", "/", "/api/orgs"]) {
      const r = await app.request(path, { headers: hdr });
      expect(r.status, path).toBe(401);
      expect(r.headers.get("www-authenticate")).toMatch(/^Basic/);
    }
    expect((await app.request("/api/demo/load", { method: "POST", headers: hdr })).status).toBe(401);
  });
  it("rejects a wrong password and accepts the right one", async () => {
    expect((await app.request("/api/orgs", { headers: { ...hdr, ...basic("wrong-password") } })).status).toBe(401);
    expect((await app.request("/api/orgs", { headers: { ...hdr, ...basic("correct-horse-batter") } })).status).toBe(401);
    expect((await app.request("/api/orgs", { headers: { ...hdr, ...basic("correct-horse-battery") } })).status).toBe(200);
  });
  it("keeps /api/health open for the host's health check", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });
});

describe("public demo: scheduled reset restores pristine synthetic data", () => {
  it("removes visitor changes (approvals, uploads, settings) and reloads the demo", async () => {
    const t = makeApp();
    const marcus = t.as(U.harbor, "controller");
    expect((await marcus.post("/api/demo/load")).status).toBe(200);
    const list = (await marcus.get("/api/bundles")).data as { id: string; label: string }[];
    const b01 = list.find((b) => b.label === "B01")!;
    expect((await marcus.post(`/api/bundles/${b01.id}/decision`, { action: "approve" })).status).toBe(200);
    const s = (await marcus.get("/api/settings")).data;
    expect((await marcus.put("/api/settings", { ...s, clerkApprovalLimit: "123" })).status).toBe(200);
    await resetAllDemo(t.db, t.dataDir, FIXTURES, disabledAdapters("t"));
    const after = (await marcus.get("/api/bundles")).data as { label: string; state: string }[];
    expect(after.length).toBe(9);
    expect(after.find((b) => b.label === "B01")!.state).toBe("matched");
    expect((await marcus.get("/api/settings")).data.clerkApprovalLimit).toBe(s.clerkApprovalLimit);
    expect(((await marcus.get("/api/audit?action=approval.")).data as unknown[]).length).toBe(0);
  }, 120_000);
});

describe("open public demo (DEMO_OPEN=1): no password, abusable actions switched off", () => {
  const db = openDb(":memory:");
  seedOrgs(db, readManifest(FIXTURES), new Date().toISOString());
  const app = createApp({ db, dataDir: mkdtempSync(join(tmpdir(), "ap-open-")), fixtureDir: FIXTURES, llm: disabledAdapters("t"), openDemo: true });
  const hdr = { "x-org-id": U.harbor.org, "x-user-id": U.harbor.controller };
  it("needs no password and says uploads are off", async () => {
    expect((await app.request("/api/orgs", { headers: hdr })).status).toBe(200);
    const meta = await (await app.request("/api/meta")).json() as { publicDemo: { open: boolean; uploadsEnabled: boolean } };
    expect(meta.publicDemo).toEqual({ open: true, uploadsEnabled: false });
  });
  it("blocks uploads, data deletion, bundle/document deletion and settings changes with an explanation", async () => {
    const calls: [string, string][] = [["POST", "/api/upload"], ["DELETE", "/api/data"], ["DELETE", "/api/bundles/x"], ["DELETE", "/api/documents/x"], ["PUT", "/api/settings"]];
    for (const [method, path] of calls) {
      const r = await app.request(path, { method, headers: hdr });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("DEMO_READ_ONLY");
    }
  });
  it("still lets visitors load demo data and approve", async () => {
    expect((await app.request("/api/demo/load", { method: "POST", headers: hdr })).status).toBe(200);
    const list = await (await app.request("/api/bundles", { headers: hdr })).json() as { id: string; label: string }[];
    const b01 = list.find((b) => b.label === "B01")!;
    const r = await app.request(`/api/bundles/${b01.id}/decision`, { method: "POST", headers: { ...hdr, "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
    expect(r.status).toBe(200);
  }, 120_000);
});
