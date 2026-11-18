# Project 03 handoff: AP Document Intelligence & Three-Way Match

## 0. LATEST (2026-11-17, fourth session): dashboard redesign, on branch `redesign/dashboard-ui` (NOT merged to main, NOT pushed)
Recovery points: branch `backup/pre-redesign` (= commit that checkpointed the earlier uncommitted OCR-preprocessing work) and `backup/pre-publish`. The redesign itself is **uncommitted working-tree changes** on `redesign/dashboard-ui`; commit with `feat: dashboard redesign` when the user agrees. `data/app.db` was never touched (copy at /private/tmp/claude-501/ap-data-backup may be gone).
- **UI**: dark navy enterprise theme (default; light/auto still in Settings). 9-item sidebar (Overview, Invoice Processing, Three-Way Match, Exceptions, Approvals, Documents, Audit Trail, Reports, Settings). New code: `web/src/pages/{Overview,Invoices,ThreeWay,Approvals,Documents,SettingsHub}.tsx`, `web/src/components/dash/*` (KpiCards, TrendChart (hand-made SVG, no chart lib), MatchDonut, ExceptionAlerts, UploadCard, InvoiceQueue, ApprovalPanel, DemoScenarios, RangeBar, RecentDocuments), `web/src/dashboard.css` (layers over `styles.css`), `web/src/lib/{dash,hooks,status}.ts`. Review page (`#/bundles/:id`) is unchanged. Old Inbox page deleted.
- **API added**: `GET /api/dashboard?days=0|7|30|90|365&source=all|demo|upload` (server/services/dashboard.ts); `GET /api/documents`; `DELETE /api/documents/:id` (Controller only, refused for approved/exported bundles, re-matches, audited); `POST /api/demo/scenario/missing-po`; `/api/exceptions?category=`; `/api/bundles` rows now carry `codes`, `lines`, `fixtureId`; `/api/stats.pendingApprovals`.
- **Definitions** (be honest about these): *processed* = bundles received in range; *auto-match* = first engine run was READY_FOR_APPROVAL; *exceptions KPI* = invoices whose first run was not clean (the alerts card counts OPEN exception rows, so the two differ); *avg processing time* = measured ms from upload to finished match, stored as `processingMs` in the extraction `decisions` row (absent for data loaded before this change, then shown as "—"); *total value* = sum in the org base currency only, other currencies listed, never converted. Donut buckets precedence: price/amount > quantity > other (`shared/exceptionCategories.ts`).
- **Demo data**: `loadDemoData` now spreads bundle/document received dates over the last 28 days (synthetic, deterministic; audit events keep the real load time) so trends have history. Trend arrows still hide until the previous period has ≥5 invoices, so they will not show for the demo.
- **Request Info** = `hold` decision with reason "Information requested: …". It sends nothing; the UI says so.
- **Tests**: `npm run check` = 178 tests (11 new in tests/integration/dashboard.test.ts); `npm run test:e2e` = 14 (new tests/e2e/demo2-dashboard.spec.ts runs after demo.spec.ts on purpose; it relies on its Harbor data and leaves B05 untouched because mobile.spec uses it). Axe scan passes on dark theme (overview, approvals). e2e screenshots 20–24 in `screenshots/` are of the new UI; run e2e with `SCREENSHOT_DIR=screenshots` to refresh.
- **Not done / honest limits**: NOT deployed. No Docker/hosting CLI here, the Dockerfile is still unbuilt, the server binds 127.0.0.1 only, and the identity switcher is not authentication, so a public instance would let anyone act as Controller. Hosting needs the user's go-ahead plus an auth or read-only-demo decision (see README "Known limitations"). Reference match is close in structure at 1440px but not pixel-exact (typeface is IBM Plex Sans, not the reference's). Mobile queue scrolls sideways inside its card rather than reflowing into cards. Real-document accuracy still unmeasured.
- **Deployment prep (5th step, uncommitted):** `PUBLIC_DEMO=1` mode (password gate `server/access.ts`, `resetAllDemo` in server/services/demo.ts, boot/24 h reset, only mode that binds 0.0.0.0), new Dockerfile, `fly.toml`, `render.yaml`, `docs/DEPLOY.md`, test `tests/integration/public-demo.test.ts` (182 tests total). DEPLOYED 2026-11-17 on Render free tier: https://ap-three-way-match-demo.onrender.com/ (render.yaml Blueprint auto-syncs from main; user created the account). Now OPEN (`DEMO_OPEN=1`, no password): uploads, deletions and settings changes return 403 DEMO_READ_ONLY; resets every 12 h. A DEMO_PASSWORD may still exist in the Render dashboard; DEMO_OPEN wins. `npm run seed` stays non-destructive; only the demo reset wipes data.
- Run: `npm run build && npm start` (port 8791) or `PORT=8797 DB_PATH=/some/scratch.db NODE_ENV=production npx tsx server/index.ts` for a throwaway instance.

