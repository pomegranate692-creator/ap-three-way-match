import { useState } from "react";
import { Settings } from "./Settings";
import { Data } from "./Data";
import { tablistKeys, tabIndexFor } from "../components/ui";

export function SettingsHub({ initialTab, theme, setTheme, onTour }: { initialTab: "settings" | "data"; theme: string; setTheme(t: string): void; onTour(): void }) {
  const [tab, setTab] = useState<"settings" | "data">(initialTab);
  return (
    <div>
      <div className="page" style={{ paddingBottom: 0 }}>
        <div className="dash-head"><div><h1>Settings</h1><p>Matching tolerances and approval limits, appearance, and where your data lives.</p></div></div>
        <div className="tabs" role="tablist" aria-label="Settings sections" onKeyDown={tablistKeys}>
          {([["settings", "Matching & approvals"], ["data", "Data & safety"]] as const).map(([k, l], i) => <button key={k} role="tab" className="tab" aria-selected={tab === k} tabIndex={tabIndexFor(tab === k, true, i === 0)} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      {tab === "settings" ? (
        <>
          <div className="page" style={{ paddingBottom: 0 }}>
            <section className="dcard"><div className="dcard-head"><h2>Appearance & help</h2></div>
              <div className="pad row"><label className="small muted" style={{ display: "grid", gap: 4 }}>Theme<select className="input" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="dark">Dark (default)</option><option value="light">Light</option><option value="auto">Match system</option></select></label>
                <button className="btn" onClick={onTour}>Guided tour</button></div></section>
          </div>
          <Settings />
        </>
      ) : <Data />}
    </div>
  );
}
