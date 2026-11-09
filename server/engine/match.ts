import { createHash } from "node:crypto";
import { D, Dec, absDiff, currencyDp, maxD, percentOf, roundMoney, s, sum, tryD, fixed } from "../../shared/money.ts";
import { daysBetween, normDocNumber, normSku, normSupplier, supplierSimilarity } from "../../shared/normalize.ts";
import type {
  CanonDoc, CanonLine, EvidenceRef, ExceptionCode, ExceptionItem, LineMatch, MatchResult, Recommendation, Role, Settings, Severity,
} from "../../shared/schemas.ts";

/**
 * Deterministic three-way reconciliation engine.
 * PURE: no I/O, no clock, no randomness, no model calls. Same input ⇒ same output.
 * Money, quantity and tolerance maths use Decimal (half-up). Nothing here reads free text from documents.
 */
export const ENGINE_VERSION = "engine@1.0.0";

export interface PriorInvoice {
  bundleId: string;
  documentId: string;
  supplierName: string | null;
  docNumber: string | null;
  total: string | null;
  currency: string | null;
  docDate: string | null;
}
export interface MatchContext {
  /** invoices ingested BEFORE this one in the same organisation */
  priorInvoices: PriorInvoice[];
  /** quantities already billed against the same PO by earlier, accepted invoices — keyed by normalised SKU */
  priorBilledQty: Record<string, string>;
}
export interface MatchInput {
  po: CanonDoc | null;
  grns: CanonDoc[];
  invoice: CanonDoc;
  settings: Settings;
  context: MatchContext;
}

const OWNER: Record<ExceptionCode, Role> = {
  MISSING_RECEIPT: "purchasing", QTY_NOT_RECEIVED: "purchasing", QTY_OVER_RECEIVED: "purchasing", QTY_OVER_ORDERED: "purchasing",
  PRICE_VARIANCE: "purchasing", UNORDERED_ITEM: "purchasing", FREIGHT_NOT_AUTHORIZED: "purchasing", DISCOUNT_NOT_APPLIED: "purchasing",
  TAX_MISMATCH: "clerk", TOTAL_ARITHMETIC: "clerk", LINE_ARITHMETIC: "clerk", CURRENCY_CONVERTED: "clerk", PO_REF_MISSING: "clerk",
  POSSIBLE_DUPLICATE: "clerk", DATE_ANOMALY: "clerk", LOW_CONFIDENCE: "clerk", MISSING_DATA: "clerk",
  CURRENCY_MISMATCH: "controller", SUPPLIER_MISMATCH: "controller", PO_REF_MISMATCH: "controller", DUPLICATE_INVOICE: "controller", SUSPECT_INSTRUCTIONS: "controller",
};

export function settingsHash(settings: Settings): string {
  return createHash("sha256").update(stableStringify(settings)).digest("hex").slice(0, 16);
}
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const nz = (d: Dec) => s(d);

