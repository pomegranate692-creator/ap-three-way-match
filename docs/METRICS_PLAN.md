# Metrics plan

**Status legend:** `MEASURED` = produced by running code in this repo (reproduce with the command shown) · `ESTIMATED` = reasoned, not measured · `UNTESTED` = placeholder, no data yet.

> All MEASURED values below come from **synthetic, self-authored fixtures**: the same team wrote the document generator and the extractor. They are an optimistic ceiling and say nothing reliable about real-world accuracy. The honest next step is to run the same harness on real, unseen supplier documents (with permission).

## 1. Measured on the 25-bundle synthetic set (`npm run eval`, results in `docs/results/eval-results.json`)
| KPI | Definition | Result | Status |
|---|---|---|---|
| Document-type accuracy | PO/receipt/invoice detected correctly | 72/72 = 100% | MEASURED (synthetic) |
| **Field extraction F1** | Per-field value equality vs generator gold (header + totals + line fields); wrong value counts as FP and FN | 100.0% overall (header 100.0%, line fields 100.0%) | MEASURED (synthetic) |
| **Line-item match accuracy** | Gold lines whose SKU, qty, price and amount (receipt: SKU, qty) were all extracted correctly | 162/162 = 100% | MEASURED (synthetic) |
| **Exception precision / recall** (bundle level) | Flagged vs seeded: 8 seeded discrepancies, 17 clean | precision 100%, recall 100% (TP 8 · FP 0 · FN 0 · TN 17) | MEASURED (synthetic) |
| Exact exception code | Produced code set equals intended code set | 25/25 | MEASURED (synthetic) |
| Baseline B0 — *total-only compare* | Flag when invoice total ≠ PO total | precision 50%, recall 50%, F1 50% | MEASURED (synthetic) |
| Baseline B1 — *zero-tolerance line compare* | Flag any qty/price difference or qty > received; no tax/currency/duplicate logic | precision 80%, recall 50%, F1 61.5% | MEASURED (synthetic) |
| Latency, PDF → fields (per invoice, warm) | `analyzePdf` wall time, 50 runs on this laptop | median 1.7 ms · p95 2.3 ms | MEASURED (this machine, tiny 1-page PDFs) |
| Test suite | `npm test` (unit + integration) / `npm run test:e2e` (browser) | 112 passed / 4 passed | MEASURED |

Why B0/B1: they are the transparent "simple deterministic alternatives" a spreadsheet user would apply. They fail in specific, explainable ways — B0 cannot see over-billing that preserves the PO total and false-flags every partial receipt; B1 cannot see tax, currency, duplicates or injected text.

## 2. Not yet measured (placeholders)
| KPI | Method to measure | Value |
|---|---|---|
| **Human correction time** | Instrument the review screen (time from opening a bundle to approve/reject) over N real clerks × M bundles; report median and IQR; compare with §3 | `[UNTESTED]` |
| Manual baseline time-on-task | Time-and-motion on the manual three-document comparison (≥ 10 bundles per clerk, ≥ 3 clerks) | `[UNTESTED]` (PRD guess of 8–15 min/bundle is an ESTIMATE, not data) |
| Error rate with app vs manual | Seed known errors into a blinded set; count missed/false flags per condition | `[UNTESTED]` |
| Correction rate on real documents | corrections ÷ extracted fields (the app already stores both; `GET /api/stats`) | `[UNTESTED]` (synthetic demo value is 0 until someone edits) |
| End-to-end completion rate | share of bundles reaching approved/rejected without developer help | `[UNTESTED]` |
| Reliability | uptime/error rate over a real pilot | `[UNTESTED]` |
| Cost per run | tokens × price if the Claude adapters are enabled; deterministic path costs no API fees | `[UNTESTED]` — adapters never run live here |
| User satisfaction | SUS or 5-point post-task survey | `[UNTESTED]` |
| Accuracy on scanned / handwritten / unseen layouts | run `npm run eval` against a real, labelled set | `[UNTESTED]` — OCR not built |

## 3. Measurement protocol (for the untested items)
1. **Sample**: ≥ 30 real bundles (de-identified) incl. partial receipts, discounts, multi-currency; hold out ≥ 10 never used while tuning rules.
2. **Gold**: two people label fields independently; resolve disagreements; store as `fixtures/real-gold.json` (kept private).
3. **Accuracy**: extend `server/eval/*` with the real set; report F1 with per-supplier breakdown and 95% bootstrap intervals.
4. **Time**: A/B within-subject, order counterbalanced: manual (spreadsheet) vs app; stopwatch from "open PDFs" to "decision recorded".
5. **Errors**: seed ≥ 10 known discrepancies into a blinded pool; compare misses and false alarms.
6. **Cost/latency**: if the LLM adapter is enabled, log tokens and wall time per call (client already counts calls) and report per bundle.
7. Record date, commit, machine, fixture hash for every reported number.

## 4. Known threats to validity
Self-authored fixtures; three layout families only; native-text PDFs only; one-page documents; the extractor's label vocabulary was written knowing the fixtures; no real users yet.
