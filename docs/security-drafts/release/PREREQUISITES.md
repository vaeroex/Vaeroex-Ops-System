# Owner canary and provider prerequisites

These are status/data prerequisites for a later approved release, not permission
to connect, import, change settings or generate now.

## Eligible owner workspace

- An unambiguous existing workspace and signed-in active owner with a live session,
  valid subscription/usage authority and available budget. No role or billing
  exemptions are created by this release.
- Current eligible stored evidence from at least two distinct providers, with
  genuine protected entity correspondence. For a future qualitative Square/QBO result:
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

Already established through owner-supplied non-secret evidence and signed-in
OpenAI UI: production key entry present; configured project matches the selected
Default project; organization identifiers match exactly; the named dedicated
production Sheets key is listed in that project. Masked fragments and key names
cannot establish equality of secret bytes. Do not request or reveal them.

Before a live Sheets-bearing canary, the owner/operator verifies only:

1. The configured production `GOOGLE_SHEETS_OPENAI_API_KEY` was issued for that
   dedicated project/organization and corresponds to the intended active key:
   confirmed/unknown. Attest from configuration provenance; never paste the key.
2. OpenAI **Data controls → Sharing**: API input/output sharing **Disabled**;
   feedback sharing **Disabled**; evaluation/fine-tuning data sharing **Disabled**
   for the applicable organization/project. Current status, not an old screenshot.
3. Existing disclosed standard retention is acceptable. **Data Retention → API
   logging: Enabled per call** is compatible with that policy; it is distinct from
   data sharing and does not prove Zero Data Retention. ZDR procurement is not required.

Source and prior tests establish dedicated OpenAI routing, `store:false`, ticket
classification immediately before transport and no general-key/NVIDIA fallback.
These must remain intact on the exact deployed artifact. A successful answer or
ID comparison does not attest deployed secret provenance or current data controls.

The recorded Vercel action was environment-variable metadata listing with
`decrypt=false`; it returned **HTTP 403: You don't have permission to list the
project environment variable.** The raw endpoint/request ID was not retained.
That provider permission rejection remains respected; no metadata retry,
decryption or alternate access route is part of this local package.

This packet applies whenever the authoritative ticket contains Sheets or inherited
Sheets data, even if the question names other providers. A genuinely non-Sheets
lineage uses the existing general provider policy; never force classification.

## Last verified eligible-data state

No rich eligible real Square/QBO pair was established in the last scoped check.
The previously saved/reopened Sheets answers prove only that tested single-plugin
path, not current cross-plugin readiness. A rich real merchant pair
is not an immediately obtainable prerequisite. A production deployment may be
reviewed while gates remain false, independently of a later live merchant claim.

Use an actually available eligible distinct-plugin pair only after verifying its
current stored authority/mapping. Processed approved files and notes can supplement
Sheets and support a cited contextual demonstration, but are not a second plugin.
Genuine provider-sandbox/model acceptance needs the separate explicitly sandbox
bridge/environment authorization; that work and old VM are excluded here. Do not
copy sandbox records or credentials into a merchant production workspace or invent
mapping/coverage. No account purchase is assumed.

## Acceptance and explicit capability limits

For one saved VSI answer (including a requested executive brief), require a useful relationship
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
