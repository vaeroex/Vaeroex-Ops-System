# Smallest remaining evidence handoff

No credentials, tokens, customer records, imported files, report text or secret
values are needed. No denied operation was retried. This is a request for an
authorized administrator to provide existing configuration/definition evidence;
it is not permission to change production settings or schema.

## Plain-language request for Isaac

“We can finish the local implementation without your laptop. Before release, an
authorized database administrator needs to confirm the exact installed source
guards and their dependencies. Please provide the metadata below, or explicitly
authorize that exact metadata-only inspection. Separately, confirm whether the
production Sheets-specific OpenAI configuration points to its intended project
and organization and has the required data controls. Send only yes/no/unknown
statuses, never key values, tokens, customer data or environment exports.”

## Database packet, metadata only

For these two previously denied lookups, supply schema, complete argument types,
return type, language, owner, security-definer flag, search path, execution grants,
definition and applied migration version:

- `public.read_google_sheets_operational_conflicts_v1`
- `private.guard_google_sheets_kpi_authority_v1`

The definition must be checked for literal secrets before sharing. If it contains
one, do not send it: report that the definition requires a secure review. A hash
alone verifies equality only when the corresponding exact source is available.

The same packet must close the already identified direct dependencies:

- `private.google_sheets_unmaterialized_file_v1` and
  `private.reject_explicit_regulated_business_text_v1` (no local definition).
- `private.enforce_workspace_persisted_limit_v1`,
  `private.guard_workspace_mutation_entitlement_v1`,
  `private.protect_business_entity_identity_v1`,
  `private.google_sheets_operational_source_current_v1`,
  `public.bind_google_sheets_read_v1`,
  `public.google_sheets_record_readable_v1`,
  `private.google_sheets_exact_delete_allowed_v1`, and
  `private.google_sheets_file_metadata_without_analysis_v1` (local source exists;
  exact installed equality/compatibility has not been established).

Include trigger bindings/order/enabled state, table columns/constraints/RLS/grants
and called-function dependencies for the source/artifact relations listed in
`12-workspace-writer-fence.sql`. Compare the source-writer functions named in
`REMAINING-QUALIFICATION-CONTRACTS.md` with their repository versions. Return any
additional relation/function dependency names before expanding the review; do not
export the entire database or query customer rows. Reuse the 27 captured audited
bodies where applicable. This is the minimum dependency closure, not a request for
new audit cycles or a claim that the two denied definitions alone finish it.

## Provider packet, yes/no/unknown only

For the production deployment, an administrator with existing authorized access
confirms:

1. A dedicated Sheets OpenAI key is configured (no value).
2. Its issuing project and organization match the project's configured selection
   and the intended Sheets destination (report match/mismatch/unknown, no IDs).
3. The required provider data controls are enabled for that destination (report
   the control names and verified status; do not assume Zero Data Retention).
4. The deployed code uses the reviewed ticket classification/revalidation path,
   with no general-provider fallback for Sheets data.

The denied Vercel configuration route stays blocked. Do not substitute another
tool to obtain the same denied information. Local mocked transport tests establish
application behavior only. Actual destination/control attestation still needs
an authorized operator or a separately approved exact metadata inspection.

## What can and cannot finish independently

**Independent local work:** owner-confirmation UI, typed RPC validation, known-table
workspace writer fence, deterministic refusal/rollback tests, and isolated native
test preparation. All remain disabled and unpublished under the current scope.

**Cannot certify without the database packet:** complete installed trigger/reader/
writer composition, full authority dependency coverage, and production-safe fence
installation/rollback. Synthetic placeholder tables are not production evidence.

**Cannot certify without the provider packet:** the actual destination and its
data controls. No amount of parser or SQL tests establishes those settings.

**Separate semantic prerequisite:** source coverage, entity correspondence,
time-zone/period and unit authority must support the chosen business comparison.
Current projections do not establish complete Square payment totals, complete
business labor coverage, or a measured file/note denominator. Therefore payment
per labor hour and waste share cannot be activated truthfully from these contracts.
The current cross-plugin invoice/order non-additivity result remains supported;
neither metadata approval nor connected labels turns it into cash reconciliation
or productivity. No new data import is requested by this handoff.
