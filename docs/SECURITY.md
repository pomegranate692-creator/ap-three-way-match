# Security

Scope: a local-first demo/MVP with synthetic data. It is **not hardened for internet exposure or real financial data**.

## Trust boundaries
| Input | Treatment |
|---|---|
| PDF files, filenames, text inside them | **Untrusted data.** Size/page limits, magic-byte sniffing, parsed with pdf.js with `isEvalSupported:false`; filenames sanitised (basename, control chars stripped, 120 chars); stored under generated ids, never by user-supplied path |
| Instructions inside documents | Never obeyed. The engine does not read free text; `injection.ts` flags instruction-like / payment-redirect / hidden (<4 pt) text → blocking `SUSPECT_INSTRUCTIONS` → HOLD; flagged text is excluded from extraction (hidden text) and shown to the human |
| Model output (optional) | Schema-validated; fields accepted only after grounding against the cited words; summaries discarded if they contain a number absent from the computed evidence; model has no write path to amounts, tolerances, approvals or exports |
| User input (corrections, notes, settings) | Zod / deterministic validation; numbers parsed by the same decimal parsers; control characters rejected |
| Exports | Formula-injection neutralised in CSV and XLSX (`= + - @ TAB CR` prefixed with `'`), including metadata cells |

## Permission scopes (enforced server-side; `shared/permissions.ts`)
| Action | Clerk | Purchasing | Controller |
|---|---|---|---|
| Correct extracted field | ✔ | ✘ | ✔ |
| Resolve review exception | tax/total/confidence/date types | qty/price/receipt/freight types | ✔ all |
| Resolve **blocking** exception / override | ✘ | ✘ | ✔ (reason required) |
| Approve | ✔ up to `clerkApprovalLimit` | ✘ | ✔ |
| Approve a bundle you corrected | ✘ (separation of duties, if enabled) | – | ✘ |
| Reject / hold / reopen | ✔ / ✔ / ✔ (not approved) | ✘ / ✔ / ✘ | ✔ / ✔ / ✔ |
| Export | ✔ | ✘ | ✔ |
| Change settings, delete bundle/data | ✘ | ✘ | ✔ |

Every denial returns an explanatory 403; every success writes an audit event with actor, role, before/after, and note.

## Financial-safety controls
- **No payment, posting, email or external-write capability exists.** Route table is asserted free of such endpoints (AT-9). "Executed" means *the approved record was written to a local file*.
- Approvals are bound to the run (figures) the approver saw; any later data change **supersedes** the approval.
- Idempotency keys on approve/reject/hold/reopen and export; byte-identical re-uploads are deduplicated.
- Rate limits (sliding window) on API, upload and LLM client; request-size limits; LLM calls have timeout, bounded retries and a circuit breaker.

## Secrets and privacy
- Secrets only via environment (`.env`, git-ignored; `.env.example` has none). The key is read server-side and never sent to the browser. No analytics, no telemetry, no third-party requests from the SPA (fonts are bundled; CSP `default-src 'self'`).
- The server binds to `127.0.0.1` only.
- If the Claude adapters are ever enabled, **document text of the current bundle is sent to Anthropic's API**. Do not enable with real confidential data without review. Disabled by default; needs `ENABLE_LLM=1` *and* a key.
- Deletion/export: `GET /api/data-export` (JSON copy), `DELETE /api/bundles/:id`, `DELETE /api/data` (confirm token; optional audit purge), Data & safety page.

## Known weaknesses (honest list)
1. **Demo identity is a user switcher, not authentication.** Anyone who can reach the port can act as any user. Mitigation: loopback bind. Real use needs SSO and signed sessions.
2. Audit table is append-only by convention (no UPDATE/DELETE code paths), not tamper-evident. A hash chain would be the next step.
3. Injection scanner is heuristic; novel phrasing may evade it (still harmless to decisions).
4. Clerk limit compares nominal numbers in the invoice's own currency.
5. No CSRF tokens (identity is header-based, no cookies); not a concern while loopback-only, required before any hosting.
6. Dependencies not audited; `npm audit` not run in CI (no CI).
7. Docker image untested.
