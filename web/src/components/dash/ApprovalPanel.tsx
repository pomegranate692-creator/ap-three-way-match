import { useEffect, useState } from "react";
import { api, newKey } from "../../lib/api";
import { CODE_LABEL, ROLE_LABEL, money, qty, whenFull } from "../../lib/format";
import { invDate } from "../../lib/dash";
import { D, tryD } from "../../../../shared/money";
import { useApp, useLoad } from "../../state";
import { DIcon, ErrorBox, LoadingBlock, Modal } from "../ui";

interface Line { key: string; sku: string | null; description: string | null; ordered: string | null; received: string | null; invoiced: string | null; poNetPrice: string | null; invNetPrice: string | null; status: string; codes: string[] }
interface Detail {
  bundle: { id: string; label: string; state: string; recommendation: string | null; poNumber: string | null };
  documents: { id: string; role: string; docType: string; filename: string; docNumber: string | null; fields: { key: string; value: string | null }[] }[];
  run: { version: number; result: { lines: Line[]; currency: string | null } } | null;
  exceptions: { id: string; code: string; severity: string; status: string; title: string; explanation: string; suggestedAction: string }[];
  approvals: { action: string; status: string; decidedBy: string; decidedRole: string; decidedAt: string; reason: string | null }[];
  permissions: { approve: { ok: boolean; reason: string | null }; canReject: boolean; canHold: boolean; canReopen: boolean };
}

/** Item-level variance, calculated with exact decimals: price % when the prices differ, otherwise a quantity overage. */
function variance(l: Line): { text: string; bad: boolean } {
  const po = tryD(l.poNetPrice), inv = tryD(l.invNetPrice);
  if (po && inv && !po.eq(inv) && !po.isZero()) {
    const pct = inv.minus(po).div(po).times(100).toDecimalPlaces(1);
    return { text: `${pct.gt(0) ? "+" : ""}${pct.toString()}%`, bad: true };
  }
  const invq = tryD(l.invoiced), recv = tryD(l.received);
  if (invq && recv && invq.gt(recv)) return { text: `+${D(invq).minus(recv).toString()} qty`, bad: true };
  if (l.status === "unmatched") return { text: "No match", bad: true };
  return { text: "—", bad: false };
}

