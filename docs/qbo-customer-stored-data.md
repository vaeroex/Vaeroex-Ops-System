# QBO Customer Stored Data: Bounded Product Surface

The customer surface reads stored QuickBooks data without calling the provider, reading credentials or invoking a model. `QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED` controls its availability. The data route calls `notFound()` before authentication when the gate is false; enclosing application boundaries can still determine the rendered page and HTTP status. Settings navigation and the Intelligence diagnostic are owner-only and use the same gate. Source browsing does not write source records, promote KPIs or change Square behavior.

## Product Contract

`/app/settings/integrations/quickbooks/data` is a dynamic, uncached server-rendered owner-only page. It reads stored source data using the authenticated session, not a service-role client. A disconnected connection can retain readable history; inactive business entities and deleting/deleted connections cannot. A connection with no eligible current sources shows zero **stored records**, never zero business activity. No connection also renders an explicit empty state. The live connection/data population is not established by these offline tests.

Meaningful deterministic outputs:

- Exact current-source counts for one selected connection and source category, across all pages, grouped by transaction/report type, lifecycle and validation state. The unit is a source identity, not a sale or economic event. No monetary fields are aggregated.
- Exact missing-currency, unknown-accounting-basis, missing-source-time-zone and missing-transaction-posting-date counts for that same stored population.
- Min/max stored posting dates and observed timestamps, plus latest stored synchronization timestamp. These are extents, not continuous import coverage, a checkpoint, successful-sync proof or provider freshness. Completeness and reconciliation remain explicitly unknown; no percentage is manufactured.
- The six supported reports (`ProfitAndLoss`, `BalanceSheet`, `CashFlow`, `ARAgingSummary`, `APAgingSummary`, `TrialBalance`) expose their actual minimized column labels and cell strings under **QBO-reported**, nonadditive observations. No report row is interpreted as a Vaeroex KPI. No numeric parsing, FX conversion, chosen "latest" basis, semantic row matching or cross-report calculation occurs.
- Twelve transaction types expose individual stored `total` and `balance` fields, their currency, status and posting date. These fields are document values, not recognized revenue. `home_total` is intentionally excluded because the current minimizer labels it with the source currency; this surface cannot repair that upstream ambiguity.
- `lib/integrations/qbo-customer/observations.ts` additionally projects deterministic supporting observations only when the selected source and mapping are active, current source validation and native work are both valid, and the minimized preview is available. Record status must also be explicitly active. It emits at most two document fields or 12 native summary rows, with preserved strings, source currency/basis/time provenance and truncation status. No labels are matched to metric names; values are never summed, parsed as numbers or converted. Missing fields are unavailable, not zero. It reuses the existing `ContextualEvidenceAuthorityV1` type without importing runtime intelligence producers. The output explicitly remains untrusted, nonadditive, not original evidence, and not connected to snapshot intake. Its current-read source handle is not represented as an immutable citation.

Reports, invoices, payments, deposits and Square payments remain separate observations. An invoice and payment for USD 100 plus a QBO report total of 100 and a Square payment of 100 do **not** produce a combined 400, nor a deduplicated 100 claim. No matching semantics have been established. Replayed **versions of the same source identity** do not create more displayed sources, because only `current_version_id` is joined. Separately persisted identities/connections are not silently deduplicated.

## Read Contract And Authority

`public.qbo_customer_source_browse_v1(p_workspace_id uuid, p_connection_id uuid = null, p_after_id uuid = null, p_source_id uuid = null, p_kind text = 'all') -> jsonb`.

The server derives workspace selection from `getCurrentWorkspace()`, validates `requireAuth()` and current JWT claims, and requires active owner membership. SQL independently derives the actor and session from `auth.uid()` / `auth.jwt()`, requires `auth.role() = 'authenticated'`, a live session bound to an undeleted/unbanned user, and active owner membership. An expired finite `auth.sessions.not_after` is denied; NULL retains the existing Square session policy. Supabase verifies JWT validity at the request boundary. Caller-supplied actor/session/role/entity values are never accepted.