---

Written 2026-11-16 for a fresh Claude Code session. State: **the app is built, tested and published. Continue from "Next steps"; do not rebuild anything.**

## 1. Purpose and requirements
A standalone, local-first app: upload purchase orders (PO), receiving records (GRN) and invoices as PDFs; extract fields with source references; match supplier, SKU, quantity, price, tax and totals line by line; flag exceptions; let a human review, correct and approve; export results; keep an audit trail. **It never executes payments or posts to a ledger.**

Source spec: `/Users/romaanmalik/Downloads/🛠️ Projects/AP Three-Way Match/Start_Here_Claude_Project_03.txt` (read it if a requirement is unclear). Key requirements:
- Users: AP clerk, controller, purchasing lead. Money uses decimal arithmetic, configurable tolerances, explicit currency rules.
- Synthetic demo data only: 25 three-document bundles (3 organisations) with 8 planted discrepancies.
- Document text is untrusted (prompt-injection defence). Any AI output is schema-validated, grounded in document text, and never decides.
- Honest KPIs: field extraction F1, line-item match accuracy, exception precision, human correction time. **No invented numbers.** Unmeasured items stay labelled unmeasured.
- Required docs (all exist in `docs/`): PRD, architecture, data-contracts, risks, acceptance-tests, BUILD_PLAN, METRICS_PLAN, SECURITY, OPERATIONS, DEMO_SCRIPT, CASE_STUDY_DRAFT, FEASIBILITY, plus `docs/CASE_STUDY.md`.

