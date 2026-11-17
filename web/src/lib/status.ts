import { bucketOfCodes } from "../../../shared/exceptionCategories";

export interface BundleRowData {
  id: string; label: string; state: string; recommendation: string | null; supplier: string | null; poNumber: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  currency: string | null; total: string | null; open: number; openBlocking: number; closed: number; docs: { po: boolean; grn: number; invoice: boolean }; source: string;
  createdAt: string; updatedAt: string; corrections: number; fixtureId: string | null; codes: string[]; lines: { matched: number; variance: number; unmatched: number };
}
export type Tone = "ok" | "warn" | "bad" | "neutral" | "accent";

export function matchStatus(b: BundleRowData): { key: "matched" | "quantity" | "price" | "other" | "none"; label: string; tone: Tone } {
  if (!b.recommendation) return { key: "none", label: "Not matched", tone: "neutral" };
  if (b.open === 0) return { key: "matched", label: "Matched", tone: "ok" };
  const bucket = bucketOfCodes(b.codes);
  const tone: Tone = b.openBlocking ? "bad" : "warn";
  if (bucket === "quantity") return { key: "quantity", label: "Quantity Mismatch", tone };
  if (bucket === "price") return { key: "price", label: "Price Mismatch", tone };
  return { key: "other", label: "Exception", tone };
}
export function processingStatus(b: BundleRowData): { key: string; label: string; tone: Tone } {
  if (b.state === "approved" || b.state === "exported") return { key: "approved", label: b.state === "exported" ? "Exported" : "Approved", tone: "accent" };
  if (b.state === "rejected") return { key: "rejected", label: "Rejected", tone: "bad" };
  if (b.state === "held") return { key: "held", label: "On Hold", tone: "neutral" };
  if (b.state === "incomplete") return { key: "incomplete", label: "Incomplete", tone: "neutral" };
  return b.open === 0 && b.recommendation === "READY_FOR_APPROVAL" ? { key: "ready", label: "Ready for Approval", tone: "ok" } : b.open === 0 ? { key: "ready", label: "Ready for Approval", tone: "ok" } : { key: "review", label: "Needs Review", tone: "warn" };
}
export const isPending = (b: BundleRowData) => ["matched", "held", "incomplete"].includes(b.state);
