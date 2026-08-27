# Production migration-history reconciliation

This note records the verified migration-history state for Supabase project
`mdiianhfrojmxqpwrflh`. It does not authorize or execute migration-history repair
or migration SQL.

The current Production ledger was reverified on 2026-08-27 with 75 unique rows
and fingerprint
`ef87be4520d35e5ab7a443c5fe2c359f3aaa3be1910de89610d2a7de24bcc08a`.
All 60 canonical/history-only reconciliation versions are present, all 42 paired
remote aliases are absent, and the four recovered historical Production versions
below remain present exactly once. No further history repair is required for
those sets.

## Canonical historical Production migrations

The four files below were recovered from Production's applied migration
statements and are committed without rewriting, modernization, consolidation,
reordering, or renaming.

| Version | Historical purpose | Raw SHA-256 | Whitespace-normalized SHA-256 |
| --- | --- | --- | --- |
| `20260618025749` | Restores the authenticated creator-read workspace RLS policy used during workspace setup. | `acac92fa4f16fad3ed4e8a4c21e092b178fdd8b69cdc0c9f5ab2e1da1b1ef4fa` | `f0921c7b0b83be1acba50ed78f6cbfe072780300cffd21ea7ab7897cb814ee35` |
| `20260713204716` | Removes anonymous execution from the two lifecycle RPCs. | `f12707c2c81db0085abdd165e775edb404bae8a879f33df82e16f329535a5b96` | `365902b81e16ddf663b3e42bd23cde15cb5ea47d2731d0f4a642108637e92064` |
| `20260726042242` | Narrows Business Notes table and future-table default privileges. | `adb6b91104257f3326d8008a7a81b4d2219818d2c1492ee107ad9d9a8f3a78ca` | `e539dd877fee7deb2eb0e75872acb1f85c815ff91abe0fc19b1fd2afe562d166` |
| `20260727013628` | Narrows the agreement-email delivery table service-role grant. | `a8017ecda61f7f4bc2fbeef20f1f2ba43c7ff271dff964a76fe0db51e6c327ac` | `9eb2fcfa35043f37072b0644a696cff6a782f69647d6eef3c85ff91fd96d44ed` |

Each effect is present in the live Production catalog. These versions are
legitimate Production lineage and must remain recorded as applied; they are not
aliases and must never be marked reverted during reconciliation.

## Verified canonical applied migrations

The four versions below were previously described as genuinely pending. A fresh
read-only Production catalog proof established that each ledger row and each
intended schema effect is already canonical. They must remain applied and must
not be marked reverted or replayed.

- `202607110001_business_memory_evidence_eligibility.sql`: the exact function
  signature, body, stable volatility, invoker mode, `postgres` owner,
  `public, extensions` search path, and intended execution grant are present.
- `20260731071855_business_health_generation_claim.sql`: the exact unique index,
  predicate, and comment are present. There are zero conflicting groups across
  11 qualifying rows.
- `20260811233219_restore_manual_activation_review_rpc.sql`: the exact canonical
  invoker function body is present with an empty search path and execution
  restricted to `postgres` and `service_role`.
- `20260817185529_intelligence_briefing_storage_contract.sql`: all three exact
  indexes and comments are present, both target tables have RLS enabled, and the
  exact canonical `soft_delete_saved_analyses` invoker function is present with
  an empty search path and authenticated execution. There are zero generation
  conflicts across the one qualifying Intelligence Briefing row.

## Historical checkpointed history repair

The status sets below describe the reconciliation that is already reflected in
the verified 75-row Production ledger. They are retained as an audit record, not
as an instruction to rerun repair. Any future incident-specific repair requires
separate approval and must use the exact Production target suffix:

```text
--linked --project-ref mdiianhfrojmxqpwrflh --dns-resolver native
```

For each version in an `applied` batch, the exact command is:

```text
supabase migration repair VERSION --linked --project-ref mdiianhfrojmxqpwrflh --dns-resolver native --status applied
```

For each version in a `reverted` batch, the exact command is:

```text
supabase migration repair VERSION --linked --project-ref mdiianhfrojmxqpwrflh --dns-resolver native --status reverted
```

Run one command at a time. After every command, verify target identity and the
full migration list. Stop on any mismatch.

### Canonical alias replacements: currently applied

