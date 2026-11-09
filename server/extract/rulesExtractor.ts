import type { DocType, ExtractedField, ExtractionResult, TextLayer, Word } from "../../shared/schemas.ts";
import { parseDate, parseNumber, parsePercent, type NumLocale } from "../../shared/normalize.ts";
import { allSegs, below, buildLines, rightOf, unionBox, type Line, type Seg } from "../ingest/layout.ts";
import { COLUMNS, HEADER_SPECS, KNOWN_CURRENCIES, TAX_LABEL, TITLES, TOTAL_LABEL, TOTAL_SPECS, labelNorm, type Spec } from "./labels.ts";

export const RULES_EXTRACTOR = "rules@1.0";

export interface ExtractOptions {
  numberLocale: NumLocale;
  dateOrder: "MDY" | "DMY";
  docTypeHint?: DocType;
}

/* ---------------------------------------------------------------- helpers */
const minConf = (ws: Word[]) => (ws.length ? Math.min(...ws.map((w) => w.conf)) : 1);
const joinText = (ws: Word[]) => ws.map((w) => w.text).join(" ");

function mk(key: string, words: Word[], value: string | null, conf: number, reason: string): ExtractedField {
  const c = Math.max(0, Math.min(1, conf * minConf(words)));
  return {
    key,
    value,
    raw: joinText(words),
    bbox: unionBox(words),
    wordIds: words.map((w) => w.id),
    confidence: Math.round(c * 1000) / 1000,
    reason: minConf(words) < 1 ? `${reason}; OCR word confidence ${(minConf(words) * 100).toFixed(0)}%` : reason,
    extractor: RULES_EXTRACTOR,
  };
}

/** Does `text` look like a printed label for ANY spec / column / total? Used to reject "value = neighbouring label". */
const ALL_LABELS: RegExp[] = [
  ...Object.values(HEADER_SPECS).flatMap((s) => s.flatMap((x) => x.labels)),
  ...TOTAL_SPECS.flatMap((s) => s.labels),
  TAX_LABEL,
  TOTAL_LABEL,
  /^(?:terms|payment terms|bill to|ship to|rechnung an|lieferadresse)$/,
];
function looksLikeLabel(text: string): boolean {
  const t = labelNorm(text);
  return ALL_LABELS.some((re) => re.test(t));
}

interface LabelHit {
  seg: Seg;
  /** words after the label when value shares the segment ("Tax ID: 84-…") */
  inline: Word[] | null;
  match: RegExpMatchArray;
}

function matchLabel(seg: Seg, labels: RegExp[]): LabelHit | null {
  const full = labelNorm(seg.text);
  for (const re of labels) {
    const m = full.match(re);
    if (m) return { seg, inline: null, match: m };
  }
  const n = seg.words.length;
  for (let k = 1; k < n; k++) {
    const prefix = labelNorm(seg.words.slice(0, k).map((w) => w.text).join(" "));
    for (const re of labels) {
      const m = prefix.match(re);
      if (m) return { seg, inline: seg.words.slice(k), match: m };
    }
  }
  return null;
}

function dateConfidence(raw: string, order: "MDY" | "DMY"): { conf: number; note: string } {
  const t = raw.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) return { conf: 0.97, note: "ISO date" };
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(t)) return { conf: 0.96, note: "dd.mm.yyyy" };
  if (/[A-Za-zäÄ]{3}/.test(t)) return { conf: 0.96, note: "month name" };
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/);
  if (m && (+m[1]! > 12 || +m[2]! > 12)) return { conf: 0.95, note: "numeric date, day/month order unambiguous" };
  return { conf: 0.88, note: `ambiguous numeric date read as ${order} per organisation setting` };
}

function ambiguousThousands(raw: string): boolean {
  return /^\D*\d{1,3}[.,]\d{3}\D*$/.test(raw.trim());
}

