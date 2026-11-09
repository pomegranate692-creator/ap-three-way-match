import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { DB } from "./db.ts";
import { all, get } from "./db.ts";
import { HttpError, audit, badRequest, forbidden, notFound, type Ctx } from "./context.ts";
import type { LlmAdapters } from "./llm/adapters.ts";
import { DecisionBody, ExceptionResolveBody, ExportBody, FieldCorrectionBody } from "../shared/schemas.ts";
import { LIMITS } from "./ingest/pdfText.ts";
import { ingestFile } from "./services/ingest.ts";
import { runMatch } from "./services/matching.ts";
import { correctField, decide, resolveException, saveSettings } from "./services/review.ts";
import { getBundleDetail, getStats, listAudit, listBundles, listExceptions } from "./services/queries.ts";
import { createExport, exportFile, listExports } from "./services/exports.ts";
import { deleteBundle, exportOrgData, loadDemoData, wipeOrgData } from "./services/demo.ts";
import { generateAiSummary } from "./services/ai.ts";
import { getSettings } from "./services/common.ts";

export interface AppOptions {
  db: DB;
  dataDir: string;
  fixtureDir: string;
  llm: LlmAdapters;
  now?: () => string;
  /** directory holding the built SPA (optional) */
  webDir?: string;
}

const MAX_BATCH_FILES = 25;
const MAX_BATCH_BYTES = 40 * 1024 * 1024;

/** Sliding-window rate limiter (per client + bucket). Protects the local API from runaway scripts/loops. */
class RateLimiter {
  private hits = new Map<string, number[]>();
  allow(key: string, limit: number, windowMs = 60_000): boolean {
    const t = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) { this.hits.set(key, arr); return false; }
    arr.push(t);
    this.hits.set(key, arr);
    return true;
  }
}