- A1: `202606170001`, `202606170002`, `202606170003`, `202606170004`, `202606180002`, `202606180003`, `202606180004`, `202606180005`, `202606180006`, `202606180007`
- A2: `202606180012`, `202606220002`, `202606260001`, `202607060001`, `202607070001`, `202607080001`, `202607080002`, `202607080003`, `202607080004`, `202607110002`
- A3: `20260721220519`, `202607250001`, `202607250002`, `20260726205442`, `202607270001`, `202607270002`, `202607300001`, `20260731092011`, `20260731093656`, `20260731213000`
- A4: `20260731224500`, `20260731231500`, `20260803052701`, `20260803172709`, `20260803181405`, `20260803204552`, `20260803205520`, `20260803230226`, `20260804010000`, `20260804160932`, `20260805011604`, `20260805163333`

### Proven history-only versions: currently applied

- B1: `202606180008`, `202606180009`, `202606180010`, `202606180011`, `20260619110000`, `202606220001`, `202606230001`, `202607260001`, `20260806180609`
- B2: `20260807172710`, `20260807181420`, `20260807185224`, `20260807195152`, `20260807203645`, `20260807215440`, `20260808060301`, `20260808064500`, `20260808070000`

### Paired remote aliases: currently absent/reverted

- C1 (pairs with A1): `20260618015711`, `20260618015721`, `20260618015814`, `20260618015903`, `20260618061639`, `20260618084518`, `20260618152156`, `20260618161311`, `20260618172630`, `20260618181707`
- C2 (pairs with A2): `20260619062213`, `20260622224719`, `20260626223440`, `20260706215202`, `20260707210949`, `20260731012629`, `20260708090351`, `20260708101247`, `20260708112329`, `20260713204553`
- C3 (pairs with A3): `20260721234940`, `20260726041024`, `20260726200616`, `20260727012022`, `20260731012720`, `20260731012817`, `20260731013019`, `20260801221404`, `20260801221419`, `20260801221428`
- C4 (pairs with A4): `20260801221439`, `20260801221447`, `20260809025117`, `20260809025123`, `20260809025128`, `20260809025137`, `20260809025142`, `20260809025150`, `20260809025154`, `20260809025158`, `20260809025203`, `20260809025207`

The four canonical historical Production versions listed above remain applied
through every checkpoint.

## Reconciliation safety boundary

Do not attempt to restore the superseded 50-row pre-reconciliation ledger. The
verified 75-row ledger and its fingerprint above are the current checkpoint.
The four verified canonical applied migrations in the preceding section are
outside both the canonical repair set and the alias set and must remain applied.
Any unexpected deviation requires a new read-only catalog proof before repair.

## Expected post-reconciliation dry run

The Supabase CLI version used for qualification synchronizes Vault by default,
so the future dry run must include `--skip-vault`:

```text
supabase db push --linked --project-ref mdiianhfrojmxqpwrflh --dns-resolver native --skip-vault --dry-run
```

It must list exactly the 25 pending QBO migrations:

1. `20260820233007_external_integrations_phase_1_canonical_foundation.sql`
2. `20260821064333_external_integrations_phase_2_reconciliation.sql`
3. `20260821172015_external_integrations_phase_3_deterministic_dependencies.sql`
4. `20260821201220_external_integrations_phase_4_control_plane.sql`
5. `20260821220853_external_integrations_phase_5_credential_security.sql`
6. `20260822012253_external_integrations_phase_6_durable_runtime.sql`
7. `20260822035335_external_integrations_phase_8a0_provider_contract_convergence.sql`
8. `20260823042718_external_integrations_phase_8b_qbo_sandbox_validation.sql`
9. `20260823111004_scope_qbo_sandbox_dispatch_candidates.sql`
10. `20260823113832_qbo_sandbox_scoped_dispatch_recovery.sql`
11. `20260823115807_reserve_qbo_sandbox_scoped_dispatch.sql`
12. `20260823121454_qbo_sandbox_dispatch_run_lock.sql`
13. `20260823205806_qbo_sandbox_credential_refresh_recovery.sql`
14. `20260824071101_qbo_sandbox_same_generation_reauthorization.sql`
15. `20260824083917_qbo_sandbox_expired_refresh_lease_reclamation.sql`
16. `20260824193332_qbo_cloud_tasks_zero_based_delivery.sql`
17. `20260824233000_qbo_retry_execution_and_reauthorization_recovery.sql`
18. `20260825180000_qbo_reauthorization_required_lifecycle.sql`
19. `20260825190000_qbo_scoped_dispatch_retry_lifecycle.sql`
20. `20260826043610_qbo_credential_envelope_binding_convergence.sql`
21. `20260826090000_qbo_credential_envelope_binding_incident_canary.sql`
22. `20260826120000_qbo_credential_lineage_incident_recovery.sql`
23. `20260826190801_qbo_precontract_initialization_retirement.sql`
24. `20260826222000_qbo_provider_result_evidence_and_ar_aging_recovery.sql`
25. `20260827033058_qbo_production_convergence.sql`

Anything else is a stop condition.