/** Convert raw words to a typed value; returns [value, confidence, reason]. */
function interpret(kind: Spec["kind"], ws: Word[], opts: ExtractOptions): [string | null, number, string] {
  const raw = joinText(ws).trim();
  switch (kind) {
    case "text":
      return raw ? [raw, 0.96, "text read next to its label"] : [null, 0, "empty"];
    case "taxid":
      return raw ? [raw, 0.95, "tax identifier read next to its label"] : [null, 0, "empty"];
    case "docno": {
      if (!raw) return [null, 0, "empty"];
      const clean = raw.replace(/[,;]$/, "");
      if (!/\d/.test(clean)) return [clean, 0.55, "reference contains no digits — verify"];
      return [clean, 0.97, "reference read next to its label"];
    }
    case "date": {
      const d = parseDate(raw, opts.dateOrder);
      if (!d) return [null, 0.3, `could not parse "${raw}" as a date`];
      const { conf, note } = dateConfidence(raw, opts.dateOrder);
      return [d, conf, `date parsed (${note})`];
    }
    case "money": {
      const p = parseNumber(raw, opts.numberLocale);
      if (!p.ok) return [null, 0.3, `could not parse "${raw}" as a number`];
      let conf = 0.97;
      const notes = [`number parsed (${p.locale} format)`];
      if (p.repaired) { conf = Math.min(conf, 0.55); notes.push("OCR-confusable characters were rewritten (O→0, l→1…): verify"); }
      if (ambiguousThousands(raw)) { conf = Math.min(conf, 0.78); notes.push("single separator followed by 3 digits is ambiguous (thousands vs decimal)"); }
      return [p.value, conf, notes.join("; ")];
    }
    case "percent": {
      const p = parsePercent(raw, opts.numberLocale);
      if (!p.ok) return [null, 0.3, `could not parse "${raw}" as a percentage`];
      return [p.value, p.repaired ? 0.55 : 0.96, "percentage parsed"];
    }
    case "currency": {
      const t = raw.toUpperCase();
      if (/^[A-Z]{3}$/.test(t)) return [t, 0.97, "ISO currency code next to its label"];
      return [null, 0.3, `"${raw}" is not an ISO currency code`];
    }
  }
}

