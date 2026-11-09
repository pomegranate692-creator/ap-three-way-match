import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { money, STATE_LABEL, REC_LABEL } from "../lib/format";
import { useApp, useLoad } from "../state";
import { Empty, ErrorBox, Icon, LoadingBlock, RecBadge, StateBadge } from "../components/ui";

interface Bundle {
  id: string; label: string; state: string; recommendation: string | null; supplier: string | null; poNumber: string | null; invoiceNumber: string | null; invoiceDate: string | null;
  currency: string | null; total: string | null; open: number; openBlocking: number; closed: number; docs: { po: boolean; grn: number; invoice: boolean }; source: string; updatedAt: string; corrections: number;
}
interface UploadResult { filename: string; status: "created" | "duplicate_file" | "rejected"; docType?: string; message?: string; bundleIds: string[] }

type Filter = "all" | "ready" | "review" | "hold" | "done";

export function Inbox() {
  const app = useApp();
  const { data, error, loading, reload } = useLoad<Bundle[]>("/api/bundles");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const b = data ?? [];
    const active = b.filter((x) => !["approved", "exported", "rejected"].includes(x.state));
    return {
      all: b.length,
      ready: active.filter((x) => x.recommendation === "READY_FOR_APPROVAL").length,
      review: active.filter((x) => x.recommendation === "EXCEPTION_REVIEW").length,
      hold: active.filter((x) => x.recommendation === "HOLD" || x.state === "held" || x.state === "incomplete").length,
      done: b.filter((x) => ["approved", "exported", "rejected"].includes(x.state)).length,
    };
  }, [data]);

  const rows = useMemo(() => {
    let r = data ?? [];
    const active = (x: Bundle) => !["approved", "exported", "rejected"].includes(x.state);
    if (filter === "ready") r = r.filter((x) => active(x) && x.recommendation === "READY_FOR_APPROVAL");
    if (filter === "review") r = r.filter((x) => active(x) && x.recommendation === "EXCEPTION_REVIEW");
    if (filter === "hold") r = r.filter((x) => active(x) && (x.recommendation === "HOLD" || x.state === "held" || x.state === "incomplete"));
    if (filter === "done") r = r.filter((x) => !active(x));
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter((x) => [x.label, x.supplier, x.invoiceNumber, x.poNumber].some((v) => v?.toLowerCase().includes(s))); }
    return r;
  }, [data, filter, q]);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(`Reading ${list.length} file${list.length > 1 ? "s" : ""}… extraction and matching run on your machine.`);
    setResults(null);
    try {
      const form = new FormData();
      list.forEach((f) => form.append("files", f, f.name));
      const r = await api<{ results: UploadResult[]; bundleIds: string[] }>("POST", "/api/upload", undefined, { form });
      setResults(r.results);
      const created = r.results.filter((x) => x.status === "created").length;
      const rej = r.results.filter((x) => x.status === "rejected").length;
      app.notify(`${created} document${created === 1 ? "" : "s"} added${rej ? `, ${rej} rejected (see details)` : ""}.`, rej && !created ? "bad" : "ok");
      reload();
    } catch (e) { app.reportError(e, "Upload failed."); } finally { setBusy(null); }
  }

  async function loadDemo() {
    setBusy("Loading synthetic bundles through the real extraction and matching pipeline…");
    try {
      const r = await api<{ bundlesLoaded: number }>("POST", "/api/demo/load");
      app.notify(`Loaded ${r.bundlesLoaded} synthetic bundles for ${app.org?.name}.`);
      reload();
    } catch (e) { app.reportError(e, "Could not load demo data."); } finally { setBusy(null); }
  }

  const noData = !loading && !error && (data?.length ?? 0) === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Invoice inbox</h1>
          <p>Each row is one invoice bundled with its purchase order and receiving record. Open one to see where every number came from.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={!!busy}><Icon.upload /> Upload PDFs</button>
          <button className="btn primary" onClick={loadDemo} disabled={!!busy}>Load demo data</button>
        </div>
      </div>

      {noData ? (
        <div className="card"><Empty title="No invoices yet" actions={<><button className="btn primary" onClick={loadDemo} disabled={!!busy}>Load synthetic demo data</button><button className="btn" onClick={() => fileInput.current?.click()} disabled={!!busy}>Upload your own PDFs</button></>}>
          Load the synthetic bundles for {app.org?.name} to try the full flow, or drop in a purchase order, receiving record and invoice (PDFs with a text layer). Nothing leaves this computer.
        </Empty></div>
      ) : (
        <div className="kpis" role="group" aria-label="Filter bundles">
          {([["all", "All bundles", ""], ["ready", "Ready for approval", "ok"], ["review", "Exception review", "warn"], ["hold", "On hold / incomplete", "bad"], ["done", "Approved · rejected", ""]] as [Filter, string, string][]).map(([k, label, tone]) => (
            <button key={k} className={`kpi ${tone}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              <b>{loading ? "–" : counts[k]}</b><span>{label}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`drop ${over ? "over" : ""}`} style={{ marginBottom: 16 }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}
      >
        <b>Drop purchase orders, receiving records and invoices here</b>
        <span className="muted small">PDF with a text layer · up to {app.meta?.limits.maxFileMb ?? 8} MB each · documents are grouped by PO number automatically · </span>
        <button className="btn sm" onClick={() => fileInput.current?.click()} disabled={!!busy}>Choose files</button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
        {busy && <div role="status" className="banner info" style={{ marginTop: 10, justifyContent: "center" }}>{busy}</div>}
      </div>

      {results && (
        <div className="card card-pad stack" style={{ marginBottom: 16 }} aria-live="polite">
          <div className="row"><h3>Upload result</h3><span className="spacer" /><button className="btn sm ghost" onClick={() => setResults(null)}>Dismiss</button></div>
          {results.map((r, i) => (
            <div key={i} className="row">
              <span className={`badge ${r.status === "created" ? "ok" : r.status === "duplicate_file" ? "neutral" : "bad"}`}>{r.status === "created" ? `Added · ${r.docType}` : r.status === "duplicate_file" ? "Already uploaded" : "Rejected"}</span>
              <span className="mono small">{r.filename}</span>
              {r.message && <span className="small muted">{r.message}</span>}
              {r.status === "created" && r.docType === "INVOICE" && r.bundleIds[0] && <a href={`#/bundles/${r.bundleIds[0]}`} className="small">Open bundle →</a>}
            </div>
          ))}
        </div>
      )}

      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data && <div className="card"><LoadingBlock label="Loading bundles" /></div>}

      {data && data.length > 0 && (
        <div className="card">
          <div className="filters" style={{ padding: "12px 12px 0", marginBottom: 0 }}>
            <input className="input" type="search" placeholder="Search supplier, invoice or PO…" aria-label="Search bundles" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
            <span className="small muted">{rows.length} of {data.length} shown{filter !== "all" ? ` · ${filter === "ready" ? REC_LABEL.READY_FOR_APPROVAL : filter === "review" ? REC_LABEL.EXCEPTION_REVIEW : filter === "hold" ? "Hold / incomplete" : STATE_LABEL.approved + " / " + STATE_LABEL.rejected}` : ""}</span>
          </div>
          <div className="table-wrap">
            <table className="t">
              <caption className="sr-only">Invoice bundles</caption>
              <thead><tr><th>Bundle</th><th>Supplier</th><th>Invoice</th><th>PO</th><th className="num">Total</th><th>System recommendation</th><th>Status</th><th className="num">Open</th></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="click" onClick={() => (location.hash = `#/bundles/${b.id}`)}>
                    <td><a href={`#/bundles/${b.id}`} onClick={(e) => e.stopPropagation()}><b>{b.label}</b></a><div className="small muted">{b.docs.po ? "PO" : "no PO"} · {b.docs.grn ? `${b.docs.grn} receipt${b.docs.grn > 1 ? "s" : ""}` : "no receipt"}{b.corrections ? ` · ${b.corrections} edit${b.corrections > 1 ? "s" : ""}` : ""}</div></td>
                    <td>{b.supplier ?? <span className="muted">unread</span>}</td>
                    <td className="mono">{b.invoiceNumber ?? "—"}<div className="small muted">{b.invoiceDate}</div></td>
                    <td className="mono">{b.poNumber ?? "—"}</td>
                    <td className="num">{money(b.total, b.currency)} <span className="muted small">{b.currency}</span></td>
                    <td><RecBadge rec={b.recommendation} /></td>
                    <td><StateBadge state={b.state} /></td>
                    <td className="num">{b.open ? <span className={`badge ${b.openBlocking ? "bad" : "warn"}`}>{b.open}</span> : <span className="tick ok" aria-label="none">✓</span>}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8}><Empty title="Nothing matches this filter">Clear the search or choose another filter.</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
