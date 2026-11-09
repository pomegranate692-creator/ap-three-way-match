import { useEffect, useState } from "react";
import { api, download, newKey } from "../lib/api";
import { useApp, useLoad } from "../state";
import { whenFull } from "../lib/format";
import { Empty, ErrorBox, LoadingBlock } from "../components/ui";

interface Preview { count: number; columns: string[]; rows: (string | number | null)[][]; notice: string }
interface Hist { id: string; kind: string; format: string; createdAt: string; rows: number; filename: string; sha256: string; createdBy: string | null; bundleCount: number }

export function Exports() {
  const app = useApp();
  const [kind, setKind] = useState<"approved_register" | "exception_record">("approved_register");
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [prev, setPrev] = useState<Preview | null>(null);
  const [prevErr, setPrevErr] = useState<string | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());
  const hist = useLoad<Hist[]>("/api/exports");

  useEffect(() => {
    let live = true;
    setLoadingPrev(true); setPrevErr(null);
    api<Preview>("POST", "/api/exports", { kind, format, preview: true })
      .then((p) => live && setPrev(p)).catch((e) => { if (live) { setPrev(null); setPrevErr((e as Error).message); } })
      .finally(() => live && setLoadingPrev(false));
    return () => { live = false; };
  }, [kind, format, app.version, app.user?.id]);

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ exportId: string; filename: string; count: number }>("POST", "/api/exports", { kind, format }, { headers: { "idempotency-key": key } });
      await download(`/api/exports/${r.exportId}/download`, r.filename);
      app.notify(`Exported ${r.count} bundle${r.count > 1 ? "s" : ""} to ${r.filename}. No payment or posting happened.`);
      setKey(newKey()); hist.reload(); app.refresh();
    } catch (e) { app.reportError(e, "Export failed."); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>Exports</h1><p>Preview exactly what goes into the file, then create it. Exports are files on your computer — they never post to a ledger or trigger payment.</p></div></div>
      <div className="card card-pad stack" style={{ marginBottom: 18 }}>
        <div className="row" style={{ gap: 24 }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small muted" style={{ padding: 0 }}>What to export</legend>
            <div className="row">
              <label className="row"><input type="radio" name="kind" checked={kind === "approved_register"} onChange={() => setKind("approved_register")} /> Approved register <span className="small muted">(approved bundles)</span></label>
              <label className="row"><input type="radio" name="kind" checked={kind === "exception_record"} onChange={() => setKind("exception_record")} /> Exception record <span className="small muted">(open exceptions, for approval routing)</span></label>
            </div></fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small muted" style={{ padding: 0 }}>Format</legend>
            <div className="row"><label className="row"><input type="radio" name="fmt" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} /> Excel (.xlsx) · 4 sheets + about</label><label className="row"><input type="radio" name="fmt" checked={format === "csv"} onChange={() => setFormat("csv")} /> CSV (.csv) · main table only</label></div></fieldset>
        </div>
        <div aria-live="polite">
          {loadingPrev && <LoadingBlock label="Building preview" />}
          {prevErr && !loadingPrev && <div className="banner info">{prevErr}</div>}
          {prev && !loadingPrev && (
            <>
              <div className="row"><b>Preview</b><span className="small muted">{prev.count} bundle{prev.count > 1 ? "s" : ""} · {prev.rows.length} rows · first columns shown</span></div>
              <div className="table-wrap" style={{ maxHeight: 280, border: "1px solid var(--line)", borderRadius: 6, marginTop: 8 }}>
                <table className="t"><thead><tr>{prev.columns.slice(0, 9).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>{prev.rows.slice(0, 40).map((r, i) => <tr key={i}>{r.slice(0, 9).map((c, j) => <td key={j} className="small">{c === null ? "" : String(c).slice(0, 60)}</td>)}</tr>)}</tbody></table>
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>{prev.notice}</p>
            </>
          )}
        </div>
        <div className="row"><button className="btn primary" disabled={!prev || busy} onClick={create}>{busy ? "Creating…" : `Create ${format.toUpperCase()} and download`}</button><span className="small muted">Text cells that start with = + − @ are neutralised so a hostile supplier name can't run as a spreadsheet formula.</span></div>
      </div>
      <h2 style={{ marginBottom: 8 }}>Export history</h2>
      {hist.error && <ErrorBox message={hist.error.message} onRetry={hist.reload} />}
      <div className="card"><div className="table-wrap"><table className="t">
        <thead><tr><th>When</th><th>Type</th><th>File</th><th className="num">Bundles</th><th>By</th><th>SHA-256</th><th /></tr></thead>
        <tbody>
          {hist.data?.map((h) => (
            <tr key={h.id}><td className="small">{whenFull(h.createdAt, app.org?.timezone)}</td><td>{h.kind === "approved_register" ? "Approved register" : "Exception record"}</td><td className="mono small">{h.filename}</td><td className="num">{h.bundleCount}</td><td>{h.createdBy}</td><td className="mono small">{h.sha256.slice(0, 12)}…</td>
              <td><button className="btn sm" onClick={() => download(`/api/exports/${h.id}/download`, h.filename).catch((e) => app.reportError(e))}>Download</button></td></tr>
          ))}
          {hist.data && !hist.data.length && <tr><td colSpan={7}><Empty title="No exports yet">Approve a bundle, or export an exception record, to see it here.</Empty></td></tr>}
        </tbody></table></div></div>
    </div>
  );
}