/* ---------------------------------------------------------------- classification */
export function classify(lines: Line[], pageHeight: number): { docType: DocType | null; confidence: number; reason: string } {
  const top = lines.filter((l) => l.page === 1 && l.yc < pageHeight * 0.3).flatMap((l) => l.segs);
  const big = [...top].filter((s) => s.size >= 14).sort((a, b) => b.size - a.size);
  for (const seg of big) {
    const t = labelNorm(seg.text);
    for (const { docType, re } of TITLES) if (re.test(t)) return { docType, confidence: 0.98, reason: `title "${seg.text}" in the page header` };
  }
  const counts = new Map<DocType, number>();
  for (const l of lines) for (const { docType, re } of TITLES) if (re.test(labelNorm(l.text))) counts.set(docType, (counts.get(docType) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return { docType: best[0], confidence: 0.6, reason: `no clear title; keyword "${best[0]}" appears ${best[1]}× in the text` };
  return { docType: null, confidence: 0, reason: "no title or keyword identifies PO / receiving record / invoice" };
}

/* ---------------------------------------------------------------- main */
export function extractWithRules(layer: TextLayer, opts: ExtractOptions): ExtractionResult {
  const lines = buildLines(layer);
  const pageH = layer.pages[0]?.height ?? 792;
  const cls = classify(lines, pageH);
  const docType = opts.docTypeHint ?? cls.docType;
  if (!docType) {
    return { docType: "INVOICE", classification: { confidence: 0, reason: cls.reason }, fields: [], lineCount: 0, warnings: ["Document type could not be determined."] };
  }
  const segs = allSegs(lines);
  const fields: ExtractedField[] = [];
  const warnings: string[] = [];

  /* ---- locate the line-item table ---- */
  const table = findTable(lines);
  const headerSegs = table ? lines.slice(0, table.headerIdx).flatMap((l) => l.segs) : segs;
  const totalsSegs = table ? lines.slice(table.endIdx).flatMap((l) => l.segs) : segs;

  /* ---- header fields ---- */
  for (const spec of HEADER_SPECS[docType]) {
    const f = findLabeled(spec, headerSegs, segs, opts);
    if (f) fields.push(f);
  }
  if (docType === "INVOICE" && !fields.find((f) => f.key === "supplierName")) {
    const cand = headerSegs
      .filter((s) => s.page === 1 && s.yc < pageH * 0.2 && s.size >= 13 && /[A-Za-z]{3}/.test(s.text) && !TITLES.some((t) => t.re.test(labelNorm(s.text))))
      .sort((a, b) => b.size - a.size || a.x0 - b.x0)[0];
    if (cand) fields.push(mk("supplierName", cand.words, cand.text, 0.85, "no 'From' label; took the largest text in the page header"));
  }

  /* ---- totals ---- */
  let totalCurrency: ExtractedField | null = null;
  if (docType !== "GRN") {
    for (const spec of TOTAL_SPECS) {
      const f = findLabeled(spec, totalsSegs, segs, opts);
      if (f) {
        if ((spec.key === "discountTotal") && f.value) f.value = f.value.replace(/^-/, ""); // printed as "-50.00"; stored as positive amount
        fields.push(f);
      }
    }
    for (const seg of totalsSegs) {
      const t = labelNorm(seg.text);
      const tm = t.match(TAX_LABEL);
      if (tm && !fields.some((f) => f.key === "taxTotal")) {
        const val = rightOf(seg, segs);
        if (val) {
          const [v, c, r] = interpret("money", val.words, opts);
          fields.push(mk("taxTotal", val.words, v, c, r));
          if (tm[1]) {
            const [rv, rc, rr] = interpret("percent", [{ ...seg.words[0]!, text: tm[1] }], opts);
            fields.push({ ...mk("taxRate", seg.words, rv, rc, `rate read from label "${seg.text}"; ${rr}`) });
          }
        }
        continue;
      }
      const tt = t.match(TOTAL_LABEL);
      if (tt && !fields.some((f) => f.key === "total")) {
        const val = rightOf(seg, segs);
        if (val) {
          const [v, c, r] = interpret("money", val.words, opts);
          fields.push(mk("total", val.words, v, c, r));
          if (tt[1]) totalCurrency = mk("currency", seg.words, tt[1].toUpperCase(), 0.95, `currency code in the total label "${seg.text}"`);
          else {
            const sym = val.text.match(/[$€£]/)?.[0];
            if (sym) totalCurrency = mk("currency", val.words, { "$": "USD", "€": "EUR", "£": "GBP" }[sym] ?? null, 0.82, `currency inferred from the symbol "${sym}"`);
          }
        }
      }
    }
    if (!fields.some((f) => f.key === "currency") && totalCurrency?.value) fields.push(totalCurrency);
    if (!fields.some((f) => f.key === "currency")) {
      const iso = segs.find((s) => s.words.some((w) => KNOWN_CURRENCIES.includes(w.text.replace(/[^A-Z]/g, "")) && w.text.length === 3));
      if (iso) {
        const w = iso.words.find((x) => KNOWN_CURRENCIES.includes(x.text))!;
        fields.push(mk("currency", [w], w.text, 0.8, "ISO currency code found in the document text (no label)"));
      }
    }
  }

  /* ---- line items ---- */
  let lineCount = 0;
  if (table) {
    const rows = parseRows(lines, table, docType, opts);
    lineCount = rows.length;
    rows.forEach((r, i) => {
      for (const [k, f] of Object.entries(r)) fields.push({ ...f, key: `line.${i + 1}.${k}` });
    });
  } else {
    warnings.push("No line-item table was recognised.");
  }

  /* ---- warnings ---- */
  const have = new Set(fields.map((f) => f.key));
  const required: Record<DocType, string[]> = {
    PO: ["docNumber", "supplierName", "total"],
    GRN: ["docNumber", "poRef"],
    INVOICE: ["docNumber", "poRef", "supplierName", "total"],
  };
  for (const k of required[docType]) if (!have.has(k)) warnings.push(`Required field "${k}" was not found.`);
  if (lineCount === 0) warnings.push("No line items were extracted.");

  return { docType, classification: { confidence: cls.confidence, reason: cls.reason }, fields, lineCount, warnings };
}

/* ---------------------------------------------------------------- labelled value lookup */
function findLabeled(spec: Spec, zone: Seg[], allS: Seg[], opts: ExtractOptions): ExtractedField | null {
  for (const seg of zone) {
    const hit = matchLabel(seg, spec.labels);
    if (!hit) continue;
    let valueWords: Word[] | null = hit.inline && hit.inline.length ? hit.inline : null;
    let via = "same text run as the label";
    if (!valueWords) {
      const tryBelow = () => {
        const b = below(seg, allS);
        return b && !looksLikeLabel(b.text) ? b : null;
      };
      const tryRight = () => {
        const r = rightOf(seg, allS);
        return r && !looksLikeLabel(r.text) ? r : null;
      };
      const pick = spec.below ? tryBelow() ?? tryRight() : tryRight() ?? tryBelow();
      if (!pick) continue;
      valueWords = pick.words;
      via = pick.yc > seg.yc + 3 ? "below the label" : "right of the label";
    }
    const [value, conf, reason] = interpret(spec.kind, valueWords, opts);
    if (value === null && conf === 0) continue;
    return mk(spec.key, valueWords, value, conf, `label "${seg.text}" → ${via}; ${reason}`);
  }
  return null;
}

/* ---------------------------------------------------------------- table */
interface Table {
  headerIdx: number;
  endIdx: number;
  cols: { key: string; x0: number; x1: number; lo: number; hi: number }[];
}

function colKeyOf(text: string): string | null {
  const t = labelNorm(text);
  for (const c of COLUMNS) if (c.re.test(t)) return c.key;
  return null;
}

function findTable(lines: Line[]): Table | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const keyed = l.segs.map((s) => ({ s, key: colKeyOf(s.text) })).filter((x): x is { s: Seg; key: string } => x.key !== null);
    const keys = new Set(keyed.map((k) => k.key));
    if (keyed.length >= 3 && keys.size === keyed.length && keys.has("qty") && (keys.has("sku") || keys.has("description"))) {
      const sorted = [...keyed].sort((a, b) => a.s.x0 - b.s.x0);
      const cols = sorted.map((k, idx) => ({
        key: k.key,
        x0: k.s.x0,
        x1: k.s.x1,
        lo: idx === 0 ? -Infinity : (sorted[idx - 1]!.s.x1 + k.s.x0) / 2,
        hi: idx === sorted.length - 1 ? Infinity : (k.s.x1 + sorted[idx + 1]!.s.x0) / 2,
      }));
      // end of table = first following line that opens the totals block, or one with no parsable qty
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const first = lines[j]!.segs[0];
        if (!first) continue;
        const t = labelNorm(first.text);
        const isTotals = TOTAL_SPECS.some((s) => s.labels.some((re) => re.test(t))) || TAX_LABEL.test(t) || TOTAL_LABEL.test(t) || lines[j]!.segs.some((sg) => TOTAL_SPECS.some((s) => s.labels.some((re) => re.test(labelNorm(sg.text)))));
        if (isTotals) {
          end = j;
          break;
        }
      }
      // continuation rows of a header that wrapped onto a second line ("Rabatt" / "%") are skipped by the row parser
      return { headerIdx: i, endIdx: end, cols };
    }
  }
  return null;
}

