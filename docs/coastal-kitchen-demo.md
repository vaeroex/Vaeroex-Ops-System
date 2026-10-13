# Coastal Kitchen: reusable fictional business

Use Coastal Kitchen consistently for future Vaeroex screenshots, walkthroughs and marketing content. It is an isolated, reproducible local fixture dataset, **not a hosted Supabase workspace, a customer account, or an authorized merchant connection**. The hosted website preview serves static screenshots only. No production account/workspace was created.

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
8. Preserve the ten approved overview/detail assets listed in `captures.json`; only the two Performance images were later recaptured for the requested historical scope clarification. New six assets are listed separately in `integration-captures.json`, including source screen, viewport, crop, encoding and SHA-256.
9. Build a Preview deployment, never Production. Check all provider tabs, keyboard navigation, 390px/320px layout, DPR2 source resolution, image loading and caption; retain Google Sheets pilot eligibility and spreadsheet-upload fallback at connection and pre-purchase points. Keep the main automatic deployment hold.

See also [workspace screenshot capture record](website-workspace-captures.md) for the original scenario and approved screenshots.

## Connected insights and VSI follow-up

The focused [workflow review](coastal-kitchen-connected-insights-review.md) records the real retrieval boundary and the proposed smallest extension. Do not treat the disconnected provider-browser fixtures as connected analysis evidence or insert a scripted VSI answer. Use the visible caption “Coastal Kitchen · Fictional business example” beneath each image or shared group.

A disposable loopback-only database copy was also prepared for actual VSI retrieval on October 13, 2026. Its 64 fictional originals used the normal reserved upload/finalize path; 168 KPI records, 20 operational records and the authored/reviewed Business Note fixture preserve the canonical business values. The current authenticated VSI authorization, source authority and bounded retrieval ran unchanged. This copy is synthetic seeding, not a claimed provider-generated import or note extraction. It has no merchant connections. Private database configuration and reproduction notes are in `/private/tmp/vaeroex-closeout-assembly-coastal-vsi/README.md`, outside Git. No provider credential is committed. The privacy-reviewed, entirely fictional generated answer and its citations are preserved as a capture recording.


## Actual VSI conversation and future reuse

- Persistent private provider configuration: `/Users/isaacvizcarra/.config/vaeroex/coastal-kitchen/provider.env` (0600; parent directory 0700). Never print its contents, commit it, copy it into a build, or pull a hosted Secret. Its former temporary copy has been removed.
- `scripts/coastal-kitchen-vsi-local.cjs --config-dir /private/tmp/vaeroex-closeout-assembly-coastal-vsi` prepares only the owned loopback database and validates actual retrieval. It requires the reviewed local-stack assembler's private config and validates its owned Postgres directory. It does not accept a hosted database.
- Add `--generate` only with authorization for limited provider usage. This invokes the unchanged engine and configured model. The request reservation must be at most $0.25; the runner refuses an existing attempt file so a retry cannot silently spend again. Keep private output/accounting outside Git; review a failed attempt before deciding whether a retry is justified. Run `--preflight` without provider credentials to verify access before generation.
- The October 13 result used two provider calls, no searches/retries, estimated $0.0024997, four validated citations. The sales finding ($27,600/$24,000), satisfaction finding (96/90), margin finding (70/68), and ticket-time observation (16.2/18 minutes) support its observations. A $500 referral-campaign budget, complimentary item, channel selection, targets and messaging are proposals, not existing facts or approved actions. The full response is unchanged in `scripts/website-demo/vsi-response.json`; it is not manually authored or polished.
- Run the normal loopback component preview, open `/app/si`, and inspect the recorded answer through the actual `VsiWorkspace` and `Exchange`. Its two GET adapters accept only this fixture workspace and conversation; writes, generation, usage calls and unrelated IDs are rejected. No production/runtime fixture route is added.
- `vsi-captures.json` records native DPR-2 PNGs, viewport sizes, actual transcript scroll positions, integer crop rectangles and lossless WebP hashes. Desktop captures show the prompt/recommendation and budget/preparation. Separate 390px and 320px captures focus on the recommendation and full proposed budget, retaining their limitations. The narrow source avoids shrinking the 390px text at 320px; the VSI image group uses modestly wider mobile framing for readable text. The complete public text transcript preserves the remaining execution steps, sample message, success measures and source descriptions.
- Preserve the existing sixteen imagery assets. Verify the new images and text transcript as delivered at desktop, 390px and 320px. Never manually change numbers, answer text, citations, scores or application controls for marketing.

## Performance target history

Weekly net sales keeps its original 28 observations and $24,000 target: 17 met target (60.71%); the latest 12 all met it. The workspace now calls this **Historical target hit rate** and labels the chart separately, with an **All history** link exposing the earlier misses. Reproduce and capture from application commit `dc3e650bb1d651046701ab4f72ba79e33b5272f5` or later using the unchanged fixtures. `captures.json` records the two replacement Performance crops. Do not adjust the dataset to make the historical card equal the recent chart.
