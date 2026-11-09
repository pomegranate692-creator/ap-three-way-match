import type { ExceptionCode, Role } from "./schemas.ts";

/**
 * Role policy. Pure functions: used by the server (enforcement) and the UI (hiding/explaining).
 * The demo identity is a user switcher, NOT authentication (see docs/SECURITY.md).
 */

export const ROLE_LABEL: Record<Role, string> = {
  clerk: "AP Clerk",
  controller: "Controller",
  purchasing: "Purchasing Lead",
};

/** Which roles may waive/override/resolve a given exception code at "review" severity. */
export const REVIEW_OWNERS: Record<ExceptionCode, Role[]> = {
  MISSING_RECEIPT: ["purchasing", "controller"],
  QTY_NOT_RECEIVED: ["purchasing", "controller"],
  QTY_OVER_RECEIVED: ["purchasing", "controller"],
  QTY_OVER_ORDERED: ["purchasing", "controller"],
  PRICE_VARIANCE: ["purchasing", "controller"],
  UNORDERED_ITEM: ["purchasing", "controller"],
  TAX_MISMATCH: ["clerk", "controller"],
  TOTAL_ARITHMETIC: ["clerk", "controller"],
  LINE_ARITHMETIC: ["clerk", "controller"],
  CURRENCY_MISMATCH: ["controller"],
  CURRENCY_CONVERTED: ["clerk", "controller"],
  SUPPLIER_MISMATCH: ["controller"],
  PO_REF_MISMATCH: ["controller"],
  PO_REF_MISSING: ["clerk", "purchasing", "controller"],
  DUPLICATE_INVOICE: ["controller"],
  POSSIBLE_DUPLICATE: ["clerk", "controller"],
  FREIGHT_NOT_AUTHORIZED: ["purchasing", "controller"],
  DISCOUNT_NOT_APPLIED: ["purchasing", "controller"],
  DATE_ANOMALY: ["clerk", "purchasing", "controller"],
  LOW_CONFIDENCE: ["clerk", "controller"],
  SUSPECT_INSTRUCTIONS: ["controller"],
  MISSING_DATA: ["clerk", "controller"],
};

export function canResolveException(role: Role, code: ExceptionCode, severity: "blocking" | "review" | "info"): boolean {
  if (severity === "blocking") return role === "controller";
  return REVIEW_OWNERS[code].includes(role);
}

/** Overriding (accepting a variance despite policy) is a controller-only act. */
export function canOverride(role: Role): boolean {
  return role === "controller";
}

export function canCorrectFields(role: Role): boolean {
  return role === "clerk" || role === "controller";
}

/** Role-level gate only. The amount limit (Decimal) and separation of duties are enforced in server/workflow/approvals.ts. */
export function canApprove(role: Role): { ok: boolean; reason?: string } {
  if (role === "purchasing") return { ok: false, reason: "Purchasing leads resolve receiving/price exceptions but do not approve payment." };
  return { ok: true };
}

export function canExport(role: Role): boolean {
  return role === "clerk" || role === "controller";
}

export function canEditSettings(role: Role): boolean {
  return role === "controller";
}
