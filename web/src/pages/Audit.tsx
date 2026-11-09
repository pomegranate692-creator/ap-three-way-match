import { useState } from "react";
import { download } from "../lib/api";
import { ROLE_LABEL, whenFull } from "../lib/format";
import { useApp, useLoad } from "../state";
import { Empty, ErrorBox, LoadingBlock } from "../components/ui";

interface Ev { id: number; at: string; actorName: string | null; actorRole: string | null; actorKind: string; action: string; entityType: string; bundleId: string | null; note: string | null; before: unknown; after: unknown }

export function Audit() {
  const app = useApp();
  const [action, setAction] = useState("");
  const { data, error, loading, reload } = useLoad<Ev[]>(`/api/audit?limit=400${action ? `&action=${encodeURIComponent(action)}` : ""}`);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Audit log</h1><p>Everything that changed state — who or what did it, when, and what it was before and after. Times are shown in {app.org?.timezone} and stored in UTC.</p></div>
        <div className="actions"><button className="btn" onClick={() => download("/api/data-export", `ap-data-${app.org?.id}.json`).catch((e) => app.reportError(e))}>Download all data (JSON)</button></div></div>
      <div className="filters">
        <select className="input" aria-label="Filter by event type" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All events</option><option value="document">Documents</option><option value="match">Match runs</option><option value="field">Field corrections</option><option value="exception">Exceptions</option><option value="approval">Approvals</option><option value="export">Exports</option><option value="settings">Settings</option><option value="ai">AI</option>
        </select>
        {data && <span className="small muted">{data.length} events (latest first)</span>}
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data && <div className="card"><LoadingBlock /></div>}
      {data && <div className="card"><div className="table-wrap"><table className="t">
        <caption className="sr-only">Audit events</caption>
        <thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>{data.map((a) => (
          <tr key={a.id}>
            <td className="mono small" style={{ whiteSpace: "nowrap" }}>{whenFull(a.at, app.org?.timezone)}</td>
            <td>{a.actorKind === "human" ? <>{a.actorName}<div className="small muted">{ROLE_LABEL[a.actorRole ?? ""]}</div></> : <span className="badge neutral">{a.actorKind === "agent" ? "extraction agent" : "system"}</span>}</td>
            <td className="mono small">{a.action}</td>
            <td className="small">{a.note}{a.bundleId && <> · <a href={`#/bundles/${a.bundleId}`}>open bundle</a></>}{(a.before || a.after) ? <details><summary className="muted">before / after</summary><pre className="mono small" style={{ whiteSpace: "pre-wrap", margin: 4 }}>{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details> : null}</td>
          </tr>))}
          {!data.length && <tr><td colSpan={4}><Empty title="No events yet">Events appear here as soon as documents are loaded or decisions are made.</Empty></td></tr>}
        </tbody></table></div></div>}
    </div>
  );
}
