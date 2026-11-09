import Decimal from "decimal.js";

/**
 * All monetary, quantity and tolerance arithmetic goes through this module.
 * Decimal (base-10) arithmetic with HALF_UP rounding — never JS floats.
 * Values cross process/API/DB boundaries as decimal STRINGS.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;

export const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function isDecimalString(v: unknown): v is string {
  return typeof v === "string" && DECIMAL_RE.test(v);
}

/** Throws on invalid input — use only on values that were already validated. */
export function D(v: Decimal.Value | null | undefined): Dec {
  if (v === null || v === undefined || v === "") return new Dec(0);
  return new Dec(v);
}

export function tryD(v: Decimal.Value | null | undefined): Dec | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Dec(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Minor-unit digits per ISO-4217 currency (subset; default 2). */
const CURRENCY_DP: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, BHD: 3, KWD: 3 };
export function currencyDp(currency: string | null | undefined): number {
  return (currency ? CURRENCY_DP[currency] : undefined) ?? 2;
}

/** Round half-up to the currency's minor unit. */
export function roundMoney(v: Dec, currency?: string | null): Dec {
  return v.toDecimalPlaces(currencyDp(currency), Dec.ROUND_HALF_UP);
}

export function roundTo(v: Dec, dp: number): Dec {
  return v.toDecimalPlaces(dp, Dec.ROUND_HALF_UP);
}

/** Canonical string form (no exponent, no trailing zeros beyond what was set). */
export function s(v: Dec): string {
  return v.toFixed();
}

/** Fixed decimals string, e.g. money(…,"USD") -> "1234.50" */
export function fixed(v: Dec, dp = 2): string {
  return v.toFixed(dp, Dec.ROUND_HALF_UP);
}

/** percent(200, 1.5) = 3 (i.e. 1.5% of 200). `pct` is expressed in percent units. */
export function percentOf(base: Dec, pct: Dec): Dec {
  return base.mul(pct).div(100);
}

export function absDiff(a: Dec, b: Dec): Dec {
  return a.minus(b).abs();
}

export function maxD(...xs: Dec[]): Dec {
  return xs.reduce((m, x) => (x.gt(m) ? x : m));
}

export function sum(xs: Dec[]): Dec {
  return xs.reduce((acc, x) => acc.plus(x), new Dec(0));
}

/** Tolerance check, boundary-inclusive: |a-b| <= max(abs, pct% of reference). */
export function withinTolerance(actual: Dec, expected: Dec, tolAbs: Dec, tolPct: Dec): boolean {
  const allowed = maxD(tolAbs, percentOf(expected.abs(), tolPct));
  return absDiff(actual, expected).lte(allowed);
}

/** Format for human display only (UI). Never parse this back. */
export function display(v: Decimal.Value | null | undefined, currency?: string | null, locale = "en-US"): string {
  const d = tryD(v);
  if (!d) return "—";
  const dp = currencyDp(currency);
  const n = d.toFixed(dp, Dec.ROUND_HALF_UP);
  // Intl cannot take Decimal; split to keep full precision, format integer part only.
  const [intPart = "0", frac] = n.replace("-", "").split(".");
  const neg = n.startsWith("-");
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(intPart));
  const decSep = locale.startsWith("de") || locale.startsWith("fr") ? "," : ".";
  return `${neg ? "-" : ""}${grouped}${frac ? decSep + frac : ""}`;
}
