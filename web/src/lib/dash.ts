export interface Delta { value: number; unit: "pct" | "pp"; direction: "up" | "down" | "flat" }
export interface Dashboard {
  range: { days: number; from: string; to: string; bucketDays: number; source: "all" | "demo" | "upload" };
  baseCurrency: string;
  data: { demo: number; upload: number };
  kpis: {
    processed: { value: number; delta: Delta | null };
    autoMatchRate: { value: number | null; matched: number; delta: Delta | null };
    exceptions: { value: number; open: number; delta: Delta | null };
    avgProcessingMs: { value: number | null; samples: number; delta: Delta | null };
    totalValue: { value: string; currency: string; other: { currency: string; total: string; count: number }[]; unread: number; delta: Delta | null };
  };
  trendNote: string | null;
  trend: { start: string; end: string; total: number; matched: number; exceptions: number }[];
  buckets: { matched: number; quantity: number; price: number; other: number };
  categories: { key: string; label: string; open: number }[];
}

export const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "Last 7 days" }, { days: 30, label: "Last 30 days" }, { days: 90, label: "Last 90 days" }, { days: 365, label: "Last 12 months" }, { days: 0, label: "All time" },
];

export function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
export const fmtPct = (v: number | null, dp = 1) => (v === null ? "—" : `${(v * 100).toFixed(dp)}%`);
export function fmtMoneyWhole(v: string, currency: string): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(v)); } catch { return `${currency} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
}
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}
/** Invoice date strings are ISO yyyy-mm-dd from the extractor; render without timezone drift. */
export function invDate(d: string | null): string {
  if (!d) return "—";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)));
}
