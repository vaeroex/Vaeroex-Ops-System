# Workspace UI clarity qualification

## Scope

- Route-specific shell labels and a collapsed mobile menu; canonical links and workspace selection are unchanged.
- Current Intelligence findings before briefings; unavailable briefing status collapsed, ten-record batches, and a working mobile list/detail return that preserves filters and focus.
- Evidence browsing before note entry, with a mounted on-demand composer, one safety reminder, 25-record batches, and visible-only bulk selection capped at the existing 100-record action limit. Explicit note feedback remains inside its existing return anchor; upload and file-action feedback stays at the source-page location.
- Settings connections first, compact account/workspace information, and on-demand password/theme controls.
- Performance six-card batches, accurate shown/total counts, compact cards, direct details, and a filter-preserving return. Stale detail selections fall back to the overview.
- Saved Analyses 25-record batches, wrapping filters, and honest loaded-set counts.

No migration, data query, authorization, provider, credential, import, billing, or connector behavior changes. The only server-action change adds a non-authoritative display discriminator to the existing note feedback return URL. Batching uses existing loaded sets; it does not claim to search older unloaded history. The existing 300-row Saved Analyses limit is explicitly labeled.

## Local qualification

`pnpm test:workspace-clarity` exercises 357 Evidence records, 320 findings, 320 list-count inputs, and 300 saved analyses. It checks all batches, tail-record search, visible-only selection, filter reset, mobile Back state/focus, deep links, Settings eligibility, disclosure state, and note-feedback placement. Server actions are replaced with throwing stubs.

Additional passing suites: homepage, Intelligence experience/lifecycle, briefings and preflight, Saved Analyses, KPI semantics/target persistence/colors, spatial UI, reports, Business Notes/context, Evidence UI, overview insights, and structural v1. Two pre-existing calendar-sensitive fixtures now pin their intended scenario clocks; business rules and expected outcomes are unchanged.

Full TypeScript and ESLint pass (58 pre-existing warnings, within the existing 59-warning limit). Independent focused reviews found and corrected stale Performance-detail and Evidence response-feedback issues, then found no material remaining issue.

## Browser qualification

Run `node scripts/workspace-clarity-preview.cjs` and open `http://127.0.0.1:3155/app/intelligence`. This local-only preview uses actual changed client components and the actual Settings page with explicit synthetic server dependencies. It reads no credentials or environment configuration, binds loopback only, blocks non-GET requests and network/form submissions, and throws on server mutations.

Desktop and 390-pixel phone-width checks verified the menu, route labels, finding selection/Back with retained batch and focus, Settings disclosures, Evidence draft retention, 350-record filtering/visible-only selection, and Saved Analyses pagination/filtering/search through 300 records. No horizontal overflow was observed on those phone-width screens and no application console errors were observed in the qualified four-screen fixture.

Performance is covered by its focused tests and unchanged semantic suites, not by this client-only preview; its server-composed full page remains a preview-deployment browser check. The hosted preview built successfully, but its authenticated page was gated by Vercel sign-in during this inspection. This is not a live Production or database qualification.

## Review corrections

The first hosted code review identified three reproduced edge cases: selecting more than the existing 100-record action limit, generic source feedback being mistaken for note feedback, and a filtered-out finding leaving the desktop detail pane blank. Focused regressions cover the corrections without widening server limits or changing business rules.

The first CI verify job stopped at a historical Square dormancy diff-scope assertion. Its correction allows only the exact reviewed workspace UI paths and the note-feedback URL file; neighboring paths and unrelated backend changes remain rejected. The Catalog and four Order parser suites and the architecture boundary regression passed locally after this correction. No QBO failure is waived by this change.

## Delivery boundary

Production records, Square connection and saved Payments, imports, purchases, and configuration were not changed. No QBO test or branch protection was changed. Exact-head CI and hosted review must be reported separately; no pre-existing CI exception is presumed for this candidate.
