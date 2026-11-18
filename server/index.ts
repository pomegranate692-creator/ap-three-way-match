import { serve } from "@hono/node-server";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { llmFromEnv } from "./llm/adapters.ts";
import { ocrFromEnv } from "./ingest/ocr.ts";
import { readManifest, resetAllDemo, seedOrgs } from "./services/demo.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]!] === undefined && m[2] !== "") process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

const port = Number(process.env.PORT ?? 8791);
const dbPath = resolve(ROOT, process.env.DB_PATH ?? "data/app.db");
const dataDir = dirname(dbPath);
const fixtureDir = join(ROOT, "fixtures");

const db = openDb(dbPath);
if (existsSync(join(fixtureDir, "manifest.json"))) seedOrgs(db, readManifest(fixtureDir), new Date().toISOString());
const llm = llmFromEnv(process.env);
const ocr = ocrFromEnv(process.env, dataDir);

// PUBLIC_DEMO=1 is the hosted, synthetic-data-only mode. It refuses to start without a password, resets all data on boot and on a
// schedule, and is the only mode that may listen beyond loopback. Never point it at a database that holds anything real.
const publicDemo = process.env.PUBLIC_DEMO === "1";
const password = process.env.DEMO_PASSWORD ?? "";
if (publicDemo && password.length < 8) { console.error("PUBLIC_DEMO=1 needs DEMO_PASSWORD (at least 8 characters). Refusing to start unprotected."); process.exit(1); }
const host = publicDemo ? (process.env.HOST ?? "0.0.0.0") : "127.0.0.1";
if (process.env.HOST && !publicDemo && process.env.HOST !== "127.0.0.1") console.warn("HOST ignored: only PUBLIC_DEMO=1 may listen beyond loopback (the identity switcher is not authentication).");
if (publicDemo) {
  const reset = async () => { try { await resetAllDemo(db, dataDir, fixtureDir, llm); console.log(`[demo] data reset to synthetic state at ${new Date().toISOString()}`); } catch (e) { console.error("[demo] reset failed", e); } };
  await reset();
  const hours = Math.max(1, Number(process.env.DEMO_RESET_HOURS ?? 24));
  setInterval(() => { void reset(); }, hours * 3_600_000).unref();
}

const app = createApp({ db, dataDir, fixtureDir, llm, ocr, webDir: process.env.NODE_ENV === "production" ? join(ROOT, "dist", "web") : undefined, ...(publicDemo ? { accessPassword: password } : {}) });

// Local use binds to loopback only; see the PUBLIC_DEMO note above.
serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`AP Three-Way Match API listening on http://${host}:${info.port}  (db: ${dbPath})`);
  console.log(`LLM adapters: ${llm.status().enabled ? "ENABLED " + llm.status().model : "disabled — " + llm.status().reason}`);
});
