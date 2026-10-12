# Google Sheets erasure qualification — October 12, 2026

## Exact migration identities

| Version | Purpose | SHA256 |
| --- | --- | --- |
| 20261002225025 | Owner approval foundation | `4ac30e7a57290eb554c7edfff2672b59ae59458dca632f5d269915f6f8c8b33b` |
| 20261012191836 | Restricted execution, lineage, retention and recovery | `107075b9e5ecfba7235bd98d911ee320dde614ef6eed4f689c414d1f6c2209c8` |

Canonical and production candidate copies are byte-identical. No migration was applied to Production by this qualification.

## Production dry run

The live Production ledger contains **141 applied migrations**, ending at `20261012091842`. An isolated stage contained those exact 141 files plus the two candidates: **143 staged files**, all hashes checked. Both the migration-list result and direct ledger count confirmed 141; the ledger was identical after the dry run.

Official Supabase CLI **2.111.0** ran `db push --linked --dry-run --include-all` successfully against project `mdiianhfrojmxqpwrflh`. Its only pending migrations were the two versions above. Roles and seeds were empty. `--include-all` was required because the reviewed October 2 approval version predates migrations already present in Production.

- [Sanitized dry-run receipt](production-dry-run-receipt.json)
- [Sanitized CLI output](production-dry-run.log)
- [Every staged filename and SHA256](production-staged-manifest.json)

The CLI dry run enumerates pending files; it does not execute or validate the migration SQL.

## Separate local execution qualification

The **146-migration canonical chain** is a different historical chain from Production's 141 applied versions. All 146 migrations, including the final `107075b9` candidate, applied successfully in an owned native PostgreSQL database with synthetic Supabase platform prerequisites. The rehearsal also passed four exact VSI policy catalog checks and the complete existing VSI pgTAP fixture (**10/10 assertions**). The cluster was stopped afterward. See [final canonical proof](canonical-bootstrap-proof.json); the [prior proof](historical-33677930/canonical-bootstrap-proof.json) remains historical.

- Restricted database suite: **95 checks**, plus **103 connector baseline checks**.
- Final native operator rehearsal (`107075b9`): **48 checks**, plus **103 connector baseline checks**. Covers actual competing writers, stale tickets, uncertain execution acknowledgement, exact-hash conflict rollback, expired approval withdrawal and fresh approval, isolated physical-cluster backup/restore with ACLs, and external-witness reconciliation after local journal loss.
- Architecture manifest suite: **585 assertions**.
- Scoped test lint: no warnings. Whitespace check passed.

Synthetic qualification does not provision or qualify live operator identities, GCS IAM, signing material, provider keys, or the external Storage checkpoint. Those remain release gates.

## Scoped review

Reviewed the final private-table revokes and forced RLS, public function grants and caller checks, support/restore role split, restrictive expiry SELECT policies, metadata cutoff, and the authenticated publication bridge. Three actionable review findings were corrected in `2bb06fa0`: empty-witness restore finalization, cursor pagination past held expiry work, and preventing unknown legacy provenance from becoming clean through a new ticketed copy. Focused regressions also verify immutable ticket changes cannot relabel legacy rows. This does not replace the explicit deployment transition and live operational gates in the release plan.

The final candidate also exposes a restricted exact-artifact hash preview to support, with no raw table access. Its role, tenant and output-shape denial checks passed. The hosted VSI catalog assertion was scoped to its original named policy after the new restrictive expiry policy made its old scalar query ambiguous; the ten security assertions remain intact.

## Final compatibility and transport checks

The exact CI workspace database group passed all13scripts on native PostgreSQL17.11, including148 workspace authorization assertions and the four existing Sheets dispatch/recovery suites. The source-evaluating fixture now supplies the actual strict read-ticket helper and verifies preservation of each workflow's original authority; no authorization assertion was removed. See [compatibility receipt](workspace-database-qualification.json).

The official Production dashboard certificate validates the project-specific direct endpoint over TLS1.3, including hostname verification, both with an explicit CA and unchanged Node TLS using `NODE_EXTRA_CA_CERTS`. No credentials or SQL were sent. The shared pooler is excluded because the current endpoint pin is host/port/database based. See [nonsecret TLS receipt and CA fingerprint](production-operator-tls.json). The CA must be copied into persistent operator custody before live use.
