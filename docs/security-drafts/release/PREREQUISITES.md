# Owner canary and provider prerequisites

These are status/data prerequisites for a later approved release, not permission
to connect, import, change settings or generate now.

## Eligible owner workspace

- An unambiguous existing workspace and signed-in active owner with a live session,
  valid subscription/usage authority and available budget. No role or billing
  exemptions are created by this release.
- Current eligible stored evidence from at least two distinct providers, with
  genuine protected entity correspondence. For the qualitative Square/QBO result:
  a completed Square payment from its active mapped merchant/location and a valid
  current QBO source version with its accepted validation/mapping/generation and
  declared accounting currency/basis/date or report period. A connected label alone
  is insufficient. Do not fabricate a mapping from names.
- For legacy connectors, the owner reviews the actual current connection and
  confirms its canonical business entity through the new mapping UI. A disconnected
  or replaced installation cannot reuse its old binding. Katana needs its new
  nonce boundary initialized during the approved quiet period.
- A five-provider live claim requires eligible real data from five providers.
  The implementation has no five/ten-connection cap, but a 12-provider synthetic
  fixture is not evidence that those providers are populated in this workspace.
- If files/notes are included, use processed, approved, current indexed facts,
  valid source/review/publication lineage, and approved current note versions.
  Raw uploads and unreviewed extraction are not model evidence. Restrict the
  initial canary to the stored native/reviewed branch already qualified; new OCR
  execution and ingestion are outside this release check.
- Privacy and retention must permit every original and inherited source. Exclude
  unverified legacy attribution; do not refresh a ticket to restore expired access.
  Confirm no regulated/personal content outside the user's authorization is sent.

## Sheets provider packet — statuses only

An authorized operator confirms these for the actual production destination:

1. `GOOGLE_SHEETS_OPENAI_API_KEY` is configured: yes/no/unknown. Never send its value.
2. The key's issuing project and organization match the configured Sheets project
   and organization: match/mismatch/unknown. No IDs or environment export needed.
3. The applicable provider data controls are verified: give the control names and
   verified status. Do not infer Zero Data Retention from variable presence.
4. The deployed ticket classification is checked immediately before transport,
   Sheets uses the dedicated OpenAI destination, and no general-provider fallback
   can send Sheets-derived content elsewhere.

The Vercel metadata route previously returned 403; it remains blocked. Use an
authorized human attestation or a separately approved exact status-only inspection,
not another route around that denial. No configuration changes are assumed.

This packet is needed when the authoritative ticket contains Sheets or inherited
Sheets content. Naming only Square/QBO in the question does not make that ticket
non-Sheets: discovery and inherited context can still include Sheets. A truly
non-Sheets ticket uses the existing general provider policy; do not force its flag.

## Acceptance and explicit capability limits

For both one saved VSI answer and one saved brief, require a useful relationship
supported by citations to two distinct original plugins, faithful entity/period/
currency labels, no double counting, no unsupported causal explanation, and exact
saved-output/citation reopening under the same owner/workspace. Wrong workspace,
another actor's private VSI copy and revoked originals must remain inaccessible.

The first supported relationship is qualitative: Square payments and QBO accounting
represent different stages; POS payments are not profit and must not be added to
accounting activity as extra sales. Actual reconciliation additionally needs typed
revenue/expense, common basis/period and refund/tax/timing/transaction correspondence.

Sales per labor hour is not implemented from current coverage contracts. It needs
complete comparable sales/time aggregates, workforce scope, time boundaries and
currency-unit authority. Inventory-to-file/note conclusions need approved,
version-bound item/entity/period relevance; current aggregate snapshots and
workspace-level reported text do not supply it. More records or owner mapping
alone cannot create either contract. Keep separately cited context and clear
limitations until those adapters supply trustworthy inputs.
