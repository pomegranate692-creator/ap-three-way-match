import type { DocType, ExtractionResult, RiskFlag, TextLayer } from "../../shared/schemas.ts";
import type { NumLocale } from "../../shared/normalize.ts";
import { readPdfTextLayer, sniffType, LIMITS, IngestError } from "../ingest/pdfText.ts";
import type { OcrEngine } from "../ingest/ocr.ts";
import { toOriginalFrame } from "../ingest/frame.ts";
import { capUnreconciledFigures } from "../extract/arithmeticCheck.ts";
import { chooseReading, capDisagreements, type Reading } from "../extract/readings.ts";
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
 * Images are read by OCR more than once (see OcrEngine.recognizeVariants): the stronger reading wins and fields the readings
 * disagree on, or whose figures do not add up, are marked for review.
 */
export async function analyzePdf(bytes: Uint8Array, opts: AnalyzeOptions): Promise<Analysis> {
  const kind = sniffType(bytes);
  const hint = { numberLocale: opts.numberLocale, dateOrder: opts.dateOrder };
  let candidates: TextLayer[];
  let pageCount: number;
  const isOcr = kind === "png" || kind === "jpeg";
  if (isOcr) {
    if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.maxBytes) throw new IngestError(`File exceeds the ${LIMITS.maxBytes / 1024 / 1024} MB limit.`, "TOO_LARGE");
    if (!opts.ocr) throw new IngestError("Image uploads need an OCR engine, which is not configured.", "UNSUPPORTED_IMAGE");
    candidates = opts.ocr.recognizeVariants ? await opts.ocr.recognizeVariants(bytes) : [await opts.ocr.recognize(bytes)];
    pageCount = 1;
    candidates = candidates.filter((l) => l.pages.some((p) => p.words.length > 0));
    if (candidates.length === 0) throw new IngestError("OCR found no readable text in this image.", "NO_TEXT_LAYER");
  } else {
    const r = await readPdfTextLayer(bytes);
    candidates = [r.layer];
    pageCount = r.pageCount;
  }

  const readings: Reading[] = candidates.map((layer) => {
    const rulesRaw = extractWithRules(layer, opts);
    const g = groundResult(rulesRaw, layer, hint);
    const { rejected, ...ex } = g;
    return { layer, rulesRaw, rejected, extraction: isOcr ? capUnreconciledFigures(ex) : ex };
  });
  const best = chooseReading(readings);
  const others = readings.filter((r) => r !== best);
  let { layer } = best;
  const rulesRaw = best.rulesRaw;
  let extraction = isOcr ? capDisagreements(best.extraction, others.map((r) => r.extraction)) : best.extraction;
  let rejected = best.rejected;
  const riskFlags = scanForRisk(layer);
  const extractorsUsed = isOcr ? ["ocr:tesseract.js", "rules@1.0"] : ["rules@1.0"];
  const words = layer.pages.flatMap((p) => p.words);
  const ocrMeanConfidence = isOcr ? words.reduce((s, w) => s + w.conf, 0) / words.length : null;

  if (opts.llmExtract) {
    try {
      const llm = await opts.llmExtract(layer, rulesRaw);
      if (llm) {
        const g2 = groundResult(llm, layer, hint);
        const have = new Set(extraction.fields.map((f) => f.key));
        const additions = g2.fields.filter((f) => !have.has(f.key)).map((f) => ({ ...f, confidence: Math.min(f.confidence, 0.85) }));
        if (additions.length) {
          extraction = { ...extraction, fields: [...extraction.fields, ...additions] };
          rejected = [...rejected, ...g2.rejected];
          extractorsUsed.push(additions[0]!.extractor);
        } else rejected = [...rejected, ...g2.rejected];
      }
    } catch (e) {
      extraction = { ...extraction, warnings: [...extraction.warnings, `Model extraction unavailable (${(e as Error).message}); rules result used.`] };
    }
  }
  if (ocrMeanConfidence !== null) {
    extraction = { ...extraction, warnings: [...extraction.warnings, `Read from a scanned image by OCR (mean word confidence ${(ocrMeanConfidence * 100).toFixed(0)}%). Check every highlighted value against the image before approving.`] };
  }
  // OCR may have read a deskewed copy; hand back boxes in the original image's frame so highlights line up with what the reviewer sees
  const back = toOriginalFrame(layer, extraction.fields);
  layer = back.layer;
  extraction = { ...extraction, fields: back.fields };
  return { layer, pageCount, extraction, rejected, riskFlags, extractorsUsed, ocrMeanConfidence };
}
