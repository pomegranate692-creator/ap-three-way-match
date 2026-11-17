import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../../lib/dash";
import { shortDate } from "../../lib/dash";

type Series = "matched" | "exceptions" | "total";
const nice = (max: number) => { if (max <= 4) return 4; const step = Math.pow(10, Math.floor(Math.log10(max / 4))); const m = [1, 2, 2.5, 5, 10].find((x) => x * step * 4 >= max) ?? 10; return m * step * 4; };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el); setW(Math.max(260, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function TrendChart({ trend, bucketDays }: { trend: Dashboard["trend"]; bucketDays: number }) {
  const [ref, W] = useWidth();
  const [hidden, setHidden] = useState<Set<Series>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const H = 210, M = { l: 34, r: 8, t: 10, b: 26 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const maxV = Math.max(1, ...trend.map((b) => b.total));
  const top = nice(maxV), ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const n = trend.length, slot = iw / Math.max(1, n), bw = Math.max(2, Math.min(18, slot * 0.62));
  const x = (i: number) => M.l + slot * i + slot / 2, y = (v: number) => M.t + ih - (v / top) * ih;
  const toggle = (s: Series) => setHidden((h) => { const c = new Set(h); if (c.has(s)) c.delete(s); else c.add(s); return c; });
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 62))));
  const label = (i: number) => (bucketDays > 1 ? `${shortDate(trend[i]!.start)}` : shortDate(trend[i]!.start));
  const empty = trend.every((b) => b.total === 0);
  const hv = hover !== null ? trend[hover] : null;
  const line = trend.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.total).toFixed(1)}`).join("");

  return (
    <div className="trend" ref={ref}>
      <div className="legend" role="group" aria-label="Chart series">
        {([["matched", "Matched", "var(--ok)"], ["exceptions", "Exceptions", "var(--warn)"], ["total", "Total", "var(--accent)"]] as [Series, string, string][]).map(([k, l, c]) => (
          <button key={k} className="legend-btn" aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}><i style={{ background: c }} />{l}</button>
        ))}
      </div>
      <svg width={W} height={H} role="img" aria-label={`Invoices per ${bucketDays > 1 ? "week" : "day"}: matched, exceptions and total. ${trend.reduce((a, b) => a + b.total, 0)} invoices in the period.`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grid" /><text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{Number.isInteger(t) ? t : t.toFixed(1)}</text></g>)}
        {trend.map((b, i) => {
          const mH = hidden.has("matched") ? 0 : (b.matched / top) * ih, eH = hidden.has("exceptions") ? 0 : (b.exceptions / top) * ih;
          return (
            <g key={b.start}>
              {mH > 0 && <rect x={x(i) - bw / 2} y={M.t + ih - mH} width={bw} height={mH} rx={1.5} fill="var(--ok)" opacity={hover === null || hover === i ? 1 : 0.55} />}
              {eH > 0 && <rect x={x(i) - bw / 2} y={M.t + ih - mH - eH} width={bw} height={eH} rx={1.5} fill="var(--warn)" opacity={hover === null || hover === i ? 1 : 0.55} />}
              {i % every === 0 && x(i) < W - M.r - 18 && <text x={x(i)} y={H - 8} textAnchor="middle" className="axis">{label(i)}</text>}
              <rect x={M.l + slot * i} y={M.t} width={slot} height={ih} fill="transparent" tabIndex={0} role="img" aria-label={`${label(i)}: ${b.total} total, ${b.matched} matched, ${b.exceptions} exceptions`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            </g>
          );
        })}
        {!hidden.has("total") && n > 0 && <><path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" />{trend.map((b, i) => <circle key={i} cx={x(i)} cy={y(b.total)} r={hover === i ? 4.5 : 2.6} fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.6} />)}</>}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="axis">No invoices in this period</text>}
        {hv && hover !== null && (
          <g className="tip" transform={`translate(${Math.min(Math.max(x(hover) - 70, M.l), W - M.r - 140)},${M.t + 2})`} pointerEvents="none">
            <rect width={140} height={64} rx={8} />
            <text x={10} y={18} className="tip-h">{bucketDays > 1 ? `${shortDate(hv.start)} – ${shortDate(new Date(Date.parse(hv.end) - 1).toISOString())}` : shortDate(hv.start)}</text>
            <text x={10} y={35} className="tip-t"><tspan fill="var(--ok)">●</tspan> Matched {hv.matched}</text>
            <text x={10} y={49} className="tip-t"><tspan fill="var(--warn)">●</tspan> Exceptions {hv.exceptions} · Total {hv.total}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
