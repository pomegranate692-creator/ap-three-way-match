import { serve } from "@hono/node-server";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { llmFromEnv } from "./llm/adapters.ts";
import { readManifest, seedOrgs } from "./services/demo.ts";

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

const app = createApp({ db, dataDir, fixtureDir, llm, webDir: process.env.NODE_ENV === "production" ? join(ROOT, "dist", "web") : undefined });

// Bind to loopback only: this is a local-first tool with a demo identity switcher, not an internet service.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`AP Three-Way Match API listening on http://127.0.0.1:${info.port}  (db: ${dbPath})`);
  console.log(`LLM adapters: ${llm.status().enabled ? "ENABLED " + llm.status().model : "disabled — " + llm.status().reason}`);
});
