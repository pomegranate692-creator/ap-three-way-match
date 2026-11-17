import { createRequire } from "node:module";

/**
 * Image clean-up applied before OCR, aimed at phone-style photos: uneven lighting, shadows, low resolution.
 * Pure pixel maths (no model, no network). The original bytes are never modified; the app stores and serves them untouched.
 *   1. decode and convert to grayscale
 *   2. upscale small images toward ~300 dpi (US-Letter width ≈ 2400 px); never downscale
 *   3. flatten lighting: divide each pixel by the mean of its surrounding window (removes gradients and soft shadows)
 *   4. deskew: find the angle at which text rows line up best (projection profile) and rotate the page level
 */
export interface PreprocessResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** processed size ÷ original size */
  scale: number;
  /** rotation applied to the (scaled) original about its centre, canvas convention (positive = clockwise); 0 when none was needed */
  rotationRad: number;
  steps: string[];
}
export const PREPROCESS = { targetWidth: 2400, maxScale: 3, maxPixels: 12_000_000, windowDivisor: 24, paperLevel: 240, maxSkewDeg: 8, minRotateDeg: 0.3, inkLevel: 150, skewSampleWidth: 700 };

interface Canvas2D {
  createCanvas(w: number, h: number): { getContext(t: "2d"): any; encode(f: "png"): Promise<Buffer> };
  loadImage(b: Buffer): Promise<{ width: number; height: number }>;
}
let canvasMod: Canvas2D | null | undefined;
function canvas(): Canvas2D | null {
  if (canvasMod === undefined) {
    try { canvasMod = createRequire(import.meta.url)("@napi-rs/canvas") as Canvas2D; } catch { canvasMod = null; }
  }
  return canvasMod;
}
export const preprocessAvailable = () => canvas() !== null;

/** Mean of a (2r+1)² window around every pixel, edge-clamped, via an integral image. */
export function boxMean(gray: Uint8Array | Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const ii = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x]!;
      ii[(y + 1) * W + x + 1] = ii[y * W + x + 1]! + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = ii[y1 * W + x1]! - ii[y0 * W + x1]! - ii[y1 * W + x0]! + ii[y0 * W + x0]!;
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** Divide by the local background so a smooth lighting gradient or soft shadow becomes flat paper white. Text stays dark. */
export function flattenLighting(gray: Uint8Array | Uint8ClampedArray, w: number, h: number, radius: number, paper = PREPROCESS.paperLevel): Uint8ClampedArray {
  const bg = boxMean(gray, w, h, radius);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round((gray[i]! / Math.max(bg[i]!, 1)) * paper);
  return out;
}

/**
 * Angle (radians, positive = text rows run clockwise down the page) at which dark pixels pile up into the sharpest horizontal rows.
 * Projection-profile search over ±maxSkewDeg on a subsampled grid: coarse 0.25° steps, then 0.05° refinement.
 */
export function estimateSkewRad(gray: Uint8Array | Uint8ClampedArray, w: number, h: number): number {
  const step = Math.max(1, Math.round(w / PREPROCESS.skewSampleWidth));
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (gray[y * w + x]! < PREPROCESS.inkLevel) { xs.push(x / step); ys.push(y / step); }
  if (xs.length < 50) return 0;
  const rows = Math.ceil(h / step), cols = Math.ceil(w / step);
  const span = rows + cols + 2;
  const score = (a: number) => {
    const sin = Math.sin(a), cos = Math.cos(a), bins = new Float64Array(span);
    for (let i = 0; i < xs.length; i++) bins[Math.floor(-xs[i]! * sin + ys[i]! * cos + cols)]!++;
    let sq = 0;
    for (const b of bins) sq += b * b;
    return sq;
  };
  const max = (PREPROCESS.maxSkewDeg * Math.PI) / 180;
  let best = 0, bestScore = score(0);
  for (let a = -max; a <= max + 1e-9; a += (0.25 * Math.PI) / 180) { const sc = score(a); if (sc > bestScore) { bestScore = sc; best = a; } }
  const centre = best;
  for (let a = centre - (0.25 * Math.PI) / 180; a <= centre + (0.25 * Math.PI) / 180 + 1e-9; a += (0.05 * Math.PI) / 180) { const sc = score(a); if (sc > bestScore) { bestScore = sc; best = a; } }
  return best;
}

export async function preprocessImage(bytes: Uint8Array): Promise<PreprocessResult | null> {
  const c = canvas();
  if (!c) return null;
  const img = await c.loadImage(Buffer.from(bytes));
  const w0 = img.width, h0 = img.height;
  let scale = w0 < PREPROCESS.targetWidth ? Math.min(PREPROCESS.maxScale, PREPROCESS.targetWidth / w0) : 1;
  while (scale > 1 && w0 * h0 * scale * scale > PREPROCESS.maxPixels) scale -= 0.1;
  scale = Math.max(1, scale);
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const cv = c.createCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * px.data[p]! + 0.587 * px.data[p + 1]! + 0.114 * px.data[p + 2]!;
  const flat = flattenLighting(gray, w, h, Math.round(w / PREPROCESS.windowDivisor));
  for (let i = 0, p = 0; i < flat.length; i++, p += 4) { px.data[p] = px.data[p + 1] = px.data[p + 2] = flat[i]!; px.data[p + 3] = 255; }
  ctx.putImageData(px, 0, 0);
  const steps = ["grayscale", ...(scale > 1 ? [`upscale x${scale.toFixed(2)}`] : []), "flatten lighting"];
  let rotationRad = 0;
  let target = cv;
  const skew = estimateSkewRad(flat, w, h);
  if (Math.abs(skew) >= (PREPROCESS.minRotateDeg * Math.PI) / 180) {
    rotationRad = -skew;
    target = c.createCanvas(w, h);
    const o = target.getContext("2d");
    o.fillStyle = `rgb(${PREPROCESS.paperLevel},${PREPROCESS.paperLevel},${PREPROCESS.paperLevel})`;
    o.fillRect(0, 0, w, h);
    o.imageSmoothingQuality = "high";
    o.translate(w / 2, h / 2);
    o.rotate(rotationRad);
    o.drawImage(cv as unknown as never, -w / 2, -h / 2);
    steps.push(`deskew ${((rotationRad * 180) / Math.PI).toFixed(2)}°`);
  }
  return { bytes: new Uint8Array(await target.encode("png")), width: w, height: h, scale: w / w0, rotationRad, steps };
}
