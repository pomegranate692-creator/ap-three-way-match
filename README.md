# AP Document Intelligence & Three-Way Match

A local-first web app that checks **purchase order ↔ receiving record ↔ invoice** before anyone pays. It reads the PDFs, shows *exactly where on the original page* each number came from, recomputes everything with decimal maths, explains every mismatch, and routes it to the right person for a recorded decision.

> **Synthetic data only. It never pays, posts or sends anything.** Every company, person and document in the demo is fictional.

<video src="https://github.com/pomegranate692-creator/ap-three-way-match/raw/main/demos/ap-three-way-match-demo.mp4" controls muted playsinline width="760"></video>

85-second captioned demo (no audio). If the player does not load, [open the video file directly](https://github.com/pomegranate692-creator/ap-three-way-match/raw/main/demos/ap-three-way-match-demo.mp4) · [Read the short case study](docs/CASE_STUDY.md)

![Quantity mismatch with source highlight](screenshots/05-source-highlight.png)

## What it does
- **Upload + preview** PDFs; auto-detect PO / receiving record / invoice; group by PO number (any arrival order).
- **Field-level provenance**: click any value → yellow box on the original PDF, printed text, confidence and the reason for it.
- **Deterministic three-way match** per line: ordered vs received vs billed, net price vs PO price, split shipments, partial receipts, line + header discounts, freight, tax recomputation (half-up), multi-currency policy, duplicate invoices, supplier/PO reference checks.
- **Exception queue** with plain explanations, expected/actual/difference, evidence chips, suggested action and owner role.
- **Human in the loop**: correct a field (reason required) → automatic re-match as a new run; accept/resolve/override exceptions with a note; role, amount-limit and separation-of-duties gates; approval is superseded if data changes later.
- **Export** approved register or exception record as CSV/XLSX with preview; formula-injection-safe.
- **Audit log** of every proposal → decision → execution; JSON export and deletion of all data.
- Onboarding, empty/loading/error states, keyboard operable, responsive to phone width, light/dark.

| | |
|---|---|
| ![Inbox](screenshots/03-inbox.png) | ![Exception](screenshots/06-exception-card.png) |
| ![Audit](screenshots/10-audit-log.png) | ![Mobile](screenshots/13-mobile-review.png) |

## Run it
Requires Node ≥ 22.13 (tested on 24.19).
```bash
npm install
npm run build && npm start        # → http://127.0.0.1:8791
```
Then follow the 3-step tour, or see [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Development: `npm run dev`. Preload everything from the CLI: `npm run seed -- --reset`.

```bash
npm run check        # typecheck + 112 unit/integration tests
npm run test:e2e     # 6 Playwright tests in real Chrome (builds + serves on :8793; uses its own data/e2e/ folder, never your demo data)
npm run eval         # extraction / matching metrics + baselines on the 25 fixtures
npm run fixtures     # regenerate the synthetic PDFs deterministically
node scripts/record-demo.mjs   # re-record the demo video: own synthetic DB in data/e2e/demo-recording/ on :8795, output in demos/<timestamp>/
```

## How AI is (and isn't) used
| Step | Implementation |
|---|---|
| Parse, classify, extract (default) | Deterministic rules on the PDF text layer |
| Reconcile, tolerances, tax, currency, duplicates, recommendation, approval rules | **Deterministic code only** (`server/engine`, `server/services/review.ts`) |
| Fill in fields the rules missed; reword explanations | **Optional Claude adapters — disabled here** (no API key; tested against a mock transport only, never run live). Output must be grounded in cited words / reuse only verified numbers, or it is discarded |
| Decide / approve / pay | A human decides. Nothing pays. |

The "How it was decided" tab on each bundle lists every step as *Rule* or *AI*. Text inside documents is untrusted: fixture B16 contains an "ignore previous instructions… remit to a new IBAN" payload plus hidden 1.5 pt text — it is flagged, held, and changes no number.

## Architecture
See [docs/architecture.md](docs/architecture.md) (data-flow diagram, agent-vs-code table, connector status) and [docs/data-contracts.md](docs/data-contracts.md).
```
shared/        Zod schemas, decimal money, locale-aware parsers, permissions, CSV safety
server/ingest  pdf.js text layer → words+boxes; prompt-injection scanner
server/extract rules extractor, grounding validator, canonical builder
server/engine  match.ts — pure reconciliation function
server/services ingest · matching · review (correct/resolve/decide/settings) · exports · queries · demo
server/llm     optional Claude client (timeout/retry/circuit breaker/rate limit) + adapters
server/eval    scorers used by tests and `npm run eval`
web/           React SPA (pdf.js viewer with source boxes)
fixtures/      25 synthetic bundles (74 PDFs) + manifest.json (gold truth)
tests/         unit · integration (real HTTP app) · e2e (Playwright)
docs/          PRD, architecture, contracts, risks, acceptance tests, metrics, security, operations, demo, case study
```

## Results (measured, synthetic — read the caveat)
On the 25 synthetic bundles (8 seeded discrepancies, 17 clean): **8/8 detected with the intended exception code, 0 false alarms**; field F1 100% on 72 documents. A total-only comparison scores F1 50% and a zero-tolerance line comparison 61.5%. Invoice analysis ≈ 2 ms median. These fixtures were written together with the extractor, so this is an **optimistic ceiling, not real-world accuracy**. Time saved, human correction time, user satisfaction and LLM cost are **untested**. Details: [docs/METRICS_PLAN.md](docs/METRICS_PLAN.md).

## Known limitations
- Native-text PDFs only — **no OCR** (scans/images are rejected with an explanation); no handwriting.
- Rules extractor knows three layout families (US grid, compact stacked, German/EU). Unfamiliar layouts degrade to low confidence → human review rather than silent errors, but accuracy on real suppliers is unknown.
- One-page-style documents; tables spanning pages and wrapped descriptions are not handled; no ability to *add* a missing line item in the UI.
- Tax: exclusive sales-tax/VAT on one rate per PO; no VAT-inclusive pricing or mixed rates. Currency: strict or manual dated rates; no rate fetching.
- Quantities compared by SKU across all receipts; unit-of-measure conversion is not modelled.
- **Demo identity is not authentication**; single user at a time; no hosted deployment; Docker image is untested (Docker not installed here).
- Accessibility: automated axe scans and keyboard tests pass, but there has been no manual screen-reader pass yet.

## Who built what
Claude Code generated the application from the supplied project instructions and implemented the follow-up mobile and keyboard improvements. The project owner directed that work. The recorded walkthrough was created with Codex using a separate synthetic database. See the [short case study](docs/CASE_STUDY.md) for the demonstrated results and remaining limitations.

## Docs
[PRD](docs/PRD.md) · [Feasibility](docs/FEASIBILITY.md) · [Architecture](docs/architecture.md) · [Data contracts](docs/data-contracts.md) · [Risks](docs/risks.md) · [Acceptance tests](docs/acceptance-tests.md) · [Metrics plan](docs/METRICS_PLAN.md) · [Security](docs/SECURITY.md) · [Operations](docs/OPERATIONS.md) · [Demo script](docs/DEMO_SCRIPT.md) · [Case study draft](docs/CASE_STUDY_DRAFT.md) · [Build plan](docs/BUILD_PLAN.md)
