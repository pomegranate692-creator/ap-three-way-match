import { analyzePdf } from "../pipeline/analyze.ts";
import { toCanonical } from "../extract/canonical.ts";
import { matchBundle, type PriorInvoice } from "../engine/match.ts";
import { fixtureBytes, loadManifest } from "./extraction.ts";
import { SettingsSchema, type CanonDoc, type DocType, type MatchResult } from "../../shared/schemas.ts";
import { D, tryD, sum } from "../../shared/money.ts";
import { normSku } from "../../shared/normalize.ts";

export interface BundleEval {
  id: string; title: string; expected: string[]; got: string[]; exactCodes: boolean; flaggedByEngine: boolean; seeded: boolean;
  baselineTotalOnly: boolean; baselineStrictLines: boolean; recommendation: string; expectedRecommendation: string; result: MatchResult; extraCodes: string[]; missedCodes: string[];
}

/** B0: header-only two-way compare — flag when invoice total ≠ PO total. Ignores receipts, tolerances, tax, duplicates. */
function baselineTotalOnly(po: CanonDoc, inv: CanonDoc): boolean {
  const a = tryD(po.total), b = tryD(inv.total);
  return !a || !b || !a.eq(b);
}
/** B1: strict line compare, zero tolerance — flag if any invoice line qty/price ≠ PO or qty > received (no tax/currency/duplicate logic). */
function baselineStrictLines(po: CanonDoc, grns: CanonDoc[], inv: CanonDoc): boolean {
  const received = new Map<string, ReturnType<typeof D>>();
  for (const g of grns) for (const l of g.lines) received.set(normSku(l.sku ?? ""), (received.get(normSku(l.sku ?? "")) ?? D(0)).plus(l.qty ?? 0));
  for (const l of inv.lines) {
    const pl = po.lines.find((x) => normSku(x.sku ?? "") === normSku(l.sku ?? ""));
    if (!pl) return true;
    if (!tryD(l.unitPrice) || !tryD(pl.unitPrice) || !D(l.unitPrice).eq(D(pl.unitPrice))) return true;
    const rec = received.get(normSku(l.sku ?? ""));
    if (grns.length && (!rec || D(l.qty).gt(rec))) return true;
    if (!grns.length) return true; // cannot confirm receipt
    if (!tryD(l.qty) || !tryD(pl.qty) || D(l.qty).gt(D(pl.qty))) return true;
  }
  return false;
}

export async function evaluateMatching() {
  const m = loadManifest();
  const out: BundleEval[] = [];
  const priorByOrg = new Map<string, PriorInvoice[]>();
  const docCache = new Map<string, CanonDoc>();

  for (const b of m.bundles) {
    const org = m.orgs.find((o) => o.id === b.orgId)!;
    const settings = SettingsSchema.parse(org.settings);
    const canon = async (file: string | undefined, docType: DocType): Promise<CanonDoc | null> => {
      if (!file) return null;
      const key = `${file}`;
      const hit = docCache.get(key);
      if (hit) return hit;
      const a = await analyzePdf(fixtureBytes(file), { numberLocale: settings.numberLocale, dateOrder: settings.dateOrder, docTypeHint: docType });
      const c = toCanonical({ documentId: `doc:${file}`, docType, fields: a.extraction.fields, riskFlags: a.riskFlags, confidenceThreshold: settings.confidenceThreshold });
      docCache.set(key, c);
      return c;
    };
    const po = await canon(b.files.po, "PO");
    const grn = await canon(b.files.grn, "GRN");
    const inv = (await canon(b.files.invoice, "INVOICE"))!;
    const prior = priorByOrg.get(org.id) ?? [];
    const result = matchBundle({ po, grns: grn ? [grn] : [], invoice: inv, settings, context: { priorInvoices: prior, priorBilledQty: {} } });
    prior.push({ bundleId: b.id, documentId: inv.documentId, supplierName: inv.supplierName, docNumber: inv.docNumber, total: inv.total, currency: inv.currency, docDate: inv.docDate });
    priorByOrg.set(org.id, prior);

    const got: string[] = [...new Set(result.exceptions.filter((e) => e.severity !== "info").map((e) => e.code as string))].sort();
    const expected = [...b.expectedExceptions].sort();
    out.push({
      id: b.id, title: b.title, expected, got, exactCodes: JSON.stringify(got) === JSON.stringify(expected), flaggedByEngine: got.length > 0, seeded: expected.length > 0,
      baselineTotalOnly: po ? baselineTotalOnly(po, inv) : true, baselineStrictLines: po ? baselineStrictLines(po, grn ? [grn] : [], inv) : true,
      recommendation: result.recommendation, expectedRecommendation: b.expectedRecommendation, result,
      extraCodes: got.filter((c) => !expected.includes(c)), missedCodes: expected.filter((c) => !(got as string[]).includes(c)),
    });
  }

  const det = (flag: (e: BundleEval) => boolean) => {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const e of out) {
      const f = flag(e);
      if (e.seeded && f) tp++; else if (!e.seeded && f) fp++; else if (e.seeded && !f) fn++; else tn++;
    }
    const precision = tp + fp ? tp / (tp + fp) : 1, recall = tp + fn ? tp / (tp + fn) : 1;
    return { tp, fp, fn, tn, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
  };
  void sum;
  return {
    bundles: out.length,
    seeded: out.filter((e) => e.seeded).length,
    clean: out.filter((e) => !e.seeded).length,
    engine: det((e) => e.flaggedByEngine),
    baselineTotalOnly: det((e) => e.baselineTotalOnly),
    baselineStrictLines: det((e) => e.baselineStrictLines),
    exactCodeMatches: out.filter((e) => e.exactCodes).length,
    recommendationMatches: out.filter((e) => e.recommendation === e.expectedRecommendation).length,
    details: out,
  };
}
