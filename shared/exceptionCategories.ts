/**
 * Business-level grouping of the 22 engine exception codes, used by the dashboard alerts and the exception queue filter.
 * Pure data: no logic here decides anything; the engine still produces the codes.
 */
export const EXCEPTION_CATEGORIES = [
  { key: "price", label: "Price discrepancy", codes: ["PRICE_VARIANCE", "DISCOUNT_NOT_APPLIED"] },
  { key: "quantity", label: "Quantity mismatch", codes: ["QTY_NOT_RECEIVED", "QTY_OVER_RECEIVED", "QTY_OVER_ORDERED", "UNORDERED_ITEM"] },
  { key: "missing_po", label: "Missing purchase order", codes: ["PO_REF_MISSING", "PO_REF_MISMATCH"] },
  { key: "missing_receipt", label: "Missing receiving record", codes: ["MISSING_RECEIPT"] },
  { key: "duplicate", label: "Duplicate invoice", codes: ["DUPLICATE_INVOICE", "POSSIBLE_DUPLICATE"] },
  { key: "amounts", label: "Tax, total or currency mismatch", codes: ["TAX_MISMATCH", "TOTAL_ARITHMETIC", "LINE_ARITHMETIC", "CURRENCY_MISMATCH", "CURRENCY_CONVERTED", "SUPPLIER_MISMATCH", "FREIGHT_NOT_AUTHORIZED"] },
  { key: "extraction", label: "Extraction or validation issue", codes: ["LOW_CONFIDENCE", "MISSING_DATA", "DATE_ANOMALY", "SUSPECT_INSTRUCTIONS"] },
] as const;

export type ExceptionCategoryKey = (typeof EXCEPTION_CATEGORIES)[number]["key"];

const BY_CODE = new Map<string, ExceptionCategoryKey>(EXCEPTION_CATEGORIES.flatMap((c) => c.codes.map((code) => [code, c.key] as const)));

export const categoryOfCode = (code: string): ExceptionCategoryKey => BY_CODE.get(code) ?? "extraction";
export const codesOfCategory = (key: string): readonly string[] => EXCEPTION_CATEGORIES.find((c) => c.key === key)?.codes ?? [];

/** The three buckets used by the three-way-match donut. Precedence: price/amount, then quantity, then everything else. */
export type MatchBucket = "matched" | "quantity" | "price" | "other";
const PRICE_KEYS: ReadonlySet<string> = new Set(["price", "amounts"]);
export function bucketOfCodes(codes: readonly string[]): MatchBucket {
  if (!codes.length) return "matched";
  const cats = new Set(codes.map(categoryOfCode));
  if ([...cats].some((c) => PRICE_KEYS.has(c))) return "price";
  if (cats.has("quantity")) return "quantity";
  return "other";
}

/** MISSING_DATA is generic; "No purchase order on file" is a missing-PO case, everything else is an extraction/validation gap. */
export const categoryOfException = (code: string, title?: string | null): ExceptionCategoryKey =>
  code === "MISSING_DATA" && /purchase order/i.test(title ?? "") ? "missing_po" : categoryOfCode(code);
export const matchesCategory = (key: string, code: string, title?: string | null) => categoryOfException(code, title) === key;
