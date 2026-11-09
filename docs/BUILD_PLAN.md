# Build plan

Legend: [x] done and verified by a run · [~] done, partially verified · [ ] pending

## Phase 0 — Environment [x]
- [x] Node 24.19, npm 11, SQLite 3.51 (`node:sqlite`), Chrome present. Missing: Docker, tesseract, pdftotext, `ANTHROPIC_API_KEY`. Port 8787 was taken by another program → app uses 8791. See FEASIBILITY.md.

## Phase 1 — Docs & contracts [x]
- [x] PRD, architecture, data-contracts, risks, acceptance-tests, FEASIBILITY

## Phase 2 — Working local MVP [x]
- [x] shared money/parsers/schemas · [x] 25-bundle fixture generator (+gold) · [x] pdf.js text layer + rules extractor + grounding · [x] deterministic engine · [x] SQLite + HTTP API + upload pipeline · [x] React UI (inbox, review with source highlights, exception queue, exports, audit, settings, data & safety, onboarding)

## Phase 3 — Approval & audit [x]
- [x] RBAC, amount limit, separation of duties, idempotency, supersede-on-change, audit trail, CSV/XLSX export with preview

## Phase 4 — Evaluation, recovery, polish [~]
- [x] `npm run eval` with two deterministic baselines · [x] LLM adapters with timeout/retry/breaker/rate-limit (mock-tested) · [x] Playwright E2E + axe scan (found and fixed: contrast, link-only-colour, initial focus)
- [ ] Real-document evaluation · [ ] OCR adapter · [ ] compact mobile decision bar · [ ] tabs arrow-key navigation (ARIA pattern) · [ ] manual screen-reader pass

## Phase 5 — Packaging [~]
- [x] README, DEMO_SCRIPT (+ video storyboard), CASE_STUDY_DRAFT, METRICS_PLAN, SECURITY, OPERATIONS · [~] Dockerfile written, **untested** · [ ] recorded video · [ ] hosted deployment

## Recommended next smallest increment
Run `npm run eval` on 10–20 real (permitted, de-identified) supplier PDFs to learn where the rules extractor fails; add those layouts or enable the grounded LLM fill-in for them.
