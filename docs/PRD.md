# PRD — AP Document Intelligence & Three-Way Match

**Status:** MVP in build · **Data:** 100% synthetic · **Hard boundary:** the system never pays, posts, or sends anything outside the machine.

## 1. Problem (interrogated, not assumed)

Before an invoice is paid, someone must confirm *we ordered it* (PO), *we received it* (receiving record / GRN) and *we are being billed correctly* (invoice). In small and mid-size finance teams this is done by eyeballing three PDFs side by side and re-keying numbers into a spreadsheet or ERP.

Questions we asked of the problem, and the answers that shaped scope:

| Question | Answer used in this MVP |
|---|---|
| Is extraction the hard part or matching? | Extraction is solvable per-supplier; the costly part is *judging variances* consistently (tolerances, partial receipts, tax, freight, discounts). So matching is deterministic, auditable code; extraction is replaceable. |
| What makes a wrong "approve" expensive? | Overpayment, duplicate payment, paying for goods never received, paying in the wrong currency. These are the **blocking** exception classes. |
| What makes a wrong "flag" expensive? | Clerk time + supplier friction + late-payment/lost early-pay discounts. Hence configurable tolerances and exception *precision* as a KPI. |
| Who must stay in control? | A human approves every recommendation. Overrides need a reason and the right role. |
| What happens when the document lies? | Documents are untrusted input (prompt-injection, wrong totals, forged duplicates). Nothing in a document can change a decision. |

## 2. Personas

### P1 — Dana, Accounts Payable Clerk (primary user)
- **Jobs:** get each invoice to "approved-for-payment-review" or a clearly explained exception, fast; fix extraction errors; chase missing receipts.
- **Today:** opens three PDFs, copies line items into Excel, compares by eye, emails purchasing. ~8–15 min/bundle (**estimate — untested here**).
- **Pains:** supplier layouts differ; partial deliveries; rounding; no memory of why something was waived last time.
- **Success:** most clean bundles need one click; exceptions arrive with evidence (which field, which page, what delta).
- **Failure consequence:** missed duplicate or over-billing → overpayment.

### P2 — Marcus, Controller (approver / policy owner)
- **Jobs:** set tolerances, approve exceptions and high-value invoices, prove controls to auditors.
- **Today:** samples approvals, relies on emailed screenshots.
- **Pains:** can't show *who approved what, on which evidence*; tolerances live in people's heads.
- **Success:** configurable tolerances, separation of duties, immutable audit trail, exportable register.
- **Failure consequence:** control deficiency finding; fraud exposure.

### P3 — Priya, Purchasing Lead (resolver of price/quantity disputes)
- **Jobs:** decide whether a price/qty variance is a supplier error or an unrecorded PO change/receipt; fix source records.
- **Today:** gets forwarded emails with no context.
- **Pains:** doesn't see the PO line vs receipt vs invoice side by side.
- **Success:** exception cards that show the three quantities/prices for the line and the delta in money.
- **Failure consequence:** supplier relationship damage, stock-record drift.

## 3. Current manual workflow (baseline we compare against)
1. Receive invoice by email/PDF. 2. Find PO. 3. Find receiving record. 4. Re-key lines. 5. Compare qty/price/tax/total by eye. 6. Email purchasing on mismatch. 7. Key into ERP. 8. Controller approves above a threshold.
The measurable parts (time, error rate) are defined in `METRICS_PLAN.md`. **No manual-baseline time has been measured yet.**

## 4. Scope

**In (MVP, built):** PDF ingest with text-layer extraction + per-field source boxes; configurable deterministic three-way match at line level (partial receipts, split shipments, discounts, freight, sales tax, multi-currency policy, duplicate detection); exception queue with explanation, edit/override/waive; correction → automatic re-match; approval workflow with roles and separation of duties; audit log; CSV/XLSX export; onboarding; synthetic data for 3 organizations; optional Claude adapters (disabled; mock-tested only).

**Out (deliberately):** payments, ledger posting, supplier master sync, email intake, real auth/SSO, VAT-inclusive pricing, multi-page line-item tables spanning pages beyond the supported layouts, handwriting. See `risks.md`.

## 5. Functional requirements (abridged)
FR1 Upload PO/GRN/Invoice PDFs; auto-classify type; group into a bundle by PO number.
FR2 Show original document with highlighted source box for each extracted field; click both ways.
FR3 Show per-field confidence and its reason; allow manual correction with a mandatory audit record.
FR4 Run deterministic three-way match; list exceptions with code, severity, expected/actual, delta, evidence.
FR5 Recommend **Ready for approval**, **Exception review**, or **Hold** — never "pay".
FR6 Approval workflow: propose → (approve | reject | hold | override with reason); role- and threshold-gated; idempotent.
FR7 Settings for tolerances, tax and currency policy, thresholds, per organization.
FR8 Export approved/exception records as CSV and XLSX with provenance and correction flags; export JSON of all org data; delete bundle/org data.
FR9 Audit log of proposed → approved → executed with actor, time (UTC, shown in org timezone), and before/after.

## 6. Non-functional
Decimal arithmetic only for money/quantity; keyboard operable; responsive to 375 px; honest empty/loading/error states; works offline (no network needed); secrets server-side only.

## 7. Success criteria
See `acceptance-tests.md` (AT-1…AT-12) and KPIs in `METRICS_PLAN.md`: field extraction F1, line-item match accuracy, exception precision/recall, human correction time (untested).
