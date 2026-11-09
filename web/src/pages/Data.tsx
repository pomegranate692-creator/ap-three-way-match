import { useState } from "react";
import { api, download } from "../lib/api";
import { useApp } from "../state";
import { Modal } from "../components/ui";

export function Data() {
  const app = useApp();
  const isCtl = app.user?.role === "controller";
  const [dlg, setDlg] = useState<"reset" | "delete" | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(kind: "reset" | "delete") {
    setBusy(true); setErr(null);
    try {
      if (kind === "reset") { const r = await api<{ bundlesLoaded: number }>("POST", "/api/demo/reset"); app.notify(`Reset. ${r.bundlesLoaded} fresh synthetic bundles loaded.`); }
      else { await api("DELETE", "/api/data", { confirm: "DELETE", includeAudit: false }); app.notify("All documents, bundles and exports for this organisation were deleted. The audit trail was kept."); }
      setDlg(null); setConfirm(""); app.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head"><div><h1>Data and safety</h1><p>What this system is connected to, what it will never do, and how to take your data out or delete it.</p></div></div>
      <div className="stack">
        <section className="card card-pad stack"><h2>Connections</h2>
          <table className="t"><thead><tr><th>Connector</th><th>Status</th><th>Notes</th></tr></thead><tbody>
            {app.meta?.connectors.map((c) => <tr key={c.name}><td>{c.name}</td><td><span className={`badge ${c.status === "available" || c.status === "enabled" ? "ok" : c.status.startsWith("blocked") ? "bad" : "neutral"}`}>{c.status}</span></td><td className="small muted">{c.detail}</td></tr>)}
          </tbody></table>
        </section>
        <section className="card card-pad stack"><h2>What this system will never do</h2>
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
            <li>Make or initiate a payment, or post to a ledger or ERP — there is no such route.</li>
            <li>Send email or messages, or call any service you haven't enabled.</li>
            <li>Follow instructions found inside a document — document text is data, never a command.</li>
            <li>Change an amount with AI — all money maths is deterministic decimal code.</li>
            <li>Approve anything without a named person, a recorded reason, and the right role.</li>
          </ul>
          <p className="small muted">Identity here is a demo user switcher, not real authentication. The server listens on this computer only (127.0.0.1).</p>
        </section>
        <section className="card card-pad stack"><h2>Your data</h2>
          <div className="row"><button className="btn" onClick={() => download("/api/data-export", `ap-data-${app.org?.id}.json`).catch((e) => app.reportError(e))}>Download everything as JSON</button><span className="small muted">Documents' fields, runs, exceptions, approvals, corrections and the audit trail. PDFs are identified by hash, not embedded.</span></div>
          <div className="row"><button className="btn" disabled={!isCtl} onClick={() => setDlg("reset")}>Reset to fresh demo data</button><button className="btn danger" disabled={!isCtl} onClick={() => setDlg("delete")}>Delete all organisation data…</button>{!isCtl && <span className="small muted">Controller only.</span>}</div>
        </section>
      </div>
      {dlg && (
        <Modal title={dlg === "reset" ? "Reset to fresh demo data?" : "Delete all data for this organisation?"} onClose={() => setDlg(null)}
          footer={<><button className="btn" onClick={() => setDlg(null)}>Cancel</button><button className={`btn ${dlg === "delete" ? "danger" : "primary"}`} disabled={busy || (dlg === "delete" && confirm !== "DELETE")} onClick={() => run(dlg)}>{busy ? "Working…" : dlg === "reset" ? "Reset" : "Delete permanently"}</button></>}>
          {dlg === "reset" ? <p>This removes every document, bundle, approval and audit event for <b>{app.org?.name}</b>, then reloads the synthetic bundles. Use it to start the demo again.</p>
            : <><p>This permanently removes every uploaded document, bundle, run, exception, approval and export file for <b>{app.org?.name}</b>. The audit trail is kept (with a record of this deletion). It can't be undone.</p><label className="field">Type DELETE to confirm<input className="input mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label></>}
          {err && <div className="banner bad" role="alert">{err}</div>}
        </Modal>
      )}
    </div>
  );
}
