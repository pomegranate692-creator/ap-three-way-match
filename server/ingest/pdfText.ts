import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextLayer, Word } from "../../shared/schemas.ts";

export class IngestError extends Error {
  constructor(message: string, readonly code: "NOT_PDF" | "CORRUPT" | "EMPTY" | "NO_TEXT_LAYER" | "TOO_LARGE" | "UNSUPPORTED_IMAGE" | "TOO_MANY_PAGES") {
    super(message);
  }
}

export const LIMITS = { maxBytes: 8 * 1024 * 1024, maxPages: 6 };

export function sniffType(buf: Uint8Array): "pdf" | "png" | "jpeg" | "unknown" {
  const head = Buffer.from(buf.subarray(0, 8));
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head[0] === 0x89 && head.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  return "unknown";
}

/**
 * Read the native text layer of a PDF into words with normalised boxes (origin top-left).
 * Deterministic. No network. Bounded size/pages. Image-only PDFs are rejected explicitly (no OCR engine installed).
 */
export async function readPdfTextLayer(data: Uint8Array): Promise<{ layer: TextLayer; pageCount: number }> {
  if (data.byteLength === 0) throw new IngestError("The file is empty.", "EMPTY");
  if (data.byteLength > LIMITS.maxBytes) throw new IngestError(`File exceeds the ${LIMITS.maxBytes / 1024 / 1024} MB limit.`, "TOO_LARGE");
  const kind = sniffType(data);
  if (kind === "png" || kind === "jpeg") {
    throw new IngestError(
      "Image uploads need an OCR engine, which is not installed in this build (connector status: optional / not built). Upload a PDF with a text layer.",
      "UNSUPPORTED_IMAGE",
    );
  }
  if (kind !== "pdf") throw new IngestError("Not a PDF file (missing %PDF header).", "NOT_PDF");

  let pdf: pdfjs.PDFDocumentProxy;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(data), // copy: pdf.js transfers the buffer
      verbosity: 0,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: false,
    }).promise;
  } catch (e) {
    throw new IngestError(`The PDF could not be parsed: ${(e as Error).message}`, "CORRUPT");
  }
  if (pdf.numPages > LIMITS.maxPages) throw new IngestError(`PDF has ${pdf.numPages} pages; limit is ${LIMITS.maxPages}.`, "TOO_MANY_PAGES");

  const pages: TextLayer["pages"] = [];
  let total = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    const width = x1 - x0;
    const height = y1 - y0;
    const content = await page.getTextContent({ disableCombineTextItems: true } as never);
    const words: Word[] = [];
    let n = 0;
    let run = 0;
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const str = raw.str;
      if (!str || !str.trim()) continue;
      run++;
      const tr = raw.transform as number[];
      const size = Math.hypot(tr[2]!, tr[3]!) || raw.height || 9;
      const baseX = tr[4]! - x0;
      const baseY = tr[5]! - y0;
      const itemW = raw.width || str.length * size * 0.5;
      // split on whitespace; allocate width proportionally to character offsets (approximation for proportional fonts)
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(str))) {
        const start = m.index;
        const len = m[0].length;
        const wx = baseX + (itemW * start) / str.length;
        const ww = (itemW * len) / str.length;
        const top = height - baseY - size * 0.82;
        words.push({
          id: `p${p}w${++n}`,
          text: m[0],
          size,
          conf: 1,
          run,
          bbox: { page: p, x: clamp(wx / width), y: clamp(top / height), w: ww / width, h: (size * 1.05) / height },
        });
      }
    }
    total += words.length;
    pages.push({ page: p, width, height, words });
  }
  await pdf.destroy();
  if (total === 0) {
    throw new IngestError("No text layer found. This looks like a scanned/image-only PDF; OCR is not available in this build.", "NO_TEXT_LAYER");
  }
  return { layer: { source: "pdf-text", pages }, pageCount: pdf.numPages };
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}
