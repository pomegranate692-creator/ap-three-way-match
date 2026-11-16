import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TextLayer, Word } from "../../shared/schemas.ts";
import { imageSize } from "./imageInfo.ts";
import { IngestError } from "./pdfText.ts";

/**
 * Optional local OCR for scanned/photographed documents (PNG / JPEG).
 * Output is an ordinary TextLayer with per-word confidence and boxes, so the same rules extractor, grounding
 * checks and source highlights apply. OCR text is UNTRUSTED like any other document text.
 */
export interface OcrStatus {
  enabled: boolean;
  reason: string;
  engine: string | null;
}
export interface OcrEngine {
  status(): OcrStatus;
  recognize(bytes: Uint8Array): Promise<TextLayer>;
}

export const OCR_LIMITS = { maxPixels: 24_000_000, minSide: 300, timeoutMs: 90_000 };
/** OCR pages are mapped onto a US-Letter-wide virtual page so the layout heuristics (written in PDF points) behave the same. */
const VIRTUAL_PAGE_WIDTH = 612;

export const disabledOcr = (reason: string): OcrEngine => ({
  status: () => ({ enabled: false, reason, engine: null }),
  async recognize() {
    throw new IngestError(`Image uploads need OCR, which is disabled (${reason}). Upload a PDF with a text layer.`, "UNSUPPORTED_IMAGE");
  },
});

/** Minimal structural view of the tesseract.js result we depend on (keeps the library optional and the types honest). */
interface TessWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TessResult { data: { blocks?: { paragraphs: { lines: { words: TessWord[] }[] }[] }[] | null } }
interface TessWorker {
  recognize(image: Uint8Array, opts: object, output: object): Promise<TessResult>;
  terminate(): Promise<unknown>;
}

export interface TesseractOptions {
  /** where trained language data is cached (downloaded once on first use unless langPath is set) */
  cachePath: string;
  lang?: string;
  /** optional local/mirrored folder or URL holding <lang>.traineddata (offline use) */
  langPath?: string;
  /** test seam */
  /** per-image limit; default OCR_LIMITS.timeoutMs */
  timeoutMs?: number;
  createWorker?: (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorker>;
}

export function tesseractOcr(o: TesseractOptions): OcrEngine {
  const lang = o.lang ?? "eng";
  let worker: Promise<TessWorker> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const start = (): Promise<TessWorker> => {
    if (!worker) {
      mkdirSync(o.cachePath, { recursive: true });
      const make = o.createWorker ?? (async (l: string, oem: number, opts: Record<string, unknown>) => {
        const mod = (await import("tesseract.js")) as unknown as { createWorker: (l: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorker> };
        return mod.createWorker(l, oem, opts);
      });
      worker = make(lang, 1, { cachePath: o.cachePath, ...(o.langPath ? { langPath: o.langPath } : {}), gzip: !o.langPath }).catch((e: Error) => {
        worker = null;
        throw new IngestError(`OCR engine could not start (${e.message}). The first run downloads language data once; check the network or set OCR_LANG_PATH.`, "OCR_UNAVAILABLE");
      });
    }
    return worker;
  };
  const reset = async () => {
    const w = worker;
    worker = null;
    if (w) await w.then((x) => x.terminate()).catch(() => {});
  };

  return {
    status: () => ({ enabled: true, reason: `tesseract.js, language "${lang}", runs locally`, engine: "tesseract.js" }),
    recognize(bytes) {
      const size = imageSize(bytes);
      if (!size || size.width < 1 || size.height < 1) return Promise.reject(new IngestError("This image file could not be read (its header is damaged or incomplete). Upload a PNG or JPEG scan.", "IMAGE_UNREADABLE"));
      if (size.width * size.height > OCR_LIMITS.maxPixels) return Promise.reject(new IngestError(`Image is ${size.width}×${size.height}px; the limit is ${OCR_LIMITS.maxPixels / 1e6} megapixels.`, "IMAGE_UNREADABLE"));
      if (Math.min(size.width, size.height) < OCR_LIMITS.minSide) return Promise.reject(new IngestError(`Image is too small to read reliably (${size.width}×${size.height}px; at least ${OCR_LIMITS.minSide}px on the short side).`, "IMAGE_UNREADABLE"));

      // one recognition at a time: a single worker is shared and memory stays bounded
      const job = queue.then(async () => {
        const w = await start();
        let timer: NodeJS.Timeout | undefined;
        try {
          const result = await Promise.race([
            w.recognize(new Uint8Array(bytes), {}, { blocks: true }),
            new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timed out")), o.timeoutMs ?? OCR_LIMITS.timeoutMs); }),
          ]);
          return toTextLayer(result, size.width, size.height);
        } catch (e) {
          await reset(); // a hung or crashed worker is discarded; the next upload starts a fresh one
          if (e instanceof IngestError) throw e;
          throw new IngestError(`OCR failed: ${(e as Error).message}`, "OCR_FAILED");
        } finally {
          if (timer) clearTimeout(timer);
        }
      });
      queue = job.catch(() => {});
      return job;
    },
  };
}

export function ocrFromEnv(env: NodeJS.ProcessEnv, dataDir: string): OcrEngine {
  if (env.ENABLE_OCR === "0") return disabledOcr("ENABLE_OCR=0");
  return tesseractOcr({ cachePath: env.OCR_CACHE_PATH ?? join(dataDir, "ocr"), ...(env.OCR_LANG ? { lang: env.OCR_LANG } : {}), ...(env.OCR_LANG_PATH ? { langPath: env.OCR_LANG_PATH } : {}) });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Convert an OCR result into the app's TextLayer (boxes normalised, origin top-left; confidence 0..1 per word). */
export function toTextLayer(result: TessResult, imgW: number, imgH: number): TextLayer {
  const k = VIRTUAL_PAGE_WIDTH / imgW;
  const pageH = imgH * k;
  const words: Word[] = [];
  let n = 0;
  for (const block of result.data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const usable = line.words.filter((w) => w.text.trim() && w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0);
        // one font size per line (median box height): digit-only words have no ascenders and would otherwise look smaller
        const size = (median(usable.map((w) => w.bbox.y1 - w.bbox.y0)) * k) / 1.05;
        for (const w of usable) {
          words.push({
            id: `p1w${++n}`,
            text: w.text.trim(),
            size,
            conf: clamp01(w.confidence / 100),
            bbox: { page: 1, x: clamp01(w.bbox.x0 / imgW), y: clamp01(w.bbox.y0 / imgH), w: clamp01((w.bbox.x1 - w.bbox.x0) / imgW), h: clamp01((w.bbox.y1 - w.bbox.y0) / imgH) },
          });
        }
      }
    }
  }
  return { source: "ocr", pages: [{ page: 1, width: VIRTUAL_PAGE_WIDTH, height: pageH, words }] };
}
