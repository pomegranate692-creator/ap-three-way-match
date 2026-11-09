export function money(v: string | null | undefined, currency?: string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const neg = v.startsWith("-");
  const [i = "0", f] = v.replace("-", "").split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dp = currency === "JPY" ? 0 : 2;
  const frac = (f ?? "").padEnd(dp, "0").slice(0, Math.max(dp, (f ?? "").length));
  return `${neg ? "−" : ""}${grouped}${frac ? "." + frac : ""}`;
}
export function qty(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return v.includes(".") ? v.replace(/\.?0+$/, "") : v;
}
export function signed(v: string | null | undefined): string {
  if (!v) return "";
  const n = v.startsWith("-") ? v : "+" + v;
  return n.replace("-", "−");
}
export function when(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date(iso));
  } catch { return iso; }
}
export function whenFull(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" }).format(new Date(iso));
  } catch { return iso; }
}
export const REC_LABEL: Record<string, string> = { READY_FOR_APPROVAL: "Ready for approval", EXCEPTION_REVIEW: "Exception review", HOLD: "Hold" };
export const STATE_LABEL: Record<string, string> = { incomplete: "Incomplete", matched: "In review", held: "On hold", approved: "Approved", rejected: "Rejected", exported: "Exported" };
export const ROLE_LABEL: Record<string, string> = { clerk: "AP Clerk", controller: "Controller", purchasing: "Purchasing Lead" };
export const CODE_LABEL: Record<string, string> = {
  MISSING_RECEIPT: "Missing receipt", QTY_NOT_RECEIVED: "Not received", QTY_OVER_RECEIVED: "Billed > received", QTY_OVER_ORDERED: "Billed > ordered",
  PRICE_VARIANCE: "Price variance", UNORDERED_ITEM: "Item not on PO", TAX_MISMATCH: "Tax mismatch", TOTAL_ARITHMETIC: "Total doesn't add up",
  LINE_ARITHMETIC: "Line arithmetic", CURRENCY_MISMATCH: "Currency mismatch", CURRENCY_CONVERTED: "Currency converted", SUPPLIER_MISMATCH: "Supplier mismatch",
  PO_REF_MISMATCH: "PO reference mismatch", PO_REF_MISSING: "PO reference missing", DUPLICATE_INVOICE: "Duplicate invoice", POSSIBLE_DUPLICATE: "Possible duplicate",
  FREIGHT_NOT_AUTHORIZED: "Freight not authorised", DISCOUNT_NOT_APPLIED: "Discount missing", DATE_ANOMALY: "Date anomaly", LOW_CONFIDENCE: "Low-confidence read",
  SUSPECT_INSTRUCTIONS: "Embedded instructions", MISSING_DATA: "Missing data",
};
export const FIELD_LABEL: Record<string, string> = {
  docNumber: "Document number", poRef: "PO reference", supplierName: "Supplier", supplierTaxId: "Supplier tax ID", currency: "Currency", docDate: "Date", taxRate: "Tax rate %",
  subtotal: "Subtotal", discountTotal: "Discount", freight: "Freight", taxTotal: "Tax", total: "Total",
  sku: "SKU", description: "Description", qty: "Qty", uom: "Unit", unitPrice: "Unit price", discountPct: "Disc %", amount: "Amount", date: "Receipt date",
};
export const labelOfKey = (k: string) => {
  const m = k.match(/^line\.(\d+)\.(.+)$/);
  return m ? `Line ${m[1]} · ${FIELD_LABEL[m[2]!] ?? m[2]}` : FIELD_LABEL[k] ?? k;
};
export const DOC_LABEL: Record<string, string> = { PO: "Purchase order", GRN: "Receiving record", INVOICE: "Invoice" };
export const DOC_SHORT: Record<string, string> = { PO: "PO", GRN: "Receipt", INVOICE: "Invoice" };
