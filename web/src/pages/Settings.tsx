import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp, useLoad } from "../state";
import { ErrorBox, LoadingBlock } from "../components/ui";

interface Fx { from: string; to: string; rate: string; asOf: string }
interface S {
  qtyTolPct: string; qtyTolAbs: string; priceTolPct: string; priceTolAbs: string; flagUnderbilling: boolean; taxTolAbs: string; totalTolAbs: string; defaultTaxRate: string; freightTaxable: boolean; freightAllowAbs: string;
  currencyPolicy: "strict" | "convert"; fxRates: Fx[]; duplicateWindowDays: number; confidenceThreshold: number; supplierMatchThreshold: number; clerkApprovalLimit: string; requireSeparateApprover: boolean;
  dateOrder: "MDY" | "DMY"; numberLocale: "us" | "eu"; llm: { extraction: boolean; explanation: boolean };
}

export function Settings() {
  const app = useApp();
  const { data, error, loading, reload } = useLoad<S>("/api/settings");
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setS(structuredClone(data)); }, [data]);
  const canEdit = app.user?.role === "controller";
  const dirty = s && data && JSON.stringify(s) !== JSON.stringify(data);

  async function save() {
    if (!s) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ rerun: { created: boolean }[] }>("PUT", "/api/settings", s);
      app.notify(`Settings saved. ${r.rerun.filter((x) => x.created).length} open bundle(s) were re-evaluated; approved ones were left alone.`);
      reload(); app.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const set = <K extends keyof S>(k: K, v: S[K]) => setS((p) => (p ? { ...p, [k]: v } : p));
  const dec = (k: keyof S, label: string, hint: string, unit?: string) => (
    <label className="field">{label}
      <span className="row"><input className="input mono" inputMode="decimal" disabled={!canEdit} value={s![k] as string} onChange={(e) => set(k, e.target.value as never)} style={{ maxWidth: 140 }} />{unit && <span className="muted">{unit}</span>}</span>
      <span className="hint">{hint}</span></label>
  );
  const tog = (k: "flagUnderbilling" | "freightTaxable" | "requireSeparateApprover", label: string, hint: string) => (
    <label className="row" style={{ alignItems: "flex-start" }}><input type="checkbox" disabled={!canEdit} checked={s![k]} onChange={(e) => set(k, e.target.checked)} style={{ marginTop: 4 }} /><span><b>{label}</b><div className="small muted">{hint}</div></span></label>
  );

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head"><div><h1>Matching settings</h1><p>Tolerances and policies for <b>{app.org?.name}</b>. Every change is audited. Tolerances are inclusive: a difference exactly equal to the limit passes.</p></div>
        <div className="actions"><button className="btn primary" disabled={!canEdit || !dirty || busy} onClick={save}>{busy ? "Saving…" : "Save settings"}</button></div></div>
      {!canEdit && <div className="banner info" style={{ marginBottom: 14 }}>You're signed in as {app.user?.name}. Only a Controller can change these settings — switch user at the top to try.</div>}
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {err && <div className="banner bad" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      {loading && !s && <div className="card"><LoadingBlock /></div>}
      {s && (
        <div className="stack">
          <section className="card card-pad stack"><h2>Quantity and price</h2>
            <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
              {dec("qtyTolPct", "Quantity tolerance", "Extra billed quantity allowed over the received (or ordered) quantity, as % …", "%")}
              {dec("qtyTolAbs", "…or absolute units", "The larger of the two applies.", "units")}
              {dec("priceTolPct", "Price tolerance", "Unit-price difference vs the PO, net of discounts, as % …", "%")}
              {dec("priceTolAbs", "…or absolute amount", "The larger of the two applies.", "currency")}
            </div>
            {tog("flagUnderbilling", "Also flag prices below the PO", "A supplier charging less than the PO is usually a mistake that comes back later as a debit note.")}
          </section>
          <section className="card card-pad stack"><h2>Tax, totals and freight</h2>
            <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
              {dec("defaultTaxRate", "Default tax rate", "Used when the PO does not state a rate. Exclusive tax only (VAT-inclusive pricing is not supported).", "%")}
              {dec("taxTolAbs", "Tax rounding tolerance", "Allowed difference between expected and printed tax.", "currency")}
              {dec("totalTolAbs", "Arithmetic tolerance", "Allowed rounding difference in line, subtotal and total sums.", "currency")}
              {dec("freightAllowAbs", "Freight allowance above PO", "Freight beyond the PO's freight line plus this amount is flagged.", "currency")}
            </div>
            {tog("freightTaxable", "Freight is taxable", "Include freight in the tax base when recomputing tax.")}
          </section>
          <section className="card card-pad stack"><h2>Currency</h2>
            <label className="field">Policy
              <select className="input" disabled={!canEdit} value={s.currencyPolicy} onChange={(e) => set("currencyPolicy", e.target.value as S["currencyPolicy"])} style={{ maxWidth: 420 }}>
                <option value="strict">Strict — a currency mismatch blocks the bundle</option><option value="convert">Convert — compare using the rates below, and ask for confirmation</option></select>
              <span className="hint">Rates are typed in by you and dated. The app never fetches exchange rates.</span></label>
            {s.currencyPolicy === "convert" && (
              <div className="stack">
                {s.fxRates.map((r, i) => (
                  <div className="row" key={i}>
                    <input className="input mono" style={{ width: 80 }} aria-label="From currency" disabled={!canEdit} value={r.from} onChange={(e) => set("fxRates", s.fxRates.map((x, j) => (j === i ? { ...x, from: e.target.value.toUpperCase() } : x)))} />→
                    <input className="input mono" style={{ width: 80 }} aria-label="To currency" disabled={!canEdit} value={r.to} onChange={(e) => set("fxRates", s.fxRates.map((x, j) => (j === i ? { ...x, to: e.target.value.toUpperCase() } : x)))} />
                    <input className="input mono" style={{ width: 120 }} aria-label="Rate" disabled={!canEdit} value={r.rate} onChange={(e) => set("fxRates", s.fxRates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                    <input className="input mono" style={{ width: 150 }} aria-label="As of date" disabled={!canEdit} value={r.asOf} onChange={(e) => set("fxRates", s.fxRates.map((x, j) => (j === i ? { ...x, asOf: e.target.value } : x)))} />
                    <button className="btn sm" disabled={!canEdit} onClick={() => set("fxRates", s.fxRates.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
                <div><button className="btn sm" disabled={!canEdit} onClick={() => set("fxRates", [...s.fxRates, { from: "USD", to: app.org?.baseCurrency ?? "EUR", rate: "0.92", asOf: new Date().toISOString().slice(0, 10) }])}>Add rate</button></div>
              </div>
            )}
          </section>
          <section className="card card-pad stack"><h2>Reading documents</h2>
            <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
              <label className="field">Number format<select className="input" disabled={!canEdit} value={s.numberLocale} onChange={(e) => set("numberLocale", e.target.value as S["numberLocale"])}><option value="us">1,234.56</option><option value="eu">1.234,56</option></select><span className="hint">Used only when a number is ambiguous (e.g. 1.234).</span></label>
              <label className="field">Ambiguous dates (03/04/2026)<select className="input" disabled={!canEdit} value={s.dateOrder} onChange={(e) => set("dateOrder", e.target.value as S["dateOrder"])}><option value="MDY">Month / day / year</option><option value="DMY">Day / month / year</option></select><span className="hint">Unambiguous dates ignore this.</span></label>
              <label className="field">Low-confidence threshold<input className="input mono" type="number" min={0} max={1} step={0.05} disabled={!canEdit} value={s.confidenceThreshold} onChange={(e) => set("confidenceThreshold", Number(e.target.value))} style={{ maxWidth: 110 }} /><span className="hint">Key fields read below this are sent to review.</span></label>
              <label className="field">Supplier-name match<input className="input mono" type="number" min={0} max={1} step={0.05} disabled={!canEdit} value={s.supplierMatchThreshold} onChange={(e) => set("supplierMatchThreshold", Number(e.target.value))} style={{ maxWidth: 110 }} /><span className="hint">Similarity needed between PO and invoice supplier.</span></label>
              <label className="field">Duplicate window<span className="row"><input className="input mono" type="number" min={0} disabled={!canEdit} value={s.duplicateWindowDays} onChange={(e) => set("duplicateWindowDays", Number(e.target.value))} style={{ maxWidth: 90 }} />days</span><span className="hint">For same-supplier, same-amount warnings.</span></label>
            </div>
          </section>
          <section className="card card-pad stack"><h2>Approval controls</h2>
            <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>{dec("clerkApprovalLimit", "AP Clerk approval limit", "Invoices above this total need a Controller. Compared numerically in the invoice's own currency.", "currency")}</div>
            {tog("requireSeparateApprover", "Separation of duties", "Whoever corrected data on a bundle cannot also approve it.")}
          </section>
          <section className="card card-pad stack"><h2>Optional AI assistance</h2>
            <p className="small muted">Status: {app.meta?.llm.enabled ? `enabled (${app.meta.llm.model})` : `off — ${app.meta?.llm.reason}`}. AI never changes amounts or decisions; see “How it was decided”.</p>
            <label className="row"><input type="checkbox" disabled={!canEdit || !app.meta?.llm.enabled} checked={s.llm.extraction} onChange={(e) => set("llm", { ...s.llm, extraction: e.target.checked })} /> Let a model fill in fields the rules couldn't find (values must be grounded in the document text)</label>
            <label className="row"><input type="checkbox" disabled={!canEdit || !app.meta?.llm.enabled} checked={s.llm.explanation} onChange={(e) => set("llm", { ...s.llm, explanation: e.target.checked })} /> Allow plain-language summaries (numbers are verified before display)</label>
          </section>
        </div>
      )}
    </div>
  );
}