Each query joins workspace + business entity + connection + exact provider mapping + exact current version + provider record identity. Only production `quickbooks_online` provider sources are eligible. The entity must be active. The exact historical mapping may be active/inactive/replaced but must have `verified_at`; pending/unverified mappings are excluded. Mapping status is shown. Master data is outside this view. Sources with missing/broken current-version linkage are excluded, so even exact source counts do not assert provider population completeness.

The function is `STABLE SECURITY DEFINER`, owned by postgres, with empty `search_path` and fully qualified relations. Dependency preflight requires existing ENABLE/FORCE RLS on the five source/scope tables; runtime also requires ENABLE/FORCE RLS on the separately created validation-work table. The migration changes no existing table, policy or grant. A definer can bypass RLS: explicit owner/session/tenant/entity predicates are therefore mandatory and tested. PUBLIC/anon/service_role execution is revoked; only authenticated receives execute. The private immutable projection helper has no direct customer execute grant. No source-table SELECT grant is added.

The allowlist removes provider/realm objects, sync tokens, fingerprints, raw payloads, validation issues, credentials, internal pipeline IDs, cell IDs, relationships and line items before the authenticated RPC response. Connection/source UUIDs are opaque navigation handles only; the native transaction document ID is business provenance. No raw projection fallback exists. A single selected preview is limited to 128 KiB stored JSON; oversize projections return metadata and `oversized`. Malformed/mismatched safe projections are unavailable, not coerced into zeros. Report strings remain untrusted text and React escapes them.

Concrete bounds: 100 connection choices (101 fails explicitly), 25 source rows/page, UUID keyset ordering, one selected source preview, at most 200 report rows, 16 columns and nesting depth 12 (root is level 0). Truncation is disclosed. Native report row hierarchy and summary/data/section roles are retained; no mathematical interpretation is added. Records have no line-item preview. Next-page cursors and selected sources must belong to the same authorized connection/category. Pages are separate request-time snapshots; inserts/updates during paging can change coverage. First page restarts enumeration. Exact counts scan the authorized stored population; query-plan/load qualification on representative history is still required, not claimed by the small fixture.

## Validation State

This surface reads `external_source_records.current_version_id/lifecycle_state` and `external_source_record_versions.validation_state/change_kind/normalized_projection/prior_version_id`, accounting and temporal columns, plus verified mapping scope. It also reads **only the work status** from `private.qbo_production_source_validation_work`, bound to workspace/entity/connection/mapping/source identity and either `source_version_id = current_version_id`, or `completed_version_id = current_version_id` with `source_version_id = prior_version_id`. No work/task/claim IDs, fingerprints or worker metadata are returned. No native task is claimed/completed.

Ordinary validation appends a version. A deletion tombstone instead retains its exact immutable source version and NULL `completed_version_id`; its work status can be valid or quarantined. The native completion RPC permits valid work for a structurally accepted deletion only after a serialized no-downstream-effects check. Existing effects require the separate retraction path. The reader does not repeat that check or convert work acceptance into economic authority. An accepted deletion can therefore display immutable validation `pending`, review `valid`, and lifecycle `deleted` together. Deleted previews remain withheld, and the accounting-observation projector excludes every non-active lifecycle regardless of work validity. No pre-deletion amount is substituted.

`pending` can be inspected as explicitly unvalidated stored data. `valid` means source-contract validity only, not economic authority. Work quarantine overrides a stale immutable label, including a pending tombstone. Work pending/claimed/superseded prevents a stale valid display; superseded/conflicting results also block previews. Multiple matching work records are treated as conflict/quarantine, never arbitrarily resolved. Safe source-review states and their exact counts are visible separately; absent work is "Not recorded," not proof of validity. `invalid` and `quarantined` retain metadata/counts but withhold preview values. `deleted` and `unavailable` also withhold values. A pending voided source is marked voided; displayed historical document fields are never active sales. If native validation quarantines it, the preview disappears while the lifecycle/count remains visible. No browser action promotes, retracts or revalidates anything.

