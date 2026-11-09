/** Load the synthetic organisations and all 25 demo bundles into the local database (data/app.db). `--reset` wipes first. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import { openDb, all } from "../server/db.ts";
import { disabledAdapters } from "../server/llm/adapters.ts";
import { loadDemoData, readManifest, seedOrgs, wipeOrgData } from "../server/services/demo.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(ROOT, process.env.DB_PATH ?? "data/app.db");
if (process.argv.includes("--reset")) for (const s of ["", "-shm", "-wal"]) rmSync(dbPath + s, { force: true });
const db = openDb(dbPath);
const fixtureDir = join(ROOT, "fixtures");
const manifest = readManifest(fixtureDir);
const t = new Date().toISOString();
seedOrgs(db, manifest, t);
let tick = Date.now();
for (const org of all<{ id: string; name: string }>(db, "SELECT id, name FROM organizations ORDER BY rowid")) {
  const controller = manifest.orgs.find((o) => o.id === org.id)!.users.find((u) => u.role === "controller")!;
  const ctx = { db, orgId: org.id, actor: { id: controller.id, name: controller.name, role: "controller" as const }, now: () => new Date(tick++).toISOString(), dataDir: dirname(dbPath), llm: disabledAdapters("seed") };
  void wipeOrgData;
  const r = await loadDemoData(ctx, fixtureDir);
  console.log(`${org.name}: ${r.bundlesLoaded} bundles loaded (${r.documentsCreated} documents, ${r.duplicatesSkipped} duplicate files skipped, ${r.rejected} rejected)`);
}
console.log(`Database: ${dbPath}`);
