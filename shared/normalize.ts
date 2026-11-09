import { tryD } from "./money.ts";

/* ---------- identity normalisation (deterministic) ---------- */

const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "gmbh", "ag", "co", "corp", "corporation", "company", "plc", "sa", "bv", "coop", "cooperative",
]);

export function normSupplier(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ");
  const tokens = cleaned.split(/\s+/).filter(Boolean).filter((t) => !LEGAL_SUFFIXES.has(t));
  return tokens.join(" ");
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, " ");
  if (t.length < 2) return [t];
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const x of A) counts.set(x, (counts.get(x) ?? 0) + 1);
  let inter = 0;
  for (const x of B) {
    const c = counts.get(x) ?? 0;
    if (c > 0) {
      inter++;
      counts.set(x, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}

export function supplierSimilarity(a: string, b: string): number {
  return dice(normSupplier(a), normSupplier(b));
}

/** "INV-10431", "inv 10431", "Inv.10431" all collapse to "INV10431". */
export function normDocNumber(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normSku(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ---------- number parsing (locale aware) ---------- */

export type NumLocale = "us" | "eu";
export interface ParsedNumber {
  ok: boolean;
  /** plain decimal string, e.g. "-1234.56" */
  value: string | null;
  locale: NumLocale | "none";
  /** true when OCR-confusable characters were rewritten (O→0, l→1, …) */
  repaired: boolean;
}

const OCR_DIGIT_MAP: Record<string, string> = { O: "0", o: "0", D: "0", l: "1", I: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2" };

export function parseNumber(raw: string, hint: NumLocale = "us"): ParsedNumber {
  let t = raw.trim().replace(/[   \s]/g, "");
  if (!t) return { ok: false, value: null, locale: "none", repaired: false };
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  // strip currency symbols / ISO codes anywhere at the edges
  t = t.replace(/^(USD|EUR|GBP|CAD|AUD|CHF|JPY)/i, "").replace(/(USD|EUR|GBP|CAD|AUD|CHF|JPY)$/i, "");
  t = t.replace(/^[$€£¥]/, "").replace(/[$€£¥]$/, "");
  if (t.startsWith("-") || t.startsWith("−")) {
    negative = !negative;
    t = t.slice(1);
  }
  if (t.endsWith("-")) {
    negative = !negative;
    t = t.slice(0, -1);
  }
  t = t.replace(/^[$€£¥]/, "");

  let repaired = false;
  if (/[0-9]/.test(t) && /[A-Za-z|]/.test(t)) {
    const rewritten = t.replace(/[A-Za-z|]/g, (ch) => {
      const m = OCR_DIGIT_MAP[ch];
      return m ?? ch;
    });
    if (/^[0-9.,]+$/.test(rewritten)) {
      t = rewritten;
      repaired = true;
    }
  }
  if (!/^[0-9.,]+$/.test(t) || !/[0-9]/.test(t)) return { ok: false, value: null, locale: "none", repaired };

  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let decimalSep: "." | "," | null = null;
  let locale: NumLocale = hint;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? "." : ",";
    locale = decimalSep === "." ? "us" : "eu";
  } else if (lastComma >= 0) {
    const after = t.length - lastComma - 1;
    const multiple = (t.match(/,/g) ?? []).length > 1;
    if (multiple) decimalSep = null; // 1,234,567 → thousands
    else if (after === 3) decimalSep = hint === "eu" ? "," : null; // 1,234 ambiguous → hint decides
    else decimalSep = ",";
    if (decimalSep === ",") locale = "eu";
  } else if (lastDot >= 0) {
    const after = t.length - lastDot - 1;
    const multiple = (t.match(/\./g) ?? []).length > 1;
    if (multiple) decimalSep = null; // 1.234.567 → thousands (eu)
    else if (after === 3) decimalSep = hint === "eu" ? null : "."; // 1.234 ambiguous → hint decides
    else decimalSep = ".";
    if (decimalSep === null && (multiple || hint === "eu")) locale = "eu";
  }
  let intPart = t;
  let frac = "";
  if (decimalSep) {
    const idx = t.lastIndexOf(decimalSep);
    intPart = t.slice(0, idx);
    frac = t.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return { ok: false, value: null, locale: "none", repaired };
  if (intPart === "") intPart = "0";
  const plain = `${negative ? "-" : ""}${intPart}${frac ? "." + frac : ""}`;
  const d = tryD(plain);
  if (!d) return { ok: false, value: null, locale: "none", repaired };
  return { ok: true, value: d.toFixed(), locale, repaired };
}

/** "8.25%" or "19 %" → "8.25" */
export function parsePercent(raw: string, hint: NumLocale = "us"): ParsedNumber {
  return parseNumber(raw.replace(/%/g, ""), hint);
}

/* ---------- dates ---------- */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januar: 1, feb: 2, february: 2, februar: 2, mar: 3, march: 3, mär: 3, märz: 3, apr: 4, april: 4,
  may: 5, mai: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, dez: 12, dezember: 12,
};

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse a document date into a date-only ISO string. NO timezone is invented:
 * document dates are calendar dates in the issuer's local context.
 */
export function parseDate(raw: string, order: "MDY" | "DMY" = "MDY"): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return validYmd(+m[1]!, +m[2]!, +m[3]!);
  if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return validYmd(+m[3]!, +m[2]!, +m[1]!); // dd.mm.yyyy
  if ((m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    const a = +m[1]!;
    const b = +m[2]!;
    if (a > 12) return validYmd(+m[3]!, b, a);
    if (b > 12) return validYmd(+m[3]!, a, b);
    return order === "MDY" ? validYmd(+m[3]!, a, b) : validYmd(+m[3]!, b, a);
  }
  if ((m = t.match(/^([A-Za-zäÄ]+)\.? (\d{1,2}),? (\d{4})$/))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    return mo ? validYmd(+m[3]!, mo, +m[2]!) : null;
  }
  if ((m = t.match(/^(\d{1,2})\.? ([A-Za-zäÄ]+)\.? (\d{4})$/))) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    return mo ? validYmd(+m[3]!, mo, +m[1]!) : null;
  }
  return null;
}

/** Whole days between two date-only strings (b - a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  return Math.round((tb - ta) / 86_400_000);
}

/** Render a UTC ISO timestamp in an IANA timezone for display. */
export function formatInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
