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

## 1b. SYNTHETIC STRESS TEST: OCR on degraded phone-style photos (`npm run eval:stress`, results in `docs/results/stress-results.json`)
**Kept separate from §1 (clean synthetic PDFs) and from any future real-document results. This is not real-world accuracy.** 10 invoices from fictional vendors, drawn with layouts, fonts, label wording, date formats and currency placements that are not in the 25-bundle fixtures (`fixtures/stress/`, generator `scripts/make-stress-fixtures.mjs`), then degraded like phone photos (rotation, skew, uneven lighting and a cast shadow, blur, low resolution, sensor noise, JPEG compression). Ground truth is computed from the source numbers, not read from the images. Every expected field is scored exactly one way: **correct**, **wrong** (a different value was read) or **missed** (nothing read); a value read where the truth is "absent" is **spurious**. A read counts as *confident* when the extractor's own confidence is at or above 0.8, the app's review threshold.

| Damage level (docs) | Fields expected | Correct | Wrong | Missed | Spurious | Wrong or spurious at conf ≥ 0.8 | Mean OCR word conf. |
|---|---|---|---|---|---|---|---|
| Light (3): ≤ 0.8° rotation, blur 0.5 px, 85% scale, JPEG q80 | 94 | 39 (41.5%) | 2 | 53 | 0 | 1 | 0.74 |
| Medium (4): ≤ 2° rotation, blur 1.0 px, 60% scale, shadow, JPEG q60 | 164 | 7 (4.3%) | 1 | 156 | 0 | 0 | 0.49 |
| Heavy (3): ≤ 4° rotation, blur 1.4 px, 50% scale, strong shadow, desk background, JPEG q40 | 137 | 0 (0.0%) | 0 | 137 | 0 | 0 | 0.27 |
| **All (10)** | **395** | **46 (11.6%)** | **3** | **346** | **0** | **1** | |

Key fields only (invoice number, date, currency, subtotal, tax, total; line SKU, quantity, unit price, amount): 31 of 276 correct (11.2%), 0 wrong, 245 missed, 0 confident errors. Light 28/66, medium 3/108, heavy 0/102. Document type was recognised from the page text in 6 of 10; the other 4 (S05 and all three heavy scans) fell back to INVOICE after a "could not be determined" warning, so they do not count as read. 11 of the 46 correct values were themselves marked below 0.8 (a human would be asked to check them).

What the numbers say, and what they do not:
- **The failure mode is "read nothing", not "read the wrong thing".** Only 3 wrong values in 395 expected fields. The single confident error (conf 0.81) is a vendor name cut to its first word ("Saltmarsh"); the other two are a stray `~~` read as a PO number (conf 0.24) and an address line taken as the vendor name (conf 0.71).
- **The OCR step is the bottleneck.** On the medium-damage sample inspected, Tesseract's page layout analysis returned fragments (skew, shadow gradient and desk background defeat its built-in thresholding), so the extractor never saw the table. A parameter sweep (scratch script, not kept) over page-segmentation modes and Sauvola thresholding helped little: medium best 13/164 correct, heavy 0/137 in every setting; sparse-text mode lifted light from 39 to 50 correct but raised wrong reads from 2 to 7 (4 of them confident), so it was not adopted. Real gains probably need image preprocessing (grayscale, adaptive normalisation, deskew, upscaling), which the app does not do yet. This is a diagnosis from 2 inspected documents and a small sweep, not a measured fix.
- **Light damage is also weak.** In S01 (clean, readable photo) the ruled table borders were read as `|` characters and the header row and several columns were lost, and `Invoice #` was read as `Invoice &`, so the invoice number was missed. The extractor's label vocabulary was written alongside the original fixtures; no extractor changes were made to fit this set.
- **Caveats.** 10 documents, one layout each; damage severity was chosen by the author before OCR was run (heavy was eased once, before any OCR number existed); the same author wrote the generator and the scorer. Tesseract was left at its defaults. Header locale hints (number format, day/month order) are supplied per document, as an organisation setting would supply them.
- **One fix came out of this run:** the "hidden text" risk flag fired on 3 of the 10 scans because OCR noise produces tiny word boxes. It now applies only to PDF text layers (test `tests/unit/injection-ocr.test.ts`). It changed no field results.

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
| Accuracy on scanned / handwritten / unseen layouts | run `npm run eval` against a real, labelled set | Scanned: one run on 5 synthetic scans (4 clean ~220 dpi, 1 deliberately poor ~90 dpi), 107 ground-truth fields from the same documents' PDF text: 87 read correctly, 5 wrong, 15 missing; all 5 wrong reads carried confidence below the 0.8 review threshold (none confidently wrong); document type right 5/5. Rendered by the same project, so an optimistic bound. Handwritten, real-world scans and unseen layouts `[UNTESTED]` |

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
