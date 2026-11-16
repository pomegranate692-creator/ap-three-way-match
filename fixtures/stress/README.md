# Synthetic stress-test set (OCR)

**SYNTHETIC. Not real documents and not real-world accuracy.** Ten invoices from fictional vendors (any resemblance to real companies is accidental), each with a different layout, font, label wording, date format and currency placement; some have extra line items, notes, a line discount, an order-level discount, freight, or bank details. Each is degraded like a phone photo.

| Level | Files | Rotation (max) | Blur | Scale | Lighting / shadow | JPEG |
|---|---|---|---|---|---|---|
| light | S01–S03 | 0.8° | 0.5 px | 85% | mild gradient | q80 |
| medium | S04–S07 | 2° | 1.0 px | 60% | gradient + cast shadow | q60 |
| heavy | S08–S10 | 4° | 1.4 px | 50% | strong gradient + shadow, desk background | q40 |

Exact per-image parameters (rotation, skew, noise) are in `ground_truth.json`, which also holds the true field values, computed from the source numbers in `scripts/stress/specs.mjs` (never read from the images) and the number/date hints an organisation setting would supply.

- Regenerate (deterministic): `node scripts/make-stress-fixtures.mjs`. It uses `@napi-rs/canvas`, which is installed as a dependency of `pdfjs-dist` but is not declared in `package.json`; the committed images mean nobody needs to regenerate.
- Evaluate: `npm run eval:stress` (needs the cached OCR language data in `data/ocr/`). Results: `docs/results/stress-results.json`; interpretation: `docs/METRICS_PLAN.md` §1b.
