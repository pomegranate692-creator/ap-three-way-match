import { useLoad } from "../../state";
import { whenFull } from "../../lib/format";
import { DOC_SHORT } from "../../lib/format";
import { Empty } from "../ui";

export interface DocItem {
  id: string; docType: string; filename: string; size: number; pageCount: number; docNumber: string | null; poRef: string | null; source: "upload" | "demo"; uploadedBy: string | null;
  createdAt: string; extractors: string[]; riskFlags: string[]; warnings: number; classificationConfidence: number; processingMs: number | null; bundles: { id: string; label: string; state: string; role: string }[];
}

/** Upload history: every document the system has ingested, newest first. */
export function RecentDocuments({ limit }: { limit: number }) {
  const { data, loading } = useLoad<DocItem[]>("/api/documents");
  const rows = (data ?? []).filter((d) => d.source === "upload").slice(0, limit);
  return (
    <section className="dcard" aria-labelledby="rd-h">
      <div className="dcard-head"><h2 id="rd-h">Upload history</h2><a className="link-right" href="#/documents">All documents →</a></div>
      {loading && !data ? <div className="pad muted" role="status">Loading…</div> : rows.length === 0 ? <Empty title="No uploads yet">Documents you upload appear here with how they were read. Synthetic demo documents are listed under Documents.</Empty> : (
        <div className="table-wrap"><table className="t"><caption className="sr-only">Uploaded documents</caption>
          <thead><tr><th>File</th><th>Read as</th><th>Number</th><th>Uploaded</th><th>Bundle</th></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}><td className="mono small">{d.filename}</td><td>{DOC_SHORT[d.docType]}</td><td className="mono">{d.docNumber ?? "—"}</td><td className="small">{whenFull(d.createdAt)}</td>
              <td>{d.bundles.map((b) => <a key={b.id} href={`#/bundles/${b.id}`} style={{ marginRight: 8 }}>{b.label}</a>)}{!d.bundles.length && <span className="muted">waiting for its invoice</span>}</td></tr>
          ))}</tbody></table></div>
      )}
    </section>
  );
}
