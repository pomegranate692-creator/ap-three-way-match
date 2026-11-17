import { DIcon } from "../ui";
import type { Dashboard } from "../../lib/dash";

export function ExceptionAlerts({ categories }: { categories: Dashboard["categories"] }) {
  const total = categories.reduce((a, c) => a + c.open, 0);
  const shown = categories.filter((c) => c.open > 0);
  return (
    <section className="dcard" aria-labelledby="exa-h">
      <div className="dcard-head"><h2 id="exa-h">Exception Alerts <span className="muted">({total})</span></h2><a className="link-right" href="#/exceptions">View All <DIcon.chev /></a></div>
      {shown.length === 0 ? <p className="muted small" style={{ padding: "14px 16px" }}>No open exceptions in this period.</p> : (
        <ul className="alerts">
          {shown.map((c) => (
            <li key={c.key}>
              <a href={`#/exceptions?category=${c.key}`}>
                <span className={`aicon ${c.key === "duplicate" || c.key === "extraction" ? "info" : c.key === "price" ? "bad" : "warn"}`}>{c.key === "duplicate" || c.key === "extraction" ? <DIcon.info /> : <DIcon.warn />}</span>
                <span className="alabel">{c.label}</span><b>{c.open}</b><DIcon.chev />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
