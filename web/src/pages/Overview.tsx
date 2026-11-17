import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state";
import { useBundles, useDashboard, useNarrow } from "../lib/hooks";
import { ApprovalPanel } from "../components/dash/ApprovalPanel";
import { ExceptionAlerts } from "../components/dash/ExceptionAlerts";
import { InvoiceQueue } from "../components/dash/InvoiceQueue";
import { KpiCards } from "../components/dash/KpiCards";
import { MatchDonut } from "../components/dash/MatchDonut";
import { RangeBar, StatusChips } from "../components/dash/RangeBar";
import { TrendChart } from "../components/dash/TrendChart";
import { UploadCard } from "../components/dash/UploadCard";
import { DIcon, ErrorBox } from "../components/ui";

export function Overview() {
  const app = useApp();
  const dash = useDashboard();
  const bundles = useBundles();
  const narrow = useNarrow(1100);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const queueIds = useMemo(() => bundles.pending.map((b) => b.id), [bundles.pending]);

  // default selection: the first invoice that needs a human; keep the user's choice while it is still listed
  useEffect(() => {
    if (!bundles.data) return;
    if (selected && bundles.rows.some((b) => b.id === selected)) return;
    setSelected(queueIds[0] ?? bundles.rows[0]?.id ?? null);
  }, [bundles.data, bundles.rows, queueIds, selected]);

  const reloadAll = () => { dash.reload(); bundles.reload(); };
  async function loadDemo() {
    setLoadingDemo(true);
    try { const r = await api<{ bundlesLoaded: number }>("POST", "/api/demo/load"); app.notify(`Loaded ${r.bundlesLoaded} synthetic bundles for ${app.org?.name}.`); reloadAll(); }
    catch (e) { app.reportError(e, "Could not load demo data."); } finally { setLoadingDemo(false); }
  }
  const d = dash.data;
  const empty = !!d && !!bundles.data && bundles.data.length === 0;

  return (
    <div className="page dash">
      <header className="dash-head">
        <div>
          <h1>AP Document Intelligence</h1>
          <p>Automated invoice processing, three-way matching, and exception management</p>
        </div>
        <RangeBar onRefresh={reloadAll} refreshing={dash.loading || bundles.loading} />
      </header>
      <StatusChips demo={d?.data.demo ?? 0} upload={d?.data.upload ?? 0} />
      {dash.error && <ErrorBox message={dash.error.message} onRetry={dash.reload} />}
      {d && d.data.demo > 0 && d.range.source !== "upload" && <p className="demo-note small" role="note"><b>Synthetic demo data.</b> Companies, invoices and received dates are fictional; dates are spread over 28 days so trends have something to show. Figures are computed from the records in the database.</p>}
      <KpiCards d={d} loading={dash.loading} />
      {d && d.trendNote && <p className="small muted trend-note">{d.trendNote}</p>}

      {empty ? (
        <section className="dcard hero">
          <h2>Start with a document or the demo</h2>
          <p>Nothing has been processed for {app.org?.name} yet. Upload purchase orders, receiving records and invoices, or load the synthetic scenarios to see matching, exceptions and approvals work end to end.</p>
          <div className="row" style={{ justifyContent: "center" }}><button className="btn primary" onClick={loadDemo} disabled={loadingDemo}>{loadingDemo ? "Loading…" : "Load synthetic demo data"}</button></div>
          <div style={{ maxWidth: 560, margin: "16px auto 0" }}><UploadCard onDone={reloadAll} compact /></div>
        </section>
      ) : (
        <div className="dash-grid">
          <div className="dash-main">
            <div className="two">
              <UploadCard onDone={reloadAll} compact />
              <section className="dcard" aria-labelledby="tr-h">
                <div className="dcard-head"><h2 id="tr-h">Invoice Processing Trend</h2></div>
                <div className="pad-sm">{d ? <TrendChart trend={d.trend} bucketDays={d.range.bucketDays} /> : <div className="skeleton" style={{ height: 230 }} aria-hidden />}</div>
              </section>
            </div>
            <InvoiceQueue rows={bundles.rows} loading={bundles.loading} selectedId={selected} onSelect={(id) => { setSelected(id); if (narrow) setDrawer(true); }} onChanged={reloadAll} />
            <div className="two lower">
              <section className="dcard" aria-labelledby="mr-h">
                <div className="dcard-head"><h2 id="mr-h">Three-Way Match Results</h2><a className="link-right" href="#/match">Details <DIcon.chev /></a></div>
                <div className="pad">{d ? <MatchDonut buckets={d.buckets} /> : <div className="skeleton" style={{ height: 160 }} aria-hidden />}</div>
              </section>
              {d ? <ExceptionAlerts categories={d.categories} /> : <section className="dcard"><div className="skeleton" style={{ height: 200, margin: 16 }} aria-hidden /></section>}
            </div>
          </div>
          <div className="dash-side" data-open={drawer} >
            {narrow && drawer && <button className="drawer-scrim" aria-label="Close approval review" onClick={() => setDrawer(false)} />}
            <ApprovalPanel bundleId={selected} queue={queueIds} onNavigate={setSelected} onChanged={reloadAll} {...(narrow ? { onClose: () => setDrawer(false) } : {})} />
          </div>
          {narrow && !drawer && selected && <button className="btn primary fab" onClick={() => setDrawer(true)}>Review selected invoice</button>}
        </div>
      )}
    </div>
  );
}
