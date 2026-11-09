# Data contracts

Source of truth: `shared/schemas.ts` (Zod). Types are inferred from it; the API and the engine validate against it. **Money, quantities, percentages and tolerances are decimal strings at every boundary** (`"4086.44"`, never a JSON number).

## 1. Text layer (parser → extractor)
```ts
TextLayer { source: "pdf-text" | "ocr"; pages: { page, width, height, words: Word[] }[] }
Word      { id: "p1w17", text, bbox: BBox, size, conf: 0..1, run?: number }
BBox      { page, x, y, w, h }          // normalised 0..1, origin top-left
```
`conf` is 1.0 for native PDF text; an OCR engine would supply per-word confidence (adapter boundary — no OCR in this build).

## 2. Extracted field (extractor → grounding validator → DB)
```ts
ExtractedField { key, value: string|null, raw, bbox: BBox|null, wordIds: string[], confidence: 0..1, reason, extractor }
```
Keys: `docNumber poRef supplierName supplierTaxId currency docDate taxRate subtotal discountTotal freight taxTotal total` and `line.<n>.{sku,description,qty,uom,unitPrice,discountPct,amount,date}`.
**Grounding rule:** accepted only if every `wordId` exists, `raw` equals the cited words, and `value` is re-derivable from `raw` by deterministic parsers (`server/extract/grounding.ts`).

## 3. Canonical document (DB → engine)
`CanonDoc { documentId, docType, docNumber, poRef, supplierName, supplierTaxId, currency, docDate, taxRate, subtotal, discountTotal, freight, taxTotal, total, lines: CanonLine[], lowConfidence[], riskFlags[] }` — built by `toCanonical()` from stored fields **with human corrections applied**.

## 4. Match result (engine → DB/UI)
```ts
MatchResult { engineVersion, settingsHash, currency, lines: LineMatch[], exceptions: ExceptionItem[],
              computed { lineSum, expectedTax, expectedTotal, taxRateUsed, fxRate }, recommendation, summary }
ExceptionItem { fingerprint "CODE|lineKey", code, severity: blocking|review|info, lineKey, title, explanation,
                expected, actual, delta (actual − expected), currency (set ⇒ money, null ⇒ quantity),
                evidence: { documentId, fieldKey, label, value }[], suggestedAction, ownerRole }
Recommendation = READY_FOR_APPROVAL | EXCEPTION_REVIEW | HOLD          // never "PAY"
```
Exception codes: `MISSING_RECEIPT QTY_NOT_RECEIVED QTY_OVER_RECEIVED QTY_OVER_ORDERED PRICE_VARIANCE UNORDERED_ITEM TAX_MISMATCH TOTAL_ARITHMETIC LINE_ARITHMETIC CURRENCY_MISMATCH CURRENCY_CONVERTED SUPPLIER_MISMATCH PO_REF_MISMATCH PO_REF_MISSING DUPLICATE_INVOICE POSSIBLE_DUPLICATE FREIGHT_NOT_AUTHORIZED DISCOUNT_NOT_APPLIED DATE_ANOMALY LOW_CONFIDENCE SUSPECT_INSTRUCTIONS MISSING_DATA`.
Recommendation rule: any blocking ⇒ HOLD; else any review ⇒ EXCEPTION_REVIEW; else READY.

## 5. Settings (per organisation)
Tolerances (`qtyTolPct/Abs`, `priceTolPct/Abs`, `taxTolAbs`, `totalTolAbs`, `freightAllowAbs`) are inclusive; the larger of abs/pct applies. Policies: `currencyPolicy strict|convert`, dated `fxRates`, `defaultTaxRate`, `freightTaxable`, `duplicateWindowDays`, `confidenceThreshold`, `supplierMatchThreshold`, `clerkApprovalLimit`, `requireSeparateApprover`, `dateOrder`, `numberLocale`, `llm.{extraction,explanation}`.

## 6. Persistence (SQLite, `server/db.ts`)
| Table | Purpose |
|---|---|
| `organizations`, `users`, `settings` | Tenants, demo identities (role: clerk/controller/purchasing), per-org settings JSON |
| `documents` | One row per unique file (`UNIQUE(org_id, sha256)`), text layer, risk flags, extractors, provenance (`source`, `uploaded_by`, `created_at`) |
| `fields` | Extracted values + provenance; `corrected`, `original_value`, `updated_by` |
| `bundles`, `bundle_docs` | Bundle = invoice + its PO + receipt(s); a PO/receipt may belong to several bundles |
| `runs` | Immutable match results, versioned per bundle, with `input_hash` (idempotent re-runs) |
| `exceptions` | Current exception set; status `open/resolved/waived/overridden`; carried across runs by fingerprint while evidence is unchanged |
| `decisions` | Agent decisions: classification, extraction, recommendation, explanation — actor, model, input hash, output |
| `approvals` | Proposal (engine recommendation) → human decision (who/role/when/reason) → execution (`executed_at`, `execution_ref` = export id) |
| `corrections` | Before/after/reason/user for every human edit |
| `exports` | Files produced (hash, filename, bundle ids) |
| `idempotency` | `(scope,key) → response` for approvals and exports |
| `audit_events` | Append-only: actor (human/system/agent), action, entity, before/after JSON, note |

Time: audit/system timestamps are UTC ISO-8601; document dates are date-only strings (no timezone is invented); the UI renders audit times in the organisation's IANA zone.

## 7. State machine (bundle)
`incomplete → matched ⇄ held`; `matched → approved → exported`; `matched|held → rejected`; any change to data after `approved/exported` supersedes the approval and returns to `matched`; `reopen` returns `held/rejected/approved/exported → matched` (approved ones: Controller only).

## 8. HTTP API (all JSON; `x-org-id` + `x-user-id` demo identity)
`GET /api/{health,meta,orgs,stats,bundles,bundles/:id,exceptions,audit,settings,exports,data-export}` · `POST /api/upload` (multipart) · `PUT /api/documents/:id/fields/:key` · `POST /api/exceptions/:id/resolve` · `POST /api/bundles/:id/{decision,rematch,ai-summary}` · `PUT /api/settings` · `POST /api/exports` (preview or create; `Idempotency-Key`) · `GET /api/exports/:id/download` · `POST /api/demo/{load,reset}` · `DELETE /api/bundles/:id` · `DELETE /api/data`. **There is no payment, posting, email or ledger route** (asserted by test AT-9).
