import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { DOC_LABEL, whenFull } from "../lib/format";
import { fmtDuration } from "../lib/dash";
import { useApp, useLoad } from "../state";
import { UploadCard } from "../components/dash/UploadCard";
import type { DocItem } from "../components/dash/RecentDocuments";
import { Empty, ErrorBox, LoadingBlock, Modal } from "../components/ui";

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function Documents() {
  const app = useApp();
  const { data, error, loading, reload } = useLoad<DocItem[]>("/api/documents");
  const [q, setQ] = useState(""); const [type, setType] = useState(""); const [src, setSrc] = useState("");
  const [remove, setRemove] = useState<DocItem | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (data ?? []).filter((d) => (!type || d.docType === type) && (!src || d.source === src) && (!q || [d.filename, d.docNumber, d.poRef].some((v) => v?.toLowerCase().includes(q.toLowerCase())))), [data, q, type, src]);

  async function preview(d: DocItem) {
    try { const blob = await api<Blob>("GET", `/api/documents/${d.id}/file`, undefined, { raw: true }); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (e) { app.reportError(e, "Could not open the document."); }
  }
  async function doRemove() {
    if (!remove) return; setBusy(true);
    try { await api("DELETE", `/api/documents/${remove.id}`); app.notify(`Removed ${remove.filename}. Matching was re-run for the bundles it fed.`); setRemove(null); reload(); }
    catch (e) { app.reportError(e, "Could not remove the document."); } finally { setBusy(false); }
  }
  return (
    <div className="page dash">
      <header className="dash-head"><div><h1>Documents</h1><p>Every purchase order, receiving record and invoice the system has read, with its source file. To replace a wrong file, remove it and upload the correct one.</p></div></header>
      <UploadCard onDone={reload} compact />
      <section className="dcard">
        <div className="dcard-head wrap">
          <h2>All documents <span className="muted">({data?.length ?? 0})</span></h2><span className="spacer" />
          <input className="input sel" type="search" placeholder="Search file, number or PO…" aria-label="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input sel" aria-label="Document type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option><option value="PO">Purchase orders</option><option value="GRN">Receiving records</option><option value="INVOICE">Invoices</option></select>
          <select className="input sel" aria-label="Source" value={src} onChange={(e) => setSrc(e.target.value)}><option value="">Demo + uploads</option><option value="demo">Synthetic demo</option><option value="upload">My uploads</option></select>
        </div>
        {error && <ErrorBox message={error.message} onRetry={reload} />}
        {loading && !data && <LoadingBlock label="Loading documents" />}
        {data && (
          <div className="table-wrap"><table className="t">
            <caption className="sr-only">Documents</caption>
            <thead><tr><th>File</th><th>Type</th><th>Number</th><th>PO ref</th><th>Size</th><th>Read in</th><th>Source</th><th>Received</th><th>Bundle</th><th className="act">Actions</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="mono small" title={d.filename}>{d.filename}{d.riskFlags.length > 0 && <span className="pill bad" style={{ marginLeft: 6 }} title={d.riskFlags.join(", ")}>Flagged</span>}</td>
                  <td>{DOC_LABEL[d.docType]}</td><td className="mono">{d.docNumber ?? "—"}</td><td className="mono">{d.poRef ?? "—"}</td>
                  <td className="small">{kb(d.size)} · {d.pageCount}p</td><td className="small">{fmtDuration(d.processingMs)}</td>
                  <td><span className={`pill soft ${d.source === "demo" ? "warn" : "accent"}`}>{d.source === "demo" ? "Synthetic" : "Upload"}</span></td>
                  <td className="small">{whenFull(d.createdAt)}</td>
                  <td>{d.bundles.map((b) => <a key={b.id} href={`#/bundles/${b.id}`} style={{ marginRight: 8 }}>{b.label}</a>)}{!d.bundles.length && <span className="muted small">unlinked</span>}</td>
                  <td className="act" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => preview(d)}>Preview</button>{" "}
                    <button className="btn sm ghost" disabled={app.user?.role !== "controller"} title={app.user?.role === "controller" ? "Remove this document" : "Only a Controller can remove documents"} onClick={() => setRemove(d)}>Remove</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10}><Empty title={data.length ? "Nothing matches these filters" : "No documents yet"}>{data.length ? "Clear the filters." : "Upload a document above or load the demo data from Overview."}</Empty></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>
      {remove && (
        <Modal title="Remove this document?" onClose={() => setRemove(null)} footer={<><button className="btn" onClick={() => setRemove(null)} disabled={busy}>Cancel</button><button className="btn danger" onClick={doRemove} disabled={busy}>{busy ? "Removing…" : "Remove document"}</button></>}>
          <p><b className="mono">{remove.filename}</b> will be deleted from disk and the database. {remove.bundles.length ? `${remove.bundles.length} bundle(s) will be re-evaluated${remove.docType === "INVOICE" ? " (an invoice removed here takes its bundle with it)" : ""}.` : ""} This is recorded in the audit trail and cannot be undone; you can upload the file again.</p>
        </Modal>
      )}
    </div>
  );
}
