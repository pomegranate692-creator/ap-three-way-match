import { z } from "zod";

/* ============================================================
 * Typed contracts. Zod is the single source of truth; TS types are inferred.
 * Money / quantities / percentages are DECIMAL STRINGS at every boundary.
 * ============================================================ */

export const decStr = z.string().regex(/^-?\d+(\.\d+)?$/, "must be a decimal string");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "ISO-4217 code");

export const Role = z.enum(["clerk", "controller", "purchasing"]);
export type Role = z.infer<typeof Role>;

export const DocType = z.enum(["PO", "GRN", "INVOICE"]);
export type DocType = z.infer<typeof DocType>;

/** Normalised box: origin top-left, all values 0..1 of page size. */
export const BBox = z.object({
  page: z.number().int().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type BBox = z.infer<typeof BBox>;

/* ---------------- text layer ---------------- */
export const Word = z.object({
  id: z.string(),
  text: z.string(),
  bbox: BBox,
  /** font size in PDF points (used for layout heuristics) */
  size: z.number(),
  /** 1.0 for native text layers; OCR engines provide per-word confidence */
  conf: z.number().min(0).max(1),
  /** index of the source text run (PDF text-show operation); words in one run are never split into separate segments */
  run: z.number().int().optional(),
});
export type Word = z.infer<typeof Word>;

export const TextPage = z.object({ page: z.number().int(), width: z.number(), height: z.number(), words: z.array(Word) });
export const TextLayer = z.object({ source: z.enum(["pdf-text", "ocr"]), pages: z.array(TextPage) });
export type TextLayer = z.infer<typeof TextLayer>;

/* ---------------- risk flags ---------------- */
export const RiskFlag = z.object({
  code: z.enum(["INSTRUCTION_IN_DOCUMENT", "HIDDEN_TEXT", "PAYMENT_REDIRECT"]),
  excerpt: z.string().max(300),
  page: z.number().int().optional(),
  wordIds: z.array(z.string()).default([]),
});
export type RiskFlag = z.infer<typeof RiskFlag>;

/* ---------------- extracted fields ---------------- */
export const FieldSchema = z.object({
  /** header keys: docNumber poRef supplierName supplierTaxId currency docDate taxRate subtotal discountTotal freight taxTotal total
   *  line keys:   line.<n>.sku|description|qty|uom|unitPrice|discountPct|amount|date */
  key: z.string(),
  value: z.string().nullable(),
  raw: z.string(),
  bbox: BBox.nullable(),
  wordIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  extractor: z.string(),
});
export type ExtractedField = z.infer<typeof FieldSchema>;

export const ExtractionResult = z.object({
  docType: DocType,
  classification: z.object({ confidence: z.number(), reason: z.string() }),
  fields: z.array(FieldSchema),
  lineCount: z.number().int(),
  warnings: z.array(z.string()),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/* ---------------- settings (per organisation) ---------------- */
export const FxRate = z.object({ from: currencyCode, to: currencyCode, rate: decStr, asOf: isoDate });
export const SettingsSchema = z.object({
  qtyTolPct: decStr.default("0"),
  qtyTolAbs: decStr.default("0"),
  priceTolPct: decStr.default("1"),
  priceTolAbs: decStr.default("0.01"),
  flagUnderbilling: z.boolean().default(true),
  taxTolAbs: decStr.default("0.05"),
  totalTolAbs: decStr.default("0.02"),
  defaultTaxRate: decStr.default("0"),
  freightTaxable: z.boolean().default(false),
  freightAllowAbs: decStr.default("0"),
  currencyPolicy: z.enum(["strict", "convert"]).default("strict"),
  fxRates: z.array(FxRate).default([]),
  duplicateWindowDays: z.number().int().min(0).max(3650).default(45),
  confidenceThreshold: z.number().min(0).max(1).default(0.8),
  supplierMatchThreshold: z.number().min(0).max(1).default(0.85),
  clerkApprovalLimit: decStr.default("5000"),
  requireSeparateApprover: z.boolean().default(true),
  dateOrder: z.enum(["MDY", "DMY"]).default("MDY"),
  numberLocale: z.enum(["us", "eu"]).default("us"),
  llm: z.object({ extraction: z.boolean().default(false), explanation: z.boolean().default(false) }).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings = (): Settings => SettingsSchema.parse({});

/* ---------------- canonical documents (engine input) ---------------- */
export interface CanonLine {
  index: number; // 1-based line index as it appears on the document
  sku: string | null;
  description: string | null;
  qty: string | null;
  unitPrice: string | null;
  discountPct: string | null;
  amount: string | null;
  date: string | null;
  uom: string | null;
}
export interface CanonDoc {
  documentId: string;
  docType: DocType;
  docNumber: string | null;
  poRef: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  currency: string | null;
  docDate: string | null;
  taxRate: string | null;
  subtotal: string | null;
  discountTotal: string | null;
  freight: string | null;
  taxTotal: string | null;
  total: string | null;
  lines: CanonLine[];
  /** keys of fields below the confidence threshold: list of {key,confidence} */
  lowConfidence: { key: string; confidence: number }[];
  riskFlags: RiskFlag[];
}

/* ---------------- match result ---------------- */
export const Severity = z.enum(["blocking", "review", "info"]);
export type Severity = z.infer<typeof Severity>;

export const ExceptionCode = z.enum([
  "MISSING_RECEIPT",
  "QTY_NOT_RECEIVED",
  "QTY_OVER_RECEIVED",
  "QTY_OVER_ORDERED",
  "PRICE_VARIANCE",
  "UNORDERED_ITEM",
  "TAX_MISMATCH",
  "TOTAL_ARITHMETIC",
  "LINE_ARITHMETIC",
  "CURRENCY_MISMATCH",
  "CURRENCY_CONVERTED",
  "SUPPLIER_MISMATCH",
  "PO_REF_MISMATCH",
  "PO_REF_MISSING",
  "DUPLICATE_INVOICE",
  "POSSIBLE_DUPLICATE",
  "FREIGHT_NOT_AUTHORIZED",
  "DISCOUNT_NOT_APPLIED",
  "DATE_ANOMALY",
  "LOW_CONFIDENCE",
  "SUSPECT_INSTRUCTIONS",
  "MISSING_DATA",
]);
export type ExceptionCode = z.infer<typeof ExceptionCode>;

export const EvidenceRef = z.object({
  documentId: z.string(),
  fieldKey: z.string(),
  label: z.string(),
  value: z.string().nullable(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const ExceptionItem = z.object({
  fingerprint: z.string(),
  code: ExceptionCode,
  severity: Severity,
  lineKey: z.string().nullable(),
  title: z.string(),
  /** deterministic explanation; every number in it comes from `expected`/`actual`/`delta` */
  explanation: z.string(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  /** signed money/qty impact, actual-minus-expected, decimal string */
  delta: z.string().nullable(),
  currency: z.string().nullable(),
  evidence: z.array(EvidenceRef),
  suggestedAction: z.string(),
  ownerRole: Role,
});
export type ExceptionItem = z.infer<typeof ExceptionItem>;

export const LineMatch = z.object({
  key: z.string(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  poLine: z.number().int().nullable(),
  invLine: z.number().int().nullable(),
  ordered: z.string().nullable(),
  received: z.string().nullable(),
  priorBilled: z.string(),
  invoiced: z.string().nullable(),
  poNetPrice: z.string().nullable(),
  invNetPrice: z.string().nullable(),
  invAmount: z.string().nullable(),
  status: z.enum(["matched", "variance", "unmatched"]),
  codes: z.array(ExceptionCode),
});
export type LineMatch = z.infer<typeof LineMatch>;

export const Recommendation = z.enum(["READY_FOR_APPROVAL", "EXCEPTION_REVIEW", "HOLD"]);
export type Recommendation = z.infer<typeof Recommendation>;

export const MatchResult = z.object({
  engineVersion: z.string(),
  settingsHash: z.string(),
  currency: z.string().nullable(),
  lines: z.array(LineMatch),
  exceptions: z.array(ExceptionItem),
  computed: z.object({
    lineSum: z.string().nullable(),
    expectedTax: z.string().nullable(),
    expectedTotal: z.string().nullable(),
    taxRateUsed: z.string().nullable(),
    fxRate: z.string().nullable(),
  }),
  recommendation: Recommendation,
  summary: z.string(),
});
export type MatchResult = z.infer<typeof MatchResult>;

/* ---------------- workflow ---------------- */
export const BundleState = z.enum(["incomplete", "matched", "held", "approved", "rejected", "exported"]);
export type BundleState = z.infer<typeof BundleState>;

export const ExceptionStatus = z.enum(["open", "resolved", "waived", "overridden"]);
export type ExceptionStatus = z.infer<typeof ExceptionStatus>;

export const DecisionAction = z.enum(["approve", "reject", "hold", "reopen"]);
export type DecisionAction = z.infer<typeof DecisionAction>;

export const ExceptionResolveBody = z.object({
  status: z.enum(["resolved", "waived", "overridden", "open"]),
  note: z.string().trim().min(3, "A note of at least 3 characters is required").max(500),
});
export const FieldCorrectionBody = z.object({
  value: z.string().max(300),
  reason: z.string().trim().min(3, "A reason of at least 3 characters is required").max(300),
});
export const DecisionBody = z.object({
  action: DecisionAction,
  reason: z.string().trim().max(500).optional(),
});
export const ExportBody = z.object({
  kind: z.enum(["approved_register", "exception_record"]),
  format: z.enum(["csv", "xlsx"]),
  bundleIds: z.array(z.string()).max(500).optional(),
  preview: z.boolean().optional(),
});