## Intelligence Pathway: Gap And Minimal Next Step

The smallest product integration is implemented without evidence promotion: the existing `app/app/intelligence/page.tsx` renders `QboIntelligenceDiagnostic` behind the same QBO gate and owner check. It performs one first-page, all-category browse RPC, rechecks the current authenticated workspace against the page workspace, and projects only safe connection labels, read time and exact diagnostic counts. No selected detail is requested; no further pages or provider data are fetched. The default connection is explicitly labeled, never a cross-connection rollup. Unavailable data has no fabricated zero counts. The customer section is titled "QuickBooks record status" and links to authorized stored data; counts do not enter findings, evidence diversity, snapshots, KPIs, briefings or model inputs. The unavailable view and mobile/tablet drill-through are covered by synthetic browser tests.

**Unavoidable gap:** no existing production QBO source-to-evidence producer is wired into snapshot intake. This current-version browser deliberately omits immutable internal version/fingerprint identifiers and is not an as-of evidence snapshot. Passing its output straight to an existing manifest would lose critical trust/validation/basis/currency semantics and create unstable citations when `current_version_id` changes.

Reusable integration anchors:

- `lib/integrations/control-plane/square-workspace-evidence.ts`: authenticated, no-cache read pattern, but explicitly sandbox-host/database-only; not a production QBO evidence reader and not changed here.
- `lib/ai/evidence-engine/contracts.ts`: structured `EvidenceCandidate` / retriever / manifest contracts. Candidates require `eligible: true`, active lifecycle, confidence/quality and lineage fields. There is no typed external-input trust, accounting basis, currency or validation field. Do not invent confidence values to force QBO through this contract.
- `lib/ai/evidence-engine/source-registry.ts`, `manifest.ts`, `citation-verification.ts`: application-generated source registry, immutable manifest and citation checks can be reused once a safe producer contract exists. `supporting`, `originalEvidenceEligible: false` and no independent economic-source assertion are the appropriate initial bounds, not "original revenue evidence."
- `lib/intelligence/snapshot/v1/adapters/evidence.ts`: consumes manifests, currently sets evidence lifecycle to active and does not retain QBO accounting/validation/trust metadata. It cannot represent pending/quarantined/voided source observations faithfully without a deliberate contract change.
- `lib/intelligence/snapshot/v1/composition.ts`, `builder.ts`, `schema.ts`, `invariants.ts`, `fingerprints.ts`, `projections.ts`: versioned producer envelopes, fingerprints, invariant checks and deterministic snapshot projections. `app/app/intelligence/page.tsx` currently supplies intelligence/contextual evidence, not a QBO evidence manifest.
- `lib/ai/evidence-index.ts`: existing memory retrieval and indexing pipeline is not a harmless QBO browse adapter. This implementation does not call it or create embeddings/model requests.

Requirements for a future source-evidence integration:

1. Add a separately authorized, bounded as-of source-evidence reader/producer with immutable version binding, workspace/entity/source/connection lineage, source hashes kept server-side, provider observation timestamps, validation/lifecycle, source basis/currency, `untrusted_external_input`, `additive: false` and explicit no-economic-promotion policy. Revalidate session and tenant scope on every citation read. The browse page is not that read API.
2. Extend the evidence/snapshot contracts and adapters to preserve those qualifiers end to end. Admit only a deliberately defined eligible subset (initially active, source-valid QBO observations as supporting context); pending/invalid/quarantined/voided/deleted observations remain diagnostic coverage information, not eligible active business evidence. Keep counts diagnostic rather than evidence corroboration or source diversity.
3. Build application-generated citations bound to the exact immutable version and an authorized detail route, with downgrade/deletion/permission rechecks. Construct a deterministic manifest/snapshot on an explicit user action; keep model dispatch, vector indexing and economic/KPI producers absent. Test injection strings as inert provider text, stale citations, as-of boundaries, cross-tenant claims and replay/source-independence cases before wiring any later user-requested explanation.