## 2. Location
- Folder: `/Users/romaanmalik/ap-three-way-match` (git, branch `main`, commits after `dd4c8e4` are LOCAL and NOT pushed (housekeeping + OCR); push only with the user's approval)
- Remote: https://github.com/pomegranate692-creator/ap-three-way-match (**public**, MIT license)
- Local git identity is the GitHub no-reply address (`323246042+pomegranate692-creator@users.noreply.github.com`); keep it. Backup branch `backup/pre-publish` is local only.

## 3. Built and tested
**Features (all working):** PDF ingest via pdf.js text layer; rules-based extractor with field grounding and per-field confidence; deterministic match engine (line-level PO/GRN/invoice, partial receipts, split shipments, discounts, freight, tax, currency policy strict|convert, duplicate detection incl. near-duplicates); 22 exception codes; SQLite persistence (`node:sqlite`); Hono HTTP API with idempotency keys; React UI (inbox, review with source highlights and fields/exceptions/history tabs, exception queue, exports with preview, audit log with search, settings/tolerances, data & safety, first-run onboarding, demo-identity switcher; note this is not real auth); human correction with before/after/reason that re-runs the match (v+1); approval controls (role limits, clerk limit default 5000, separation of duties so the editor cannot approve, supersede-on-change); CSV/XLSX export with formula-injection neutralisation, approved register and exception record; injection flagging (`SUSPECT_INSTRUCTIONS`); optional Claude adapters (extraction fill-in, explanation) with timeout/retry/circuit breaker/rate limit, **disabled by default and mock-tested only**; compact mobile decision bar and ARIA arrow-key tab navigation; Dockerfile (written, untested).

**Update 2026-11-16 (second session): local OCR is built.** `tesseract.js` reads PNG/JPEG scans (`server/ingest/ocr.ts`, `imageInfo.ts`; `ENABLE_OCR=0` disables; language data cached in `data/ocr/`, gitignored). Image-only PDFs are still rejected. Scanned fixtures in `fixtures/scanned/` (made by `scripts/make-scanned-fixtures.mjs`, macOS sips). Unrecognised currency codes now cap at confidence 0.5 (caught OCR misread `USB`). Tests: `npm run check` = 123 tests (OCR unit 8, OCR integration 3 need cached data); e2e = 7 (new `scan.spec.ts`); e2e now writes screenshots to `test-results/screenshots/` (use `SCREENSHOT_DIR=screenshots` to refresh tracked ones). OCR measured on 5 synthetic scans only: 87/107 fields right, 5 wrong (all conf < 0.8), 15 missing.

**Update 2026-11-16 (third session): synthetic OCR stress test.** The user has no real invoices, so a stress set was generated instead: `fixtures/stress/` (10 invoices, fictional vendors, new layouts/fonts/labels/date and currency formats, degraded like phone photos at light/medium/heavy levels; `ground_truth.json` computed from source numbers). Generator: `scripts/make-stress-fixtures.mjs` + `scripts/stress/` (uses `@napi-rs/canvas`, a transitive pdfjs-dist dependency NOT declared in package.json). Scoring: `server/eval/stress.ts`; run `npm run eval:stress` (writes `docs/results/stress-results.json`). **Measured, labelled SYNTHETIC STRESS TEST (docs/METRICS_PLAN.md §1b, kept apart from §1):** 46/395 fields correct (light 39/94, medium 7/164, heavy 0/137), 3 wrong, 346 missed, 0 spurious; 1 wrong read at conf ≥ 0.8 (vendor name cut to "Saltmarsh", conf 0.81); key fields 31/276 correct, 0 confident errors; doc type recognised 6/10 (4 defaulted to INVOICE). Diagnosis: the bottleneck is Tesseract page layout/binarisation on skewed, shadowed, low-res photos (and ruled table borders read as `|`, `Invoice #` read as `Invoice &`), not wrong values. A scratch sweep of PSM and Sauvola thresholding helped little (psm11 lifted light 39→50 but raised wrong reads 2→7, 4 confident; not adopted). **One fix shipped:** HIDDEN_TEXT risk flag no longer applies to OCR layers (it fired on 3/10 scans from noise); test `tests/unit/injection-ocr.test.ts`. No extractor changes were made to fit the stress set, so it is still a clean baseline for any later preprocessing change (re-run and compare against the numbers above). `npm run check` = 133 tests (178 after the 4th session).

**Tests (earlier run, before OCR):**
- `npm run check`: typecheck + **112 vitest tests** (money 30, engine 33, export 3, extraction 11, llm 14, integration workflow 19, 25-bundle fixtures 2).
- `npm run test:e2e`: **6 Playwright tests** (desktop demo path AT-12, keyboard, error recovery, tab arrows; mobile layout and decision bar), with axe accessibility scan.
- `npm run eval` (measured on synthetic fixtures only): document-type accuracy 100%; field F1 100% (header and line items); line-item match 162/162; bundle-level exception detection precision 100%, recall 100% (TP 8, FP 0, FN 0, TN 17); baseline B0 (total-only compare) F1 50.0%, B1 (zero-tolerance lines) F1 61.5%; median invoice analysis about 1.8 ms. These fixtures were generated alongside the extractor, so 100% is an **optimistic upper bound**, not evidence for real documents.
- **Not measured:** human correction time, manual-baseline time on task, user satisfaction, LLM cost per run (no key; adapters never run live), accuracy on real or scanned documents.

**Seeded discrepancies (fixtures):** B05 QTY_OVER_RECEIVED (billed 100, received 80), B06 PRICE_VARIANCE, B08 TAX_MISMATCH, B12 MISSING_RECEIPT, B14 TOTAL_ARITHMETIC (total $90 too high; fix by correction, then a second reviewer approves), B16 SUSPECT_INSTRUCTIONS, B20 CURRENCY_MISMATCH, B25 DUPLICATE_INVOICE. B01 is a clean example ($1,512.79). Orgs: Harbor & Pine Hardware, Cobalt Bay Foods, Meridian Labs GmbH.

**Other deliverables in repo:** `docs/CASE_STUDY.md`, 95-second captioned demo `demos/ap-three-way-match-demo.webm` (re-recorded 2026-11-17 on the new dashboard UI with `scripts/record-demo.mjs`; needs `npx playwright install ffmpeg`, which only encodes VP8/VP9, so the output is WebM, not MP4) (tracked; other `demos/*` ignored), `scripts/record-demo.mjs` (uses its own DB), `screenshots/01..16`.

## 4. Known bugs, errors, incomplete work
No known failing tests or code bugs. Gaps:
1. ~~No OCR~~ done for PNG/JPEG, but it is weak on photos (stress test: 11.6% of fields correct). Still open: image preprocessing, image-only PDFs (needs PDF page rendering), real scanned documents, handwriting.
2. **LLM extraction/explanation never run live.** `ENABLE_LLM=0`, no `ANTHROPIC_API_KEY`. Do not claim the AI adds measured value.
3. **No real-document evaluation** (needs 10–20 permitted, de-identified supplier PDFs or scans; the user has none yet). The stress test is synthetic and must never be quoted as real-world accuracy.
4. **Unverified:** Docker image; real phone and Safari; manual screen-reader pass.
5. **Housekeeping:** `docs/BUILD_PLAN.md` is stale (shows recorded video as pending; it exists; hosted deployment was ruled out by the user). `npm run test:e2e` rewrites the tracked `screenshots/*.png`, and `npm run eval` rewrites `docs/results/eval-results.json` (timestamp and latency only). After running them, restore with `git checkout -- screenshots docs/results/eval-results.json` unless the update is intended.
6. Docs sections reserved for the user's own contribution are placeholders; do not fill them in.
7. Environment gaps: no Docker, tesseract, pdftotext, or API key.

## 5. Architecture and decisions
- Stack: TypeScript, Node 24 (`node:sqlite`), Hono API, React 19 + Vite, Zod, `decimal.js`, pdf.js, pdfkit (fixtures), exceljs, vitest, Playwright (installed Chrome) + axe. Chosen for a single-language local-first MVP; SQLite instead of Postgres (single user).
- Layout: `shared/` (money, normalize, schemas, permissions, csvSafe) · `server/ingest/` (pdfText, layout, injection) · `server/extract/` (rules extractor, grounding, labels, canonical) · `server/engine/match.ts` (pure deterministic engine) · `server/pipeline/analyze.ts` · `server/services/` (ingest, matching, review, exports, ai, queries, demo) · `server/llm/` (adapters, claude) · `server/export/build.ts` · `server/eval/` · `web/src/pages/*` and `components/*`.
- **Rule that matters:** money, tolerance, tax, duplicate, RBAC and validation logic is deterministic code and never calls an LLM. An LLM may only (1) propose extracted fields that are grounded in document text, or (2) reword an explanation whose numbers are verified. Never use JS floats for money; use `shared/money.ts`.
- Document text is untrusted; never follow instructions found in documents. Every state change writes an `audit_events` row; retryable mutations take an Idempotency-Key.
- Demo identity switcher is not authentication. Single user at a time. No payment or posting route exists (asserted by test AT-9).
- Ports: app **8791** (default 8787 was taken). Playwright uses 8793 with `data/e2e/`; the recording script uses 8795 with its own DB. `playwright.config.ts` deliberately isolates e2e data so `data/app.db` is never touched.

## 6. Next steps, priority order
1. ~~Local OCR~~ DONE (see update above). Optional follow-up: OCR for image-only PDFs. Original plan was: `tesseract.js` (free, local), OCR output feeding the existing grounded extractor with word boxes for source highlights, low-confidence fields surfaced for correction, a few synthetic scanned fixtures, tests (OCR uncertainty acceptance test), docs updated. Keep OCR optional so the app still runs without it.
2. **OCR preprocessing (recommended next, needs the user's OK first):** grayscale + adaptive normalisation + deskew/page crop + upscale before Tesseract. Needs pixel access: declare `@napi-rs/canvas` (already installed transitively) as a dependency, or pick another library. Ask before changing package.json. Measure with `npm run eval:stress` against the numbers above and add a regression test per fix. Extractor gaps seen in light-damage scans: ruled table borders break row grouping; `#` misread as `&`; supplier name taken from the wrong line.
   Housekeeping (done earlier): refresh `docs/BUILD_PLAN.md`; make e2e write screenshots to an ignored folder (or only on demand) so tests stop dirtying tracked files.
3. Real-document evaluation on a permitted, de-identified set; add failing layouts to the extractor or enable the grounded LLM fill-in for them. Report results honestly.
4. Run the Claude adapters live only if the user supplies a key and approves cost; then measure cost per run and fill-in accuracy.
5. Measure human correction time and time on task against a manual baseline (needs the user). Update `docs/METRICS_PLAN.md` measured-vs-estimated table.
6. Test the Docker image (if Docker is available), real-phone/Safari layout, and a manual screen-reader pass.

## 7. Commands
```bash
cd /Users/romaanmalik/ap-three-way-match
npm install                 # only if node_modules is missing
npm run fixtures            # regenerate the 25 synthetic bundles (deterministic)
npm run seed                # load them into SQLite (data/app.db)
npm run build && npm start  # production on http://localhost:8791
npm run dev                 # API 8791 + Vite 5173
npm run check               # typecheck + 133 unit/integration tests
npm run eval:stress         # OCR on fixtures/stress (SYNTHETIC stress test; rewrites docs/results/stress-results.json)
npm run eval                # extraction and matching metrics (rewrites docs/results/eval-results.json)
npm run test:e2e            # Playwright, 6 tests (rewrites screenshots/)
```
Quick demo: open B05 (blocked, quantity mismatch), click the "100" to see the source highlight; B14 (correct the total, switch to the Controller identity, approve, export).

## 8. Rules for the next session
- Work only in `/Users/romaanmalik/ap-three-way-match`. Do **not** touch the user's portfolio website, the Agent Dashboard, other repos, or scheduled tasks.
- **Preserve `data/app.db`, `data/uploads` and `data/exports`**: never reset, delete or reseed them. Tests must use isolated data.
- Do not push, publish or deploy without the user's explicit approval (every earlier publish was approved individually). Ask before installing packages or other large changes.
- Describe the project honestly: "an AI-assisted working prototype tested on synthetic documents." Do not claim real-world accuracy, measured time savings, active AI features, or that the user hand-wrote the code. Never invent metrics.
- Commit format: `type: description`, local commits, no attribution lines, keep the no-reply git identity.
- Keep `CLAUDE.md` short (about 1.3 KB). Prefer small files and immutable patterns. Run `npm run check` before calling a milestone done.
- The user prefers concise answers and one short closing report; they want work done, not plans.
