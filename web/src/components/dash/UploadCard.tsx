import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../state";
import { DIcon } from "../ui";

type Status = "queued" | "processing" | "added" | "duplicate" | "rejected" | "failed";
interface Item { id: number; name: string; size: number; status: Status; message?: string; docType?: string; documentId?: string; bundleId?: string; file?: File }
interface UploadResult { filename: string; status: "created" | "duplicate_file" | "rejected"; documentId?: string; docType?: string; message?: string; bundleIds: string[] }

const OK_EXT = /\.(pdf|png|jpe?g)$/i;
const DOC_LABEL: Record<string, string> = { PO: "Purchase order", GRN: "Receiving record", INVOICE: "Invoice" };
let seq = 0;

/** Real upload: each file is sent to /api/upload (classification → extraction → validation → matching run server-side). */
export function UploadCard({ onDone, compact }: { onDone(): void; compact?: boolean }) {
  const app = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const maxMb = app.meta?.limits.maxFileMb ?? 8;
  const maxFiles = app.meta?.limits.maxFilesPerBatch ?? 20;
  const patch = (id: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function sendOne(it: Item) {
    patch(it.id, { status: "processing", message: undefined });
    try {
      const form = new FormData();
      form.append("files", it.file!, it.name);
      const r = await api<{ results: UploadResult[] }>("POST", "/api/upload", undefined, { form });
      const x = r.results[0]!;
      patch(it.id, {
        status: x.status === "created" ? "added" : x.status === "duplicate_file" ? "duplicate" : "rejected", message: x.message, docType: x.docType, documentId: x.documentId,
        bundleId: x.docType === "INVOICE" ? x.bundleIds[0] : undefined,
      });
    } catch (e) { patch(it.id, { status: "failed", message: (e as Error).message }); }
  }

  async function add(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    if (list.length > maxFiles) { app.notify(`At most ${maxFiles} files at a time; the first ${maxFiles} were taken.`, "bad"); list.length = maxFiles; }
    const fresh: Item[] = list.map((f) => {
      const id = ++seq;
      if (!OK_EXT.test(f.name)) return { id, name: f.name, size: f.size, status: "rejected" as const, message: "Unsupported file type. Use PDF, PNG or JPG." };
      if (f.size === 0) return { id, name: f.name, size: f.size, status: "rejected" as const, message: "The file is empty." };
      if (f.size > maxMb * 1024 * 1024) return { id, name: f.name, size: f.size, status: "rejected" as const, message: `Larger than the ${maxMb} MB limit.` };
      return { id, name: f.name, size: f.size, status: "queued" as const, file: f };
    });
    setItems((xs) => [...fresh, ...xs].slice(0, 12));
    for (const it of fresh.filter((x) => x.status === "queued")) await sendOne(it);
    onDone();
  }

  const retry = async (it: Item) => { await sendOne(it); onDone(); };
  const remove = async (it: Item) => {
    if (!it.documentId) { setItems((xs) => xs.filter((x) => x.id !== it.id)); return; }
    try { await api("DELETE", `/api/documents/${it.documentId}`); setItems((xs) => xs.filter((x) => x.id !== it.id)); app.notify(`Removed ${it.name}. Matching was re-run for any bundle it fed.`); onDone(); }
    catch (e) { app.reportError(e, "Could not remove the document."); }
  };
  const busy = items.some((x) => x.status === "processing" || x.status === "queued");

  return (
    <section className={`dcard upload ${compact ? "compact" : ""}`} aria-labelledby="up-h">
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); }}
      >
        <div className="up-ico" aria-hidden><DIcon.cloud /></div>
        <h2 id="up-h">Upload AP Documents</h2>
        <p>Drag and drop or click to select files</p>
        <p className="muted small">Supports PDF, PNG, JPG · Purchase Orders, Receipts, Invoices · up to {maxMb} MB each</p>
        <button className="btn primary" onClick={() => input.current?.click()} disabled={busy}><Icon_Upload /> {busy ? "Processing…" : "Select Files"}</button>
        <input ref={input} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg" multiple hidden aria-label="Select AP documents" onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
      </div>
      {items.length > 0 && (
        <ul className="uplist" aria-live="polite">
          {items.map((it) => (
            <li key={it.id} className={it.status}>
              <span className="fname" title={it.name}>{it.name}</span>
              <span className="fstat">
                {it.status === "processing" || it.status === "queued" ? <><span className="prog" aria-hidden><i /></span><span className="sr-only">Processing</span> {it.status === "queued" ? "Queued" : "Reading…"}</> : null}
                {it.status === "added" && <><b className="ok">Added</b> · {DOC_LABEL[it.docType ?? ""] ?? it.docType}{it.bundleId && <> · <a href={`#/bundles/${it.bundleId}`}>Open</a></>}</>}
                {it.status === "duplicate" && <b className="muted">Already uploaded</b>}
                {it.status === "rejected" && <b className="bad">Rejected</b>}
                {it.status === "failed" && <b className="bad">Failed</b>}
                {it.message && it.status !== "added" && <span className="muted"> — {it.message}</span>}
              </span>
              <span className="fact">
                {it.status === "failed" && <button className="btn sm" onClick={() => retry(it)}>Retry</button>}
                {it.status === "added" && app.user?.role === "controller" && <button className="btn sm ghost" onClick={() => remove(it)} aria-label={`Remove ${it.name}`}>Remove</button>}
                {["rejected", "duplicate", "failed"].includes(it.status) && <button className="btn sm ghost" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} aria-label={`Dismiss ${it.name}`}>Dismiss</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
const Icon_Upload = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>;
