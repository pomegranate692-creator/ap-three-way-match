import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, newKey } from "../lib/api";
import { CODE_LABEL, DOC_LABEL, DOC_SHORT, labelOfKey, money, qty, REC_LABEL, ROLE_LABEL, signed, when, whenFull } from "../lib/format";
import { useApp, useLoad } from "../state";
import { PdfViewer, type Highlight } from "../components/PdfViewer";
import { AiBadge, CodeBadge, Conf, Empty, ErrorBox, Icon, LoadingBlock, ReasonDialog, RecBadge, SevBadge, StateBadge, tabIndexFor, tablistKeys } from "../components/ui";

/* ------------------------------------------------------------------ types */
interface Field { id: string; key: string; value: string | null; raw: string; bbox: Highlight["bbox"] | null; wordIds: string[]; confidence: number; reason: string; extractor: string; corrected: boolean; originalValue: string | null; updatedBy: string | null }
interface Doc { id: string; role: string; docType: string; filename: string; sha256: string; pageCount: number; docNumber: string | null; classification: { confidence: number; reason: string }; riskFlags: { code: string; excerpt: string }[]; extractors: string[]; warnings: string[]; fields: Field[] }
interface Evidence { documentId: string; fieldKey: string; label: string; value: string | null }
interface Exc { id: string; code: string; severity: "blocking" | "review" | "info"; lineKey: string | null; title: string; explanation: string; expected: string | null; actual: string | null; delta: string | null; currency: string | null; evidence: Evidence[]; suggestedAction: string; ownerRole: string; status: "open" | "resolved" | "waived" | "overridden"; note: string | null; resolvedBy: string | null; resolvedRole: string | null; resolvedAt: string | null; canResolve: boolean; canOverride: boolean }
interface LineM { key: string; poLine: number | null; invLine: number | null; sku: string | null; description: string | null; ordered: string | null; received: string | null; priorBilled: string; invoiced: string | null; poNetPrice: string | null; invNetPrice: string | null; invAmount: string | null; status: string; codes: string[] }
interface AuditEv { id: number; at: string; actorName: string | null; actorRole: string | null; actorKind: "human" | "system" | "agent"; action: string; entityType: string; note: string | null; before: unknown; after: unknown }
interface Detail {
  bundle: { id: string; label: string; state: string; recommendation: string | null; poNumber: string | null; source: string };
  org: { name: string; timezone: string; baseCurrency: string };
  documents: Doc[];
  run: { id: string; version: number; trigger: string; createdAt: string; engineVersion: string; result: { recommendation: string; summary: string; currency: string | null; lines: LineM[]; computed: { lineSum: string | null; expectedTax: string | null; expectedTotal: string | null; taxRateUsed: string | null; fxRate: string | null } } } | null;
  runs: { version: number; trigger: string; createdAt: string; recommendation: string; exceptionCount: number }[];
  exceptions: Exc[]; approvals: any[]; corrections: any[]; audit: AuditEv[];
  permissions: { canCorrect: boolean; approve: { ok: boolean; reason: string | null }; canReject: boolean; canHold: boolean; canReopen: boolean; canExport: boolean };
  limits: { clerkApprovalLimit: string; requireSeparateApprover: boolean; confidenceThreshold: number };
  ai: { stages: { stage: string; method: string; ai: boolean }[]; summary: string | null };
}
type Tab = "match" | "exceptions" | "fields" | "history" | "how";
type Sel = { docId: string; key: string } | null;

const HEADER_KEYS: Record<string, { all: string[]; required: string[] }> = {
  PO: { all: ["docNumber", "supplierName", "currency", "docDate", "subtotal", "discountTotal", "freight", "taxRate", "taxTotal", "total"], required: ["docNumber", "supplierName", "currency", "total"] },
  GRN: { all: ["docNumber", "poRef", "supplierName", "docDate"], required: ["docNumber", "poRef"] },
  INVOICE: { all: ["docNumber", "poRef", "supplierName", "supplierTaxId", "currency", "docDate", "subtotal", "discountTotal", "freight", "taxRate", "taxTotal", "total"], required: ["docNumber", "poRef", "supplierName", "currency", "subtotal", "taxTotal", "total"] },
};
const LINE_COLS: Record<string, string[]> = { PO: ["sku", "description", "qty", "unitPrice", "discountPct", "amount"], INVOICE: ["sku", "description", "qty", "unitPrice", "discountPct", "amount"], GRN: ["sku", "description", "qty", "date"] };

