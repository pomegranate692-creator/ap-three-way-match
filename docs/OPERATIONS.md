# Operations

## Run
```bash
npm install
npm run build && npm start        # http://127.0.0.1:8791  (PORT / DB_PATH override via env or .env)
# or for development:  npm run dev   (API 8791 + Vite 5173)
npm run seed -- --reset           # optional: preload all 25 synthetic bundles into data/app.db from the CLI
```
Requires Node ≥ 22.13 (`node:sqlite`). First launch creates `data/app.db` and the three synthetic organisations; use *Load demo data* in the UI.

## Layout of local state
`data/app.db` (SQLite, WAL) · `data/uploads/<org>/<doc-id>.pdf` · `data/exports/*.csv|xlsx`. All git-ignored. Browser tests (`npm run test:e2e`) use a separate `data/e2e/` folder that is wiped on each run; they never touch the files above.

## Failure modes and recovery
| Failure | Behaviour | Recovery |
|---|---|---|
| Server not running / unreachable | UI banner "Can't reach the server… nothing was changed", Retry | start server; no data lost (writes are transactional) |
| Corrupt / image-only / oversized PDF | Per-file rejection with code and message; no partial bundle | upload a text-layer PDF |
| Document arrives out of order | Bundle assembled by PO number as PO/receipt arrive; each arrival re-runs the match | none needed |
| Duplicate upload | Byte-identical → existing record reused | none |
| Duplicate invoice (different bytes) | `DUPLICATE_INVOICE` blocking hold | Controller rejects, or overrides with reason |
| LLM disabled / timeout / 5xx / bad JSON / ungrounded output | Rules result used; warning on document; audit event; circuit breaker after 3 failures (60 s cool-down) | none; app fully works without it |
| Retry of a mutation (double-click, network retry) | `Idempotency-Key` returns the first result | none |
| Wrong correction | History keeps original; correct again or reopen | field edit; approval auto-superseded |
| Settings changed | Open bundles re-evaluated; approved ones untouched | Controller can reopen a bundle |
| Bad data / want a clean slate | Data & safety → *Reset* or `npm run seed -- --reset` | – |

## Rollback
- Per bundle: Controller → *Reject*/*Reopen*, or `DELETE /api/bundles/:id` (removes unshared documents and their files; audit retains the deletion).
- Whole organisation: `DELETE /api/data` with `{"confirm":"DELETE"}`.
- Schema: single `SCHEMA_VERSION = 1`; no migrations yet. Back up `data/app.db` (copy with the `-wal` file, or `sqlite3 data/app.db ".backup out.db"`).

## Logging
Server logs to stdout (startup, unhandled errors only; no document contents). Business logging is the `audit_events` table (UI + JSON export). LLM calls are counted in the client; token cost is **not** recorded (no live use yet).

## Health & checks
`GET /api/health`. `npm run check` (typecheck + unit + integration), `npm run test:e2e` (Playwright using installed Chrome; builds and serves on port 8793 with a throw-away DB), `npm run eval`.

## Known operational limits
Single user at a time (SQLite, in-memory rate limiter, demo identity); documents ≤ 8 MB / 6 pages; files per upload ≤ 25 / 40 MB; synchronous extraction in the request (≈ms for the fixtures; unmeasured for large PDFs).
