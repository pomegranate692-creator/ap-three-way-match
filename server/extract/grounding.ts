import type { ExtractedField, ExtractionResult, TextLayer, Word } from "../../shared/schemas.ts";
import { FieldSchema } from "../../shared/schemas.ts";
import { parseDate, parseNumber } from "../../shared/normalize.ts";
import { D, tryD } from "../../shared/money.ts";
import type { NumLocale } from "../../shared/normalize.ts";

/**
 * Grounding validator — the safety net between ANY extractor (rules or model) and the database.
 * A field is accepted only if:
 *   1. it passes the schema,
 *   2. every cited word id exists in the document's text layer,
 *   3. its `raw` text equals the cited words, and
 *   4. its normalised value is re-derivable from that raw text by deterministic parsers.
 * A model that invents a value, cites the wrong words, or smuggles in text not on the page is rejected.
 */
export interface GroundingReport {
  accepted: ExtractedField[];
  rejected: { key: string; reason: string }[];
}

const MONEY_KEYS = /^(subtotal|discountTotal|freight|taxTotal|total|line\.\d+\.(qty|unitPrice|discountPct|amount))$/;
const DATE_KEYS = /^(docDate|line\.\d+\.date)$/;

export function validateGrounding(fields: unknown[], layer: TextLayer, hint: { numberLocale: NumLocale; dateOrder: "MDY" | "DMY" }): GroundingReport {
  const index = new Map<string, Word>();
  for (const p of layer.pages) for (const w of p.words) index.set(w.id, w);
  const accepted: ExtractedField[] = [];
  const rejected: GroundingReport["rejected"] = [];
  const seen = new Set<string>();

  for (const candidate of fields) {
    const parsed = FieldSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected.push({ key: String((candidate as { key?: unknown })?.key ?? "?"), reason: `schema: ${parsed.error.issues[0]?.message ?? "invalid"}` });
      continue;
    }
    const f = parsed.data;
    if (seen.has(f.key)) {
      rejected.push({ key: f.key, reason: "duplicate key" });
      continue;
    }
    if (!/^(docNumber|poRef|supplierName|supplierTaxId|currency|docDate|taxRate|subtotal|discountTotal|freight|taxTotal|total|line\.\d+\.(sku|description|qty|uom|unitPrice|discountPct|amount|date))$/.test(f.key)) {
      rejected.push({ key: f.key, reason: "unknown field key" });
      continue;
    }
    const words = f.wordIds.map((id) => index.get(id));
    if (words.some((w) => !w)) {
      rejected.push({ key: f.key, reason: "cites a word id that does not exist in the document" });
      continue;
    }
    const cited = (words as Word[]).map((w) => w.text).join(" ");
    if (normSpace(cited) !== normSpace(f.raw)) {
      rejected.push({ key: f.key, reason: `raw text "${f.raw}" does not match the cited words "${cited}"` });
      continue;
    }
    if (f.value !== null) {
      const why = checkValue(f, hint);
      if (why) {
        rejected.push({ key: f.key, reason: why });
        continue;
      }
    }
    seen.add(f.key);
    accepted.push(f);
  }
  return { accepted, rejected };
}

function normSpace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function checkValue(f: ExtractedField, hint: { numberLocale: NumLocale; dateOrder: "MDY" | "DMY" }): string | null {
  const raw = f.raw;
  if (MONEY_KEYS.test(f.key)) {
    const p = parseNumber(raw, hint.numberLocale);
    const claimed = tryD(f.value);
    if (!p.ok || !claimed) return `value "${f.value}" is not a number derivable from "${raw}"`;
    if (!D(p.value).abs().eq(claimed.abs())) return `value ${f.value} is not derivable from the printed text "${raw}"`;
    return null;
  }
  if (DATE_KEYS.test(f.key)) {
    return parseDate(raw, hint.dateOrder) === f.value ? null : `date ${f.value} is not derivable from "${raw}"`;
  }
  if (f.key === "taxRate") {
    const claimed = tryD(f.value);
    if (!claimed) return "tax rate is not numeric";
    const nums = raw.match(/[\d.,]+/g) ?? [];
    return nums.some((n) => { const p = parseNumber(n, hint.numberLocale); return p.ok && D(p.value).eq(claimed); }) ? null : `tax rate ${f.value} does not appear in "${raw}"`;
  }
  if (f.key === "currency") {
    const v = f.value!.toUpperCase();
    return raw.toUpperCase().includes(v) || (v === "USD" && raw.includes("$")) || (v === "EUR" && raw.includes("€")) || (v === "GBP" && raw.includes("£"))
      ? null
      : `currency ${f.value} is not present in "${raw}"`;
  }
  // text-like fields: normalised value must be present in the raw text
  return normSpace(raw).toLowerCase().includes(normSpace(f.value!).toLowerCase().replace(/^'/, "")) ? null : `value "${f.value}" does not appear in "${raw}"`;
}

export function groundResult(result: ExtractionResult, layer: TextLayer, hint: { numberLocale: NumLocale; dateOrder: "MDY" | "DMY" }) {
  const report = validateGrounding(result.fields, layer, hint);
  return { ...result, fields: report.accepted, warnings: [...result.warnings, ...report.rejected.map((r) => `Rejected field ${r.key}: ${r.reason}`)], rejected: report.rejected };
}
