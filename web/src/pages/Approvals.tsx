import { useEffect, useState } from "react";
import { ROLE_LABEL, whenFull } from "../lib/format";
import { hashParams, useBundles, useNarrow } from "../lib/hooks";
import { matchStatus } from "../lib/status";
import { ApprovalPanel } from "../components/dash/ApprovalPanel";
import { Empty } from "../components/ui";
import { useLoad } from "../state";

interface Ev { id: number; at: string; actorName: string | null; actorRole: string | null; action: string; bundleId: string | null; note: string | null }

export function Approvals() {
  const b = useBundles();
  const narrow = useNarrow(900);
  const want = hashParams().get("id");
  const [sel, setSel] = useState<string | null>(want);
  const [open, setOpen] = useState(!!want);
  const hist = useLoad<Ev[]>("/api/audit?action=approval.&limit=50");
  const ids = b.pending.map((x) => x.id);
  useEffect(() => { if (!sel && ids[0]) setSel(ids[0]); }, [sel, ids]);
  const changed = () => { b.reload(); hist.reload(); };
  const label = (id: string | null) => b.data?.find((x) => x.id === id)?.invoiceNumber ?? b.data?.find((x) => x.id === id)?.label ?? id ?? "";
  return (
    <div className="page dash">
      <header className="dash-head"><div><h1>Approvals</h1><p>Invoices waiting for a human decision. The system recommends; you decide, and nothing is ever paid or posted from here.</p></div></header>
      <div className="dash-grid approvals">
        <div className="dash-main">
          <section className="dcard"><div className="dcard-head"><h2>Awaiting decision <span className="muted">({b.pending.length})</span></h2></div>
            {b.pending.length === 0 ? <Empty title="Nothing to approve">{b.rows.length ? "Every invoice has been decided." : "Load demo data or upload documents first."}</Empty> : (
              <ul className="alerts">{b.pending.map((x) => { const m = matchStatus(x); return (
                <li key={x.id}><button className={`rowbtn ${sel === x.id ? "sel" : ""}`} onClick={() => { setSel(x.id); setOpen(true); }}>
                  <b className="mono">{x.invoiceNumber ?? x.label}</b><span className="alabel">{x.supplier ?? "—"}</span><span className={`pill ${m.tone}`}>{m.label}</span></button></li>); })}</ul>)}
          </section>
          <section className="dcard"><div className="dcard-head"><h2>Decision history</h2></div>
            {hist.data && hist.data.length > 0 ? <div className="table-wrap"><table className="t"><caption className="sr-only">Recent approval decisions</caption><thead><tr><th>When</th><th>Invoice</th><th>Decision</th><th>By</th><th>Reason</th></tr></thead>
              <tbody>{hist.data.map((e) => <tr key={e.id}><td className="small nowrap">{whenFull(e.at)}</td><td className="mono">{label(e.bundleId)}</td><td>{e.action.replace("approval.", "")}</td><td>{e.actorName} <span className="muted small">{ROLE_LABEL[e.actorRole ?? ""] ?? ""}</span></td><td className="small">{e.note ?? "—"}</td></tr>)}</tbody></table></div>
              : <p className="muted pad">No decisions recorded yet.</p>}
          </section>
        </div>
        <div className="dash-side" data-open={narrow ? open : true}>
          {narrow && open && <button className="drawer-scrim" aria-label="Close approval review" onClick={() => setOpen(false)} />}
          <ApprovalPanel bundleId={sel} queue={ids} onNavigate={setSel} onChanged={changed} {...(narrow ? { onClose: () => setOpen(false) } : {})} />
        </div>
      </div>
    </div>
  );
}
