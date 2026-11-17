import type { Ctx } from "../context.ts";
import { all, get } from "../db.ts";
import { D, Dec, s as decStr, sum } from "../../shared/money.ts";
import type { MatchResult } from "../../shared/schemas.ts";
import { EXCEPTION_CATEGORIES, bucketOfCodes, categoryOfException, type MatchBucket } from "../../shared/exceptionCategories.ts";
import { bundleDocs, canonOf, getSettings, type BundleRow } from "./common.ts";

const DAY = 86_400_000;
/** A comparison arrow is only shown when the previous period held at least this many invoices. */
export const MIN_PRIOR_FOR_TREND = 5;

export type SourceFilter = "all" | "demo" | "upload";
export interface DashboardQuery { days: number; source: SourceFilter }

interface Enriched {
  id: string; createdAt: number; source: string; matched: boolean; bucket: MatchBucket; total: Dec | null; currency: string | null;
}

export interface Delta { value: number; unit: "pct" | "pp"; direction: "up" | "down" | "flat" }

function pctDelta(cur: number, prev: number): Delta | null {
  if (prev <= 0) return null;
  const v = ((cur - prev) / prev) * 100;
  return { value: Math.round(Math.abs(v) * 10) / 10, unit: "pct", direction: Math.abs(v) < 0.05 ? "flat" : v > 0 ? "up" : "down" };
}
function ppDelta(cur: number, prev: number): Delta {
  const v = (cur - prev) * 100;
  return { value: Math.round(Math.abs(v) * 10) / 10, unit: "pp", direction: Math.abs(v) < 0.05 ? "flat" : v > 0 ? "up" : "down" };
}

/** First (initial) analysis of every bundle in the org, so "auto-matched" means "the engine found nothing wrong on first read". */
function loadBundles(ctx: Ctx, source: SourceFilter): Enriched[] {
  const rows = all<BundleRow>(ctx.db, "SELECT * FROM bundles WHERE org_id=? ORDER BY seq", ctx.orgId).filter((b) => source === "all" || b.source === source);
  const settings = getSettings(ctx.db, ctx.orgId);
  const out: Enriched[] = [];
  for (const b of rows) {
    const first = get<{ recommendation: string; result_json: string }>(ctx.db, "SELECT recommendation, result_json FROM runs WHERE bundle_id=? ORDER BY version ASC LIMIT 1", b.id);
    const codes = first ? (JSON.parse(first.result_json) as MatchResult).exceptions.filter((e) => e.severity !== "info").map((e) => e.code) : [];
    const matched = first?.recommendation === "READY_FOR_APPROVAL";
    const d = bundleDocs(ctx.db, b.id);
    const inv = d.invoice ? canonOf(ctx.db, d.invoice, settings) : null;
    let total: Dec | null = null;
    try { total = inv?.total ? D(inv.total) : null; } catch { total = null; }
    out.push({ id: b.id, createdAt: Date.parse(b.created_at), source: b.source, matched, bucket: matched ? "matched" : bucketOfCodes(codes.length ? codes : ["MISSING_DATA"]), total, currency: inv?.currency ?? null });
  }
  return out;
}

function processingTimes(ctx: Ctx, fromMs: number, toMs: number): number[] {
  const rows = all<{ output_json: string; created_at: string }>(ctx.db, "SELECT output_json, created_at FROM decisions WHERE org_id=? AND kind='extraction'", ctx.orgId);
  const out: number[] = [];
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    if (t < fromMs || t >= toMs) continue;
    const ms = (JSON.parse(r.output_json) as { processingMs?: unknown }).processingMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) out.push(ms);
  }
  return out;
}

