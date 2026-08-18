# Production migration-history reconciliation

This note records a proposed-only reconciliation for Supabase project
`mdiianhfrojmxqpwrflh`. It does not authorize or execute migration-history repair
or migration SQL.

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

## Qualified pending migrations

- `202607110001_business_memory_evidence_eligibility.sql`: genuine execution.
  The live function has the same signature, stable volatility, invoker mode,
  `postgres` owner, and `public, extensions` search path, but its body is the
  older retrieval definition. No dependent objects were found. Replacing the
  body does not backfill rows or change the function identity.
- `20260731071855_business_health_generation_claim.sql`: genuine execution.
  No equivalent index exists and the exact proposed key/predicate has zero
  conflicting groups across 11 qualifying rows.
- `20260811233219_restore_manual_activation_review_rpc.sql`: genuine execution.
  The function is absent. The migration creates the canonical invoker RPC with
  an empty search path and service-role-only execution; it contains no backfill.
- `20260817185529_intelligence_briefing_storage_contract.sql`: genuine execution.
  All three indexes are absent, exact claim conflicts are zero, and the existing
  deletion function is the older invoker contract. The migration contains no
  Saved Analysis row mutation.

## Proposed checkpointed history repair

No command in this section has been executed. Every future repair command must
use this exact suffix:

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

### Canonical alias replacements: applied first

- A1: `202606170001`, `202606170002`, `202606170003`, `202606170004`, `202606180002`, `202606180003`, `202606180004`, `202606180005`, `202606180006`, `202606180007`
- A2: `202606180012`, `202606220002`, `202606260001`, `202607060001`, `202607070001`, `202607080001`, `202607080002`, `202607080003`, `202607080004`, `202607110002`
- A3: `20260721220519`, `202607250001`, `202607250002`, `20260726205442`, `202607270001`, `202607270002`, `202607300001`, `20260731092011`, `20260731093656`, `20260731213000`
- A4: `20260731224500`, `20260731231500`, `20260803052701`, `20260803172709`, `20260803181405`, `20260803204552`, `20260803205520`, `20260803230226`, `20260804010000`, `20260804160932`, `20260805011604`, `20260805163333`

### Proven history-only versions: applied second

- B1: `202606180008`, `202606180009`, `202606180010`, `202606180011`, `20260619110000`, `202606220001`, `202606230001`, `202607260001`, `20260806180609`
- B2: `20260807172710`, `20260807181420`, `20260807185224`, `20260807195152`, `20260807203645`, `20260807215440`, `20260808060301`, `20260808064500`, `20260808070000`

### Paired remote aliases: reverted only after all applied batches verify

- C1 (pairs with A1): `20260618015711`, `20260618015721`, `20260618015814`, `20260618015903`, `20260618061639`, `20260618084518`, `20260618152156`, `20260618161311`, `20260618172630`, `20260618181707`
- C2 (pairs with A2): `20260619062213`, `20260622224719`, `20260626223440`, `20260706215202`, `20260707210949`, `20260731012629`, `20260708090351`, `20260708101247`, `20260708112329`, `20260713204553`
- C3 (pairs with A3): `20260721234940`, `20260726041024`, `20260726200616`, `20260727012022`, `20260731012720`, `20260731012817`, `20260731013019`, `20260801221404`, `20260801221419`, `20260801221428`
- C4 (pairs with A4): `20260801221439`, `20260801221447`, `20260809025117`, `20260809025123`, `20260809025128`, `20260809025137`, `20260809025142`, `20260809025150`, `20260809025154`, `20260809025158`, `20260809025203`, `20260809025207`

The four canonical historical Production versions listed above remain applied
through every checkpoint.

## Interruption recovery

Record each successful command. To recover, invert only successful commands in
strict reverse order:

- alias marked reverted: run the same Production-pinned command with
  `--status applied`;
- canonical version marked applied: run the same Production-pinned command with
  `--status reverted`.

After each inverse, recheck identity and the full ledger. Recovery is complete
only when the preserved original 50-row ledger and its checksum match.

## Expected post-reconciliation dry run

The Supabase CLI version used for qualification synchronizes Vault by default,
so the future dry run must include `--skip-vault`:

```text
supabase db push --linked --project-ref mdiianhfrojmxqpwrflh --dns-resolver native --skip-vault --dry-run
```

It must list exactly:

1. `202607110001_business_memory_evidence_eligibility.sql`
2. `20260731071855_business_health_generation_claim.sql`
3. `20260811233219_restore_manual_activation_review_rpc.sql`
4. `20260817185529_intelligence_briefing_storage_contract.sql`

Anything else is a stop condition.
