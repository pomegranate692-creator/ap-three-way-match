import { useState } from "react";
import { CODE_LABEL, money, qty } from "../lib/format";
import { invDate } from "../lib/dash";
import { useBundles, useDashboard } from "../lib/hooks";
import { matchStatus, type BundleRowData } from "../lib/status";
import { MatchDonut } from "../components/dash/MatchDonut";
import { useLoad } from "../state";
import { Empty, ErrorBox, LoadingBlock } from "../components/ui";

interface Detail { run: { result: { currency: string | null; lines: { key: string; sku: string | null; description: string | null; ordered: string | null; received: string | null; invoiced: string | null; poNetPrice: string | null; invNetPrice: string | null; status: string; codes: string[] }[]; summary: string } } | null }

function Lines({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<Detail>(`/api/bundles/${id}`, [id]);
  if (error) return <ErrorBox message={error.message} onRetry={reload} />;
  if (loading && !data) return <LoadingBlock label="Loading lines" />;
  const r = data?.run?.result;
  if (!r) return <p className="muted pad">This bundle has not been matched yet.</p>;
  return (
    <div>
      <p className="small muted pad-sm">{r.summary}</p>
      <div className="table-wrap"><table className="t li"><caption className="sr-only">Line-level three-way comparison</caption>
        <thead><tr><th>Item</th><th className="num">Ordered (PO)</th><th className="num">Received</th><th className="num">Invoiced</th><th className="num">PO price</th><th className="num">Invoice price</th><th>Result</th></tr></thead>
        <tbody>{r.lines.map((l) => (
          <tr key={l.key}><td>{l.description ?? l.sku ?? l.key}<div className="small muted mono">{l.sku}</div></td><td className="num">{qty(l.ordered)}</td><td className="num">{qty(l.received)}</td><td className={`num ${l.codes.some((c) => c.startsWith("QTY")) ? "off" : ""}`}>{qty(l.invoiced)}</td>
            <td className="num">{money(l.poNetPrice, r.currency)}</td><td className={`num ${l.codes.includes("PRICE_VARIANCE") ? "off" : ""}`}>{money(l.invNetPrice, r.currency)}</td>
            <td>{l.status === "matched" ? <span className="pill ok">✓ Matched</span> : <span className="pill warn" title={l.codes.map((c) => CODE_LABEL[c] ?? c).join(", ")}>⚠ {l.codes.map((c) => CODE_LABEL[c] ?? c)[0] ?? l.status}</span>}</td></tr>
        ))}</tbody></table></div>
    </div>
  );
}

export function ThreeWay() {
  const dash = useDashboard();
  const b = useBundles();
  const [sel, setSel] = useState<BundleRowData | null>(null);
  return (
    <div className="page dash">
      <header className="dash-head"><div><h1>Three-Way Match</h1><p>Purchase order, receiving record and invoice compared line by line with exact decimal arithmetic and your tolerances. No AI is involved in these numbers.</p></div></header>
      <div className="two">
        <section className="dcard"><div className="dcard-head"><h2>Match results</h2></div><div className="pad">{dash.data ? <MatchDonut buckets={dash.data.buckets} /> : <LoadingBlock />}</div></section>
        <section className="dcard"><div className="dcard-head"><h2>What is compared</h2></div>
          <ul className="pad bullets"><li>Supplier identity and PO reference</li><li>Ordered vs received vs invoiced quantity per line (partial receipts and split shipments included)</li><li>PO price vs invoice price, discounts and freight</li><li>Tax and totals arithmetic, currency policy</li><li>Duplicate and near-duplicate invoices</li></ul></section>
      </div>
      <section className="dcard">
        <div className="dcard-head"><h2>Invoices <span className="muted">({b.rows.length})</span></h2></div>
        {b.error && <ErrorBox message={b.error.message} onRetry={b.reload} />}
        <div className="table-wrap"><table className="t"><caption className="sr-only">Three-way match status by invoice</caption>
          <thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th>PO</th><th>Receipt</th><th>Invoice</th><th className="num">Lines ✓ / ⚠ / ✕</th><th>Result</th></tr></thead>
          <tbody>
            {b.rows.map((r) => { const m = matchStatus(r); return (
              <tr key={r.id} className={`click ${sel?.id === r.id ? "sel" : ""}`} onClick={() => setSel(sel?.id === r.id ? null : r)} tabIndex={0} aria-selected={sel?.id === r.id} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(sel?.id === r.id ? null : r); } }}>
                <td className="mono">{r.invoiceNumber ?? r.label}</td><td>{r.supplier ?? "—"}</td><td className="nowrap">{invDate(r.invoiceDate)}</td>
                <td>{r.docs.po ? <span className="tick ok">✓</span> : <span className="tick bad">✕</span>}</td><td>{r.docs.grn ? <span className="tick ok">✓ {r.docs.grn > 1 ? `×${r.docs.grn}` : ""}</span> : <span className="tick bad">✕</span>}</td><td><span className="tick ok">✓</span></td>
                <td className="num mono">{r.lines.matched} / {r.lines.variance} / {r.lines.unmatched}</td><td><span className={`pill ${m.tone}`}>{m.label}</span></td>
              </tr>); })}
            {!b.rows.length && <tr><td colSpan={8}><Empty title="No invoices yet">Upload documents or load demo data from Overview.</Empty></td></tr>}
          </tbody></table></div>
        {sel && <div className="lines-open"><div className="dcard-head"><h3>Lines for {sel.invoiceNumber ?? sel.label}</h3><a className="link-right" href={`#/bundles/${sel.id}`}>Open full review →</a></div><Lines id={sel.id} /></div>}
      </section>
    </div>
  );
}
