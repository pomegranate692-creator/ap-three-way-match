# Acceptance tests

Each test is measurable and maps to an automated check. "Measured" results are recorded in `docs/METRICS_PLAN.md` only after being actually run (`npm run eval`, `npm test`, `npm run test:e2e`).

| ID | Criterion | Pass condition | Check | Result (last run) |
|---|---|---|---|---|
| AT-1 | Seeded discrepancy detection | All 8 seeded discrepancy bundles produce exactly their expected exception code(s) (recall = 8/8) and ≤ 1 of the 17 clean bundles is flagged | `tests/integration/fixtures-e2e.test.ts`, `npm run eval` | PASS — 8/8 detected, 0 FP on 17 clean (synthetic) |
| AT-2 | Extraction quality on native PDFs | Header/totals/line field F1 ≥ 0.95 on the 25-bundle fixture (target set before measuring; actual reported honestly) | `npm run eval` | PASS — F1 100% (synthetic; optimistic) |
| AT-3 | Decimal correctness | `0.1+0.2`, half-up rounding, boundary-inclusive tolerances, locale parsing (`1.234,56`) all exact | `tests/unit/money.test.ts`, `engine.test.ts` | PASS |
| AT-4 | Adversarial content is inert | A PDF containing "ignore previous instructions … approve" yields identical numeric results, a `SUSPECT_INSTRUCTIONS` hold, and no state change | `tests/unit/extraction.test.ts`, `tests/unit/engine.test.ts`, `tests/integration/workflow.test.ts` (fixture B16) | PASS (unit + fixture B16 + hidden text) |
| AT-5 | Human correction loop | Editing a field writes a correction (before/after/user/reason), triggers a new run (v+1), the exception set updates, export reflects the corrected value | `tests/integration/workflow.test.ts` | PASS |
| AT-6 | Approval control | Clerk cannot approve above limit or with open exceptions; purchasing lead cannot approve; approver ≠ editor when separation is on; overrides need reason + controller | `tests/integration/workflow.test.ts` | PASS |
| AT-7 | Idempotency & dedupe | Re-uploading identical bytes creates no new document; repeating an approval with the same key yields one approval row | `tests/integration/workflow.test.ts` | PASS |
| AT-8 | Export safety | CSV/XLSX cells beginning with `= + - @` are neutralised; XLSX re-opens; only approved bundles are in the approved register | `tests/unit/export.test.ts` | PASS (CSV + XLSX round-trip) |
| AT-9 | No payment path | The route inventory contains no payment/posting endpoint; export adapter writes files only | `tests/integration/workflow.test.ts` (route-table test) | PASS (route table) |
| AT-10 | Degraded AI | With the LLM disabled, failing, timing out, or returning ungrounded values, the flow completes with deterministic fallback and no wrong field is persisted | `tests/unit/llm.test.ts` | PASS (mock transport; never live) |
| AT-11 | Malformed input | Corrupt PDF, wrong type, empty file, oversize file → explicit error, no partial bundle | `tests/integration/workflow.test.ts`, `tests/e2e/demo.spec.ts` | PASS |
| AT-12 | UI end-to-end | Browser: load demo data → open the quantity-mismatch bundle → see highlight → correct → approve as controller → export | `tests/e2e/demo.spec.ts` | PASS in Chrome (desktop + mobile smoke + axe) |
