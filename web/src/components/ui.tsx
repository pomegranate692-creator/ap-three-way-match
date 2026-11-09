import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CODE_LABEL, REC_LABEL, STATE_LABEL } from "../lib/format";

/* ---------- icons (inline, 24px grid) ---------- */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const Icon = {
  inbox: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5" /></svg>,
  queue: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3l9 16H3L12 3zM12 10v4M12 17v.5" /></svg>,
  export: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg>,
  audit: () => <svg viewBox="0 0 24 24" {...P}><path d="M8 4h8l4 4v12H8zM16 4v4h4M5 8v12M11 13h6M11 17h6" /></svg>,
  settings: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /></svg>,
  shield: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4" /></svg>,
  upload: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>,
  check: () => <svg viewBox="0 0 24 24" {...P}><path d="M5 12l5 5 9-10" /></svg>,
  x: () => <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  pencil: () => <svg viewBox="0 0 24 24" {...P}><path d="M4 20l1-5L16 4l4 4L9 19l-5 1z" /></svg>,
  spark: () => <svg viewBox="0 0 24 24" {...P}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>,
};

export function RecBadge({ rec }: { rec: string | null }) {
  if (!rec) return <span className="badge neutral">Not matched</span>;
  const cls = rec === "READY_FOR_APPROVAL" ? "ok" : rec === "HOLD" ? "bad" : "warn";
  return <span className={`badge ${cls}`}><i className="dot" />{REC_LABEL[rec]}</span>;
}
export function StateBadge({ state }: { state: string }) {
  const cls = state === "approved" || state === "exported" ? "ok" : state === "rejected" ? "bad" : state === "held" ? "warn" : "neutral";
  return <span className={`badge ${cls}`}>{STATE_LABEL[state] ?? state}</span>;
}
export function SevBadge({ sev }: { sev: string }) {
  return <span className={`badge ${sev === "blocking" ? "bad" : sev === "review" ? "warn" : "neutral"}`}>{sev === "blocking" ? "Blocking" : sev === "review" ? "Needs review" : "Info"}</span>;
}
export function CodeBadge({ code }: { code: string }) {
  return <span className="badge neutral">{CODE_LABEL[code] ?? code}</span>;
}
export function AiBadge({ ai, label }: { ai: boolean; label?: string }) {
  return ai ? <span className="badge ai" title="A language model was involved in this step"><Icon.spark /> {label ?? "AI"}</span> : <span className="badge neutral" title="Deterministic code — same input, same output">{label ?? "Rule"}</span>;
}

export function Conf({ v, threshold = 0.8 }: { v: number; threshold?: number }) {
  const c = v >= 0.95 ? "var(--ok)" : v >= threshold ? "var(--accent)" : "var(--bad)";
  return <span className="conf" title={`Read with ${(v * 100).toFixed(0)}% confidence`}><i style={{ ["--w" as string]: `${v * 100}%`, ["--c" as string]: c }} />{(v * 100).toFixed(0)}%</span>;
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}
export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return <div role="status" aria-live="polite" className="stack" style={{ padding: 16 }}><span className="sr-only">{label}</span><Skeleton h={20} w="40%" /><Skeleton h={14} /><Skeleton h={14} w="85%" /><Skeleton h={14} w="70%" /></div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="banner bad" role="alert"><span>{message}</span>{onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}</div>;
}
export function Empty({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="empty"><h2>{title}</h2>{children && <p>{children}</p>}{actions && <div className="row" style={{ justifyContent: "center" }}>{actions}</div>}</div>;
}

export function Modal({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer?: ReactNode; onClose(): void; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,textarea,select,button.primary,button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input,textarea,select,[tabindex]:not([tabindex='-1'])")];
        if (!f.length) return;
        const a = f[0]!, z = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} style={wide ? { width: "min(760px,100%)" } : undefined}>
        <div className="modal-head"><h2 id={id}>{title}</h2></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Dialog that collects a mandatory reason before a consequential action. */
export function ReasonDialog(p: { title: string; intro?: ReactNode; confirmLabel: string; required?: boolean; danger?: boolean; placeholder?: string; onCancel(): void; onConfirm(reason: string): Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = !p.required || reason.trim().length >= 3;
  const go = async () => {
    setBusy(true); setErr(null);
    try { await p.onConfirm(reason.trim()); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={p.title} onClose={p.onCancel}
      footer={<><button className="btn" onClick={p.onCancel} disabled={busy}>Cancel</button><button className={`btn ${p.danger ? "danger" : "primary"}`} disabled={!ok || busy} onClick={go}>{busy ? "Working…" : p.confirmLabel}</button></>}>
      {p.intro}
      <label className="field">{p.required ? "Reason (required)" : "Note (optional)"}
        <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={p.placeholder ?? "Say what you checked and why."} maxLength={500} />
        <span className="hint">Recorded in the audit trail with your name and role.</span>
      </label>
      {err && <div className="banner bad" role="alert">{err}</div>}
    </Modal>
  );
}

/* ---------- tabs: standard arrow-key behaviour (WAI-ARIA "tabs" pattern) ----------
   Put onKeyDown on the role="tablist" element. Left/Right move between tabs (wrapping), Home/End jump to the
   first/last, and the newly focused tab is activated. Disabled tabs are skipped. Pair with roving tabindex:
   only the selected tab is in the Tab order (see tabIndexFor). */
export function tablistKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'));
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || tabs.length < 2) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const target = tabs[next];
  target?.focus();
  target?.click();
}
/** Roving tabindex: the selected tab is tabbable; if nothing is selected yet, the first tab is. */
export const tabIndexFor = (selected: boolean, anySelected: boolean, first: boolean) => (selected || (!anySelected && first) ? 0 : -1);
