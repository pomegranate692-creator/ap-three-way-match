import { useEffect, useMemo, useState } from "react";
import { useApp, useLoad } from "../state";
import type { Dashboard } from "./dash";
import { isPending, type BundleRowData } from "./status";

export function useNarrow(px = 1100) {
  const q = `(max-width:${px}px)`;
  const [n, setN] = useState(() => (typeof matchMedia === "function" ? matchMedia(q).matches : false));
  useEffect(() => { const m = matchMedia(q); const f = () => setN(m.matches); m.addEventListener("change", f); f(); return () => m.removeEventListener("change", f); }, [q]);
  return n;
}

/** Hash query (`#/route?x=1`), re-read on every render of the shell. */
export function hashParams(): URLSearchParams { return new URLSearchParams((location.hash.split("?")[1] ?? "")); }

export function useDashboard() {
  const app = useApp();
  return useLoad<Dashboard>(app.user ? `/api/dashboard?days=${app.days}&source=${app.source}` : null, [app.days, app.source]);
}

export function useBundles() {
  const app = useApp();
  const res = useLoad<BundleRowData[]>("/api/bundles");
  const rows = useMemo(() => (res.data ?? []).filter((b) => app.source === "all" || b.source === app.source), [res.data, app.source]);
  // approval queue: invoices still awaiting a human decision, those with open exceptions first
  const pending = useMemo(() => rows.filter(isPending).sort((a, b) => Number(b.open > 0) - Number(a.open > 0) || b.openBlocking - a.openBlocking || a.label.localeCompare(b.label, undefined, { numeric: true })), [rows]);
  return { ...res, rows, pending };
}
