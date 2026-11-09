import type { DocType } from "../../shared/schemas.ts";

/** Normalise printed label text for matching: lowercase, hyphens→space, collapse spaces, drop trailing colon. */
export function labelNorm(t: string): string {
  return t
    .toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*$/, "")
    .trim();
}

export type Kind = "text" | "docno" | "date" | "money" | "percent" | "currency" | "taxid";
export interface Spec {
  key: string;
  labels: RegExp[];
  kind: Kind;
  /** value normally sits in the block BELOW the label (party blocks) */
  below?: boolean;
}

const NUM = String.raw`(?:no\.?|number|#|nr\.?|nummer)`;
const PO_REF = [
  new RegExp(String.raw`^(?:po|purchase order|your order|customer po|order ref(?:erence)?)\s*${NUM}?$`),
  /^bestell\s*(?:nummer|nr\.?)$/,
];

export const HEADER_SPECS: Record<DocType, Spec[]> = {
  PO: [
    { key: "docNumber", kind: "docno", labels: [new RegExp(String.raw`^(?:po|purchase order|order)\s*${NUM}$`), /^bestell\s*(?:nummer|nr\.?)$/] },
    { key: "docDate", kind: "date", labels: [/^(?:order date|date|bestelldatum)$/] },
    { key: "supplierName", kind: "text", below: true, labels: [/^(?:vendor|supplier|lieferant)$/] },
    { key: "currency", kind: "currency", labels: [/^(?:currency|währung)$/] },
  ],
  GRN: [
    { key: "docNumber", kind: "docno", labels: [new RegExp(String.raw`^(?:grn|receipt|report|beleg)\s*${NUM}$`)] },
    { key: "poRef", kind: "docno", labels: PO_REF },
    { key: "docDate", kind: "date", labels: [/^(?:received date|date received|receipt date|eingangsdatum|date)$/] },
    { key: "supplierName", kind: "text", below: true, labels: [/^(?:supplier|vendor|lieferant)$/] },
  ],
  INVOICE: [
    { key: "docNumber", kind: "docno", labels: [new RegExp(String.raw`^(?:invoice|inv\.?)\s*${NUM}$`), /^rechnungs?\s*(?:nummer|nr\.?)$/] },
    { key: "poRef", kind: "docno", labels: PO_REF },
    { key: "docDate", kind: "date", labels: [/^(?:invoice date|date|rechnungsdatum|datum)$/] },
    { key: "supplierName", kind: "text", below: true, labels: [/^(?:from|von|seller|vendor|supplier|issued by)$/] },
    { key: "supplierTaxId", kind: "taxid", labels: [/^(?:tax id|vat id|vat no\.?|ein|ust ?id ?nr\.?|ust id)$/] },
    { key: "currency", kind: "currency", labels: [/^(?:currency|währung)$/] },
  ],
};

export const TOTAL_SPECS: Spec[] = [
  { key: "subtotal", kind: "money", labels: [/^(?:subtotal|sub total|net total|zwischensumme|net amount|nettobetrag)$/] },
  { key: "discountTotal", kind: "money", labels: [/^(?:discount|rabatt|volume discount|less discount)$/] },
  { key: "freight", kind: "money", labels: [/^(?:freight|shipping|shipping (?:and|&) handling|fracht|versand(?:kosten)?|delivery)$/] },
];
export const TAX_LABEL = /^(?:sales tax|tax|vat|mwst\.?|ust\.?|umsatzsteuer)(?:\s*\(?\s*([\d.,]+)\s*%\s*\)?)?$/;
export const TOTAL_LABEL = /^(?:total due|total|grand total|amount due|invoice total|gesamtbetrag|endbetrag)(?:\s*\(([a-z]{3})\))?$/;

export const COLUMNS: { key: string; re: RegExp }[] = [
  { key: "line", re: /^(?:line|ln|#|pos\.?|no\.?)$/ },
  { key: "sku", re: /^(?:sku|item|item (?:no|code|#)\.?|part(?: no\.?| #)?|artikel ?(?:nr\.?|nummer)?|product code|material)$/ },
  { key: "description", re: /^(?:description|desc\.?|bezeichnung|artikelbezeichnung|item description)$/ },
  { key: "qty", re: /^(?:qty|quantity|menge|units|qty ordered|ordered|qty received|qty rec'?d|menge erhalten|received qty|menge geliefert)$/ },
  { key: "uom", re: /^(?:uom|unit|einheit|u\/m)$/ },
  { key: "unitPrice", re: /^(?:unit price|price|rate|einzelpreis|preis|unit cost|price\/unit)$/ },
  { key: "discountPct", re: /^(?:disc(?:ount)?(?: %)?\.?|rab\. ?%|rabatt(?: %)?)$/ },
  { key: "amount", re: /^(?:amount|line total|total|ext\.? (?:price|amount)|betrag|gesamt(?:preis)?|net amount)$/ },
  { key: "date", re: /^(?:receipt date|date received|received|eingang am|delivery date)$/ },
];

export const TITLES: { docType: DocType; re: RegExp }[] = [
  { docType: "GRN", re: /goods receipt|receiving (?:report|record)|wareneingang|delivery receipt|goods received/ },
  { docType: "PO", re: /purchase order|bestellung/ },
  { docType: "INVOICE", re: /invoice|rechnung/ },
];

export const KNOWN_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"];
