import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { imageSize } from "../../server/ingest/imageInfo.ts";
import { disabledOcr, tesseractOcr, toTextLayer } from "../../server/ingest/ocr.ts";
import { IngestError } from "../../server/ingest/pdfText.ts";
import { FIXTURES } from "../helpers.ts";

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return new Uint8Array(b);
};
const w = (text: string, x0: number, y0: number, x1: number, y1: number, confidence: number) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });
const result = (words: ReturnType<typeof w>[]) => ({ data: { blocks: [{ paragraphs: [{ lines: [{ words }] }] }] } });

describe("image header reading", () => {
  it("reads PNG and JPEG dimensions without decoding", () => {
    expect(imageSize(png(1777, 2300))).toEqual({ width: 1777, height: 2300 });
    expect(imageSize(readFileSync(join(FIXTURES, "scanned", "B01_INV_INV48137.hi.png")))).toEqual({ width: 1777, height: 2300 });
    // SOI, APP0 (len 16), SOF0 (height 600, width 800)
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20]), Buffer.alloc(10)]);
    expect(imageSize(new Uint8Array(jpg))).toEqual({ width: 800, height: 600 });
  });
  it("returns null for truncated or foreign data", () => {
    expect(imageSize(new Uint8Array(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")))).toBeNull();
    expect(imageSize(new Uint8Array(Buffer.from("hello world, not an image at all")))).toBeNull();
  });
});

describe("OCR result → text layer", () => {
  it("normalises boxes, scales confidence to 0..1, drops empty words, and uses one size per line", () => {
    const layer = toTextLayer(result([w("INV-1", 100, 200, 300, 240, 96.4), w("  ", 310, 200, 320, 240, 10), w("42", 400, 205, 460, 235, 71)]), 1000, 2000);
    expect(layer.source).toBe("ocr");
    const [page] = layer.pages;
    expect(page!.width).toBe(612);
    expect(page!.height).toBeCloseTo(1224, 5);
    expect(page!.words.map((x) => x.text)).toEqual(["INV-1", "42"]);
    expect(page!.words[0]!.conf).toBeCloseTo(0.964, 3);
    expect(page!.words[0]!.bbox).toMatchObject({ page: 1, x: 0.1, y: 0.1 });
    expect(page!.words[0]!.bbox.w).toBeCloseTo(0.2, 5);
    expect(page!.words[1]!.size).toBe(page!.words[0]!.size);
    expect(page!.words.every((x) => x.run === undefined)).toBe(true);
  });
  it("tolerates a result with no blocks", () => {
    expect(toTextLayer({ data: { blocks: null } }, 800, 1000).pages[0]!.words).toEqual([]);
  });
});

describe("OCR engine guards (no tesseract needed)", () => {
  const worker = (impl: () => Promise<unknown>) => ({ recognize: impl, terminate: async () => { terminated++; } }) as never;
  let terminated = 0;
  const engine = (impl: () => Promise<unknown>, extra: object = {}) => tesseractOcr({ cachePath: join(FIXTURES, "..", "data", "ocr-test-unused"), createWorker: async () => worker(impl), ...extra });
  const code = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as IngestError | null;

  it("rejects unreadable, tiny and oversized images before any OCR work", async () => {
    const e = engine(async () => { throw new Error("must not run"); });
    expect((await code(e.recognize(new Uint8Array([1, 2, 3]))))?.code).toBe("IMAGE_UNREADABLE");
    expect((await code(e.recognize(png(120, 150))))?.code).toBe("IMAGE_UNREADABLE");
    expect((await code(e.recognize(png(6000, 6000))))?.code).toBe("IMAGE_UNREADABLE");
  });
  it("reports a failed start as OCR_UNAVAILABLE and retries on the next call", async () => {
    let tries = 0;
    const e = tesseractOcr({ cachePath: join(FIXTURES, "..", "data", "ocr-test-unused"), createWorker: async () => { if (++tries === 1) throw new Error("offline"); return worker(async () => result([w("A", 1, 1, 9, 9, 90)])); } });
    expect((await code(e.recognize(png(800, 1000))))?.code).toBe("OCR_UNAVAILABLE");
    expect((await e.recognize(png(800, 1000))).pages[0]!.words).toHaveLength(1);
  });
  it("turns an engine crash or timeout into OCR_FAILED and discards the worker", async () => {
    terminated = 0;
    expect((await code(engine(async () => { throw new Error("boom"); }).recognize(png(800, 1000))))?.code).toBe("OCR_FAILED");
    expect((await code(engine(() => new Promise(() => {}), { timeoutMs: 30 }).recognize(png(800, 1000))))?.code).toBe("OCR_FAILED");
    expect(terminated).toBe(2);
  });
  it("is clearly disabled when switched off", async () => {
    const e = disabledOcr("ENABLE_OCR=0");
    expect(e.status().enabled).toBe(false);
    expect((await code(e.recognize(png(800, 1000))))?.code).toBe("UNSUPPORTED_IMAGE");
  });
});