No existing source registry, canonical normalizer, reconciliation classification or shadow flag authorizes promotion by itself. `lib/integrations/deterministic/registry.ts`, `lib/integrations/reconciliation/classifier.ts`, `contributions.ts`, `shadow-projection.ts` and `lib/integrations/persistence/reconciliation-commands.ts` remain separate contracts. `projectLegacyKpiShadowCandidate` sets `shadowOnly: true` and `promotionAuthorized: false`; it is not a QBO/Square match engine. Native source validation is necessary but does not choose authoritative sales versus invoices, prove settlement links, allocate tax/tips/refunds, reconcile cash versus accrual, certify report/detail equivalence or authorize recognized-revenue contributions.

## Migration Workflow And Verification

The repository stages forward-only production migrations from `supabase/production-migrations` into an isolated reviewed ledger, separate from mixed sandbox `supabase/migrations`. The customer read function is defined in `20260930003000_qbo_customer_source_browse.sql`. Historical sandbox migrations and prior Square qualification results are not deployment authorization for this reader.

Deployment requires a reconciled production ledger, the approved prerequisite sequence, security tests on the fully staged disposable baseline, verified auth/session schema and catalog privileges, representative query plans, and review of the output allowlist. `03000` defines a PL/pgSQL reader before `20260930004000` creates its validation-work table. Reads **fail closed** until that table is present with forced RLS; security assertions require both migrations. There is no fallback that hides native work status. PostgREST schema-cache visibility must be checked after deployment. Gate enablement is a separate release decision after qualification.

Offline verification uses pinned **devDependency** `@electric-sql/pglite@0.3.14` from `electric-sql/pglite`; it is not a runtime dependency. Tests load no `.env`, live database, provider or model clients. Normal package resolution is the default; `QBO_TEST_PGLITE_MODULE` is an optional local override, not a CI prerequisite.

```sh
node --test scripts/qbo-customer-source-browse-tests.cjs scripts/qbo-customer-server-tests.cjs
node scripts/qbo-customer-browser-tests.cjs
node scripts/qbo-customer-browser-tests.cjs --serve
node node_modules/eslint/bin/eslint.js lib/integrations/qbo-customer app/app/settings/integrations/quickbooks/data/page.tsx scripts/qbo-customer-*.cjs
pnpm test:qbo-production-database --supabase-local
```

The PGlite harness executes the **unmodified candidate SQL** against minimal dependency tables, with real database roles and synthetic JWT/session rows. It tests installation before the validation-work relation exists and runtime failure while that relation is absent. It is not canonical Supabase migration qualification or real authentication.

`supabase/tests/qbo_customer_source_browse.test.sql` is a standalone native pgTAP behavioral suite for the fully staged baseline. It includes the shared `fixtures/qbo-production-native.sql`, uses native scheduling, commit and validation paths without disabling guards, and rolls back its synthetic data. It covers owner/session/tenant checks, empty coverage, replay, pagination, separate report/detail observations, minimized provenance, pending/valid/quarantined work and tombstones, and absence of browse writes or economic promotion. `scripts/run-qbo-production-candidate-database-tests.cjs` runs the full migration chains in disposable databases. Its `--supabase-local` mode requires Docker and uses a newly owned container; native mode requires the PostgreSQL binary directory configured by `QBO_TEST_POSTGRES_BIN`. A passing PGlite result does not substitute for full-chain qualification.

Browser tests serve the actual React components, project CSS and candidate RPC from a loopback-only synthetic fixture and close it after checks. They capture overview, report, blocked, empty and Intelligence diagnostic screenshots in temporary test output. Viewports are 1440, 1024, 768, 390 and 320 pixels. Set `QBO_TEST_CHROME_EXECUTABLE` to an installed Chrome executable if Playwright has no downloaded browser. Every run uses a fresh profile, never a user's authenticated session. `--serve` prints a random loopback URL and leaves only synthetic fixture data available until Ctrl-C. Preview-only `?fixture=unavailable`, `?fixture=denied` and `?fixture=query` exercise the real blocked component; `?fixture=intelligence` and `?fixture=intelligence-unavailable` exercise the isolated Intelligence diagnostic, not other Intelligence producers. Previewing adds no application authentication bypass or deployment flag.

