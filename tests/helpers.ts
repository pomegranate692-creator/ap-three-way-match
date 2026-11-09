import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import { openDb } from "../server/db.ts";
import { disabledAdapters, type LlmAdapters } from "../server/llm/adapters.ts";
import { readManifest, seedOrgs } from "../server/services/demo.ts";

export const FIXTURES = join(import.meta.dirname, "..", "fixtures");

export const U = {
  harbor: { org: "org-harbor", clerk: "u-harbor-clerk", controller: "u-harbor-ctrl", purchasing: "u-harbor-purch" },
  cobalt: { org: "org-cobalt", clerk: "u-cobalt-clerk", controller: "u-cobalt-ctrl", purchasing: "u-cobalt-purch" },
  meridian: { org: "org-meridian", clerk: "u-meridian-clerk", controller: "u-meridian-ctrl", purchasing: "u-meridian-purch" },
} as const;

export function makeApp(llm: LlmAdapters = disabledAdapters("test")) {
  const dataDir = mkdtempSync(join(tmpdir(), "ap3wm-"));
  const db = openDb(":memory:");
  let tick = Date.UTC(2026, 2, 10, 9, 0, 0);
  const now = () => new Date((tick += 1000)).toISOString();
  seedOrgs(db, readManifest(FIXTURES), now());
  const app = createApp({ db, dataDir, fixtureDir: FIXTURES, llm, now });

  async function api<T = any>(method: string, path: string, o: { org: string; user: string; body?: unknown; headers?: Record<string, string>; form?: FormData } ) {
    const headers: Record<string, string> = { "x-org-id": o.org, "x-user-id": o.user, ...(o.headers ?? {}) };
    let body: BodyInit | undefined;
    if (o.form) body = o.form;
    else if (o.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.body); }
    const res = await app.request(path, { method, headers, body });
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as T, headers: res.headers };
  }
  const as = (who: { org: string }, role: "clerk" | "controller" | "purchasing") => {
    const org = who.org;
    const user = (who as any)[role] as string;
    return {
      org, user,
      get: <T = any>(p: string) => api<T>("GET", p, { org, user }),
      post: <T = any>(p: string, body?: unknown, headers?: Record<string, string>) => api<T>("POST", p, { org, user, body, ...(headers ? { headers } : {}) }),
      put: <T = any>(p: string, body?: unknown) => api<T>("PUT", p, { org, user, body }),
      del: <T = any>(p: string, body?: unknown) => api<T>("DELETE", p, { org, user, body }),
      upload: <T = any>(files: { name: string; bytes: Uint8Array | Buffer }[]) => {
        const form = new FormData();
        for (const f of files) form.append("files", new File([new Uint8Array(f.bytes)], f.name, { type: "application/pdf" }));
        return api<T>("POST", "/api/upload", { org, user, form });
      },
    };
  };
  return { app, db, api, as, dataDir };
}

export const pdf = (name: string) => readFileSync(join(FIXTURES, "pdf", name));

export async function bundleByLabel(session: ReturnType<ReturnType<typeof makeApp>["as"]>, label: string) {
  const list = (await session.get("/api/bundles")).data as { id: string; label: string }[];
  const b = list.find((x) => x.label === label);
  if (!b) throw new Error(`no bundle ${label}`);
  return (await session.get(`/api/bundles/${b.id}`)).data;
}
