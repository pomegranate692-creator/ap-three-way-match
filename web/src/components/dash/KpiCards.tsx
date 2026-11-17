import type { ReactNode } from "react";
import { DIcon } from "../ui";
import { fmtDuration, fmtMoneyWhole, fmtPct, type Dashboard, type Delta } from "../../lib/dash";

/** Trend text only exists when the server proved enough history; `good` says whether "up" is good news for this metric. */
function Trend({ d, good, label }: { d: Delta | null; good: "up" | "down"; label: string }) {
  if (!d) return <span className="kpi-sub muted">{label}</span>;
  const tone = d.direction === "flat" ? "flat" : d.direction === good ? "good" : "bad";
  const Arrow = d.direction === "down" ? DIcon.arrowDown : DIcon.arrowUp;
  const txt = d.unit === "pp" ? `${d.direction === "down" ? "−" : "+"}${d.value} pp` : `${d.direction === "down" ? "−" : "+"}${d.value}%`;
  return <span className="kpi-sub"><span className={`delta ${tone}`}>{d.direction !== "flat" && <Arrow />}{txt}</span> <span className="muted">vs. prior period</span></span>;
}

function Card({ tone, icon, label, value, children, title }: { tone: string; icon: ReactNode; label: string; value: string; children: ReactNode; title?: string }) {
  return (
    <div className={`kcard ${tone}`} role="group" aria-label={label} title={title}>
      <div className="kicon" aria-hidden>{icon}</div>
      <div className="kbody">
        <div className="klabel">{label}</div>
        <div className="kvalue">{value}</div>
        {children}
      </div>
    </div>
  );
}

export function KpiCards({ d, loading }: { d: Dashboard | null; loading: boolean }) {
  if (!d) return <div className="kpi-row">{Array.from({ length: 5 }, (_, i) => <div key={i} className="kcard skeleton-card" aria-hidden />)}</div>;
  const k = d.kpis;
  const other = k.totalValue.other;
  return (
    <div className="kpi-row" aria-busy={loading}>
      <Card tone="blue" icon={<DIcon.doc />} label="Invoices Processed" value={k.processed.value.toLocaleString()} title="Invoices (bundles) received in the selected period">
        <Trend d={k.processed.delta} good="up" label={`${d.data.demo ? "incl. demo data" : "in this period"}`} />
      </Card>
      <Card tone="green" icon={<DIcon.approve />} label="Auto-Match Rate" value={fmtPct(k.autoMatchRate.value)} title="Share of invoices the engine found nothing wrong with on first read">
        <Trend d={k.autoMatchRate.delta} good="up" label={k.processed.value ? `${k.autoMatchRate.matched} of ${k.processed.value} clean on first read` : "no invoices yet"} />
      </Card>
      <Card tone="amber" icon={<DIcon.warn />} label="Exceptions" value={String(k.exceptions.value)} title="Invoices where the first read found a discrepancy">
        <Trend d={k.exceptions.delta} good="down" label={`${k.exceptions.open} open now`} />
      </Card>
      <Card tone="blue" icon={<DIcon.clock />} label="Avg. Processing Time" value={fmtDuration(k.avgProcessingMs.value)} title="Measured: read, classify, extract, validate and match, per document">
        <Trend d={k.avgProcessingMs.delta} good="down" label={k.avgProcessingMs.samples ? `per document · ${k.avgProcessingMs.samples} measured` : "not measured for this data"} />
      </Card>
      <Card tone="green" icon={<DIcon.coins />} label="Total Invoice Value" value={fmtMoneyWhole(k.totalValue.value, k.totalValue.currency)} title={`Sum of invoice totals in ${k.totalValue.currency}; other currencies are not converted`}>
        <Trend d={k.totalValue.delta} good="up" label={other.length ? `+ ${other.map((o) => `${o.currency} ${Number(o.total).toLocaleString("en-US", { maximumFractionDigits: 0 })}`).join(", ")} (not converted)` : k.totalValue.unread ? `${k.totalValue.unread} unread total(s) excluded` : `${k.totalValue.currency}, no conversion`} />
      </Card>
    </div>
  );
}
