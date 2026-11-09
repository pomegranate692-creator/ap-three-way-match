# Synthetic fixtures

**Everything here is fictional** — organisations, suppliers, people, tax IDs, addresses and the "IBAN" in bundle 16. Regenerate deterministically with `npm run fixtures` (`scripts/generate-fixtures.ts`); `manifest.json` holds the generator's gold values and the intended exception codes.

- 25 bundles · 74 PDFs · 3 organisations (Harbor & Pine Hardware, Cobalt Bay Foods, Meridian Labs GmbH) · 9 suppliers · 3 layout families (A US grid, B compact stacked, C German/EU number+date formats, EUR).
- **17 clean** bundles include: full receipt, partial receipt billed as received, split shipment (two receipt lines per SKU), line discount, header volume discount, authorised freight, fractional quantities (kg), price inside tolerance (+0.38%), EUR with comma decimals.
- **8 seeded discrepancies:** B05 quantity (billed 100 / received 80) · B06 price +8% · B08 tax at 9.25% instead of 8.25% · B12 no receiving record · B14 stated total +$90.00 · B16 embedded instructions + hidden text · B20 PO in EUR but invoice in USD · B25 re-sent copy of B11's invoice (same PO and receipt bytes, new file, number formatted `INV 49507` vs `INV-49507`).
- Bundle 25 intentionally reuses bundle 11's PO/receipt files byte-for-byte, exercising file-hash dedupe.
- Not covered by files (tested in code instead): OCR noise / low-confidence words (`tests/unit/extraction.test.ts`), corrupt/empty/image uploads (`tests/integration/workflow.test.ts`).
- Limits: native-text, one-page PDFs, written by the same team as the extractor → metrics on this set are an optimistic ceiling.
