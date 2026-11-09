import React, { useEffect, useRef, useState } from "react";
import { AppProvider, useApp, useLoad } from "./state";
import { api } from "./lib/api";
import { ROLE_LABEL } from "./lib/format";
import { Icon, Modal } from "./components/ui";
import { Inbox } from "./pages/Inbox";
import { Review } from "./pages/Review";
import { Queue } from "./pages/Queue";
import { Exports } from "./pages/Exports";
import { Audit } from "./pages/Audit";
import { Settings } from "./pages/Settings";
import { Data } from "./pages/Data";

function useHash() {
  const [h, setH] = useState(location.hash || "#/");
  useEffect(() => { const f = () => setH(location.hash || "#/"); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

function Onboarding() {
  const app = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = step === 2;
  async function loadAndClose() {
    setBusy(true);
    try { const r = await api<{ bundlesLoaded: number }>("POST", "/api/demo/load"); app.notify(`Loaded ${r.bundlesLoaded} synthetic bundles for ${app.org?.name}.`); app.refresh(); app.closeOnboarding(); location.hash = "#/"; }
    catch (e) { app.reportError(e, "Could not load demo data."); } finally { setBusy(false); }
  }
  const steps = [
    { t: "Check three documents before anyone pays", b: <><p>An invoice should only be paid if the goods were <b>ordered</b> (purchase order), <b>received</b> (receiving record) and <b>billed correctly</b> (invoice). This tool reads all three, compares them line by line, and tells you exactly what doesn't agree.</p><ul style={{ margin: 0, paddingLeft: 20 }}><li>Every number links back to the box it was read from on the original page.</li><li>Maths is exact decimal arithmetic with tolerances you control.</li><li>It recommends. A person decides. <b>It never pays or posts anything.</b></li></ul><div className="banner warn">All data in this build is synthetic — made-up companies and invoices.</div></> },
    { t: "Choose who you're acting as", b: <><p>Roles decide what you can do. Switch any time from the top bar.</p><dl className="kv"><dt><b>AP Clerk</b></dt><dd>Corrects misread fields, clears tax and total issues, approves small clean invoices.</dd><dt><b>Purchasing Lead</b></dt><dd>Settles quantity, price and missing-receipt disputes. Can't approve payment.</dd><dt><b>Controller</b></dt><dd>Overrides blocking items, approves large invoices, sets tolerances.</dd></dl><p className="small muted">This is a demo switcher, not a login. Currently: <b>{app.user?.name}</b> ({ROLE_LABEL[app.user?.role ?? "clerk"]}) at <b>{app.org?.name}</b>.</p></> },
    { t: "Try it with demo data", b: <><p>Load synthetic bundles for <b>{app.org?.name}</b>. They run through the real reader and matcher — nothing is pre-baked. Some are clean; some contain deliberate problems such as billing more than was received.</p><p className="small muted">Suggested first look: open bundle <b>B05</b> (Harbor &amp; Pine) — invoiced 100, received 80.</p></> },
  ];
  const s = steps[step]!;
  return (
    <Modal title={s.t} onClose={app.closeOnboarding} wide
      footer={<>
        <span className="small muted" style={{ marginRight: "auto" }}>Step {step + 1} of 3</span>
        <button className="btn ghost" onClick={app.closeOnboarding}>Skip</button>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {!last && <button className="btn primary" onClick={() => setStep(step + 1)}>Next</button>}
        {last && <button className="btn primary" disabled={busy} onClick={loadAndClose}>{busy ? "Loading…" : "Load demo data"}</button>}
      </>}>
      {s.b}
    </Modal>
  );
}

function Shell() {
  const app = useApp();
  const hash = useHash();
  const stats = useLoad<{ openExceptions: number; openBlocking: number }>(app.user ? "/api/stats" : null);
  const [route, qs] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(qs ?? "");
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("ap.theme") ?? "auto"; } catch { return "auto"; } });
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ap.theme", theme); } catch { /* ignore */ }
  }, [theme]);
  // Move focus to <main> on navigation, but NOT on first load (that would skip the skip-link for keyboard users).
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return; }
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [route]);

  const nav: [string, string, () => React.JSX.Element, string?][] = [
    ["/", "Inbox", Icon.inbox], ["/exceptions", "Exceptions", Icon.queue, stats.data?.openExceptions ? String(stats.data.openExceptions) : undefined],
    ["/exports", "Exports", Icon.export], ["/audit", "Audit log", Icon.audit], ["/settings", "Settings", Icon.settings], ["/data", "Data & safety", Icon.shield],
  ];
  const active = (p: string) => (p === "/" ? route === "/" || route!.startsWith("/bundles") : route!.startsWith(p));

  let page;
  if (app.loading && !app.org) page = <div className="page"><div role="status">Starting…</div></div>;
  else if (!app.org || !app.user) page = <div className="page"><div className="banner bad" role="alert">{app.offline ?? "No organisations found."} <button className="btn sm" onClick={app.retry}>Retry</button></div></div>;
  else if (route!.startsWith("/bundles/")) page = <Review id={route!.split("/")[2]!} key={route} initialTab={(params.get("tab") as never) ?? undefined} />;
  else if (route === "/exceptions") page = <Queue />;
  else if (route === "/exports") page = <Exports />;
  else if (route === "/audit") page = <Audit />;
  else if (route === "/settings") page = <Settings />;
  else if (route === "/data") page = <Data />;
  else page = <Inbox />;

  return (
    <div className="app">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <aside className="rail">
        <div className="brand"><div className="brand-mark" aria-hidden>3∙</div><div><b>Three-Way Match</b><span>AP document intelligence</span></div></div>
        <nav className="nav" aria-label="Main">
          {nav.map(([p, label, I, count]) => (
            <a key={p} href={`#${p}`} aria-current={active(p) ? "page" : undefined}><I /><span className="label">{label}</span>{count && <span className="count" aria-label={`${count} open`}>{count}</span>}</a>
          ))}
        </nav>
        <div className="rail-foot">
          <button className="btn sm" onClick={app.openOnboarding}>Guided tour</button>
          <label className="small muted" style={{ display: "grid", gap: 3 }}>Theme<select className="input" value={theme} onChange={(e) => setTheme(e.target.value)} style={{ minHeight: 28, padding: "2px 6px" }}><option value="auto">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <span className="small muted">v0.1 · local-first · no payments</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="synthetic-tag" title="Every company, person and document here is fictional">Synthetic data</span>
          <span className="grow" />
          {app.org && app.user && (
            <>
              <label className="row small muted">Organisation
                <select className="input" aria-label="Organisation" value={app.org.id} onChange={(e) => { app.setOrg(e.target.value); location.hash = "#/"; }} style={{ width: "auto", minHeight: 30, padding: "3px 8px" }}>{app.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label className="row small muted">Acting as
                <select className="input" aria-label="Acting as" value={app.user.id} onChange={(e) => app.setUser(e.target.value)} style={{ width: "auto", minHeight: 30, padding: "3px 8px" }}>{app.org.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}</select></label>
            </>
          )}
        </header>
        {app.offline && app.org && <div className="banner bad" role="alert" style={{ margin: "12px 24px 0" }}>{app.offline}<button className="btn sm" onClick={app.retry}>Retry</button></div>}
        <main id="main" tabIndex={-1} style={{ outline: "none" }}>{page}</main>
      </div>
      {app.onboardingOpen && app.org && <Onboarding />}
      <div className="toasts" aria-live="polite">{app.toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "bad" ? "alert" : "status"}><span>{t.text}</span><button onClick={() => app.dismiss(t.id)} aria-label="Dismiss">×</button></div>)}</div>
    </div>
  );
}

export default function App() { return <AppProvider><Shell /></AppProvider>; }
