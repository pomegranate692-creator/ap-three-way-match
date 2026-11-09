import type { DocType, ExtractionResult, RiskFlag, TextLayer } from "../../shared/schemas.ts";
import type { NumLocale } from "../../shared/normalize.ts";
import { readPdfTextLayer } from "../ingest/pdfText.ts";
import { scanForRisk } from "../ingest/injection.ts";
import { extractWithRules } from "../extract/rulesExtractor.ts";
import { groundResult } from "../extract/grounding.ts";

export interface AnalyzeOptions {
  numberLocale: NumLocale;
  dateOrder: "MDY" | "DMY";
  docTypeHint?: DocType;
  /** Optional alternative extractor (e.g. Claude). Must return fields citing word ids; they are grounding-checked here. */
  llmExtract?: (layer: TextLayer, rules: ExtractionResult) => Promise<ExtractionResult | null>;
}

export interface Analysis {
  layer: TextLayer;
  pageCount: number;
  extraction: ExtractionResult;
  rejected: { key: string; reason: string }[];
  riskFlags: RiskFlag[];
  extractorsUsed: string[];
}

/**
 * bytes → text layer → risk scan → rules extraction → (optional model fill-in) → grounding validation.
 * The rules extractor always runs; a model may only ADD fields the rules could not find, and only if grounded.
 */
export async function analyzePdf(bytes: Uint8Array, opts: AnalyzeOptions): Promise<Analysis> {
  const { layer, pageCount } = await readPdfTextLayer(bytes);
  const riskFlags = scanForRisk(layer);
  const rulesRaw = extractWithRules(layer, opts);
  const hint = { numberLocale: opts.numberLocale, dateOrder: opts.dateOrder };
  let grounded = groundResult(rulesRaw, layer, hint);
  const extractorsUsed = ["rules@1.0"];

  if (opts.llmExtract) {
    try {
      const llm = await opts.llmExtract(layer, rulesRaw);
      if (llm) {
        const g2 = groundResult(llm, layer, hint);
        const have = new Set(grounded.fields.map((f) => f.key));
        const additions = g2.fields.filter((f) => !have.has(f.key)).map((f) => ({ ...f, confidence: Math.min(f.confidence, 0.85) }));
        if (additions.length) {
          grounded = { ...grounded, fields: [...grounded.fields, ...additions], rejected: [...grounded.rejected, ...g2.rejected] };
          extractorsUsed.push(additions[0]!.extractor);
        } else grounded = { ...grounded, rejected: [...grounded.rejected, ...g2.rejected] };
      }
    } catch (e) {
      grounded.warnings.push(`Model extraction unavailable (${(e as Error).message}); rules result used.`);
    }
  }
  const { rejected, ...extraction } = grounded;
  return { layer, pageCount, extraction, rejected, riskFlags, extractorsUsed };
}
