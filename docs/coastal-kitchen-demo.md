# Coastal Kitchen: reusable fictional business

Use Coastal Kitchen consistently for future Vaeroex screenshots, walkthroughs and marketing content. It is an isolated, reproducible local fixture dataset, **not a saved Supabase workspace, a customer account, or an authorized merchant connection**. The hosted website preview serves static screenshots only. No production account/workspace was created.

## Scenario and canonical inputs

- Profile: fictional 54-seat restaurant; manager Maya Rowan; Tuesday–Sunday dinner and Saturday–Sunday lunch. All people, suppliers and source records are fictional.
- Clock: `2026-10-12T18:00:00.000Z`; reporting timezone UTC. 28 Monday-ending weekly observations, April 6–October 12. Latest reporting week October 6–12.
- `scripts/website-demo/data.ts`: profile, workspace, 168 KPI observations (six metrics × 28 weeks), 64 source files/imports, 20 operational records, reviewed business context and meeting-note draft.
- `scripts/website-demo/calculations.ts`: normal application intelligence, snapshot, readiness and historical-review functions. Current Business Health 90 = quality base 50 + capped opportunity adjustment 50 − supplier risk 10. Readiness 87 is the rounded normal coverage result; neither score is a fixture override. Three previous valid reviews use the normal snapshot recorder.
- Latest values: net sales $27,600 / target $24,000; gross margin 70% / minimum 68%; labor 29.8% / maximum 32%; ticket time 16.2 minutes / maximum 18; guest satisfaction 96% / minimum 90%; food waste 3.5% / maximum 5%.
- Evidence includes sales/cost history, labor and service records, guest feedback, waste measures, supplier register and operational context. The selected supplier finding is supported by two overdue invoices ($420 + $180) from one register. Confirm settlement and supplier dependency; the register does not establish cash shortage or current nonpayment. Do not replace this limitation with invented certainty.

## Provider-shaped demonstration

`integration-data.ts` in the same script directory is the reusable provider fixture. It uses the current connector contracts and contains no tokens, OAuth results, real merchant IDs or live calls.

| Source | Supported screen and input | Relationship to existing evidence |
| --- | --- | --- |
| Square | Actual saved-Payments browser: three completed Sunday October 11 payments, $162, $81 and $108 USD. Previous/disconnected connection, not live authorization. | $351 gross includes fictional 8% tax, no tips/refunds: $325 before tax is a small subset of the week's $27,600 net sales, never an additional revenue total. This does not claim full-week import coverage. |
| QuickBooks Online | Actual stored ProfitAndLoss report observation, accrual/USD, October 6–12. Sales $27,600; food/beverage cost $8,280; gross profit $19,320; labor $8,224.80; other operating expenses $2,400; net income $8,695.20. | Sales, margin and labor are derived from the existing scenario's latest metrics. This is another observation of the same activity, not additive revenue. Normal UI retains nonadditive semantics and unknown reconciliation. No combined-revenue capability is claimed. |
| Google Sheets | Actual mapping editor and selected-cell preview. Stable IDs W26–W28; weeks September 28, October 5, October 12; guest satisfaction 95%, 95%, 96%, target 90. | Same guest-satisfaction series as the existing evidence, not a second imported metric and not revenue. Preview does not approve or import. Pilot status remains visible; no Google account or OAuth authorization is fabricated. |

The integration screenshots do **not** add duplicate sources to the approved Health inputs. The app does not automatically reconcile these providers. Keep one authoritative metric source per reporting scope. The sample accounting report is simplified fictional accounting, not a customer outcome or complete-history claim.

## Capture and regeneration

1. Install the locked repository dependencies. Run `node scripts/website-workspace-imagery-tests.cjs` to validate calculations, provider schemas, arithmetic, immutable asset hashes and the local read/write boundary.
2. Run `node scripts/website-demo-preview.cjs`. It serves only `http://127.0.0.1:3190`; no environment file, credentials, Supabase client, provider client or paid model is loaded. Static server rejects writes and has `connect-src 'none'`. Local fetch responses are limited to synthetic search and the reviewed Sheets preview; approval/save/import/OAuth remain blocked.
3. Open `/app/settings/integrations/square` at 840×1000/DPR2 (390×1000 mobile). Capture `#saved-payments` from the actual `SquareDirectCustomerPanel`. Full page truthfully says no account is connected; the focused capture retains Previous connection.
4. Open `/app/settings/integrations/quickbooks/data` at 1040×1000/DPR2 (390 mobile). Capture `[aria-label="QBO-reported observation"]` from actual `QboStoredDataView`. It retains period, currency, accrual basis and nonadditive explanation.
5. Open `/app/settings/integrations/google-sheets` at 1040×1000/DPR2. Click **Preview selected columns**, never Approve. Capture the actual mapping metric fieldset through its preview. At 390/DPR2 capture the selected-cell preview with its explicit non-import statement. Do not claim these fixture cells were fetched from Google.
6. Wait for fonts/rendering, move pointer outside the crop, then use Chrome's native **Capture full size screenshot** to obtain PNG at DPR2. Browser automation screenshots are JPEG and are suitable only for review evidence, not these marketing masters. Crop at integer native-pixel coordinates from `integration-captures.json`; encode lossless WebP without resizing or changing interface pixels. Inspect every image for pointers, private identifiers, real data, loading states and browser chrome.
7. The production components used by these captures are unchanged from commit `dd16057ad68239b17c567ec3617c7a59fdd1a86c` (the approved imagery head). Fixture/capture additions live only under `scripts/website-demo`; no fixture route is shipped in the application. `integration-screens.tsx` mounts the actual components at their existing read boundaries. The Sheets-only wrapper supplies local page context; only the real editor is captured.
8. Preserve the ten approved overview/detail assets listed in `captures.json`. New six assets are listed separately in `integration-captures.json`, including source screen, viewport, crop, encoding and SHA-256.
9. Build a Preview deployment, never Production. Check all provider tabs, keyboard navigation, 390px/320px layout, DPR2 source resolution, image loading and caption; retain Google Sheets pilot eligibility and spreadsheet-upload fallback at connection and pre-purchase points. Keep the main automatic deployment hold.

See also [workspace screenshot capture record](website-workspace-captures.md) for the original scenario and approved screenshots.
