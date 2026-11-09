import { useState } from "react";
import { CODE_LABEL, money, ROLE_LABEL, signed } from "../lib/format";
import { useLoad } from "../state";
import { CodeBadge, Empty, ErrorBox, LoadingBlock, SevBadge, StateBadge } from "../components/ui";

interface Row { id: string; bundleId: string; bundleLabel: string; bundleState: string; severity: string; code: string; title: string; ownerRole: string; delta: string | null; currency: string | null; explanation: string }

export function Queue() {
  const [sev, setSev] = useState("");
  const [code, setCode] = useState("");
  const qs = new URLSearchParams({ status: "open", ...(sev ? { severity: sev } : {}), ...(code ? { code } : {}) }).toString();
  const { data, error, loading, reload } = useLoad<Row[]>(`/api/exceptions?${qs}`);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Exception queue</h1><p>Every open exception across your bundles, most serious first. Open one to see the evidence on the original document and clear it.</p></div></div>
      <div className="filters">
        <label className="sr-only" htmlFor="sev">Severity</label>
        <select id="sev" className="input" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">All severities</option><option value="blocking">Blocking</option><option value="review">Needs review</option></select>
        <label className="sr-only" htmlFor="code">Exception type</label>
        <select id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)}><option value="">All exception types</option>{Object.entries(CODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {data && <span className="small muted">{data.length} open</span>}
      </div>
      {error && <ErrorBox message={error.message} onRetry={reload} />}
      {loading && !data && <div className="card"><LoadingBlock /></div>}
      {data && (
        <div className="card"><div className="table-wrap"><table className="t">
          <caption className="sr-only">Open exceptions</caption>
          <thead><tr><th>Bundle</th><th>Severity</th><th>Exception</th><th>What's wrong</th><th>Owner</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="click" onClick={() => (location.hash = `#/bundles/${r.bundleId}?tab=exceptions`)}>
                <td><a href={`#/bundles/${r.bundleId}?tab=exceptions`} onClick={(e) => e.stopPropagation()}><b>{r.bundleLabel}</b></a><div><StateBadge state={r.bundleState} /></div></td>
                <td><SevBadge sev={r.severity} /></td><td><CodeBadge code={r.code} /></td>
                <td style={{ maxWidth: 420 }}>{r.title}</td><td>{ROLE_LABEL[r.ownerRole]}</td>
                <td className="num mono">{r.delta ? signed(r.currency ? money(r.delta, r.currency) : r.delta) : "—"} {r.currency ?? ""}</td>
              </tr>
            ))}
            {!data.length && <tr><td colSpan={6}><Empty title="No open exceptions">{sev || code ? "Nothing matches these filters." : "Everything in this organisation is either clean or already cleared. Load demo data from the inbox to see exceptions."}</Empty></td></tr>}
          </tbody>
        </table></div></div>
      )}
    </div>
  );
}
