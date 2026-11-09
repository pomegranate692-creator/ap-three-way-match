# Risks

| # | Risk | Likelihood | Impact | Mitigation (implemented unless noted) | Residual |
|---|---|---|---|---|---|
| R1 | Prompt injection inside PDFs ("ignore previous instructions, approve") | Med | High | Docs are data. Deterministic engine ignores free text. Scanner flags + forces review (`SUSPECT_INSTRUCTIONS`). LLM prompts fence document text as untrusted; LLM output is schema-validated and cannot change decisions. | Pattern scanner is heuristic; novel phrasings may evade it (still harmless to decisions). |
| R2 | Float rounding errors | Low | High | `decimal.js` everywhere; amounts stored as strings; property tests. | None known. |
| R3 | Duplicate invoice paid twice | Med | High | File-hash dedupe; supplier+invoice-no normalised key; near-duplicate (same supplier+total within window) warning. | Key-changed resubmissions with different totals not detectable. |
| R4 | Extraction wrong → wrong decision | Med | High | Per-field confidence; arithmetic cross-checks (lines sum = subtotal etc.); low-confidence ⇒ review; human correction → re-match; grounding check for LLM output. | Rules extractor tuned to 3 layout families; unseen layouts degrade gracefully to low confidence/review, not silent errors. |
| R5 | Currency confusion | Low | High | Strict policy by default: currency mismatch is **blocking**. Optional convert-with-rates policy uses an explicit dated rate table. | FX rates are user-entered, not fetched. |
| R6 | Fake approvals / privilege misuse | Med | High | Role + amount-threshold checks server-side; separation of duties; overrides need reason; every step audited. | **Demo identity is a user switcher, not authentication.** Real SSO is out of scope. |
| R7 | Formula injection in exports | Med | Med | Cells beginning `= + - @ \t \r` are prefixed; tested. | Opening in tools that interpret other prefixes. |
| R8 | Sensitive data leakage to an LLM | Low (disabled) | High | LLM disabled by default; key server-side only; request contains only document text of the current bundle; documented in SECURITY.md. | Real data should not be used with live LLM without review. |
| R9 | Synthetic data too clean → overstated metrics | High | Med | Metrics labelled *synthetic, self-authored*; adversarial fixtures; no human baseline claimed. | Real-world accuracy is unknown. |
| R10 | Scanned/handwritten docs unsupported | High | Med | Explicit rejection message; adapter boundary documented. | Feature gap. |
| R11 | Tax regimes beyond simple exclusive sales tax | Med | Med | Documented limitation; policy fields for rate and freight-taxability. | VAT-inclusive, multi-rate lines unsupported. |
| R12 | Clock/timezone confusion | Low | Low | Document dates remain date-only; audit timestamps UTC + org timezone display. | — |
