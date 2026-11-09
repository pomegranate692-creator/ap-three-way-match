import type { CanonDoc, CanonLine, DocType, RiskFlag } from "../../shared/schemas.ts";

export interface StoredField {
  key: string;
  value: string | null;
  confidence: number;
}

/** Fields that drive money/quantity decisions: low confidence on these routes the bundle to human review. */
const CRITICAL = /^(docNumber|poRef|supplierName|currency|subtotal|taxTotal|total|line\.\d+\.(sku|qty|unitPrice|amount))$/;

/**
 * Build the engine's input from persisted fields (extracted values with human corrections already applied).
 * Pure function; no I/O.
 */
export function toCanonical(args: {
  documentId: string;
  docType: DocType;
  fields: StoredField[];
  riskFlags: RiskFlag[];
  confidenceThreshold: number;
}): CanonDoc {
  const m = new Map(args.fields.map((f) => [f.key, f]));
  const v = (k: string) => m.get(k)?.value ?? null;
  const idx = new Set<number>();
  for (const f of args.fields) {
    const mm = f.key.match(/^line\.(\d+)\./);
    if (mm) idx.add(Number(mm[1]));
  }
  const lines: CanonLine[] = [...idx]
    .sort((a, b) => a - b)
    .map((i) => ({
      index: i,
      sku: v(`line.${i}.sku`),
      description: v(`line.${i}.description`),
      qty: v(`line.${i}.qty`),
      unitPrice: v(`line.${i}.unitPrice`),
      discountPct: v(`line.${i}.discountPct`),
      amount: v(`line.${i}.amount`),
      date: v(`line.${i}.date`),
      uom: v(`line.${i}.uom`),
    }));
  const lowConfidence = args.fields
    .filter((f) => CRITICAL.test(f.key) && f.confidence < args.confidenceThreshold)
    .map((f) => ({ key: f.key, confidence: f.confidence }));
  return {
    documentId: args.documentId,
    docType: args.docType,
    docNumber: v("docNumber"),
    poRef: v("poRef"),
    supplierName: v("supplierName"),
    supplierTaxId: v("supplierTaxId"),
    currency: v("currency"),
    docDate: v("docDate"),
    taxRate: v("taxRate"),
    subtotal: v("subtotal"),
    discountTotal: v("discountTotal"),
    freight: v("freight"),
    taxTotal: v("taxTotal"),
    total: v("total"),
    lines,
    lowConfidence,
    riskFlags: args.riskFlags,
  };
}
