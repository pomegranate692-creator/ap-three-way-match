import { describe, expect, it } from "vitest";
import { toOriginalBox, toOriginalFrame } from "../../server/ingest/frame.ts";
import type { OcrFrame, TextLayer } from "../../shared/schemas.ts";

/** forward transform used by preprocessing: rotate a normalised point about the page centre by `rotationRad` (canvas convention) */
function rotateForward(u: number, v: number, f: OcrFrame): [number, number] {
  const cos = Math.cos(f.rotationRad), sin = Math.sin(f.rotationRad), cx = f.width / 2, cy = f.height / 2;
  const dx = u * f.width - cx, dy = v * f.height - cy;
  return [(dx * cos - dy * sin + cx) / f.width, (dx * sin + dy * cos + cy) / f.height];
}
const frame: OcrFrame = { rotationRad: (-3 * Math.PI) / 180, width: 2400, height: 3100 };

describe("OCR frame mapping", () => {
  it("maps a point back to where it was in the original photo (round trip)", () => {
    for (const [u, v] of [[0.2, 0.1], [0.5, 0.5], [0.9, 0.8]] as const) {
      const [pu, pv] = rotateForward(u, v, frame);
      const box = toOriginalBox({ page: 1, x: pu, y: pv, w: 0, h: 0 }, frame);
      expect(box.x).toBeCloseTo(u, 9);
      expect(box.y).toBeCloseTo(v, 9);
    }
  });

  it("returns an axis-aligned box that contains the rotated one and stays inside the page", () => {
    const b = toOriginalBox({ page: 1, x: 0.6, y: 0.5, w: 0.2, h: 0.02 }, frame);
    expect(b.w).toBeGreaterThan(0.2);
    expect(b.h).toBeGreaterThan(0.02);
    for (const n of [b.x, b.y, b.x + b.w, b.y + b.h]) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1); }
  });

  it("remaps every word and field box, and drops the frame marker", () => {
    const layer: TextLayer = { source: "ocr", frame, pages: [{ page: 1, width: 612, height: 792, words: [{ id: "w1", text: "x", size: 10, conf: 1, bbox: { page: 1, x: 0.8, y: 0.9, w: 0.05, h: 0.01 } }] }] };
    const fields = [{ key: "total", bbox: { page: 1, x: 0.8, y: 0.9, w: 0.05, h: 0.01 } }, { key: "none", bbox: null }];
    const out = toOriginalFrame(layer, fields);
    expect(out.layer.frame).toBeUndefined();
    expect(out.layer.pages[0]!.words[0]!.bbox).toEqual(out.fields[0]!.bbox);
    expect(out.layer.pages[0]!.words[0]!.bbox).not.toEqual(layer.pages[0]!.words[0]!.bbox);
    expect(out.fields[1]!.bbox).toBeNull();
    expect(layer.frame).toBeDefined(); // input is not mutated
  });

  it("leaves a layer without a rotation untouched", () => {
    const layer: TextLayer = { source: "ocr", pages: [{ page: 1, width: 612, height: 792, words: [] }] };
    const out = toOriginalFrame(layer, [{ key: "a", bbox: { page: 1, x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }]);
    expect(out.fields[0]!.bbox).toEqual({ page: 1, x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
  });
});
