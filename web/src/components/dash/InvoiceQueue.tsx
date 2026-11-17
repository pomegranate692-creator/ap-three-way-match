import { useEffect, useMemo, useRef, useState } from "react";
import { api, download, newKey } from "../../lib/api";
import { money } from "../../lib/format";
import { invDate } from "../../lib/dash";
import { matchStatus, processingStatus, type BundleRowData } from "../../lib/status";
import { useApp } from "../../state";
import { DIcon, Empty } from "../ui";

type SortKey = "invoice" | "supplier" | "date" | "amount" | "match" | "status";
const STATUS_OPTS: [string, string][] = [["all", "All Statuses"], ["ready", "Ready for Approval"], ["review", "Needs Review"], ["held", "On Hold"], ["incomplete", "Incomplete"], ["approved", "Approved / Exported"], ["rejected", "Rejected"]];
const MATCH_OPTS: [string, string][] = [["all", "Any match result"], ["matched", "Matched"], ["quantity", "Quantity mismatch"], ["price", "Price / amount mismatch"], ["other", "Other exception"]];

export function InvoiceQueue(p: { rows: BundleRowData[]; loading: boolean; selectedId: string | null; onSelect(id: string): void; pageSize?: number; initialMatch?: string; onChanged?(): void; showMatchFilter?: boolean }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [match, setMatch] = useState(p.initialMatch ?? "all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(p.pageSize ?? 5);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { setMatch(p.initialMatch ?? "all"); }, [p.initialMatch]);
  useEffect(() => { setPage(0); }, [q, status, match, size]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest(".row-menu")) setMenu(null); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menu]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = p.rows.filter((b) => {
      if (s && ![b.label, b.supplier, b.invoiceNumber, b.poNumber].some((v) => v?.toLowerCase().includes(s))) return false;
      if (status !== "all") { const k = processingStatus(b).key; if (status === "approved" ? k !== "approved" : k !== status) return false; }
      if (match !== "all" && matchStatus(b).key !== match) return false;
      return true;
    });
    const val = (b: BundleRowData): string | number => ({
      invoice: b.invoiceNumber ?? b.label, supplier: b.supplier ?? "", date: b.invoiceDate ?? b.createdAt, amount: Number(b.total ?? 0), match: matchStatus(b).label, status: processingStatus(b).label,
    })[sort.key];
    return [...r].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir || a.label.localeCompare(b.label, undefined, { numeric: true }); });
  }, [p.rows, q, status, match, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const cur = Math.min(page, pages - 1);
  const view = filtered.slice(cur * size, cur * size + size);
  const allOnPage = view.length > 0 && view.every((b) => sel.has(b.id));
  const toggle = (id: string) => setSel((s) => { const c = new Set(s); if (c.has(id)) c.delete(id); else c.add(id); return c; });
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="thbtn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>{label}<span aria-hidden>{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span></button>
    </th>
  );

  async function exportSelected() {
    // The exception record only accepts invoices that still have open exceptions; say plainly how many were left out.
    const eligible = p.rows.filter((b) => sel.has(b.id) && b.open > 0 && ["matched", "held", "incomplete"].includes(b.state));
    const skipped = sel.size - eligible.length;
    if (!eligible.length) { app.notify("None of the selected invoices has an open exception, so there is nothing to put in an exception record.", "bad"); return; }
    try {
      const r = await api<{ exportId: string; filename: string; count: number }>("POST", "/api/exports", { kind: "exception_record", format: "csv", bundleIds: eligible.map((b) => b.id) }, { headers: { "idempotency-key": newKey() } });
      await download(`/api/exports/${r.exportId}/download`, r.filename);
      app.notify(`Exported ${r.count} invoice${r.count === 1 ? "" : "s"} with open exceptions to ${r.filename}${skipped ? ` (${skipped} selected without open exceptions left out)` : ""}. No payment or posting happened.`);
      p.onChanged?.();
    } catch (e) { app.reportError(e, "Export failed."); }
  }
  async function viewDoc(b: BundleRowData) {
    try {
      const d = await api<{ documents: { id: string; role: string }[] }>("GET", `/api/bundles/${b.id}`);
      const inv = d.documents.find((x) => x.role === "invoice");
      if (!inv) throw new Error("This bundle has no invoice document.");
      const blob = await api<Blob>("GET", `/api/documents/${inv.id}/file`, undefined, { raw: true });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { app.reportError(e, "Could not open the document."); }
  }

  return (
    <section className="dcard queue" aria-labelledby="iq-h" ref={wrap}>
      <div className="dcard-head wrap">
        <h2 id="iq-h">Invoice Queue <span className="muted">({p.rows.length} total)</span></h2>
        <span className="spacer" />
        <label className="searchbox"><DIcon.search /><input type="search" placeholder="Search invoices, suppliers, or PO numbers..." aria-label="Search invoices, suppliers or PO numbers" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select className="input sel" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {p.showMatchFilter && <select className="input sel" aria-label="Filter by match result" value={match} onChange={(e) => setMatch(e.target.value)}>{MATCH_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
      </div>
      {sel.size > 0 && (
        <div className="selbar" role="status"><b>{sel.size} selected</b><button className="btn sm" onClick={exportSelected}><DIcon.doc /> Export exception record</button><button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button></div>
      )}
      <div className="table-wrap">
        <table className="t qt">
          <caption className="sr-only">Invoice queue</caption>
          <thead><tr>
            <th className="cb"><input type="checkbox" aria-label="Select all invoices on this page" checked={allOnPage} onChange={() => setSel((s) => { const c = new Set(s); view.forEach((b) => (allOnPage ? c.delete(b.id) : c.add(b.id))); return c; })} /></th>
            {th("invoice", "Invoice #")}{th("supplier", "Supplier")}{th("date", "Invoice Date")}{th("amount", "Amount", "num")}{th("match", "Match Status")}{th("status", "Processing Status")}<th className="act">Actions</th>
          </tr></thead>
          <tbody>
            {view.map((b) => {
              const m = matchStatus(b), s = processingStatus(b);
              return (
                <tr key={b.id} className={`click ${p.selectedId === b.id ? "sel" : ""}`} onClick={() => p.onSelect(b.id)} aria-selected={p.selectedId === b.id}>
                  <td className="cb" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${b.invoiceNumber ?? b.label}`} checked={sel.has(b.id)} onChange={() => toggle(b.id)} /></td>
                  <td className="nowrap"><a href={`#/bundles/${b.id}`} className="inv-link" onClick={(e) => e.stopPropagation()}>{b.invoiceNumber ?? b.label}</a>{b.fixtureId && <span className="scn" title="Synthetic demo scenario id">{b.fixtureId}</span>}</td>
                  <td>{b.supplier ?? <span className="muted">unread</span>}</td>
                  <td className="nowrap">{invDate(b.invoiceDate)}</td>
                  <td className="num">{b.total ? `${b.currency && b.currency !== "USD" ? b.currency + " " : "$"}${money(b.total, b.currency)}` : "—"}</td>
                  <td><span className={`pill ${m.tone}`}>{m.key === "matched" ? "✓ " : m.key === "none" ? "" : "⚠ "}{m.label}</span></td>
                  <td><span className={`pill soft ${s.tone}`}>{s.label}</span></td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
                    <div className="row-menu">
                      <button className="iconbtn" aria-label={`Actions for ${b.invoiceNumber ?? b.label}`} aria-haspopup="menu" aria-expanded={menu === b.id} onClick={() => setMenu(menu === b.id ? null : b.id)}><DIcon.dots /></button>
                      {menu === b.id && (
                        <div className="menu" role="menu">
                          <button role="menuitem" onClick={() => { setMenu(null); p.onSelect(b.id); }}>Review &amp; approve</button>
                          <button role="menuitem" onClick={() => { setMenu(null); location.hash = `#/bundles/${b.id}`; }}>Open full detail</button>
                          <button role="menuitem" onClick={() => { setMenu(null); void viewDoc(b); }}>View invoice document</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!view.length && <tr><td colSpan={8}>{p.loading ? <div className="pad muted" role="status">Loading invoices…</div> : p.rows.length === 0 ? <Empty title="No invoices yet">Upload documents or load the synthetic demo data to see them here.</Empty> : <Empty title="Nothing matches these filters">Clear the search or choose another status.</Empty>}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span className="muted small">{filtered.length ? `${cur * size + 1}–${Math.min(filtered.length, cur * size + size)} of ${filtered.length}` : "0 results"}</span>
        <span className="spacer" />
        <label className="small muted">Rows <select className="input sel mini" value={size} onChange={(e) => setSize(Number(e.target.value))}>{[5, 10, 25, 50].map((n) => <option key={n}>{n}</option>)}</select></label>
        <button className="iconbtn" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><DIcon.chevL /></button>
        <span className="small">Page {cur + 1} of {pages}</span>
        <button className="iconbtn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page"><DIcon.chev /></button>
      </div>
    </section>
  );
}