export function ApprovalPanel(p: { bundleId: string | null; queue: string[]; onNavigate(id: string): void; onChanged(): void; onClose?(): void }) {
  const app = useApp();
  const { data, error, loading, reload } = useLoad<Detail>(p.bundleId ? `/api/bundles/${p.bundleId}` : null, [p.bundleId]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { key: string }>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  useEffect(() => { setNotes(""); setFormErr(null); setConfirm(null); }, [p.bundleId]);

  const idx = p.bundleId ? p.queue.indexOf(p.bundleId) : -1;
  const nav = (
    <div className="pnav">
      <button className="iconbtn" aria-label="Previous invoice" disabled={idx <= 0} onClick={() => p.onNavigate(p.queue[idx - 1]!)}><DIcon.chevL /></button>
      <span className="small">{idx >= 0 ? `${idx + 1} of ${p.queue.length}` : p.queue.length ? `– of ${p.queue.length}` : "0 of 0"}</span>
      <button className="iconbtn" aria-label="Next invoice" disabled={idx < 0 || idx >= p.queue.length - 1} onClick={() => p.onNavigate(p.queue[idx + 1]!)}><DIcon.chev /></button>
      {p.onClose && <button className="iconbtn close" aria-label="Close approval review" onClick={p.onClose}>✕</button>}
    </div>
  );

  if (!p.bundleId) return (
    <aside className="dcard approval" aria-labelledby="ap-h"><div className="dcard-head"><h2 id="ap-h">Approval Review</h2>{nav}</div><div className="pad muted">{p.queue.length ? "Select an invoice from the queue to review it here." : "Nothing is waiting for review."}</div></aside>
  );
  if (error) return <aside className="dcard approval"><div className="dcard-head"><h2 id="ap-h">Approval Review</h2>{nav}</div><div className="pad"><ErrorBox message={error.message} onRetry={reload} /></div></aside>;
  if (!data || (loading && data.bundle.id !== p.bundleId)) return <aside className="dcard approval"><div className="dcard-head"><h2 id="ap-h">Approval Review</h2>{nav}</div><LoadingBlock label="Loading invoice" /></aside>;

  const d = data;
  const inv = d.documents.find((x) => x.role === "invoice");
  const po = d.documents.find((x) => x.role === "po");
  const grns = d.documents.filter((x) => x.role === "grn");
  const f = (k: string) => inv?.fields.find((x) => x.key === k)?.value ?? null;
  const cur = f("currency");
  const open = d.exceptions.filter((e) => e.status === "open");
  const st = d.bundle.state;
  const done = ["approved", "exported", "rejected"].includes(st);
  const lines = d.run?.result.lines ?? [];
  const lastDecision = d.approvals.find((a) => a.status !== "superseded");
  const label = done ? (st === "rejected" ? "Rejected" : "Approved") : st === "held" ? "On Hold" : open.length ? "Needs Review" : "Ready";
  const tone = done ? (st === "rejected" ? "bad" : "accent") : st === "held" ? "neutral" : open.length ? "warn" : "ok";

  async function openDoc(id: string) {
    try { const blob = await api<Blob>("GET", `/api/documents/${id}/file`, undefined, { raw: true }); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (e) { app.reportError(e, "Could not open the document."); }
  }
  async function decide(action: "approve" | "reject" | "hold", reason: string, key: string) {
    setBusy(action); setFormErr(null);
    try {
      await api("POST", `/api/bundles/${d.bundle.id}/decision`, { action, ...(reason ? { reason } : {}) }, { headers: { "idempotency-key": key } });
      app.notify(action === "approve" ? `Invoice ${inv?.docNumber ?? d.bundle.label} approved. Recorded in the audit trail; nothing was paid or posted.` : action === "reject" ? `Invoice ${inv?.docNumber ?? d.bundle.label} rejected.` : `Information requested for ${inv?.docNumber ?? d.bundle.label}; invoice is on hold. (No message is sent from this app; follow up with the supplier yourself.)`);
      setNotes(""); setConfirm(null); reload(); p.onChanged();
    } catch (e) { setFormErr((e as Error).message); app.reportError(e, "The action did not go through; nothing was changed."); setConfirm(null); }
    finally { setBusy(null); }
  }
  const needNotes = (what: string) => { if (notes.trim().length < 3) { setFormErr(`Add a note of at least 3 characters to ${what}.`); document.getElementById("approval-notes")?.focus(); return false; } return true; };

  return (
    <aside className="dcard approval" aria-labelledby="ap-h">
      <div className="dcard-head"><h2 id="ap-h">Approval Review</h2>{nav}</div>
      <div className="ap-body">
        <div className="ap-title"><DIcon.doc /><a href={`#/bundles/${d.bundle.id}`}><b>{inv?.docNumber ?? d.bundle.label}</b></a><span className={`pill soft ${tone}`}>{label}</span></div>
        <dl className="ap-meta">
          <dt>Supplier:</dt><dd>{f("supplierName") ?? "—"}</dd>
          <dt>Invoice Date:</dt><dd>{invDate(f("docDate"))}</dd>
          <dt>Amount:</dt><dd><b>{f("total") ? `${cur && cur !== "USD" ? cur + " " : "$"}${money(f("total"), cur)}` : "—"}</b></dd>
        </dl>

        <div className="ap-box">
          <h3>Three-Way Match Summary</h3>
          <ul className="tw">
            <li><span>Purchase Order</span>{po ? <button className="lnk" onClick={() => openDoc(po.id)}>{po.docNumber ?? po.filename}</button> : <span className="muted">{d.bundle.poNumber ?? "—"}</span>}<span className={po ? "found" : "missing"}>{po ? "✓ Found" : "✕ Missing"}</span></li>
            <li><span>Receiving Record</span>{grns.length ? <button className="lnk" onClick={() => openDoc(grns[0]!.id)}>{grns[0]!.docNumber ?? grns[0]!.filename}{grns.length > 1 ? ` +${grns.length - 1}` : ""}</button> : <span className="muted">—</span>}<span className={grns.length ? "found" : "missing"}>{grns.length ? "✓ Found" : "✕ Missing"}</span></li>
            <li><span>Invoice</span>{inv ? <button className="lnk" onClick={() => openDoc(inv.id)}>{inv.docNumber ?? inv.filename}</button> : <span className="muted">—</span>}<span className={inv ? "found" : "missing"}>{inv ? "✓ Found" : "✕ Missing"}</span></li>
          </ul>
        </div>

        {open.length > 0 ? (
          <div className="ap-exc" role="note">
            <DIcon.warn /><div><b>Exception: {CODE_LABEL[open[0]!.code] ?? open[0]!.title}</b><p>{open[0]!.explanation}</p>
              {open.length > 1 && <a href={`#/bundles/${d.bundle.id}?tab=exceptions`} className="small">+ {open.length - 1} more exception{open.length > 2 ? "s" : ""}</a>}</div>
          </div>
        ) : !done && <div className="ap-ok" role="note"><DIcon.approve /><div><b>No open exceptions</b><p>Quantities, prices, tax and totals agree within your tolerances.</p></div></div>}

        <h3 className="ap-h3">Line Items ({lines.length})</h3>
        <div className="table-wrap"><table className="t li">
          <caption className="sr-only">Line item comparison across purchase order, receipt and invoice</caption>
          <thead><tr><th>Item</th><th className="num">PO Qty</th><th className="num">Recv Qty</th><th className="num">Inv Qty</th><th className="num">PO Price</th><th className="num">Inv Price</th><th className="num">Variance</th></tr></thead>
          <tbody>
            {lines.map((l) => { const v = variance(l); const qBad = l.codes.some((c) => c.startsWith("QTY")); return (
              <tr key={l.key}>
                <td title={l.sku ?? ""}>{l.description ?? l.sku ?? l.key}</td>
                <td className="num">{qty(l.ordered)}</td><td className="num">{qty(l.received)}</td><td className={`num ${qBad ? "off" : ""}`}>{qty(l.invoiced)}</td>
                <td className="num">{l.poNetPrice ? money(l.poNetPrice, d.run?.result.currency) : "—"}</td><td className={`num ${l.codes.includes("PRICE_VARIANCE") ? "off" : ""}`}>{l.invNetPrice ? money(l.invNetPrice, d.run?.result.currency) : "—"}</td>
                <td className="num">{v.bad ? <span className="vbadge">{v.text}</span> : <span className="muted">{v.text}</span>}</td>
              </tr>); })}
            {!lines.length && <tr><td colSpan={7} className="muted">No line items were matched yet.</td></tr>}
          </tbody>
        </table></div>

        {done ? (
          <div className="ap-done">
            <b>{st === "rejected" ? "Rejected" : "Approved"}{lastDecision ? ` by ${lastDecision.decidedBy} (${ROLE_LABEL[lastDecision.decidedRole] ?? lastDecision.decidedRole})` : ""}</b>
            {lastDecision && <div className="muted small">{whenFull(lastDecision.decidedAt)}{lastDecision.reason ? ` — “${lastDecision.reason}”` : ""}</div>}
            <a className="small" href={`#/audit`}>View audit trail →</a>
          </div>
        ) : (
          <>
            <label className="ap-notes" htmlFor="approval-notes"><b>Approval Notes <span className="muted">(optional for approve; required to reject or request info)</span></b>
              <textarea id="approval-notes" className="input" rows={3} maxLength={500} value={notes} onChange={(e) => { setNotes(e.target.value); setFormErr(null); }} placeholder="Add a note for the audit trail…" aria-describedby={formErr ? "ap-err" : undefined} />
            </label>
            {formErr && <div id="ap-err" className="banner bad" role="alert">{formErr}</div>}
            {!d.permissions.approve.ok && <p className="small muted" id="approve-why">Approve is unavailable: {d.permissions.approve.reason}</p>}
            <div className="ap-actions">
              <button className="btn good" disabled={!d.permissions.approve.ok || !!busy} aria-describedby="approve-why" onClick={() => setConfirm({ key: newKey() })}><DIcon.approve /> Approve</button>
              <button className="btn bad" disabled={!d.permissions.canReject || !!busy} title={d.permissions.canReject ? undefined : "Your role cannot reject this invoice right now."} onClick={() => { if (needNotes("reject")) void decide("reject", notes.trim(), newKey()); }}>✕ Reject</button>
              <button className="btn" disabled={!d.permissions.canHold || !!busy} title={d.permissions.canHold ? "Puts the invoice on hold and records what you need. No message is sent." : "Only invoices in review can be put on hold."} onClick={() => { if (needNotes("request information")) void decide("hold", `Information requested: ${notes.trim()}`, newKey()); }}><DIcon.msg /> Request Info</button>
            </div>
          </>
        )}
      </div>
      {confirm && (
        <Modal title="Approve this invoice?" onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)} disabled={!!busy}>Cancel</button><button className="btn primary" disabled={!!busy} onClick={() => decide("approve", notes.trim(), confirm.key)}>{busy ? "Working…" : "Confirm approval"}</button></>}>
          <p>You are approving <b>{inv?.docNumber ?? d.bundle.label}</b> from <b>{f("supplierName")}</b> for <b>{cur} {money(f("total"), cur)}</b> as <b>{app.user?.name}</b> ({ROLE_LABEL[app.user?.role ?? "clerk"]}).</p>
          <p className="small muted">This records a human approval in the audit trail. It does not pay the invoice or post to any ledger.</p>
        </Modal>
      )}
    </aside>
  );
}