For an independently started **gate-off, nonproduction loopback build**, run `node scripts/qbo-customer-browser-tests.cjs --gate-off-origin=http://127.0.0.1:PORT`. This mode starts no server, touches no fixture database, uses no authenticated browser state, and permits browser requests only to the two local QBO page URLs and local static assets. Its default assertion requires the rendered workspace/root not-found heading and absence of QBO source regions, report/document values and action forms/buttons at desktop/mobile widths. For a deliberately unconfigured build, add `--gate-off-boundary=configuration` to assert the explicit "Connect Supabase to continue" boundary instead. A configuration-boundary result proves UI unavailability, not route-level `notFound()` execution; the focused source test checks the latter before authentication. HTTP 200 can accompany an enclosing application boundary or streamed not-found content. HTTP status alone is never sufficient, and this mode must not target a live deployment.

## Settings Navigation

`app/app/settings/page.tsx` renders an owner-only stored-data link after `ConnectionStatusPanel` inside the gated accounting section. The link remains available when there are zero current connections so stored disconnected history is reachable. It does not reuse generic `canManage`, which also admits admin/manager.

The QBO `ConnectionStatusPanel` action prop is explicitly owner-only, matching QBO API authorization. Generic `canManage`, the Square section and the generic panel implementation retain their independent access rules.

Navigation pattern:

```tsx
{context.membership?.role === "owner" ? (
  <Link href="/app/settings/integrations/quickbooks/data"
    className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-vaeroex-blue">
    <FileText aria-hidden="true" className="h-4 w-4" />
    View stored QuickBooks data
  </Link>
) : null}
```

`qboBrowseHref` returns a typed Next `Route` for its fixed local pathname and validated URLSearchParams, including its bounded detail anchor. No typedRoutes relaxation is needed.

## Required Deployed Checks

Release verification requires production-like PostgREST JWT/RLS checks for active, revoked, expired and swapped-workspace sessions; deployment/recovery rehearsal; disconnect/reconnect and remap histories under concurrent changes; representative query-plan/response-size/load limits; and the deployed page behind the disabled gate before customer enablement. Offline fixtures do not establish these conditions, current live population, economic reconciliation or continuous temporal coverage. Qualification results, artifact hashes and release-specific approvals belong in the release evidence, not this design contract.

## Implementation Files

Customer surface and tests:

- `lib/integrations/qbo-customer/contracts.ts`
- `lib/integrations/qbo-customer/server.ts`
- `lib/integrations/qbo-customer/observations.ts`
- `lib/integrations/qbo-customer/view.tsx`
- `lib/integrations/qbo-customer/diagnostic-view.tsx`
- `lib/integrations/qbo-customer/intelligence-diagnostic.tsx`
- `app/app/settings/integrations/quickbooks/data/page.tsx`
- `supabase/production-migrations/20260930003000_qbo_customer_source_browse.sql`
- `supabase/tests/qbo_customer_source_browse.test.sql`
- `scripts/qbo-customer-test-support.cjs`
- `scripts/qbo-customer-source-browse-tests.cjs`
- `scripts/qbo-customer-server-tests.cjs`
- `scripts/qbo-customer-browser-tests.cjs`
- `docs/qbo-customer-stored-data.md`

Page integration points:

- `app/app/settings/page.tsx`: gated owner browse link and owner-only QBO action prop.
- `app/app/intelligence/page.tsx`: gated owner diagnostic component only; no producer input changes.

The shared native fixture, validation runtime, QBO API routes and candidate database runner are dependencies of this surface, not alternate source-authority or economic-promotion paths.