export function createApp(opts: AppOptions) {
  const app = new Hono<{ Variables: { ctx: Ctx } }>();
  const limiter = new RateLimiter();
  const now = opts.now ?? (() => new Date().toISOString());

  /* ---------- security headers ---------- */
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    if (!c.req.path.startsWith("/api/")) {
      c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }
  });

  /* ---------- errors ---------- */
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    if (err instanceof ZodError) return c.json({ error: { code: "UNPROCESSABLE", message: err.issues[0]?.message ?? "Invalid input", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, 422);
    console.error("[api] unhandled", err);
    return c.json({ error: { code: "INTERNAL", message: "Something went wrong on the server. Nothing was changed if this was a write; it is safe to retry." } }, 500);
  });

  /* ---------- rate limiting ---------- */
  app.use("/api/*", async (c, next) => {
    const ip = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? "local";
    const bucket = c.req.path === "/api/upload" ? "upload" : c.req.method === "GET" ? "read" : "write";
    const limit = { upload: 30, write: 300, read: 1500 }[bucket];
    if (!limiter.allow(`${ip}:${bucket}`, limit)) throw new HttpError(429, "RATE_LIMITED", "Too many requests — please slow down and retry in a moment.");
    await next();
  });

  /* ---------- public ---------- */
  app.get("/api/health", (c) => c.json({ ok: true, time: now() }));
  app.get("/api/meta", (c) =>
    c.json({
      app: "AP Document Intelligence & Three-Way Match", version: "0.1.0", synthetic: true,
      llm: opts.llm.status(),
      connectors: [
        { name: "Local file upload", status: "available" },
        { name: "SQLite (node:sqlite)", status: "available" },
        { name: "PDF text layer (pdf.js)", status: "available" },
        { name: "CSV / XLSX export (file only)", status: "available" },
        { name: "OCR for scanned images", status: "not built", detail: "No OCR engine installed; scanned/image-only files are rejected with a clear message." },
        { name: "Claude API (extraction + wording)", status: opts.llm.status().enabled ? "enabled" : "optional · disabled", detail: opts.llm.status().reason },
        { name: "ERP / payment / ledger posting", status: "blocked by design", detail: "No such route exists. The system never pays or posts." },
        { name: "Email / Gmail / calendar", status: "not connected" },
      ],
      limits: { maxFileMb: LIMITS.maxBytes / 1024 / 1024, maxPages: LIMITS.maxPages, maxFilesPerBatch: MAX_BATCH_FILES },
    }),
  );
  app.get("/api/orgs", (c) => {
    const orgs = all<{ id: string; name: string; timezone: string; base_currency: string }>(opts.db, "SELECT id, name, timezone, base_currency FROM organizations ORDER BY rowid");
    return c.json(orgs.map((o) => ({ id: o.id, name: o.name, timezone: o.timezone, baseCurrency: o.base_currency, synthetic: true, users: all<{ id: string; name: string; role: string }>(opts.db, "SELECT id, name, role FROM users WHERE org_id=? ORDER BY CASE role WHEN 'clerk' THEN 0 WHEN 'controller' THEN 1 ELSE 2 END", o.id) })));
  });

  /* ---------- demo identity (NOT authentication — see docs/SECURITY.md) ---------- */
  app.use("/api/*", async (c, next) => {
    const p = c.req.path;
    if (p === "/api/health" || p === "/api/meta" || p === "/api/orgs") return next();
    const orgId = c.req.header("x-org-id");
    const userId = c.req.header("x-user-id");
    if (!orgId || !userId) throw new HttpError(401, "NO_IDENTITY", "Choose a demo user first (top-right menu).");
    const u = get<{ id: string; name: string; role: "clerk" | "controller" | "purchasing" }>(opts.db, "SELECT id, name, role FROM users WHERE id=? AND org_id=?", userId, orgId);
    if (!u) throw new HttpError(401, "UNKNOWN_IDENTITY", "That demo user does not belong to this organisation.");
    c.set("ctx", { db: opts.db, orgId, actor: { id: u.id, name: u.name, role: u.role }, now, dataDir: opts.dataDir, llm: opts.llm });
    await next();
  });

  const body = async <S extends ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> => {
    let json: unknown;
    try { json = await c.req.json(); } catch { throw badRequest("Request body must be valid JSON."); }
    return schema.parse(json);
  };
  const ctxOf = (c: Context<{ Variables: { ctx: Ctx } }>) => c.get("ctx");

  /* ---------- reads ---------- */
  app.get("/api/stats", (c) => c.json(getStats(ctxOf(c))));
  app.get("/api/bundles", (c) => c.json(listBundles(ctxOf(c), { ...(c.req.query("state") ? { state: c.req.query("state")! } : {}), ...(c.req.query("recommendation") ? { recommendation: c.req.query("recommendation")! } : {}), ...(c.req.query("q") ? { q: c.req.query("q")! } : {}) })));
  app.get("/api/bundles/:id", (c) => c.json(getBundleDetail(ctxOf(c), c.req.param("id"))));
  app.get("/api/exceptions", (c) => c.json(listExceptions(ctxOf(c), { ...(c.req.query("status") ? { status: c.req.query("status")! } : { status: "open" }), ...(c.req.query("severity") ? { severity: c.req.query("severity")! } : {}), ...(c.req.query("code") ? { code: c.req.query("code")! } : {}) })));
  app.get("/api/audit", (c) => c.json(listAudit(ctxOf(c), { ...(c.req.query("bundleId") ? { bundleId: c.req.query("bundleId")! } : {}), ...(c.req.query("action") ? { action: c.req.query("action")! } : {}), limit: Number(c.req.query("limit") ?? 200), offset: Number(c.req.query("offset") ?? 0) })));
  app.get("/api/settings", (c) => c.json(getSettings(opts.db, ctxOf(c).orgId)));
  app.get("/api/exports", (c) => c.json(listExports(ctxOf(c))));

  app.get("/api/documents/:id/file", (c) => {
    const ctx = ctxOf(c);
    const d = get<{ stored_path: string; filename: string }>(opts.db, "SELECT stored_path, filename FROM documents WHERE id=? AND org_id=?", c.req.param("id"), ctx.orgId);
    if (!d) throw notFound("Document");
    return new Response(readFileSync(d.stored_path), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${d.filename.replace(/"/g, "")}"`, "cache-control": "private, max-age=300" } });
  });

  app.get("/api/exports/:id/download", (c) => {
    const f = exportFile(ctxOf(c), c.req.param("id"));
    const type = f.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
    return new Response(readFileSync(f.path), { headers: { "content-type": type, "content-disposition": `attachment; filename="${f.filename}"` } });
  });

  app.get("/api/data-export", (c) => {
    const ctx = ctxOf(c);
    audit(ctx, { action: "data.exported", entityType: "org", entityId: ctx.orgId, note: "Full JSON copy of organisation data downloaded" });
    return new Response(JSON.stringify(exportOrgData(ctx), null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="ap-data-${ctx.orgId}.json"` } });
  });

  /* ---------- writes ---------- */
  app.post("/api/upload", async (c) => {
    const ctx = ctxOf(c);
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_BATCH_BYTES + 1024 * 1024) throw new HttpError(413, "TOO_LARGE", `Upload is larger than ${MAX_BATCH_BYTES / 1024 / 1024} MB in total.`);
    let form: FormData;
    try { form = await c.req.formData(); } catch { throw badRequest("Expected a multipart form upload with one or more files."); }
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (!files.length) throw badRequest("No files were attached.");
    if (files.length > MAX_BATCH_FILES) throw badRequest(`At most ${MAX_BATCH_FILES} files per upload.`);
    let total = 0;
    const results = [];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      total += bytes.byteLength;
      if (total > MAX_BATCH_BYTES) throw new HttpError(413, "TOO_LARGE", "Upload is too large.");
      results.push(await ingestFile(ctx, { name: f.name, bytes }, "upload"));
    }
    const bundleIds = [...new Set(results.flatMap((r) => r.bundleIds))];
    return c.json({ results, bundleIds }, 200);
  });

  app.put("/api/documents/:id/fields/:key", async (c) => {
    const b = await body(c, FieldCorrectionBody);
    return c.json(correctField(ctxOf(c), { documentId: c.req.param("id"), key: decodeURIComponent(c.req.param("key")), ...b }));
  });
  app.post("/api/bundles/:id/rematch", (c) => {
    const ctx = ctxOf(c);
    if (!get(opts.db, "SELECT 1 x FROM bundles WHERE id=? AND org_id=?", c.req.param("id"), ctx.orgId)) throw notFound("Bundle");
    return c.json(runMatch(ctx, c.req.param("id"), "manual"));
  });
  app.post("/api/exceptions/:id/resolve", async (c) => c.json(resolveException(ctxOf(c), c.req.param("id"), await body(c, ExceptionResolveBody))));
  app.post("/api/bundles/:id/decision", async (c) => {
    const b = await body(c, DecisionBody);
    return c.json(decide(ctxOf(c), c.req.param("id"), b, c.req.header("idempotency-key") ?? null));
  });
  app.post("/api/bundles/:id/ai-summary", async (c) => c.json(await generateAiSummary(ctxOf(c), c.req.param("id"))));
  app.delete("/api/bundles/:id", (c) => c.json(deleteBundle(ctxOf(c), c.req.param("id"))));
  app.put("/api/settings", async (c) => {
    let json: unknown;
    try { json = await c.req.json(); } catch { throw badRequest("Request body must be valid JSON."); }
    return c.json(saveSettings(ctxOf(c), json));
  });
  app.post("/api/exports", async (c) => c.json(await createExport(ctxOf(c), await body(c, ExportBody), c.req.header("idempotency-key") ?? null)));

  app.post("/api/demo/load", async (c) => c.json(await loadDemoData(ctxOf(c), opts.fixtureDir)));
  app.post("/api/demo/reset", async (c) => {
    const ctx = ctxOf(c);
    const wiped = wipeOrgData(ctx, true);
    return c.json({ ...wiped, ...(await loadDemoData(ctx, opts.fixtureDir)) });
  });
  app.delete("/api/data", async (c) => {
    const ctx = ctxOf(c);
    const b = (await c.req.json().catch(() => ({}))) as { confirm?: string; includeAudit?: boolean };
    if (b.confirm !== "DELETE") throw forbidden('Send {"confirm":"DELETE"} to confirm permanent deletion of this organisation\'s documents and decisions.');
    return c.json(wipeOrgData(ctx, !!b.includeAudit));
  });

  /* ---------- static SPA (production) ---------- */
  const webDir = opts.webDir ? resolve(opts.webDir) : null;
  if (webDir && existsSync(join(webDir, "index.html"))) {
    const MIME: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".json": "application/json", ".map": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) return c.json({ error: { code: "NOT_FOUND", message: "Unknown API route" } }, 404);
      const rel = normalize(decodeURIComponent(c.req.path)).replace(/^([/\\]|\.\.)+/g, "");
      const file = resolve(webDir, rel);
      if (file.startsWith(webDir + "/") && existsSync(file) && statSync(file).isFile()) {
        const type = MIME[extname(file)] ?? "application/octet-stream";
        return new Response(readFileSync(file), { headers: { "content-type": type, "cache-control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
      }
      return c.html(readFileSync(join(webDir, "index.html"), "utf8"));
    });
  } else {
    app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: c.req.path.startsWith("/api/") ? "Unknown API route" : "The web app is not built. Run `npm run build` or use `npm run dev`." } }, 404));
  }
  return app;
}
