import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { PREPROCESS, boxMean, estimateSkewRad, flattenLighting, preprocessAvailable, preprocessImage } from "../../server/ingest/preprocess.ts";

const deg = (r: number) => (r * 180) / Math.PI;

/** grey page (paper 235) with dark text-row bars, optionally rotated clockwise by `angleDeg` about the centre */
function barsPage(w: number, h: number, angleDeg: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(w * h).fill(235);
  const a = (angleDeg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // un-rotate the pixel into the unrotated page, where rows are every 40px and 14px tall, 80% of the width
    const dx = x - cx, dy = y - cy;
    const ux = dx * cos + dy * sin + cx, uy = -dx * sin + dy * cos + cy;
    if (ux > w * 0.1 && ux < w * 0.9 && uy % 40 < 14 && uy > 40 && uy < h - 40) g[y * w + x] = 40;
  }
  return g;
}

describe("boxMean / flattenLighting", () => {
  it("boxMean averages a clamped window", () => {
    const g = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]); // 3x3
    const m = boxMean(g, 3, 3, 1);
    expect(m[4]).toBeCloseTo(50, 5); // centre: all nine
    expect(m[0]).toBeCloseTo((10 + 20 + 40 + 50) / 4, 5); // corner: 2x2 window
  });

  it("turns a lighting gradient into flat paper while keeping ink dark", () => {
    const w = 400, h = 300, g = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.round(250 - (x / w) * 120); // bright left, dark right
    for (let y = 100; y < 110; y++) for (let x = 20; x < w - 20; x++) g[y * w + x] = Math.round(g[y * w + x]! * 0.25); // ink row, 25% of local brightness
    const f = flattenLighting(g, w, h, 40);
    const paper = [f[50 * w + 40]!, f[50 * w + 200]!, f[50 * w + 360]!];
    expect(Math.max(...paper) - Math.min(...paper)).toBeLessThan(12); // left and right edges now match
    expect(f[105 * w + 200]!).toBeLessThan(PREPROCESS.paperLevel * 0.6); // ink still clearly darker than paper
  });
});

describe("estimateSkewRad", () => {
  it("is ~0 for a level page", () => expect(Math.abs(deg(estimateSkewRad(barsPage(600, 800, 0), 600, 800)))).toBeLessThan(0.2));
  it.each([-4, -1.5, 2, 5])("finds a %d° tilt within 0.3°", (angle) => {
    expect(deg(estimateSkewRad(barsPage(600, 800, angle), 600, 800))).toBeCloseTo(angle, 0);
    expect(Math.abs(deg(estimateSkewRad(barsPage(600, 800, angle), 600, 800)) - angle)).toBeLessThan(0.3);
  });
  it("returns 0 when there is almost no ink", () => expect(estimateSkewRad(new Uint8ClampedArray(100 * 100).fill(240), 100, 100)).toBe(0));
});

describe("preprocessImage", () => {
  it("is available (the dependency is declared)", () => expect(preprocessAvailable()).toBe(true));

  it("upscales a small, tilted, unevenly lit photo and levels it, reporting the rotation it applied", async () => {
    const w = 600, h = 800, bars = barsPage(w, h, 3);
    const cv = createCanvas(w, h), ctx = cv.getContext("2d"), px = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const shade = 1 - 0.3 * ((i % w) / w); px.data.set([bars[i]! * shade, bars[i]! * shade, bars[i]! * shade, 255], i * 4); }
    ctx.putImageData(px, 0, 0);
    const r = await preprocessImage(new Uint8Array(await cv.encode("png")));
    expect(r).not.toBeNull();
    expect(r!.width).toBe(Math.round(w * PREPROCESS.maxScale)); // 600 → 1800 (cap is 3x, target 2400)
    expect(r!.scale).toBeCloseTo(3, 1);
    expect(deg(r!.rotationRad)).toBeCloseTo(-3, 0); // rotated back by about the tilt
    expect(r!.steps.join(" ")).toMatch(/flatten lighting/);
    expect([...r!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG
  });

  it("rejects bytes that are not an image (the OCR engine catches this and reads the original instead)", async () => {
    await expect(preprocessImage(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
