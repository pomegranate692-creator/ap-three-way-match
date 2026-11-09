import type { BBox, TextLayer, Word } from "../../shared/schemas.ts";

/** Words smaller than this (pt) are treated as hidden/tiny text: ignored for extraction, flagged by the scanner. */
export const TINY_TEXT_PT = 4;

export interface Seg {
  page: number;
  text: string;
  words: Word[];
  /** geometry in PDF points, origin top-left */
  x0: number;
  x1: number;
  yc: number;
  size: number;
  pageW: number;
  pageH: number;
}
export interface Line {
  page: number;
  yc: number;
  segs: Seg[];
  text: string;
}

export function unionBox(words: Word[]): BBox | null {
  if (!words.length) return null;
  const page = words[0]!.bbox.page;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of words) {
    if (w.bbox.page !== page) continue;
    x0 = Math.min(x0, w.bbox.x);
    y0 = Math.min(y0, w.bbox.y);
    x1 = Math.max(x1, w.bbox.x + w.bbox.w);
    y1 = Math.max(y1, w.bbox.y + w.bbox.h);
  }
  return { page, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function makeSeg(words: Word[], pageW: number, pageH: number): Seg {
  const sorted = [...words].sort((a, b) => a.bbox.x - b.bbox.x);
  const x0 = sorted[0]!.bbox.x * pageW;
  const last = sorted[sorted.length - 1]!;
  const x1 = (last.bbox.x + last.bbox.w) * pageW;
  const size = Math.max(...sorted.map((w) => w.size));
  const yc = (sorted[0]!.bbox.y + sorted[0]!.bbox.h / 2) * pageH;
  return { page: sorted[0]!.bbox.page, text: sorted.map((w) => w.text).join(" "), words: sorted, x0, x1, yc, size, pageW, pageH };
}

/** Build lines of segments. A segment is a run of words with no wide gap; wide gaps separate table cells / label vs value. */
export function buildLines(layer: TextLayer): Line[] {
  const lines: Line[] = [];
  for (const pg of layer.pages) {
    const words = pg.words.filter((w) => w.size >= TINY_TEXT_PT);
    const items = words.map((w) => ({ w, yc: (w.bbox.y + w.bbox.h / 2) * pg.height }));
    items.sort((a, b) => a.yc - b.yc || a.w.bbox.x - b.w.bbox.x);
    const clusters: { yc: number; size: number; words: Word[] }[] = [];
    for (const it of items) {
      const c = clusters[clusters.length - 1];
      if (c && Math.abs(it.yc - c.yc) <= Math.max(2.5, c.size * 0.4)) c.words.push(it.w);
      else clusters.push({ yc: it.yc, size: it.w.size, words: [it.w] });
    }
    for (const c of clusters) {
      const ws = [...c.words].sort((a, b) => a.bbox.x - b.bbox.x);
      const segsW: Word[][] = [];
      let cur: Word[] = [];
      for (const w of ws) {
        const prev = cur[cur.length - 1];
        if (prev) {
          const gap = (w.bbox.x - (prev.bbox.x + prev.bbox.w)) * pg.width;
          const sameRun = prev.run !== undefined && prev.run === w.run;
          const lim = sameRun ? Infinity : Math.max(prev.size, w.size) * (prev.run !== undefined ? 0.3 : 0.6);
          if (gap > lim) {
            segsW.push(cur);
            cur = [];
          }
        }
        cur.push(w);
      }
      if (cur.length) segsW.push(cur);
      const segs = segsW.map((sw) => makeSeg(sw, pg.width, pg.height));
      lines.push({ page: pg.page, yc: c.yc, segs, text: segs.map((s) => s.text).join("  ") });
    }
  }
  return lines;
}

export function allSegs(lines: Line[]): Seg[] {
  return lines.flatMap((l) => l.segs);
}

/** Nearest segment to the right on (roughly) the same baseline. */
export function rightOf(seg: Seg, segs: Seg[]): Seg | null {
  let best: Seg | null = null;
  for (const c of segs) {
    if (c === seg || c.page !== seg.page) continue;
    if (Math.abs(c.yc - seg.yc) > Math.max(3, seg.size * 0.55)) continue;
    if (c.x0 < seg.x1 + 1) continue;
    if (!best || c.x0 < best.x0) best = c;
  }
  return best;
}

/** Nearest segment below, roughly left-aligned with `seg` (stacked label/value, or the first line of an address block). */
export function below(seg: Seg, segs: Seg[], maxDy = 26): Seg | null {
  let best: Seg | null = null;
  for (const c of segs) {
    if (c === seg || c.page !== seg.page) continue;
    const dy = c.yc - seg.yc;
    if (dy < Math.max(4, seg.size * 0.6) || dy > maxDy) continue;
    if (Math.abs(c.x0 - seg.x0) > 8) continue;
    if (!best || dy < best.yc - seg.yc) best = c;
  }
  return best;
}
