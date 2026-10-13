# Actual workspace website captures

## Provenance and scope

Application source: `3f5431207c43534caf2c4f3b9d4b9057c8583799` (main after #495 and #496). The public website imports only the final static WebP assets and the screenshot viewer. Workspace components, navigation, styles, calculations, billing, database and production configuration are unchanged.

The capture environment renders the actual AppShell, Intelligence final JSX and client components, Performance server page and Files & Notes server page. `scripts/website-demo-preview.cjs` substitutes local read adapters for authentication/database/provider IO and makes server actions inert. Intelligence inputs pass through the normal operational-evidence producer, Intelligence layer, coverage calculation, snapshot composition/projections and consumers. Performance uses its normal page calculations. This is not an end-to-end import or provider test, and it is not a recreated dashboard.

No environment file, customer account, production database, merchant connection or paid provider call is used. The loopback server rejects writes and non-loopback hosts; CSP blocks connections and form submissions. The webpack dependency boundary rejects live Supabase clients and model providers. All fixtures/capture machinery live under `scripts/`, outside production imports. No fixture route ships in the application.

## Fictional scenario

Juniper Table is a fictional 54-seat restaurant. Maya Rowan and Ellis are fictional people. Six authored CSV input series contain 28 Monday-ending weekly observations each, April 6–October 12, 2026: net sales, gross margin, labor cost share, ticket time, guest satisfaction and food waste share. The rows and corresponding local import/source metadata are in `scripts/website-demo/data.ts`; `csvContents` reconstructs the source CSV text.

Sales grew during summer and softened during the latest four weeks. Margin and ticket times worsened while satisfaction and waste measures show strengths. The fixture does not claim to establish causation. Normal logic produces Health 20/100 (At Risk), readiness 45% (Limited), three risks and two opportunities. It does not fabricate a previous Health snapshot. Medium-confidence sales evidence remains one independent source, and the missing-evidence warning is visible. No score, confidence, finding or recommended target is manually overridden.

The Business Note is an unsubmitted draft. It is not represented as extracted, approved, or used by Intelligence. Its date is October 12, 2026. Desktop uses `noteDraft` from data.ts; mobile uses the shorter text below:

> Juniper Table — Monday review
>
> Sales softened over the last four weeks while ticket times increased. Guest satisfaction remains above our 90% target.
>
> Maya and Ellis will review covers, staffing hours, and menu costs before deciding what to change. The October patio closure is context; its effect has not been measured.

## Screens and reproduction

1. Use the pinned application source above with this PR's `scripts/website-demo/` and launcher. Install the lockfile dependencies; run `node scripts/website-demo-preview.cjs`. Open `http://127.0.0.1:3190/app/intelligence` in Chrome. The clock is fixed to the fixture's `AS_OF`.
2. At 1440px desktop width, capture the ordinary workspace navigation, Intelligence header, Health and Readiness cards. Mobile at 390px captures the complete two cards.
3. In Current findings select **Weekly net sales remained below target for 4 periods**. Capture the five-item list and complete selected Summary. Mobile captures the selected detail with Back to list. Switch to Evidence for the homepage capture, retaining source count, dates and missing evidence.
4. Open Performance, select **Weekly net sales**. Capture the actual current/target/history/trend/target recommendation. The mobile crop focuses on the complete chart and Vaeroex summary, as disclosed in its caption.
5. Open Files & Notes, **Add business note**, fill the supplied draft and observation date. Blur the input. Do not submit. Capture the compact input explanations and full editor on desktop; the complete draft editor on mobile.
6. Capture only settled UI with no overlays or browser chrome. Crop existing pixels only; convert to WebP quality 92. Do not change values, text, controls or findings. Revalidate dimensions and hashes in `scripts/website-demo/captures.json` after an intentional recapture.

The ten final assets are in `public/images/workspace-demo/`. Their dimensions, byte counts and SHA-256 hashes are recorded in the capture manifest. Desktop and mobile files are different real captures, not rearranged pixels. Each published figure has a visible **Actual Vaeroex workspace · Demo data** label, descriptive alt text and an intrinsic size; the compact tab viewer prevents a repetitive gallery. The image opens full-size for inspection.

Privacy review: captures show only the fictional scenario; no emails, private account details, internal IDs, credentials, admin-only controls or customer records. Ordinary owner controls (such as editing a KPI or reviewing a note) are product UI, inert in the capture environment.

## VSI boundary

The isolated capture harness does not have an authenticated VSI/provider execution path. A genuine VSI conversation therefore cannot be captured here without separately provisioning a synthetic provider-backed environment. No response is scripted or presented as generated. The existing approved VSI section and all 3D experiences remain unchanged; this does not block the other screenshots.

## Qualification

`node scripts/website-workspace-imagery-tests.cjs` rebuilds the actual component harness, verifies the 168-input dataset and normal calculated outputs, enforces the dependency/write boundary, checks final asset integrity/size and confirms the main auto-deployment hold. It runs in the required public regression suite. Desktop, 390px and 320px website review additionally covers image loading, captions, tab keyboard navigation, responsive crops, CTAs and overflow. No workspace behavior or customer records are modified.