/* ------------------------------------------------------------------ page */
export function Review({ id, initialTab }: { id: string; initialTab?: Tab }) {
  const app = useApp();
  const { data, error, loading, reload } = useLoad<Detail>(`/api/bundles/${id}`);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [tab, setTab] = useState<Tab>(initialTab ?? "match");
  const [pane, setPane] = useState<"doc" | "analysis">("analysis");

  useEffect(() => { setActiveDoc(null); setSel(null); setTab(initialTab ?? "match"); }, [id, initialTab]);
  useEffect(() => {
    if (data && (!activeDoc || !data.documents.some((d) => d.id === activeDoc))) setActiveDoc((data.documents.find((d) => d.role === "invoice") ?? data.documents[0])?.id ?? null);
  }, [data, activeDoc]);

  const doc = data?.documents.find((d) => d.id === activeDoc) ?? null;
  const evidenceKeys = useMemo(() => {
    const s = new Set<string>();
    data?.exceptions.filter((e) => e.status === "open").forEach((e) => e.evidence.forEach((v) => s.add(`${v.documentId}|${v.fieldKey}`)));
    return s;
  }, [data]);
  const highlights: Highlight[] = useMemo(
    () => (doc ? doc.fields.filter((f) => f.bbox).map((f) => ({ key: f.key, bbox: f.bbox!, ...(evidenceKeys.has(`${doc.id}|${f.key}`) ? { kind: "exc" as const } : {}) })) : []),
    [doc, evidenceKeys],
  );

  const focus = (docId: string, key: string, openFields = true) => {
    setActiveDoc(docId); setSel({ docId, key }); if (openFields) setTab("fields"); setPane("doc");
    if (!openFields) setPane("doc");
  };

  if (loading && !data) return <div className="page"><div className="card"><LoadingBlock label="Loading bundle" /></div></div>;
  if (error && !data) return <div className="page"><a href="#/">← Inbox</a><div style={{ marginTop: 12 }}><ErrorBox message={error.status === 404 ? "This bundle doesn't exist in the current organisation (or was deleted)." : error.message} onRetry={reload} /></div></div>;
  if (!data) return null;

  const open = data.exceptions.filter((e) => e.status === "open");
  const inv = data.documents.find((d) => d.role === "invoice");
  const f = (k: string) => inv?.fields.find((x) => x.key === k)?.value ?? null;
  const tz = data.org.timezone;
  const firstDocId = ["PO", "GRN", "INVOICE"].map((t) => data.documents.find((d) => d.docType === t)).find(Boolean)?.id;
  const tabs: [Tab, string, ReactNode?][] = [
    ["match", "Match"], ["exceptions", "Exceptions", open.length ? <span key="p" className={`pill ${open.some((e) => e.severity === "blocking") ? "bad" : ""}`}>{open.length}</span> : <span key="p" className="pill">{data.exceptions.length}</span>],
    ["fields", "Fields"], ["history", "History"], ["how", "How it was decided"],
  ];

  return (
    <>
      <div className="page" style={{ paddingBottom: 0, paddingTop: 14 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <a href="#/">← Inbox</a>
          <span className="muted">/</span>
          <h1 style={{ fontSize: 18 }}>{data.bundle.label} · <span className="mono">{f("docNumber") ?? "invoice"}</span></h1>
          <StateBadge state={data.bundle.state} /> <RecBadge rec={data.bundle.recommendation} />
          <span className="spacer" />
          <span className="small muted">{f("supplierName")} · PO <span className="mono">{data.bundle.poNumber ?? "—"}</span> · {money(f("total"), f("currency"))} {f("currency")}</span>
        </div>
      </div>
      <div className="seg-switch" role="group" aria-label="Pane">
        <button aria-pressed={pane === "doc"} onClick={() => setPane("doc")}>Document</button>
        <button aria-pressed={pane === "analysis"} onClick={() => setPane("analysis")}>Analysis{open.length ? ` (${open.length})` : ""}</button>
      </div>
      <div className="review" data-pane={pane}>
        {/* ---------------- left: original document ---------------- */}
        <section className="card viewer" aria-label="Original documents">
          <div className="tabs" role="tablist" aria-label="Documents in this bundle" onKeyDown={tablistKeys}>
            {["PO", "GRN", "INVOICE"].map((t) => {
              const ds = data.documents.filter((d) => d.docType === t);
              if (!ds.length) return <button key={t} className="tab" role="tab" disabled aria-selected="false" title={t === "GRN" ? "No receiving record on file for this PO" : "Not uploaded"} style={{ opacity: 0.55 }}>{DOC_SHORT[t]} <span className="pill bad">missing</span></button>;
              return ds.map((d, i) => (
                <button key={d.id} className="tab" role="tab" aria-selected={d.id === activeDoc} tabIndex={tabIndexFor(d.id === activeDoc, data.documents.some((x) => x.id === activeDoc), d.id === firstDocId)} onClick={() => { setActiveDoc(d.id); setSel(null); }}>
                  {DOC_SHORT[t]}{ds.length > 1 ? ` ${i + 1}` : ""} {d.riskFlags.length > 0 && <span className="pill bad" title="Contains instruction-like text">!</span>}
                </button>
              ));
            })}
          </div>
          {doc ? (
            <div style={{ display: "grid", gridTemplateRows: "auto minmax(0,1fr)", minHeight: 0 }}>
              <div className="doc-meta">
                <b>{DOC_LABEL[doc.docType]}</b><span className="mono">{doc.docNumber}</span><span className="muted">·</span>
                <span className="muted mono" title={doc.filename}>{doc.filename.length > 30 ? doc.filename.slice(0, 28) + "…" : doc.filename}</span>
                <span className="muted" title={`SHA-256 ${doc.sha256}`}>sha {doc.sha256.slice(0, 8)}</span>
                <AiBadge ai={doc.extractors.some((e) => e.startsWith("claude"))} label={doc.extractors.join(" + ")} />
              </div>
              <PdfViewer documentId={doc.id} highlights={highlights} selectedKey={sel?.docId === doc.id ? sel.key : null} onPick={(k) => { setSel({ docId: doc.id, key: k }); setTab("fields"); setPane("analysis"); }} />
            </div>
          ) : <Empty title="No document selected" />}
        </section>

        {/* ---------------- right: analysis ---------------- */}
        <section className="inspector" aria-label="Analysis">
          <div className="card panel">
            <div className="tabs" role="tablist" aria-label="Analysis sections" onKeyDown={tablistKeys}>
              {tabs.map(([k, label, extra]) => (
                <button key={k} className="tab" role="tab" id={`tab-${k}`} aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} aria-controls="tabpanel" onClick={() => setTab(k)}>{label}{extra}</button>
              ))}
            </div>
            <div className="panel-body" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
              {tab === "match" && <MatchTab d={data} focus={focus} />}
              {tab === "exceptions" && <ExceptionsTab d={data} focus={focus} reload={reload} />}
              {tab === "fields" && doc && <FieldsTab d={data} doc={doc} sel={sel} setSel={setSel} reload={reload} />}
              {tab === "history" && <HistoryTab d={data} tz={tz} />}
              {tab === "how" && <HowTab d={data} reload={reload} />}
            </div>
          </div>
          <DecisionBar d={data} reload={reload} onSeeExceptions={() => setTab("exceptions")} />
        </section>
      </div>
      {app.offline && null}
    </>
  );
}

/* ------------------------------------------------------------------ match tab */
function MatchTab({ d, focus }: { d: Detail; focus(docId: string, key: string, openFields?: boolean): void }) {
  const r = d.run?.result;
  const inv = d.documents.find((x) => x.role === "invoice");
  const po = d.documents.find((x) => x.role === "po");
  if (!r) return <Empty title="Not matched yet">Upload the invoice with its purchase order to run the three-way match.</Empty>;
  const cur = r.currency ?? "";
  const excByLine = (k: string) => d.exceptions.filter((e) => e.lineKey === k && e.status === "open");
  const fv = (k: string) => inv?.fields.find((x) => x.key === k)?.value ?? null;
  const tick = (ok: boolean) => ok ? <span className="tick ok" aria-label="agrees">✓</span> : <span className="tick bad" aria-label="differs">✗</span>;
  const eq = (a: string | null, b: string | null) => a !== null && b !== null && Math.abs(Number(a) - Number(b)) <= 0.05;
  const tone = r.recommendation === "READY_FOR_APPROVAL" ? "ok" : r.recommendation === "HOLD" ? "bad" : "warn";
  return (
    <div className="stack">
      <div className={`recommend ${tone}`}>
        <div style={{ flex: 1 }}>
          <h2>System recommendation: {REC_LABEL[r.recommendation]} <AiBadge ai={false} label="Rule-based" /></h2>
          <p>{r.summary}</p>
          <p className="small muted" style={{ marginTop: 6 }}>Run v{d.run!.version} · {d.run!.engineVersion}. The system only recommends; a person decides and nothing is ever paid from here.</p>
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: 6 }}>Lines · ordered → received → billed</h3>
        <div className="table-wrap">
          <table className="t">
            <caption className="sr-only">Three-way line comparison</caption>
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Billed</th><th className="num">PO price</th><th className="num">Invoice price</th><th>Result</th></tr></thead>
            <tbody>
              {r.lines.map((l) => {
                const ex = excByLine(l.key);
                const qtyBad = ex.some((e) => ["QTY_OVER_RECEIVED", "QTY_OVER_ORDERED", "QTY_NOT_RECEIVED"].includes(e.code));
                const priceBad = ex.some((e) => e.code === "PRICE_VARIANCE");
                const invLine = l.invLine;
                return (
                  <tr key={l.key}>
                    <td><b className="mono">{l.sku ?? "?"}</b><div className="small muted">{l.description}</div></td>
                    <td className="num mono">{qty(l.ordered)}</td>
                    <td className="num mono">{l.received === null ? <span className="muted">no receipt</span> : qty(l.received)}</td>
                    <td className="num mono" style={qtyBad ? { background: "var(--bad-soft)", color: "var(--bad)", fontWeight: 600 } : undefined}>
                      {inv && invLine ? <a href="#" onClick={(e) => { e.preventDefault(); focus(inv.id, `line.${invLine}.qty`); }}>{qty(l.invoiced)}</a> : qty(l.invoiced)}
                      {Number(l.priorBilled) > 0 && <div className="small muted">+{qty(l.priorBilled)} earlier</div>}
                    </td>
                    <td className="num mono">{po && l.poLine ? <a href="#" onClick={(e) => { e.preventDefault(); focus(po.id, `line.${l.poLine}.unitPrice`); }}>{money(l.poNetPrice)}</a> : money(l.poNetPrice)}</td>
                    <td className="num mono" style={priceBad ? { background: "var(--bad-soft)", color: "var(--bad)", fontWeight: 600 } : undefined}>{inv && invLine ? <a href="#" onClick={(e) => { e.preventDefault(); focus(inv.id, `line.${invLine}.unitPrice`); }}>{money(l.invNetPrice)}</a> : money(l.invNetPrice)}</td>
                    <td>{l.status === "matched" ? <span className="badge ok">✓ Matches</span> : l.status === "unmatched" ? <span className="badge bad">✗ Not on PO</span> : <span className="badge warn">△ {l.codes.map((c) => CODE_LABEL[c] ?? c).join(", ")}</span>}</td>
                  </tr>
                );
              })}
              {!r.lines.length && <tr><td colSpan={7}><span className="muted">No invoice lines to compare.</span></td></tr>}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>Prices are net of line discounts. Quantities are totalled per SKU across split shipments. Click a figure to see where it was read on the page.</p>
      </div>

      <div>
        <h3 style={{ marginBottom: 6 }}>Invoice arithmetic · recomputed with decimal maths</h3>
        <table className="t">
          <thead><tr><th>Check</th><th className="num">Recomputed</th><th className="num">Printed on invoice</th><th /></tr></thead>
          <tbody>
            <tr><td>Sum of line amounts → subtotal</td><td className="num mono">{money(r.computed.lineSum, cur)}</td><td className="num mono">{money(fv("subtotal"), cur)}</td><td>{tick(eq(r.computed.lineSum, fv("subtotal")))}</td></tr>
            <tr><td>Tax at {r.computed.taxRateUsed ?? "?"}% {fv("taxRate") && Number(fv("taxRate")) !== Number(r.computed.taxRateUsed) ? <span className="badge warn">invoice says {fv("taxRate")}%</span> : null}</td><td className="num mono">{money(r.computed.expectedTax, cur)}</td><td className="num mono">{money(fv("taxTotal"), cur)}</td><td>{tick(eq(r.computed.expectedTax, fv("taxTotal")))}</td></tr>
            <tr><td>Subtotal − discount + freight + tax → total</td><td className="num mono">{money(r.computed.expectedTotal, cur)}</td><td className="num mono">{money(fv("total"), cur)}</td><td>{tick(eq(r.computed.expectedTotal, fv("total")))}</td></tr>
          </tbody>
        </table>
        {r.computed.fxRate && <p className="small muted" style={{ marginTop: 6 }}>Invoice prices converted at {r.computed.fxRate} for comparison.</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ exceptions tab */
function ExceptionsTab({ d, focus, reload }: { d: Detail; focus(docId: string, key: string, openFields?: boolean): void; reload(): void }) {
  const [dlg, setDlg] = useState<{ exc: Exc; status: "resolved" | "waived" | "overridden" | "open" } | null>(null);
  const app = useApp();
  const locked = ["approved", "exported", "rejected"].includes(d.bundle.state);
  const open = d.exceptions.filter((e) => e.status === "open");
  const closed = d.exceptions.filter((e) => e.status !== "open");
  if (!d.exceptions.length) return <Empty title="No exceptions">Every line matched within tolerance and the invoice arithmetic reconciles.</Empty>;
  const lineOf = (e: Exc) => d.run?.result.lines.find((l) => l.key === e.lineKey);
  const card = (e: Exc) => {
    const l = lineOf(e);
    const isQty = ["QTY_OVER_RECEIVED", "QTY_OVER_ORDERED", "QTY_NOT_RECEIVED"].includes(e.code);
    const why = locked ? `This bundle is ${d.bundle.state}; reopen it to change exceptions.` : !e.canResolve ? (e.severity === "blocking" ? "Blocking exceptions can only be cleared by a Controller." : `Owned by the ${ROLE_LABEL[e.ownerRole]} — your role can't resolve this.`) : "";
    return (
      <article key={e.id} className={`exc-card ${e.severity} ${e.status !== "open" ? "closed" : ""}`} aria-label={e.title}>
        <div className="row"><SevBadge sev={e.severity} /><CodeBadge code={e.code} />{e.status !== "open" && <span className="badge ok">✓ {e.status}</span>}<span className="spacer" /><span className="small muted">Owner: {ROLE_LABEL[e.ownerRole]}</span></div>
        <h3>{e.title}</h3>
        {isQty && l ? (
          <div className="ways" aria-label="Ordered, received and invoiced quantities">
            <div><small>Ordered</small><b>{qty(l.ordered)}</b></div>
            <div><small>Received</small><b>{qty(l.received)}</b></div>
            <div className="off"><small>Invoiced{Number(l.priorBilled) > 0 ? " (cumulative)" : ""}</small><b>{qty(e.actual)}</b></div>
          </div>
        ) : e.expected !== null || e.actual !== null ? (
          <div className="ways" aria-label="Expected, actual and difference">
            <div><small>Expected</small><b>{e.currency ? money(e.expected, e.currency) : e.expected ?? "—"}</b></div>
            <div className="off"><small>Actual</small><b>{e.currency ? money(e.actual, e.currency) : e.actual ?? "—"}</b></div>
            <div><small>Difference {e.currency ?? ""}</small><b>{e.delta ? signed(e.currency ? money(e.delta, e.currency) : e.delta) : "—"}</b></div>
          </div>
        ) : null}
        <p>{e.explanation}</p>
        {e.evidence.length > 0 && (
          <div className="evid" aria-label="Evidence">
            {e.evidence.filter((v) => v.fieldKey !== "risk").map((v, i) => (
              <button key={i} className="chip" onClick={() => focus(v.documentId, v.fieldKey)} title="Show where this was read">
                {v.label}{v.value !== null && <> · <span className="mono">{v.value}</span></>}
              </button>
            ))}
          </div>
        )}
        <p className="small muted"><b>Suggested:</b> {e.suggestedAction}</p>
        <div className="explain-note"><AiBadge ai={false} label="Template" /> Wording is filled from the computed figures — no AI wrote this explanation.</div>
        {e.status === "open" ? (
          <div className="row" title={why}>
            <button className="btn sm" disabled={!e.canResolve || locked} onClick={() => setDlg({ exc: e, status: "resolved" })}>Mark resolved</button>
            <button className="btn sm" disabled={!e.canResolve || locked} onClick={() => setDlg({ exc: e, status: "waived" })}>Accept as is</button>
            <button className="btn sm danger" disabled={!e.canOverride || !e.canResolve || locked} onClick={() => setDlg({ exc: e, status: "overridden" })} title={e.canOverride ? "Controller override: accept despite policy" : "Only a Controller can override"}>Override…</button>
            {why && <span className="small muted">{why}</span>}
          </div>
        ) : (
          <div className="row small"><span>{e.status === "overridden" ? "Overridden" : e.status === "waived" ? "Accepted as is" : "Resolved"} by <b>{e.resolvedBy}</b> ({ROLE_LABEL[e.resolvedRole ?? ""] ?? e.resolvedRole}) · {when(e.resolvedAt, d.org.timezone)} — “{e.note}”</span><span className="spacer" />
            <button className="btn sm ghost" disabled={locked || !e.canResolve} onClick={() => setDlg({ exc: e, status: "open" })}>Reopen</button></div>
        )}
      </article>
    );
  };
  const titles = { resolved: "Mark as resolved", waived: "Accept this exception as is", overridden: "Override exception", open: "Reopen exception" } as const;
  return (
    <div className="stack">
      {open.length > 0 ? open.map(card) : <div className="banner info">All exceptions are closed. You can now approve, or reopen any item below.</div>}
      {closed.length > 0 && <><h3 style={{ marginTop: 6 }}>Closed ({closed.length})</h3>{closed.map(card)}</>}
      {dlg && (
        <ReasonDialog
          title={titles[dlg.status]} required danger={dlg.status === "overridden"} confirmLabel={dlg.status === "open" ? "Reopen" : dlg.status === "overridden" ? "Override and record" : "Record"}
          intro={<p>{dlg.exc.title}.{dlg.status === "overridden" && " An override accepts the variance even though policy would stop it. It is logged under your name."}{dlg.status === "waived" && " Use this when the difference is acceptable and no correction is needed."}{dlg.status === "resolved" && " Use this once the underlying problem has been fixed at the source."}</p>}
          onCancel={() => setDlg(null)}
          onConfirm={async (note) => { await api("POST", `/api/exceptions/${dlg.exc.id}/resolve`, { status: dlg.status, note }); setDlg(null); app.notify("Recorded in the audit trail."); reload(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ fields tab */
function FieldsTab({ d, doc, sel, setSel, reload }: { d: Detail; doc: Doc; sel: Sel; setSel(s: Sel): void; reload(): void }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fieldMap = new Map(doc.fields.map((x) => [x.key, x]));
  const selKey = sel?.docId === doc.id ? sel.key : null;
  const selField = selKey ? fieldMap.get(selKey) ?? null : null;
  const { required, all } = HEADER_KEYS[doc.docType]!;
  const headerKeys = all.filter((k) => fieldMap.has(k) || required.includes(k));
  const lineIdx = [...new Set(doc.fields.map((x) => x.key.match(/^line\.(\d+)\./)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const cols = LINE_COLS[doc.docType]!;
  const thr = d.limits.confidenceThreshold;

  useEffect(() => { setEditing(false); setErr(null); }, [selKey, doc.id]);

  const start = (key: string) => { setSel({ docId: doc.id, key }); setValue(fieldMap.get(key)?.value ?? ""); setReason(""); setErr(null); setEditing(true); };
  async function save() {
    if (!selKey) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ runs: { version: number | null }[] }>("PUT", `/api/documents/${doc.id}/fields/${encodeURIComponent(selKey)}`, { value, reason });
      app.notify(`Saved. The match re-ran (v${r.runs[0]?.version ?? "?"}) and the change is in the audit trail.`);
      setEditing(false); reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const cell = (key: string) => {
    const x = fieldMap.get(key);
    if (!x) return <span className="muted">—</span>;
    const low = x.confidence < thr;
    return (
      <button className={`btn sm ghost mono ${x.corrected ? "val-corrected" : ""}`} style={{ padding: "1px 5px", minHeight: 24, ...(selKey === key ? { background: "var(--hl)" } : {}), ...(low ? { color: "var(--bad)" } : {}) }}
        onClick={() => setSel({ docId: doc.id, key })} aria-pressed={selKey === key} title={`${labelOfKey(key)} — click to see its source`}>
        {x.value ?? "—"}{low && " ⚠"}
      </button>
    );
  };

  return (
    <div className="stack">
      {doc.warnings.length > 0 && <div className="banner warn" role="status"><div>{doc.warnings.slice(0, 4).map((w, i) => <div key={i}>{w}</div>)}</div></div>}
      {doc.riskFlags.length > 0 && <div className="banner bad" role="alert"><div><b>Instruction-like text found in this document.</b> It was not followed and did not affect any figure.{doc.riskFlags.slice(0, 2).map((r, i) => <div key={i} className="mono small">“{r.excerpt.slice(0, 140)}”</div>)}</div></div>}

      <div className="card card-pad" style={{ boxShadow: "none", background: "var(--surface-2)" }} aria-live="polite">
        {!selField ? (
          <p className="muted">Select a value below, or a box on the document, to see exactly what was read, how sure the system is, and to correct it.</p>
        ) : (
          <div className="stack">
            <div className="row"><b>{labelOfKey(selField.key)}</b><Conf v={selField.confidence} threshold={thr} />{selField.corrected && <span className="badge accent">Corrected by a person</span>}<AiBadge ai={selField.extractor.startsWith("claude")} label={selField.extractor === "human" ? "Human" : selField.extractor} /></div>
            <dl className="kv small">
              <dt>Value used</dt><dd className="mono"><b>{selField.value ?? "—"}</b></dd>
              <dt>Printed text</dt><dd className="mono">{selField.raw || "—"}{selField.bbox ? <span className="muted"> · page {selField.bbox.page}</span> : <span className="muted"> · no page location (entered manually)</span>}</dd>
              {selField.corrected && <><dt>Originally read</dt><dd className="mono">{selField.originalValue ?? "(not found)"}</dd></>}
              <dt>Why this confidence</dt><dd>{selField.reason}</dd>
            </dl>
            {!editing ? (
              <div className="row"><button className="btn sm" disabled={!d.permissions.canCorrect} onClick={() => start(selField.key)}><Icon.pencil /> Correct this value</button>{!d.permissions.canCorrect && <span className="small muted">{["approved", "exported"].includes(d.bundle.state) ? "Reopen the bundle to edit." : "Your role can't edit extracted fields."}</span>}</div>
            ) : (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <label className="field">Correct value<input className="input mono" value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></label>
                <label className="field">Why are you changing it? (required)<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier confirmed by phone" /></label>
                {err && <div className="banner bad" role="alert">{err}</div>}
                <div className="row"><button type="submit" className="btn primary sm" disabled={busy || reason.trim().length < 3}>{busy ? "Saving…" : "Save and re-run match"}</button><button type="button" className="btn sm" onClick={() => setEditing(false)}>Cancel</button><span className="small muted">The old value stays in history.</span></div>
              </form>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ marginBottom: 6 }}>Header fields</h3>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Field</th><th>Value</th><th>Confidence</th><th>Source</th></tr></thead>
          <tbody>
            {headerKeys.map((k) => {
              const x = fieldMap.get(k);
              return (
                <tr key={k} className={`field-row ${selKey === k ? "sel" : ""}`}>
                  <td>{labelOfKey(k)}</td>
                  <td>{x ? cell(k) : <button className="btn sm" disabled={!d.permissions.canCorrect} onClick={() => { setSel({ docId: doc.id, key: k }); start(k); }}>Not found — enter</button>}</td>
                  <td>{x ? <Conf v={x.confidence} threshold={thr} /> : <span className="badge bad">missing</span>}</td>
                  <td className="small muted">{x ? (x.bbox ? `p${x.bbox.page}` : "manual") : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <div>
        <h3 style={{ marginBottom: 6 }}>Line items ({lineIdx.length})</h3>
        {lineIdx.length === 0 ? <div className="banner warn">No line items were read from this document.</div> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>#</th>{cols.map((c) => <th key={c} className={["qty", "unitPrice", "discountPct", "amount"].includes(c) ? "num" : ""}>{labelOfKey(c)}</th>)}</tr></thead>
            <tbody>{lineIdx.map((i) => (
              <tr key={i}><td className="muted">{i}</td>{cols.map((c) => <td key={c} className={["qty", "unitPrice", "discountPct", "amount"].includes(c) ? "num" : ""}>{cell(`line.${i}.${c}`)}</td>)}</tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="small muted" style={{ marginTop: 6 }}>⚠ marks values read with confidence below {(thr * 100).toFixed(0)}%. A blue edge marks a value a person corrected.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ history tab */
const ACTION_TEXT: Record<string, string> = {
  "document.uploaded": "Document uploaded", "document.loaded_demo": "Demo document loaded", "document.extracted": "Fields extracted", "bundle.created": "Bundle created", "match.run": "Three-way match run",
  "field.corrected": "Field corrected", "exception.waived": "Exception accepted as is", "exception.resolved": "Exception resolved", "exception.overridden": "Exception overridden", "exception.reopened": "Exception reopened",
  "exception.cleared": "Exception cleared by new data", "approval.approved": "Approved", "approval.rejected": "Rejected", "approval.held": "Put on hold", "approval.reopened": "Reopened", "approval.superseded": "Approval superseded by new data",
  "export.executed": "Approved record exported to file", "export.created": "Exception record exported", "settings.updated": "Settings changed", "ai.summary_created": "AI summary created",
};
function HistoryTab({ d, tz }: { d: Detail; tz: string }) {
  const [kind, setKind] = useState<"all" | "human" | "auto">("all");
  const ev = d.audit.filter((a) => kind === "all" || (kind === "human" ? a.actorKind === "human" : a.actorKind !== "human"));
  return (
    <div className="stack">
      <div>
        <h3 style={{ marginBottom: 6 }}>Proposal → decision → execution</h3>
        {d.approvals.length === 0 ? <p className="muted">No decision recorded yet. The system proposes; a person decides.</p> : (
          <table className="t"><thead><tr><th>System proposed</th><th>Person decided</th><th>What executed</th></tr></thead><tbody>
            {d.approvals.map((a) => (
              <tr key={a.id}>
                <td><span className="badge neutral">{REC_LABEL[a.proposedRecommendation] ?? a.proposedRecommendation}</span><div className="small muted">by {a.proposedBy}</div></td>
                <td><b>{a.action}</b> by {a.decidedBy} ({ROLE_LABEL[a.decidedRole] ?? a.decidedRole})<div className="small muted">{whenFull(a.decidedAt, tz)}{a.reason ? ` — “${a.reason}”` : ""}</div>{a.status === "superseded" && <span className="badge warn">superseded by later data</span>}</td>
                <td>{a.executedAt ? <>Written to export file<div className="small muted">{whenFull(a.executedAt, tz)} · no payment</div></> : <span className="muted">{a.action === "approve" && a.status !== "superseded" ? "Not exported yet" : "—"}</span>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
      {d.corrections.length > 0 && (
        <div><h3 style={{ marginBottom: 6 }}>Human corrections ({d.corrections.length})</h3>
          <table className="t"><thead><tr><th>Field</th><th>Before</th><th>After</th><th>Who / why</th></tr></thead><tbody>
            {d.corrections.map((c) => <tr key={c.id}><td>{labelOfKey(c.fieldKey)}</td><td className="mono">{c.before ?? "—"}</td><td className="mono"><b>{c.after ?? "—"}</b></td><td><span className="small">{c.user}</span><div className="small muted">“{c.reason}”</div></td></tr>)}
          </tbody></table></div>
      )}
      <div><h3 style={{ marginBottom: 6 }}>Match runs</h3>
        <div className="row">{d.runs.map((r) => <span key={r.version} className="badge neutral" title={whenFull(r.createdAt, tz)}>v{r.version} · {r.trigger.replace("_", " ")} · {r.exceptionCount} exc.</span>)}</div>
      </div>
      <div>
        <div className="row"><h3>Audit trail</h3><span className="spacer" />
          {(["all", "human", "auto"] as const).map((k) => <button key={k} className={`btn sm ${kind === k ? "primary" : ""}`} onClick={() => setKind(k)}>{k === "all" ? "All" : k === "human" ? "People" : "System & AI"}</button>)}</div>
        <div className="timeline" style={{ marginTop: 8 }}>
          {ev.map((a) => (
            <div className="tl" key={a.id}>
              <span className={`pt ${a.actorKind}`} title={a.actorKind} />
              <div><div><b>{ACTION_TEXT[a.action] ?? a.action}</b> <span className="muted small">— {a.actorKind === "human" ? `${a.actorName} (${ROLE_LABEL[a.actorRole ?? ""] ?? a.actorRole})` : a.actorKind === "agent" ? "extraction agent" : "system"}</span></div>
                {a.note && <div className="small">{a.note}</div>}<time>{whenFull(a.at, tz)}</time></div>
            </div>
          ))}
          {!ev.length && <p className="muted">Nothing to show.</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ how decided tab */
function HowTab({ d, reload }: { d: Detail; reload(): void }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  async function summarise() {
    setBusy(true);
    try { await api("POST", `/api/bundles/${d.bundle.id}/ai-summary`); app.notify("AI summary added (numbers verified against the evidence)."); reload(); }
    catch (e) { app.notify((e as Error).message, "bad"); } finally { setBusy(false); }
  }
  const enabled = app.meta?.llm.enabled;
  return (
    <div className="stack">
      <p>Every automated step in this bundle, and whether a language model was involved. Anything involving money is deterministic code that gives the same answer every time.</p>
      <div className="pipeline">
        {d.ai.stages.map((s) => (
          <div className="step" key={s.stage}><div><b>{s.stage}</b><div className="small muted">{s.method}</div></div><AiBadge ai={s.ai} label={s.ai ? "AI" : "Rule"} /></div>
        ))}
      </div>
      <div className="card card-pad" style={{ boxShadow: "none", background: "var(--surface-2)" }}>
        <div className="row"><b>Plain-language summary</b><span className="spacer" /><button className="btn sm" disabled={!enabled || busy || !d.exceptions.some((e) => e.status === "open")} onClick={summarise}><Icon.spark /> {busy ? "Asking…" : "Summarise with AI"}</button></div>
        {d.ai.summary ? <p style={{ marginTop: 8 }}>{d.ai.summary}</p> : <p className="small muted" style={{ marginTop: 6 }}>{enabled ? "Optional. The model may only reword the computed figures; if it mentions a number that isn't in the evidence, the text is discarded." : `Unavailable: ${app.meta?.llm.reason ?? "AI adapter disabled"} The template explanations on each exception are used instead.`}</p>}
      </div>
      <div>
        <h3 style={{ marginBottom: 6 }}>Documents</h3>
        <table className="t"><thead><tr><th>Document</th><th>Detected as</th><th>Read by</th></tr></thead><tbody>
          {d.documents.map((x) => <tr key={x.id}><td className="mono small">{x.filename}</td><td><span className="small">{DOC_LABEL[x.docType]} · {(x.classification.confidence * 100).toFixed(0)}%</span><div className="small muted">{x.classification.reason}</div></td><td>{x.extractors.join(" + ")}</td></tr>)}
        </tbody></table>
      </div>
      <div className="banner info" style={{ alignItems: "flex-start" }}><Icon.shield /><div>Text inside documents is treated as untrusted data. If a document says "ignore your instructions" or "approve this", it is flagged for a Controller and has no effect on the match.</div></div>
    </div>
  );
}

/* ------------------------------------------------------------------ decision bar */
function DecisionBar({ d, reload, onSeeExceptions }: { d: Detail; reload(): void; onSeeExceptions(): void }) {
  const app = useApp();
  const [dlg, setDlg] = useState<{ action: "approve" | "reject" | "hold" | "reopen"; key: string } | null>(null);
  const [more, setMore] = useState(false);
  const p = d.permissions;
  const open = d.exceptions.filter((e) => e.status === "open").length;
  const st = d.bundle.state;
  const done = st === "approved" || st === "exported";
  const cfg = {
    approve: { title: "Approve this bundle", label: "Approve", required: false, danger: false },
    reject: { title: "Reject this invoice", label: "Reject invoice", required: true, danger: true },
    hold: { title: "Put on hold", label: "Hold", required: true, danger: false },
    reopen: { title: "Reopen this bundle", label: "Reopen", required: true, danger: false },
  } as const;
  // On phones the secondary actions (Reopen / Hold / Reject) tuck behind a "More" button so the bar stays one
  // short row with the main action. On wide screens CSS shows everything inline, exactly as before.
  const hasMore = p.canReopen || p.canHold || p.canReject;
  return (
    <div className="card decision" aria-label="Decision" data-more={more}>
      <div className="row">
        <div className="decision-text">
          <b>{done ? (st === "exported" ? "Approved and exported" : "Approved") : st === "rejected" ? "Rejected" : st === "held" ? "On hold" : "Your decision"}</b>
          <span className="small muted">{done ? "Recorded. Export it from the Exports page." : st === "rejected" ? "No further action unless reopened." : open ? `${open} open exception${open > 1 ? "s" : ""} to clear first` : "No open exceptions"}</span>
        </div>
        <span className="spacer" />
        <div className="decision-more" id="decision-more">
          {p.canReopen && <button className="btn sm" onClick={() => setDlg({ action: "reopen", key: newKey() })}>Reopen</button>}
          {p.canHold && <button className="btn sm" onClick={() => setDlg({ action: "hold", key: newKey() })}>Hold</button>}
          {p.canReject && <button className="btn sm danger" onClick={() => setDlg({ action: "reject", key: newKey() })}>Reject</button>}
        </div>
        {!done && st !== "rejected" && <button className="btn good" disabled={!p.approve.ok} onClick={() => setDlg({ action: "approve", key: newKey() })} aria-describedby="approve-why"><Icon.check /> Approve</button>}
        {hasMore && <button className="btn ghost decision-toggle" aria-expanded={more} aria-controls="decision-more" onClick={() => setMore((m) => !m)}>{more ? "Less" : "More"}</button>}
      </div>
      {!done && st !== "rejected" && !p.approve.ok && p.approve.reason && (
        <div className="small muted decision-hint" id="approve-why"><span className="decision-reason" title={p.approve.reason}>Can't approve yet: {p.approve.reason}</span> {open > 0 && <button className="btn sm ghost" onClick={onSeeExceptions}>See exceptions</button>}</div>
      )}
      {!done && p.approve.ok && <div className="small muted decision-note" id="approve-why">Approving records your sign-off for payment review. This system never executes a payment.</div>}
      {dlg && (
        <ReasonDialog
          title={cfg[dlg.action].title} confirmLabel={cfg[dlg.action].label} required={cfg[dlg.action].required} danger={cfg[dlg.action].danger}
          intro={dlg.action === "approve" ? <div className="banner info">You are approving {d.bundle.label} for payment review. The system recommended <b>{REC_LABEL[d.bundle.recommendation ?? ""] ?? "—"}</b>. {d.limits.requireSeparateApprover && "Separation of duties is on: if you corrected data here, someone else must approve."}</div> : undefined}
          onCancel={() => setDlg(null)}
          onConfirm={async (reason) => {
            await api("POST", `/api/bundles/${d.bundle.id}/decision`, { action: dlg.action, reason }, { headers: { "idempotency-key": dlg.key } });
            setDlg(null); app.notify(dlg.action === "approve" ? "Approved. Recorded with your name and the figures you saw." : dlg.action === "reject" ? "Rejected." : dlg.action === "hold" ? "Put on hold." : "Reopened for review."); reload();
          }}
        />
      )}
    </div>
  );
}