export function matchBundle(input: MatchInput): MatchResult {
  const { po, grns, invoice, settings, context } = input;
  const ex: ExceptionItem[] = [];
  const lineMatches: LineMatch[] = [];
  const invCur = invoice.currency;

  const ev = (doc: CanonDoc | null, fieldKey: string, label: string, value: string | null): EvidenceRef[] =>
    doc ? [{ documentId: doc.documentId, fieldKey, label, value }] : [];

  const add = (e: {
    code: ExceptionCode; severity: Severity; lineKey?: string | null; title: string; explanation: string;
    expected?: string | null; actual?: string | null; delta?: string | null; currency?: string | null; evidence?: EvidenceRef[]; action: string;
  }) => {
    const lineKey = e.lineKey ?? null;
    ex.push({
      fingerprint: `${e.code}|${lineKey ?? "-"}`, code: e.code, severity: e.severity, lineKey, title: e.title, explanation: e.explanation,
      expected: e.expected ?? null, actual: e.actual ?? null, delta: e.delta ?? null, currency: e.currency ?? null,
      evidence: e.evidence ?? [], suggestedAction: e.action, ownerRole: OWNER[e.code],
    });
  };

  /* ---------- no PO: cannot three-way match ---------- */
  if (!po) {
    add({
      code: "MISSING_DATA", severity: "blocking", lineKey: "doc:PO", title: "No purchase order on file",
      explanation: `Invoice ${invoice.docNumber ?? "(number unreadable)"} references PO ${invoice.poRef ?? "(none)"}, but no purchase order document has been uploaded for it. A three-way match needs the PO.`,
      action: "Upload the purchase order, or ask Purchasing for it.",
    });
    return finish(settings, invCur, [], ex, { lineSum: null, expectedTax: null, expectedTotal: null, taxRateUsed: null, fxRate: null }, invoice);
  }

  /* ---------- document quality & safety ---------- */
  for (const doc of [po, ...grns, invoice]) {
    if (doc.riskFlags.length) {
      const f = doc.riskFlags[0]!;
      add({
        code: "SUSPECT_INSTRUCTIONS", severity: "blocking", lineKey: `doc:${doc.docType}`,
        title: `${labelOf(doc)} contains text that tries to instruct the processing system`,
        explanation: `The ${labelOf(doc)} contains ${doc.riskFlags.length} passage(s) that read like instructions or payment-redirection ("${f.excerpt.slice(0, 120)}…"). Document text is treated as untrusted data and was NOT followed; it had no effect on this match. This is a common fraud / prompt-injection pattern, so a controller must review the document.`,
        actual: f.code, evidence: [{ documentId: doc.documentId, fieldKey: "risk", label: "Flagged passage", value: f.excerpt.slice(0, 160) }],
        action: "Controller: inspect the document, contact the supplier through a known channel, and do not act on the embedded text.",
      });
    }
    if (doc.lowConfidence.length) {
      const worst = [...doc.lowConfidence].sort((a, b) => a.confidence - b.confidence);
      add({
        code: "LOW_CONFIDENCE", severity: "review", lineKey: `doc:${doc.docType}`,
        title: `${doc.lowConfidence.length} low-confidence field(s) on the ${labelOf(doc)}`,
        explanation: `These fields were read with confidence below ${(settings.confidenceThreshold * 100).toFixed(0)}%: ${worst.slice(0, 6).map((w) => `${w.key} (${(w.confidence * 100).toFixed(0)}%)`).join(", ")}. The match below may be wrong if they were misread.`,
        actual: worst.map((w) => w.key).join(", "), evidence: worst.slice(0, 6).map((w) => ({ documentId: doc.documentId, fieldKey: w.key, label: w.key, value: null })),
        action: "Compare each flagged field with the original document and correct it if needed; the match re-runs automatically.",
      });
    }
  }

  /* ---------- currency policy ---------- */
  const poCur = po.currency;
  let comparable = true;
  let fx: Dec | null = null;
  if (!invCur || !poCur) {
    add({
      code: "MISSING_DATA", severity: "review", lineKey: "doc:currency", title: "Currency not found",
      explanation: `The ${!invCur ? "invoice" : "purchase order"} has no readable currency, so amounts cannot be safely compared.`,
      action: "Enter the currency shown on the document.", evidence: ev(!invCur ? invoice : po, "currency", "Currency", null),
    });
  } else if (invCur !== poCur) {
    const rate = settings.currencyPolicy === "convert" ? findRate(settings, invCur, poCur) : null;
    if (rate) {
      fx = rate;
      add({
        code: "CURRENCY_CONVERTED", severity: "review", lineKey: "doc:currency", title: `Invoice in ${invCur}, PO in ${poCur} — converted at ${nz(rate)}`,
        explanation: `The invoice is in ${invCur} but the PO is in ${poCur}. Per the organisation's currency policy, invoice prices were converted to ${poCur} at the configured rate ${nz(rate)} for comparison only. Confirm the rate is acceptable.`,
        expected: poCur, actual: invCur, evidence: [...ev(invoice, "currency", "Invoice currency", invCur), ...ev(po, "currency", "PO currency", poCur)],
        action: "Confirm the exchange rate in Settings is current and acceptable.",
      });
    } else {
      comparable = false;
      add({
        code: "CURRENCY_MISMATCH", severity: "blocking", lineKey: "doc:currency", title: `Currency mismatch: PO ${poCur}, invoice ${invCur}`,
        explanation: `The PO is in ${poCur} but the invoice is in ${invCur}. ${settings.currencyPolicy === "convert" ? `No ${invCur}→${poCur} rate is configured.` : "The organisation's policy is strict (no automatic conversion)."} Prices and totals are not comparable, so price checks were skipped to avoid false alarms. Paying in the wrong currency risks a significant over/under-payment.`,
        expected: poCur, actual: invCur, evidence: [...ev(invoice, "currency", "Invoice currency", invCur), ...ev(po, "currency", "PO currency", poCur)],
        action: "Ask the supplier to reissue the invoice in the PO currency, or have the Controller approve an explicit conversion.",
      });
    }
  }
  const cur = invCur ?? poCur ?? "";

  /* ---------- supplier / references ---------- */
  if (po.supplierName && invoice.supplierName) {
    const sim = supplierSimilarity(po.supplierName, invoice.supplierName);
    if (sim < settings.supplierMatchThreshold) {
      add({
        code: "SUPPLIER_MISMATCH", severity: "blocking", lineKey: "doc:supplier", title: "Invoice supplier differs from PO supplier",
        explanation: `The PO is with "${po.supplierName}" but the invoice is from "${invoice.supplierName}" (name similarity ${(sim * 100).toFixed(0)}%, threshold ${(settings.supplierMatchThreshold * 100).toFixed(0)}%). Paying a different legal entity is a classic payment-fraud pattern.`,
        expected: po.supplierName, actual: invoice.supplierName, evidence: [...ev(po, "supplierName", "PO supplier", po.supplierName), ...ev(invoice, "supplierName", "Invoice supplier", invoice.supplierName)],
        action: "Verify the supplier identity with Purchasing before any approval.",
      });
    }
  }
  if (!invoice.poRef) {
    add({
      code: "PO_REF_MISSING", severity: "review", lineKey: "doc:poRef", title: "Invoice does not quote a PO number",
      explanation: "No purchase-order reference was found on the invoice; the PO link was made some other way.", action: "Confirm the invoice belongs to this PO.",
    });
  } else if (po.docNumber && normDocNumber(invoice.poRef) !== normDocNumber(po.docNumber)) {
    add({
      code: "PO_REF_MISMATCH", severity: "blocking", lineKey: "doc:poRef", title: "Invoice quotes a different PO number",
      explanation: `The invoice quotes PO "${invoice.poRef}" but is being matched to PO "${po.docNumber}".`, expected: po.docNumber, actual: invoice.poRef,
      evidence: [...ev(invoice, "poRef", "Invoice PO reference", invoice.poRef), ...ev(po, "docNumber", "PO number", po.docNumber)], action: "Confirm which PO the invoice is for.",
    });
  }
  for (const g of grns) {
    if (g.poRef && po.docNumber && normDocNumber(g.poRef) !== normDocNumber(po.docNumber)) {
      add({
        code: "PO_REF_MISMATCH", severity: "blocking", lineKey: `doc:GRN:${g.docNumber ?? g.documentId}`, title: "Receiving record quotes a different PO number",
        explanation: `Receiving record ${g.docNumber ?? ""} quotes PO "${g.poRef}", not "${po.docNumber}".`, expected: po.docNumber, actual: g.poRef,
        evidence: ev(g, "poRef", "Receiving PO reference", g.poRef), action: "Check the receiving record was attached to the right PO.",
      });
    }
  }
  if (po.docDate && invoice.docDate && invoice.docDate < po.docDate) {
    add({
      code: "DATE_ANOMALY", severity: "review", lineKey: "doc:date", title: "Invoice is dated before the purchase order",
      explanation: `Invoice date ${invoice.docDate} precedes PO date ${po.docDate} (${Math.abs(daysBetween(po.docDate, invoice.docDate))} days).`, expected: `≥ ${po.docDate}`, actual: invoice.docDate,
      evidence: [...ev(invoice, "docDate", "Invoice date", invoice.docDate), ...ev(po, "docDate", "PO date", po.docDate)], action: "Check for a date typo or a retroactive PO.",
    });
  }

  /* ---------- duplicates ---------- */
  let exactDuplicate = false;
  if (invoice.supplierName && invoice.docNumber) {
    const sKey = normSupplier(invoice.supplierName);
    const nKey = normDocNumber(invoice.docNumber);
    for (const p of context.priorInvoices) {
      if (!p.supplierName || !p.docNumber || p.documentId === invoice.documentId) continue;
      const sameSupplier = normSupplier(p.supplierName) === sKey || supplierSimilarity(p.supplierName, invoice.supplierName) >= settings.supplierMatchThreshold;
      if (sameSupplier && normDocNumber(p.docNumber) === nKey) {
        exactDuplicate = true;
        add({
          code: "DUPLICATE_INVOICE", severity: "blocking", lineKey: "doc:duplicate", title: `Duplicate of invoice ${p.docNumber} already in the system`,
          explanation: `Invoice number "${invoice.docNumber}" from "${invoice.supplierName}" matches invoice "${p.docNumber}" (bundle ${p.bundleId}) once spacing, case and punctuation are normalised${p.total && invoice.total ? `; totals ${p.total} vs ${invoice.total}` : ""}. Approving would risk paying the same invoice twice.`,
          expected: "unique invoice number", actual: invoice.docNumber, evidence: ev(invoice, "docNumber", "Invoice number", invoice.docNumber),
          action: `Reject as a duplicate of ${p.bundleId} unless the supplier confirms it is a distinct invoice.`,
        });
        break;
      }
    }
    if (!exactDuplicate && invoice.total) {
      const tol = D(settings.totalTolAbs);
      for (const p of context.priorInvoices) {
        if (!p.supplierName || !p.total || p.documentId === invoice.documentId) continue;
        if (supplierSimilarity(p.supplierName, invoice.supplierName) < settings.supplierMatchThreshold) continue;
        if (p.currency && invoice.currency && p.currency !== invoice.currency) continue;
        const t1 = tryD(p.total), t2 = tryD(invoice.total);
        if (!t1 || !t2 || absDiff(t1, t2).gt(tol)) continue;
        if (p.docDate && invoice.docDate && Math.abs(daysBetween(p.docDate, invoice.docDate)) > settings.duplicateWindowDays) continue;
        add({
          code: "POSSIBLE_DUPLICATE", severity: "review", lineKey: "doc:duplicate", title: `Same supplier and amount as invoice ${p.docNumber ?? ""}`,
          explanation: `Invoice "${p.docNumber}" (bundle ${p.bundleId}) is from the same supplier for the same total ${invoice.total} ${cur} within ${settings.duplicateWindowDays} days, but has a different number.`,
          actual: invoice.total, evidence: ev(invoice, "total", "Invoice total", invoice.total), action: "Confirm this is not a re-keyed copy of the earlier invoice.",
        });
        break;
      }
    }
  }

  /* ---------- receipts present? ---------- */
  const hasGrn = grns.length > 0;
  if (!hasGrn) {
    add({
      code: "MISSING_RECEIPT", severity: "blocking", lineKey: "doc:GRN", title: "No receiving record for this PO",
      explanation: "There is no goods-receipt / receiving document for this PO, so it is unknown whether any of the invoiced goods arrived. Three-way match cannot be completed; quantity-vs-receipt checks were skipped.",
      action: "Ask Receiving / Purchasing for the receipt, or confirm the goods were not delivered.",
    });
  }

  /* ---------- line-level matching ---------- */
  const poBySku = new Map<string, { lines: CanonLine[]; qty: Dec; net: Dec; first: CanonLine }>();
  for (const l of po.lines) {
    const key = l.sku ? normSku(l.sku) : l.description ? `DESC:${l.description.toLowerCase().trim()}` : null;
    if (!key) continue;
    const qty = tryD(l.qty) ?? D(0);
    const price = tryD(l.unitPrice) ?? D(0);
    const net = price.mul(D(100).minus(tryD(l.discountPct) ?? 0)).div(100);
    const cur0 = poBySku.get(key);
    if (cur0) { cur0.lines.push(l); cur0.qty = cur0.qty.plus(qty); } else poBySku.set(key, { lines: [l], qty, net, first: l });
  }
  const received = new Map<string, Dec>();
  const receivedEvidence = new Map<string, EvidenceRef[]>();
  for (const g of grns) {
    for (const l of g.lines) {
      const key = l.sku ? normSku(l.sku) : l.description ? `DESC:${l.description.toLowerCase().trim()}` : null;
      if (!key) continue;
      received.set(key, (received.get(key) ?? D(0)).plus(tryD(l.qty) ?? 0));
      receivedEvidence.set(key, [...(receivedEvidence.get(key) ?? []), { documentId: g.documentId, fieldKey: `line.${l.index}.qty`, label: `Received (${g.docNumber ?? "GRN"})`, value: l.qty }]);
    }
  }

  const groups = new Map<string, CanonLine[]>();
  for (const l of invoice.lines) {
    const key = l.sku ? normSku(l.sku) : l.description ? `DESC:${l.description.toLowerCase().trim()}` : `LINE:${l.index}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  const qtyTol = (basis: Dec) => maxD(D(settings.qtyTolAbs), percentOf(basis.abs(), D(settings.qtyTolPct)));
  let lineSumParts: Dec[] = [];
  let lineSumComplete = true;

  for (const [key, ls] of groups) {
    const first = ls[0]!;
    const lineKey = `sku:${key}`;
    const skuLabel = first.sku ?? first.description ?? `line ${first.index}`;
    const entry = poBySku.get(key);
    const invoiced = sum(ls.map((l) => tryD(l.qty) ?? D(0)));
    const codes: ExceptionCode[] = [];
    let invNetFirst: Dec | null = null;

    // ----- per invoice line: arithmetic + price
    for (const l of ls) {
      const q = tryD(l.qty), p = tryD(l.unitPrice), a = tryD(l.amount);
      if (a) lineSumParts.push(a); else lineSumComplete = false;
      if (!q || !p || !a) {
        add({
          code: "MISSING_DATA", severity: "review", lineKey: `line:${l.index}`, title: `Invoice line ${l.index} is missing quantity, price or amount`,
          explanation: `Invoice line ${l.index} (${l.sku ?? l.description ?? "?"}) lacks ${[!q && "quantity", !p && "unit price", !a && "amount"].filter(Boolean).join(", ")}.`,
          evidence: ev(invoice, `line.${l.index}.amount`, "Line amount", l.amount), action: "Complete the missing values from the original document.",
        });
        continue;
      }
      const invNet = p.mul(D(100).minus(tryD(l.discountPct) ?? 0)).div(100);
      if (!invNetFirst) invNetFirst = invNet;
      const expectedAmount = roundMoney(q.mul(invNet), invCur);
      if (absDiff(expectedAmount, a).gt(D(settings.totalTolAbs))) {
        codes.push("LINE_ARITHMETIC");
        add({
          code: "LINE_ARITHMETIC", severity: "review", lineKey: `line:${l.index}`, title: `Line ${l.index}: amount does not equal quantity × price`,
          explanation: `${nz(q)} × ${nz(invNet)}${l.discountPct && !D(l.discountPct).isZero() ? ` (after ${l.discountPct}% discount)` : ""} = ${fixed(expectedAmount, currencyDp(invCur))} ${cur}, but the invoice line says ${fixed(a, currencyDp(invCur))}.`,
          expected: fixed(expectedAmount, currencyDp(invCur)), actual: fixed(a, currencyDp(invCur)), delta: fixed(a.minus(expectedAmount), currencyDp(invCur)), currency: cur,
          evidence: [{ documentId: invoice.documentId, fieldKey: `line.${l.index}.amount`, label: "Line amount", value: l.amount }, { documentId: invoice.documentId, fieldKey: `line.${l.index}.unitPrice`, label: "Unit price", value: l.unitPrice }, { documentId: invoice.documentId, fieldKey: `line.${l.index}.qty`, label: "Quantity", value: l.qty }],
          action: "Check which of quantity, price or amount was misread or mis-typed.",
        });
      }
      // price vs PO
      if (entry && comparable) {
        const rate = fx ?? D(1);
        const invNetConv = invNet.mul(rate);
        const poNet = entry.net;
        const variance = invNetConv.minus(poNet);
        const allowed = maxD(D(settings.priceTolAbs), percentOf(poNet.abs(), D(settings.priceTolPct)));
        if (variance.abs().gt(allowed) && (variance.gt(0) || settings.flagUnderbilling)) {
          codes.push("PRICE_VARIANCE");
          const impact = roundMoney(variance.mul(q), poCur ?? invCur);
          const pct = poNet.isZero() ? null : variance.div(poNet).mul(100);
          add({
            code: "PRICE_VARIANCE", severity: "review", lineKey, title: `${skuLabel}: invoice price ${variance.gt(0) ? "above" : "below"} PO price`,
            explanation: `${skuLabel} is invoiced at ${fixed(invNetConv, 2)} per unit${fx ? ` (converted at ${nz(fx)})` : ""} but the PO price is ${fixed(poNet, 2)}: ${variance.gt(0) ? "+" : ""}${fixed(variance, 2)} per unit${pct ? ` (${pct.gt(0) ? "+" : ""}${fixed(pct, 2)}%)` : ""}, beyond the tolerance of ${fixed(allowed, 2)}. Over ${nz(q)} units that is ${variance.gt(0) ? "an over-charge" : "an under-charge"} of ${fixed(impact.abs(), 2)} ${poCur ?? cur}.`,
            expected: fixed(poNet, 2), actual: fixed(invNetConv, 2), delta: fixed(impact, 2), currency: poCur ?? cur,
            evidence: [{ documentId: invoice.documentId, fieldKey: `line.${l.index}.unitPrice`, label: "Invoice unit price", value: l.unitPrice }, { documentId: po.documentId, fieldKey: `line.${entry.first.index}.unitPrice`, label: "PO unit price", value: entry.first.unitPrice }],
            action: "Purchasing: confirm whether the price changed (amend the PO) or the supplier made an error (request a credit note).",
          });
        }
      }
    }

    // ----- quantity (aggregated per SKU)
    const recv = received.get(key) ?? D(0);
    const prior = exactDuplicate ? D(0) : D(context.priorBilledQty[key] ?? 0);
    const cumulative = prior.plus(invoiced);
    if (!entry) {
      codes.push("UNORDERED_ITEM");
      const amt = sum(ls.map((l) => tryD(l.amount) ?? D(0)));
      add({
        code: "UNORDERED_ITEM", severity: "review", lineKey, title: `${skuLabel} is not on the purchase order`,
        explanation: `The invoice bills ${nz(invoiced)} × ${skuLabel}${first.description ? ` (${first.description})` : ""}, which does not appear on PO ${po.docNumber ?? ""}.`,
        actual: nz(invoiced), delta: fixed(amt, 2), currency: cur, evidence: ev(invoice, `line.${first.index}.sku`, "Invoice SKU", first.sku),
        action: "Purchasing: confirm whether this item was ordered outside the PO.",
      });
    } else {
      const ordered = entry.qty;
      let overReceived = false;
      if (hasGrn) {
        if (recv.isZero()) {
          codes.push("QTY_NOT_RECEIVED");
          add({
            code: "QTY_NOT_RECEIVED", severity: "blocking", lineKey, title: `${skuLabel}: billed but nothing received`,
            explanation: `The invoice bills ${nz(invoiced)} × ${skuLabel}, but no receiving record lists this item.`, expected: "0", actual: nz(invoiced), delta: nz(invoiced),
            evidence: [{ documentId: invoice.documentId, fieldKey: `line.${first.index}.qty`, label: "Invoiced qty", value: first.qty }], action: "Do not pay for this line until receipt is confirmed.",
          });
          overReceived = true;
        } else if (cumulative.gt(recv.plus(qtyTol(recv)))) {
          overReceived = true;
          codes.push("QTY_OVER_RECEIVED");
          const over = cumulative.minus(recv);
          const net = invNetFirst ?? entry.net;
          const money = roundMoney(over.mul(net), invCur);
          add({
            code: "QTY_OVER_RECEIVED", severity: "review", lineKey, title: `${skuLabel}: invoiced ${nz(invoiced)}, received ${nz(recv)}`,
            explanation: `The invoice bills ${nz(invoiced)} × ${skuLabel}${first.description ? ` (${first.description})` : ""}${prior.gt(0) ? ` (plus ${nz(prior)} already billed on earlier invoices)` : ""}, but only ${nz(recv)} ${recv.eq(1) ? "was" : "were"} received (PO ordered ${nz(ordered)}). Quantity billed beyond receipt: ${nz(over)}. At the invoiced price that is ${fixed(money, currencyDp(invCur))} ${cur} billed for goods not yet received.`,
            expected: nz(recv), actual: nz(cumulative), delta: nz(over),
            evidence: [{ documentId: invoice.documentId, fieldKey: `line.${first.index}.qty`, label: "Invoiced qty", value: first.qty }, ...(receivedEvidence.get(key) ?? []), { documentId: po.documentId, fieldKey: `line.${entry.first.index}.qty`, label: "Ordered qty", value: entry.first.qty }],
            action: "Purchasing: check whether the remainder is in transit or short-shipped. Pay only the received quantity, or hold until the rest arrives.",
          });
        }
      }
      if (!overReceived && cumulative.gt(ordered.plus(qtyTol(ordered)))) {
        codes.push("QTY_OVER_ORDERED");
        const over = cumulative.minus(ordered);
        add({
          code: "QTY_OVER_ORDERED", severity: "review", lineKey, title: `${skuLabel}: invoiced ${nz(cumulative)}, ordered ${nz(ordered)}`,
          explanation: `Total billed for ${skuLabel} (${nz(cumulative)}${prior.gt(0) ? `, including ${nz(prior)} on earlier invoices` : ""}) exceeds the quantity on the PO (${nz(ordered)}) by ${nz(over)}.`,
          expected: nz(ordered), actual: nz(cumulative), delta: nz(over),
          evidence: [{ documentId: invoice.documentId, fieldKey: `line.${first.index}.qty`, label: "Invoiced qty", value: first.qty }, { documentId: po.documentId, fieldKey: `line.${entry.first.index}.qty`, label: "Ordered qty", value: entry.first.qty }],
          action: "Purchasing: confirm the PO should be increased, or dispute the excess.",
        });
      }
    }

    lineMatches.push({
      key: lineKey, sku: first.sku, description: first.description, poLine: entry?.first.index ?? null, invLine: first.index,
      ordered: entry ? nz(entry.qty) : null, received: hasGrn ? nz(recv) : null, priorBilled: nz(prior), invoiced: nz(invoiced),
      poNetPrice: entry ? fixed(entry.net, 2) : null, invNetPrice: invNetFirst ? fixed(invNetFirst, 2) : null, invAmount: ls.every((l) => l.amount) ? fixed(sum(ls.map((l) => D(l.amount))), currencyDp(invCur)) : null,
      status: !entry ? "unmatched" : codes.length ? "variance" : "matched", codes,
    });
  }
  if (invoice.lines.length === 0) {
    add({
      code: "MISSING_DATA", severity: "review", lineKey: "doc:lines", title: "No invoice line items were extracted",
      explanation: "The invoice has no readable line items, so quantities and prices could not be matched.", action: "Enter the line items manually or re-upload a clearer copy.",
    });
  }

  /* ---------- totals, tax, freight, discount ---------- */
  const dp = currencyDp(invCur);
  const lineSum = lineSumComplete && lineSumParts.length ? sum(lineSumParts) : null;
  const subtotal = tryD(invoice.subtotal);
  const discount = tryD(invoice.discountTotal) ?? D(0);
  const freight = tryD(invoice.freight) ?? D(0);
  const statedTax = tryD(invoice.taxTotal);
  const statedTotal = tryD(invoice.total);

  if (lineSum && subtotal && absDiff(lineSum, subtotal).gt(D(settings.totalTolAbs))) {
    add({
      code: "TOTAL_ARITHMETIC", severity: "review", lineKey: "total:subtotal", title: "Subtotal does not equal the sum of the lines",
      explanation: `The invoice lines add up to ${fixed(lineSum, dp)} ${cur}, but the subtotal states ${fixed(subtotal, dp)}.`, expected: fixed(lineSum, dp), actual: fixed(subtotal, dp), delta: fixed(subtotal.minus(lineSum), dp), currency: cur,
      evidence: ev(invoice, "subtotal", "Subtotal", invoice.subtotal), action: "Check for a missing/extra line or a misread amount.",
    });
  }
  const base = subtotal ?? lineSum;
  const rateStr = po.taxRate ?? settings.defaultTaxRate;
  const rate = tryD(rateStr) ?? D(0);
  let expectedTax: Dec | null = null;
  if (base) {
    const taxable = base.minus(discount).plus(settings.freightTaxable ? freight : D(0));
    expectedTax = roundMoney(percentOf(taxable, rate), invCur);
    if (statedTax && absDiff(expectedTax, statedTax).gt(D(settings.taxTolAbs))) {
      const statedRate = invoice.taxRate;
      add({
        code: "TAX_MISMATCH", severity: "review", lineKey: "total:tax", title: "Tax differs from the expected amount",
        explanation: `Expected tax is ${fixed(expectedTax, dp)} ${cur} (${nz(rate)}% of ${fixed(taxable, dp)}${po.taxRate ? ", the rate on the PO" : ", the organisation's default rate"}), but the invoice charges ${fixed(statedTax, dp)}${statedRate ? ` (rate printed: ${statedRate}%)` : ""}. Difference: ${fixed(statedTax.minus(expectedTax), dp)} ${cur}, beyond the ${settings.taxTolAbs} tolerance.`,
        expected: fixed(expectedTax, dp), actual: fixed(statedTax, dp), delta: fixed(statedTax.minus(expectedTax), dp), currency: cur,
        evidence: [...ev(invoice, "taxTotal", "Invoice tax", invoice.taxTotal), ...ev(invoice, "taxRate", "Invoice tax rate", invoice.taxRate), ...ev(po, "taxRate", "PO tax rate", po.taxRate)],
        action: "Clerk: confirm the tax jurisdiction/rate; request a corrected invoice if the supplier over/under-charged.",
      });
    }
  }
  if (base && statedTax && statedTotal) {
    const expectedTotal = base.minus(discount).plus(freight).plus(statedTax);
    if (absDiff(expectedTotal, statedTotal).gt(D(settings.totalTolAbs))) {
      add({
        code: "TOTAL_ARITHMETIC", severity: "review", lineKey: "total:total", title: "Invoice total does not add up",
        explanation: `Subtotal ${fixed(base, dp)} − discount ${fixed(discount, dp)} + freight ${fixed(freight, dp)} + tax ${fixed(statedTax, dp)} = ${fixed(expectedTotal, dp)} ${cur}, but the invoice total says ${fixed(statedTotal, dp)} — a difference of ${fixed(statedTotal.minus(expectedTotal), dp)}.`,
        expected: fixed(expectedTotal, dp), actual: fixed(statedTotal, dp), delta: fixed(statedTotal.minus(expectedTotal), dp), currency: cur,
        evidence: ev(invoice, "total", "Invoice total", invoice.total), action: "Clerk: verify the printed total against the components; request a corrected invoice if the supplier's arithmetic is wrong.",
      });
    }
  }
  if (!statedTotal) {
    add({ code: "MISSING_DATA", severity: "review", lineKey: "total:total", title: "Invoice total not found", explanation: "No readable invoice total, so the document cannot be reconciled.", action: "Enter the total from the original document.", evidence: ev(invoice, "total", "Invoice total", null) });
  }
  if (comparable) {
    const poFreight = tryD(po.freight) ?? D(0);
    const invFreightConv = freight.mul(fx ?? D(1));
    if (invFreightConv.minus(poFreight).gt(D(settings.freightAllowAbs))) {
      add({
        code: "FREIGHT_NOT_AUTHORIZED", severity: "review", lineKey: "total:freight", title: "Freight charged beyond what the PO authorises",
        explanation: `The invoice charges freight of ${fixed(freight, dp)} ${cur}; the PO authorises ${fixed(poFreight, 2)} (allowance ${settings.freightAllowAbs}). Excess: ${fixed(invFreightConv.minus(poFreight), 2)}.`,
        expected: fixed(poFreight, 2), actual: fixed(invFreightConv, 2), delta: fixed(invFreightConv.minus(poFreight), 2), currency: poCur ?? cur,
        evidence: [...ev(invoice, "freight", "Invoice freight", invoice.freight), ...ev(po, "freight", "PO freight", po.freight)], action: "Purchasing: confirm the freight terms.",
      });
    }
    const poDisc = tryD(po.discountTotal) ?? D(0);
    if (poDisc.gt(0) && discount.mul(fx ?? D(1)).lt(poDisc.minus(D(settings.totalTolAbs)))) {
      add({
        code: "DISCOUNT_NOT_APPLIED", severity: "review", lineKey: "total:discount", title: "Agreed discount missing from the invoice",
        explanation: `The PO carries a ${fixed(poDisc, 2)} discount; the invoice shows ${fixed(discount, 2)}. The supplier may not have honoured the agreed terms.`,
        expected: fixed(poDisc, 2), actual: fixed(discount, 2), delta: fixed(discount.minus(poDisc), 2), currency: cur,
        evidence: [...ev(invoice, "discountTotal", "Invoice discount", invoice.discountTotal), ...ev(po, "discountTotal", "PO discount", po.discountTotal)], action: "Request a corrected invoice or credit note.",
      });
    }
  }

  const expectedTotalForResult = base && statedTax ? base.minus(discount).plus(freight).plus(statedTax) : null;
  return finish(settings, invCur, lineMatches, ex, {
    lineSum: lineSum ? fixed(lineSum, dp) : null, expectedTax: expectedTax ? fixed(expectedTax, dp) : null,
    expectedTotal: expectedTotalForResult ? fixed(expectedTotalForResult, dp) : null, taxRateUsed: nz(rate), fxRate: fx ? nz(fx) : null,
  }, invoice);
}

function labelOf(doc: CanonDoc): string {
  return doc.docType === "PO" ? "purchase order" : doc.docType === "GRN" ? "receiving record" : "invoice";
}

function findRate(settings: Settings, from: string, to: string): Dec | null {
  const direct = settings.fxRates.filter((r) => r.from === from && r.to === to).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  if (direct) return D(direct.rate);
  const inverse = settings.fxRates.filter((r) => r.from === to && r.to === from).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  if (inverse && !D(inverse.rate).isZero()) return D(1).div(D(inverse.rate));
  return null;
}

const SEV_ORDER: Record<Severity, number> = { blocking: 0, review: 1, info: 2 };

function finish(settings: Settings, currency: string | null, lines: LineMatch[], exceptions: ExceptionItem[], computed: MatchResult["computed"], invoice: CanonDoc): MatchResult {
  const sorted = [...exceptions].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.fingerprint.localeCompare(b.fingerprint));
  // fingerprints must be unique: if the same code+lineKey repeats, suffix deterministically
  const seen = new Map<string, number>();
  for (const e of sorted) {
    const n = (seen.get(e.fingerprint) ?? 0) + 1;
    seen.set(e.fingerprint, n);
    if (n > 1) e.fingerprint = `${e.fingerprint}#${n}`;
  }
  const blocking = sorted.filter((e) => e.severity === "blocking").length;
  const review = sorted.filter((e) => e.severity === "review").length;
  const recommendation: Recommendation = blocking ? "HOLD" : review ? "EXCEPTION_REVIEW" : "READY_FOR_APPROVAL";
  const summary =
    recommendation === "READY_FOR_APPROVAL"
      ? `All ${lines.length} invoice line(s) match the PO and receipts within tolerance; totals and tax reconcile. Ready for human approval (nothing is paid by this system).`
      : `${blocking} blocking and ${review} review exception(s) found. ${recommendation === "HOLD" ? "Hold — do not approve until blocking items are cleared." : "Resolve the exceptions before approval."}`;
  void invoice;
  return { engineVersion: ENGINE_VERSION, settingsHash: settingsHash(settings), currency, lines, exceptions: sorted, computed, recommendation, summary };
}
