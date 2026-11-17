import { RANGES } from "../../lib/dash";
import { useApp } from "../../state";
import { DIcon } from "../ui";

export function RangeBar({ onRefresh, refreshing }: { onRefresh(): void; refreshing?: boolean }) {
  const app = useApp();
  return (
    <div className="rangebar">
      <label className="selwrap"><DIcon.cal /><span className="sr-only">Date range</span>
        <select className="input" aria-label="Date range" value={app.days} onChange={(e) => app.setDays(Number(e.target.value))}>{RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}</select></label>
      <button className="btn" onClick={onRefresh} disabled={refreshing}><span className={refreshing ? "spin" : ""}><DIcon.refresh /></span> Refresh</button>
    </div>
  );
}

export function StatusChips({ demo, upload }: { demo: number; upload: number }) {
  const app = useApp();
  const ocr = app.meta?.connectors.find((c) => c.name.startsWith("OCR"));
  const ai = app.meta?.llm.enabled;
  return (
    <div className="chips" aria-label="System status">
      <span className="chip ok" title="API reachable; extraction and matching run locally"><i className="dot" /> System online</span>
      <span className="chip" title="Documents are read with the PDF text layer and, for images, local OCR">{ocr?.status === "available" ? "OCR on" : "OCR off"}</span>
      <span className="chip" title={app.meta?.llm.reason}>{ai ? "AI assist on" : "AI assist off"}</span>
      <label className="chip sel" title="Demo data is synthetic. Uploads are your own documents.">
        <span className="sr-only">Data shown</span>
        <select aria-label="Data shown" value={app.source} onChange={(e) => app.setSource(e.target.value as "all" | "demo" | "upload")}>
          <option value="all">All data ({demo + upload})</option><option value="demo">Synthetic demo ({demo})</option><option value="upload">My uploads ({upload})</option>
        </select>
      </label>
    </div>
  );
}