export function getDashboard(ctx: Ctx, q: DashboardQuery) {
  const nowMs = Date.parse(ctx.now());
  const all_ = loadBundles(ctx, q.source);
  const earliest = all_.length ? Math.min(...all_.map((b) => b.createdAt)) : null;
  const endMs = nowMs + 1;
  const startMs = q.days > 0 ? nowMs - q.days * DAY : earliest ?? nowMs;
  const prevStart = q.days > 0 ? startMs - q.days * DAY : null;

  const cur = all_.filter((b) => b.createdAt >= startMs && b.createdAt < endMs);
  const prev = prevStart === null ? [] : all_.filter((b) => b.createdAt >= prevStart && b.createdAt < startMs);
  const hasHistory = prevStart !== null && earliest !== null && earliest <= prevStart + (startMs - prevStart) / 2 && prev.length >= MIN_PRIOR_FOR_TREND;

  const org = get<{ base_currency: string }>(ctx.db, "SELECT base_currency FROM organizations WHERE id=?", ctx.orgId)!;
  const baseCurrency = org.base_currency;
  const valueOf = (rows: Enriched[]) => {
    const byCur = new Map<string, Dec[]>();
    for (const b of rows) if (b.total && b.currency) byCur.set(b.currency, [...(byCur.get(b.currency) ?? []), b.total]);
    const base = sum(byCur.get(baseCurrency) ?? []);
    const other = [...byCur.entries()].filter(([c]) => c !== baseCurrency).map(([currency, v]) => ({ currency, total: decStr(sum(v)), count: v.length }));
    const unread = rows.filter((b) => !b.total || !b.currency).length;
    return { base, other, unread };
  };
  const curVal = valueOf(cur), prevVal = valueOf(prev);

  const matchedN = cur.filter((b) => b.matched).length;
  const rate = cur.length ? matchedN / cur.length : null;
  const prevRate = prev.length ? prev.filter((b) => b.matched).length / prev.length : null;

  const times = processingTimes(ctx, startMs, endMs);
  const prevTimes = prevStart === null ? [] : processingTimes(ctx, prevStart, startMs);
  const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const prevAvgMs = prevTimes.length ? prevTimes.reduce((a, b) => a + b, 0) / prevTimes.length : null;

  const excBundles = cur.length - matchedN;
  const openExc = all<{ code: string; title: string; bundle_id: string }>(ctx.db, "SELECT e.code, e.title, e.bundle_id FROM exceptions e JOIN bundles b ON b.id=e.bundle_id WHERE b.org_id=? AND e.status='open'", ctx.orgId);
  const inWindow = new Set(cur.map((b) => b.id));
  const openInWindow = openExc.filter((e) => inWindow.has(e.bundle_id));

  // trend buckets: daily up to 31 days, weekly beyond
  const spanDays = Math.max(1, Math.ceil((nowMs - startMs) / DAY));
  const step = spanDays > 31 ? 7 : 1;
  const trend: { start: string; end: string; total: number; matched: number; exceptions: number }[] = [];
  for (let t = startMs; t < endMs; t += step * DAY) {
    const rows = cur.filter((b) => b.createdAt >= t && b.createdAt < t + step * DAY);
    const m = rows.filter((b) => b.matched).length;
    trend.push({ start: new Date(t).toISOString(), end: new Date(Math.min(t + step * DAY, endMs)).toISOString(), total: rows.length, matched: m, exceptions: rows.length - m });
  }

  const buckets = { matched: 0, quantity: 0, price: 0, other: 0 };
  for (const b of cur) buckets[b.bucket]++;

  const categories = EXCEPTION_CATEGORIES.map((c) => ({ key: c.key, label: c.label, open: openInWindow.filter((e) => categoryOfException(e.code, e.title) === c.key).length }));

  const sources = all<{ source: string; n: number }>(ctx.db, "SELECT source, COUNT(*) n FROM bundles WHERE org_id=? GROUP BY source", ctx.orgId);

  return {
    range: { days: q.days, from: new Date(startMs).toISOString(), to: new Date(nowMs).toISOString(), bucketDays: step, source: q.source },
    baseCurrency,
    data: { demo: sources.find((x) => x.source === "demo")?.n ?? 0, upload: sources.find((x) => x.source === "upload")?.n ?? 0 },
    kpis: {
      processed: { value: cur.length, delta: hasHistory ? pctDelta(cur.length, prev.length) : null },
      autoMatchRate: { value: rate, matched: matchedN, delta: hasHistory && rate !== null && prevRate !== null ? ppDelta(rate, prevRate) : null },
      exceptions: { value: excBundles, open: openInWindow.length, delta: hasHistory ? pctDelta(excBundles, prev.length - prev.filter((b) => b.matched).length) : null },
      avgProcessingMs: { value: avgMs, samples: times.length, delta: hasHistory && avgMs !== null && prevAvgMs !== null ? pctDelta(avgMs, prevAvgMs) : null },
      totalValue: { value: decStr(curVal.base), currency: baseCurrency, other: curVal.other, unread: curVal.unread, delta: hasHistory && prevVal.base.gt(0) ? pctDelta(curVal.base.toNumber(), prevVal.base.toNumber()) : null },
    },
    trendNote: hasHistory ? null : cur.length ? "Comparison arrows appear once the previous period holds at least 5 invoices." : null,
    trend, buckets, categories,
  };
}
