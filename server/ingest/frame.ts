import type { BBox, ExtractedField, OcrFrame, TextLayer } from "../../shared/schemas.ts";

/**
 * OCR reads a deskewed copy of the photo so text rows are level, but reviewers see the ORIGINAL image.
 * These helpers map boxes from the deskewed frame back to the original frame (the inverse of the rotation applied before OCR).
 */
export function toOriginalBox(b: BBox, f: OcrFrame): BBox {
  const cos = Math.cos(-f.rotationRad), sin = Math.sin(-f.rotationRad);
  const cx = f.width / 2, cy = f.height / 2;
  const xs: number[] = [], ys: number[] = [];
  for (const [u, v] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const) {
    const dx = u * f.width - cx, dy = v * f.height - cy;
    xs.push((dx * cos - dy * sin + cx) / f.width);
    ys.push((dx * sin + dy * cos + cy) / f.height);
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x0 = clamp(Math.min(...xs)), x1 = clamp(Math.max(...xs)), y0 = clamp(Math.min(...ys)), y1 = clamp(Math.max(...ys));
  return { page: b.page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Returns the layer and fields with every box in the original image's frame, and no `frame` marker. No-op when there is none. */
export function toOriginalFrame<F extends Pick<ExtractedField, "bbox">>(layer: TextLayer, fields: F[]): { layer: TextLayer; fields: F[] } {
  const f = layer.frame;
  if (!f || f.rotationRad === 0) {
    const { frame: _drop, ...plain } = layer;
    return { layer: plain, fields };
  }
  return {
    layer: { source: layer.source, pages: layer.pages.map((p) => ({ ...p, words: p.words.map((w) => ({ ...w, bbox: toOriginalBox(w.bbox, f) })) })) },
    fields: fields.map((x) => (x.bbox ? { ...x, bbox: toOriginalBox(x.bbox, f) } : x)),
  };
}
