import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "../lib/api";
import { LoadingBlock, ErrorBox } from "./ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface Highlight { key: string; bbox: { page: number; x: number; y: number; w: number; h: number }; kind?: "exc" }

interface Props {
  documentId: string;
  highlights: Highlight[];
  selectedKey: string | null;
  onPick(key: string): void;
}

/** Renders the ORIGINAL PDF and overlays a box on the exact words each extracted value was read from. */
export function PdfViewer({ documentId, highlights, selectedKey, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);

  useEffect(() => {
    let live = true;
    let loaded: pdfjs.PDFDocumentProxy | null = null;
    setDoc(null); setErr(null);
    (async () => {
      try {
        const blob = await api<Blob>("GET", `/api/documents/${documentId}/file`, undefined, { raw: true });
        const buf = await blob.arrayBuffer();
        loaded = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
        if (!live) return;
        const sizes: { w: number; h: number }[] = [];
        for (let i = 1; i <= loaded.numPages; i++) { const v = (await loaded.getPage(i)).getViewport({ scale: 1 }); sizes.push({ w: v.width, h: v.height }); }
        setPages(sizes); setDoc(loaded);
      } catch (e) { if (live) setErr((e as Error).message || "The PDF could not be displayed."); }
    })();
    return () => { live = false; loaded?.destroy().catch(() => {}); };
  }, [documentId]);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, e.contentRect.width - 28)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedKey || !wrap.current) return;
    const c = wrap.current;
    const el = c.querySelector<HTMLElement>(`[data-hl="${CSS.escape(selectedKey)}"]`);
    if (!el) return;
    // scroll ONLY the viewer's own container (scrollIntoView would also scroll the whole page)
    const er = el.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    c.scrollTo({
      top: Math.max(0, c.scrollTop + (er.top - cr.top) - c.clientHeight / 2 + er.height / 2),
      left: Math.max(0, c.scrollLeft + (er.left - cr.left) - c.clientWidth / 2 + er.width / 2),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selectedKey, doc, width, zoom]);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto minmax(0,1fr)", minHeight: 0, height: "100%" }}>
      <div className="row" style={{ padding: "6px 10px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
        <span className="small muted">Original document · boxes mark where each value was read</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Zoom out">−</button>
        <span className="mono small" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button className="btn sm" onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))} aria-label="Zoom in">+</button>
      </div>
      <div className="viewer-canvas" ref={wrap} tabIndex={0} aria-label="Document preview">
        {err && <ErrorBox message={`Preview unavailable: ${err}`} />}
        {!doc && !err && <div style={{ background: "var(--surface)", borderRadius: 8 }}><LoadingBlock label="Loading document" /></div>}
        {doc && pages.map((p, i) => <Page key={`${documentId}-${i}`} doc={doc} index={i + 1} size={p} cssWidth={width * zoom} highlights={highlights.filter((h) => h.bbox.page === i + 1)} selectedKey={selectedKey} onPick={onPick} />)}
      </div>
    </div>
  );
}

function Page({ doc, index, size, cssWidth, highlights, selectedKey, onPick }: { doc: pdfjs.PDFDocumentProxy; index: number; size: { w: number; h: number }; cssWidth: number; highlights: Highlight[]; selectedKey: string | null; onPick(k: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cssHeight = (cssWidth * size.h) / size.w;
  useEffect(() => {
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(index);
      if (cancelled || !canvas.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / size.w) * dpr });
      const c = canvas.current;
      c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
      c.style.width = `${cssWidth}px`; c.style.height = `${cssHeight}px`;
      task = page.render({ canvasContext: c.getContext("2d")!, viewport });
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [doc, index, cssWidth, cssHeight, size.w]);
  const hl = useMemo(() => highlights, [highlights]);
  return (
    <div className="pdf-page" style={{ width: cssWidth, height: cssHeight, marginBottom: 14 }}>
      <canvas ref={canvas} />
      {hl.map((h) => (
        <button key={h.key} data-hl={h.key} className={`hl ${selectedKey === h.key ? "sel" : ""} ${h.kind ?? ""}`} aria-label={`Source of ${h.key}`}
          onClick={() => onPick(h.key)}
          style={{ left: h.bbox.x * cssWidth, top: h.bbox.y * cssHeight, width: Math.max(8, h.bbox.w * cssWidth), height: Math.max(8, h.bbox.h * cssHeight) }} />
      ))}
    </div>
  );
}