function parseRows(lines: Line[], table: Table, docType: DocType, opts: ExtractOptions): Record<string, ExtractedField>[] {
  const rows: Record<string, ExtractedField>[] = [];
  for (let i = table.headerIdx + 1; i < table.endIdx; i++) {
    const l = lines[i]!;
    const cells = new Map<string, Seg[]>();
    for (const seg of l.segs) {
      const cx = (seg.x0 + seg.x1) / 2;
      const col = table.cols.find((c) => cx >= c.lo && cx < c.hi);
      if (!col) continue;
      cells.set(col.key, [...(cells.get(col.key) ?? []), seg]);
    }
    const qtySegs = cells.get("qty");
    if (!qtySegs) continue;
    const qtyWords = qtySegs.flatMap((s) => s.words);
    const qtyParsed = parseNumber(joinText(qtyWords), opts.numberLocale);
    if (!qtyParsed.ok) continue;
    const row: Record<string, ExtractedField> = {};
    for (const [key, segs] of cells) {
      if (key === "line") continue;
      const words = segs.flatMap((s) => s.words);
      const text = joinText(words);
      if (!text.trim()) continue;
      let f: ExtractedField;
      switch (key) {
        case "sku":
          f = mk("sku", words, text.trim(), /\d/.test(text) ? 0.97 : 0.7, "table cell under the SKU column");
          break;
        case "description":
          f = mk("description", words, text.trim(), 0.96, "table cell under the description column");
          break;
        case "uom":
          f = mk("uom", words, text.trim().toUpperCase(), 0.95, "table cell under the unit column");
          break;
        case "date": {
          const [v, c, r] = interpret("date", words, opts);
          f = mk("date", words, v, c, `receipt date column; ${r}`);
          break;
        }
        default: {
          // qty / unitPrice / discountPct / amount
          const [v, c, r] = interpret("money", words, opts);
          f = mk(key, words, v, c, `table cell under the ${key} column; ${r}`);
        }
      }
      row[key] = f;
    }
    if (!row.sku && !row.description) continue;
    rows.push(row);
  }
  void docType;
  return rows;
}
