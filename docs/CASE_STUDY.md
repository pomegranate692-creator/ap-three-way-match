# Checking invoices before approval

**AP Document Intelligence & Three-Way Match · Working prototype · AI-assisted development**

[Watch the 85-second demo](../demos/ap-three-way-match-demo.mp4)

## The problem

An invoice can add up correctly and still charge a company for goods that never arrived. Checking the bill means comparing three documents: the purchase order, the receiving record and the invoice.

This project explores how software can make those differences easier to find and give a reviewer the evidence needed to decide what happens next.

## The solution

The app reads PDF documents, compares quantities and prices, checks tax and totals, and flags discrepancies. Clicking an extracted number highlights its source on the original PDF. Reviewers can record corrections and decisions, then export an exception report or an approved register.

Approval follows role and amount limits. Someone who corrects a bundle cannot also approve it when separation of duties is enabled. Changes and approvals appear in an audit trail. The app never sends payments or posts to an accounting system.

## What the demo shows

**B01: a clean invoice.** All three product lines match the order and delivery record. The $1,512.79 total checks out, allowing a person to approve it.

**B05: an incomplete delivery.** The supplier billed for 100 units, but only 80 were received. The app flags the $599 difference before tax and prevents approval while the exception remains open.

**B14: a correction and second review.** A simulated correction removes a $90 total error. The app checks the figures again, requires a different reviewer to approve, and exports the updated register.

## How it was built and checked

Claude Code generated the application from the supplied project instructions. My role was directing the build and the follow-up improvements. The interface uses React; the server uses Node.js and SQLite. Rules and exact decimal arithmetic perform the checks. Optional AI reading and explanation features are disabled and have not been tested against a live model.

The recorded synthetic evaluation detected all eight planted discrepancies across 25 bundles, with no false alarms on the 17 clean bundles. The last reported checks passed 112 unit/integration tests and six browser tests.

## What remains

The test documents were created alongside the reader, so these results do not establish accuracy on real supplier documents. Scanned PDFs are unsupported, login is a demo user switcher, and time savings have not been measured. The next step is testing a permitted, de-identified set of real documents.
