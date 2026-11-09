# Phase 0 — Feasibility and dependency report

Inspected only this project folder and the machine's tools. Nothing in any other folder (including any portfolio site) was read or modified.

## Environment (checked, not assumed)
| Item | Result |
|---|---|
| Node / npm | v24.19.0 / 11.17.0 — `node:sqlite` available (no native DB module needed) |
| Python | 3.9.6 (not needed by the app) |
| SQLite CLI | 3.51.0 |
| Docker | **not installed** → Dockerfile written but **never built or run** |
| `pdftotext`, `tesseract` | **not installed** → OCR not built; PDF text layer via `pdfjs-dist` instead |
| `ANTHROPIC_API_KEY` | **not set** → Claude adapters exist, are disabled, and were tested only against a mock transport |
| Browser | Google Chrome installed → Playwright runs with `channel: "chrome"` (no download) |
| npm registry | reachable |
| Gmail / calendar / MCP / paid APIs | **not connected and not used** by the application |
| Port 8787 | already used by another program on this machine → this app defaults to **8791** |

## (a) Feasibility assessment
Feasible as a local-first TypeScript app. The hard parts — decimal reconciliation, tolerances, duplicate detection, field provenance, approval controls, audit — are deterministic and fully testable offline. Extraction from *native-text* PDFs is feasible with a layout-aware rules engine. Not feasible in this environment: OCR of scans, and any claim about live LLM quality.

## (b) Smallest sensible MVP (built)
Upload → read PDF text layer with word boxes → rules extraction with source references → deterministic three-way match → editable exception queue → human correction with automatic re-match → role-gated approval → CSV/XLSX export, with audit throughout.

## (c) Key architectural decisions and trade-offs
| Decision | Why | Cost |
|---|---|---|
| Deterministic engine; model optional and fenced | Money must be reproducible and auditable | Less flexible on unseen layouts (rules extractor tuned to 3 layout families) |
| `decimal.js`, decimal strings everywhere | Float errors are unacceptable in AP | Slightly more verbose code |
| SQLite via `node:sqlite` | Zero-install, single file, local-first | Not multi-user; Node ≥ 22.13 |
| Bundle = one invoice (+PO, +receipts) | Multiple invoices per PO is normal (partial billing) | PO/receipt shared across bundles; needs cumulative-billing logic |
| Demo identity switcher, not auth | Demonstrates RBAC without inventing a login system | **Not secure authentication**; documented |
| Grounding validator on every extractor | Lets a model help without being trusted | Rejects some legitimate model output |
| pdf.js for both extraction and preview | Same coordinates drive source highlights | Word boxes inside a text run are proportional estimates |

## (d) Integrations
| | Status |
|---|---|
| Local upload, SQLite, pdf.js, CSV/XLSX | **Available** (used) |
| Claude API | **Optional / disabled** (no key; mock-tested only) |
| OCR | **Not built** (no engine installed) |
| ERP / payments / ledger | **Blocked by design** — no route exists |
| Email / Gmail / calendar / MCP | **Not connected, not used** |

## (e) Files created
See the repository tree in `README.md`. Docs: PRD, architecture, data-contracts, risks, acceptance-tests, BUILD_PLAN, FEASIBILITY, METRICS_PLAN, SECURITY, OPERATIONS, DEMO_SCRIPT, CASE_STUDY_DRAFT.

## (f) First acceptance criteria
AT-1…AT-12 in `acceptance-tests.md` (detection of 8 seeded discrepancies with ≤1 false alarm; field F1 ≥ 0.95; exact decimal maths; inert injection; correction loop; approval controls; idempotency; export safety; no payment route; degraded AI; malformed input; browser end-to-end).
