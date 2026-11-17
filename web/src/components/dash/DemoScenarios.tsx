import { useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../state";
import type { BundleRowData } from "../../lib/status";

const SCENARIOS: { id: string; title: string; look: string; org: string }[] = [
  { id: "B01", title: "Clean match", look: "PO, receipt and invoice agree; ready for one-click approval.", org: "Harbor & Pine Hardware" },
  { id: "B06", title: "Price discrepancy", look: "Invoice unit price is above the PO price by more than tolerance.", org: "Harbor & Pine Hardware" },
  { id: "B05", title: "Quantity mismatch", look: "Billed 100, only 80 received. Click the 100 to see its source on the page.", org: "Harbor & Pine Hardware" },
  { id: "B25", title: "Duplicate invoice", look: "Same supplier and number as an earlier invoice; blocked.", org: "Cobalt Bay Foods" },
  { id: "B14", title: "Needs a manual correction", look: "Stated total is $90 off. Correct it, then a second person approves.", org: "Cobalt Bay Foods" },
];

/** Guided tour of the synthetic scenarios. Every row links to a real bundle that the real engine produced. */
export function DemoScenarios({ rows, onChanged }: { rows: BundleRowData[]; onChanged(): void }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const byFixture = new Map(rows.filter((r) => r.fixtureId).map((r) => [r.fixtureId!, r]));
  const noPo = rows.find((r) => r.fixtureId?.endsWith("-noPO"));
  if (!rows.some((r) => r.source === "demo") && byFixture.size === 0) return null;
  async function loadNoPo() {
    setBusy(true);
    try { await api("POST", "/api/demo/scenario/missing-po"); app.notify("Loaded an invoice that has no purchase order on file."); onChanged(); }
    catch (e) { app.reportError(e, "Could not load the scenario."); } finally { setBusy(false); }
  }
  return (
    <section className="dcard" aria-labelledby="ds-h">
      <div className="dcard-head"><h2 id="ds-h">Demo scenarios <span className="muted">(synthetic)</span></h2></div>
      <ul className="scn-list">
        {SCENARIOS.map((s) => { const r = byFixture.get(s.id); return (
          <li key={s.id}><b>{s.title}</b><span className="muted small">{s.look}</span>
            {r ? <a className="btn sm" href={`#/bundles/${r.id}`}>Open {s.id}</a> : <span className="small muted">Switch to {s.org}</span>}</li>); })}
        <li><b>Missing purchase order</b><span className="muted small">An invoice arrives with no PO or receipt on file; the engine blocks it.</span>
          {noPo ? <a className="btn sm" href={`#/bundles/${noPo.id}`}>Open</a> : <button className="btn sm" disabled={busy} onClick={loadNoPo}>{busy ? "Loading…" : "Load this scenario"}</button>}</li>
      </ul>
    </section>
  );
}
