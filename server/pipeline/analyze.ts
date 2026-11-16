import type { DocType, ExtractionResult, RiskFlag, TextLayer } from "../../shared/schemas.ts";
import type { NumLocale } from "../../shared/normalize.ts";
import { readPdfTextLayer, sniffType, LIMITS, IngestError } from "../ingest/pdfText.ts";
import type { OcrEngine } from "../ingest/ocr.ts";
import { scanForRisk } from "../ingest/injection.ts";
import { extractWithRules } from "../extract/rulesExtractor.ts";
import { groundResult } from "../extract/grounding.ts";

export interface AnalyzeOptions {
  numberLocale: NumLocale;
  dateOrder: "MDY" | "DMY";
  docTypeHint?: DocType;
  /** Needed only for PNG/JPEG scans. PDFs never touch it. */
  ocr?: OcrEngine;
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
  /** mean OCR word confidence (0..1) when the text came from OCR, else null */
  ocrMeanConfidence: number | null;
}

/**
 * bytes → text layer → risk scan → rules extraction → (optional model fill-in) → grounding validation.
 * The rules extractor always runs; a model may only ADD fields the rules could not find, and only if grounded.
 */
export async function analyzePdf(bytes: Uint8Array, opts: AnalyzeOptions): Promise<Analysis> {
  const kind = sniffType(bytes);
  let layer: TextLayer;
  let pageCount: number;
  let ocrMeanConfidence: number | null = null;
  if (kind === "png" || kind === "jpeg") {
    if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.maxBytes) throw new IngestError(`File exceeds the ${LIMITS.maxBytes / 1024 / 1024} MB limit.`, "TOO_LARGE");
    if (!opts.ocr) throw new IngestError("Image uploads need an OCR engine, which is not configured.", "UNSUPPORTED_IMAGE");
    layer = await opts.ocr.recognize(bytes);
    pageCount = 1;
    const words = layer.pages.flatMap((p) => p.words);
    if (words.length === 0) throw new IngestError("OCR found no readable text in this image.", "NO_TEXT_LAYER");
    ocrMeanConfidence = words.reduce((s, w) => s + w.conf, 0) / words.length;
  } else {
    ({ layer, pageCount } = await readPdfTextLayer(bytes));
  }
  const riskFlags = scanForRisk(layer);
  const rulesRaw = extractWithRules(layer, opts);
  const hint = { numberLocale: opts.numberLocale, dateOrder: opts.dateOrder };
  let grounded = groundResult(rulesRaw, layer, hint);
  const extractorsUsed = ocrMeanConfidence === null ? ["rules@1.0"] : ["ocr:tesseract.js", "rules@1.0"];

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
  if (ocrMeanConfidence !== null) {
    extraction.warnings.push(`Read from a scanned image by OCR (mean word confidence ${(ocrMeanConfidence * 100).toFixed(0)}%). Check every highlighted value against the image before approving.`);
  }
  return { layer, pageCount, extraction, rejected, riskFlags, extractorsUsed, ocrMeanConfidence };
}
