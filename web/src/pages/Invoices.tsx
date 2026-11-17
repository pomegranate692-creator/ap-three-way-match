import { useBundles, hashParams } from "../lib/hooks";
import { InvoiceQueue } from "../components/dash/InvoiceQueue";
import { UploadCard } from "../components/dash/UploadCard";
import { DemoScenarios } from "../components/dash/DemoScenarios";
import { RecentDocuments } from "../components/dash/RecentDocuments";
import { useApp } from "../state";
import { api } from "../lib/api";
import { useState } from "react";

/** "Invoice Processing": upload documents, watch them move through the pipeline, and work the full invoice queue. */
export function Invoices() {
  const app = useApp();
  const b = useBundles();
  const [busy, setBusy] = useState(false);
  const match = hashParams().get("match") ?? undefined;
  async function loadDemo() {
    setBusy(true);
    try { const r = await api<{ bundlesLoaded: number }>("POST", "/api/demo/load"); app.notify(`Loaded ${r.bundlesLoaded} synthetic bundles for ${app.org?.name}.`); b.reload(); }
    catch (e) { app.reportError(e, "Could not load demo data."); } finally { setBusy(false); }
  }
  return (
    <div className="page dash">
      <header className="dash-head"><div><h1>Invoice Processing</h1><p>Upload documents, then follow each invoice from classification and extraction through matching to a decision.</p></div>
        <div className="rangebar"><button className="btn" onClick={loadDemo} disabled={busy}>{busy ? "Loading…" : "Load demo data"}</button></div></header>
      <ol className="pipeline-steps" aria-label="Processing pipeline">
        {["Upload", "Classify", "Extract", "Validate", "Three-way match", "Human review", "Approve / reject", "Audit & export"].map((s, i) => <li key={s}><span>{i + 1}</span>{s}</li>)}
      </ol>
      <UploadCard onDone={b.reload} />
      <DemoScenarios rows={b.rows} onChanged={b.reload} />
      <InvoiceQueue rows={b.rows} loading={b.loading} selectedId={null} onSelect={(id) => { location.hash = `#/bundles/${id}`; }} pageSize={10} {...(match ? { initialMatch: match } : {})} showMatchFilter onChanged={b.reload} />
      <RecentDocuments limit={8} />
    </div>
  );
}
