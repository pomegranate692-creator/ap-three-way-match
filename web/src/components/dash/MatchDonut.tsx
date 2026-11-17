import { fmtPct, type Dashboard } from "../../lib/dash";

const SEG: { key: keyof Dashboard["buckets"]; label: string; color: string; filter: string }[] = [
  { key: "matched", label: "Matched", color: "var(--ok)", filter: "READY" },
  { key: "quantity", label: "Quantity Mismatch", color: "var(--warn)", filter: "EXC" },
  { key: "price", label: "Price / Amount Mismatch", color: "var(--bad)", filter: "EXC" },
  { key: "other", label: "Other Exception", color: "var(--ink-3)", filter: "EXC" },
];

export function MatchDonut({ buckets }: { buckets: Dashboard["buckets"] }) {
  const total = buckets.matched + buckets.quantity + buckets.price + buckets.other;
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 150 150" className="donut" role="img" aria-label={`${total} invoices: ${SEG.map((s) => `${buckets[s.key]} ${s.label}`).join(", ")}`}>
        <circle cx="75" cy="75" r={R} fill="none" stroke="var(--line)" strokeWidth="16" />
        {total > 0 && SEG.map((s) => {
          const frac = buckets[s.key] / total; if (!frac) return null;
          const len = frac * C, off = -acc * C; acc += frac;
          return <circle key={s.key} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - (frac < 1 ? 1.5 : 0))} ${C}`} strokeDashoffset={off} transform="rotate(-90 75 75)" />;
        })}
        <text x="75" y="76" textAnchor="middle" className="donut-n">{total}</text>
        <text x="75" y="94" textAnchor="middle" className="donut-l">Invoices</text>
      </svg>
      <ul className="donut-legend">
        {SEG.map((s) => (
          <li key={s.key}>
            <a href={`#/invoices?match=${s.key}`} title={`Show ${s.label} invoices`}><i style={{ background: s.color }} /><span>{s.label}</span><b>{buckets[s.key]}</b><em>({total ? fmtPct(buckets[s.key] / total) : "—"})</em></a>
          </li>
        ))}
      </ul>
    </div>
  );
}
