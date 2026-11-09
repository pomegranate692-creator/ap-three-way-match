# Demo script (60 seconds, live, synthetic data, no credentials)

Setup once: `npm run build && npm start`, open http://127.0.0.1:8791. (Reset any time: *Data & safety → Reset*.)
Every step below is automated in `tests/e2e/demo.spec.ts`; screenshots from that real run are in `screenshots/`.

| Time | Do | Say | Proves |
|---|---|---|---|
| 0:00 | First run: the 3-step tour → **Load demo data** (Harbor & Pine, as *Dana · AP Clerk*) | "Nine synthetic bundles are being read and matched by the real pipeline — nothing is pre-baked." | Real ingest, extraction, matching |
| 0:10 | Open **B01** (green) → **Approve** | "Clean bundle: ordered, received and billed agree. One click, recorded with my name." | **Success path** |
| 0:18 | Back, open **B05** → Match tab | "Billed 100, received 80 — the cell is red. Nothing else is wrong." | **Failure path**: quantity mismatch |
| 0:26 | Click the billed **100** | "Every number is traceable: this box on the original PDF, 97% confidence, why." | Field provenance + confidence |
| 0:32 | *Exceptions* tab | "Template-written explanation with the dollar exposure. I'm a clerk, so I can't clear a receiving dispute — it belongs to Purchasing. Approve is disabled and says why." | Explanation, RBAC, approval gate |
| 0:40 | **Exports → Exception record → preview → CSV** | "The exception record goes to Purchasing for approval; nothing is paid or posted." | Exception export with preview |
| 0:46 | Switch org to **Cobalt Bay**, load data, open **B14** → Exceptions | "Supplier's total is $90 too high." | Arithmetic check |
| 0:50 | Fields → Total → **Correct this value** (re-key, give a reason) | "My correction is audited and the match re-runs." | **Human correction** → v2, exception clears |
| 0:55 | Approve is disabled for me (I edited it) → switch to **Samir · Controller** → Approve → **Exports → Approved register → XLSX** | "Separation of duties: someone else signs. The register has the corrected value, who approved, and the audit trail." | **Regenerated trustworthy output** |

Close (5 s): *Audit log* → "field.corrected → match v2 → approval → export.executed. The system never paid anything."

## Questions to be ready for
- *Where was AI used?* In this build: nowhere at run time (no API key). The optional adapters (field fill-in, plain-language summary) are implemented and mock-tested, off by default. "How it was decided" tab shows every step as Rule vs AI.
- *What if a supplier hides instructions in the PDF?* Open **B16** (Cobalt): flagged, held, numbers unaffected.
- *Duplicate?* **B25** (Cobalt) is a re-sent copy of B11 with a differently formatted number.
- *EUR/German layout?* Meridian Labs — **B20** has a USD invoice against a EUR PO (strict policy → hold).

# 60-second video storyboard (record from the real app — do not animate)
1. **0–5 s** Title card: "Three documents, one decision." Cut to the inbox (screenshots/03-inbox.png style).
2. **5–15 s** Screen recording: load data, B01 approve. Caption: "Clean → one click."
3. **15–30 s** B05: red billed cell → click → yellow box on the PDF. Caption: "Billed 100 · received 80 · here's the page."
4. **30–40 s** Exceptions card; clerk cannot resolve; export exception record. Caption: "Routed, not paid."
5. **40–55 s** B14 correction → controller approval → XLSX. Caption: "Corrected, re-checked, approved by someone else."
6. **55–60 s** Audit log scroll. End card: "Deterministic maths · human approval · no payments."
Voice-over optional; keep on-screen text ≤ 8 words per caption. Record at 1360×860, light theme.
