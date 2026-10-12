# Historical authorization/provider fixture compatibility

Source stable after changes to exactly four SQL test files in the shared implementation worktree. No application or migration edit by this contributor. No hosted execution or provider request. Root/security own full migration/suite qualification and publication.

## Minimal corrected fixture files

| File under `supabase/tests/` | Baseline source proof | Correction |
|---|---|---|
| `external_integrations_phase_1_canonical_foundation.test.sql` | Workspaces defaulted to manual_review at183; authenticated Owner JWT at268 invokes `create_business_entity_v1` at278, whose actual migration writes `public.business_entities` at `20260820233007…:1325`. The new public-tenant trigger therefore blocks this intended role-positive case. | Both test workspaces now have trialing status and `now()+interval '1 day'`. Existing actor/role/negative tests retained. Policy inventory separately requires exactly the original permissive authenticated SELECT tuple and exactly three restrictive entitlement DELETE/INSERT/UPDATE tuples. |
| `external_integrations_phase_4_control_plane.test.sql` | Default workspaces at307; authenticated Manager JWT at653 invokes connection-intent RPC at660; actual `20260821201220…:1594` inserts guarded private integration connection. | Same bounded trial for both fixture workspaces. No role/provider assertion weakened. |
| `external_integrations_phase_8a0_contract_convergence.test.sql` | Default workspaces at286; authenticated Owner JWT at693 invokes connection-intent RPC at699. | Same bounded trial. Unsupported provider/configuration negatives retained. |
| `external_integrations_qbo_production_convergence.test.sql` | Default workspaces at179; authenticated Owner JWT at503 invokes connection intent at509 and bound OAuth state at521. Actual `20260827033058…:550,566` writes both guarded private OAuth/state-binding tables. | Same bounded trial for both test workspaces. Missing runtime configuration, cross-tenant and provider authority negatives retained. |

Line numbers in the source-proof column refer to pre-edit fixture source; the called migration definitions are unchanged.

The remaining 14 suites in the requested 18-suite CI block were not changed: their relevant execution is either no-authenticated-JWT service/worker authority, authenticated execute/read-denial checks only, or intentional billing behavior. In particular Customer #1 billing cases and phase3/phase6 authority denials remain unchanged. Security agent owns separate security_high/preferences/reporting-timezone fixture updates.

## Native bounded before/after proof

- Harness: `/tmp/vaeroex-fixture-entitlement-proof.cjs`
- Raw result: `/tmp/vaeroex-fixture-entitlement-proof.json`
- Command: `/Users/isaacvizcarra/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --max-old-space-size=128 /tmp/vaeroex-fixture-entitlement-proof.cjs`
- PostgreSQL17.11; owned nonce-named temporary cluster/private Unix socket/empty network listen; inherited connection configuration refused; statement timeout10s; child utility timeout30s; cluster stopped in finally.
- **16/16 PASS**, final shell wall0.77s. Loads actual fixture profile/workspace/membership seed SQL before and after, actual new entitlement predicate/trigger functions and actual core billing DDL. Each of8 original default-manual-review workspaces rejects an authenticated synthetic definer insert with42501; all8 bounded-trial workspaces permit the same insert. Every fixture test is rolled back. This confirms the entitlement gate and actual seed values; the target definer table is synthetic, so this is not execution of the full historical provider RPC suites.
- Results record final fixture SHA-256 and boundary-migration SHA-256. `git diff --check` passes for all four edited fixtures.
- One initial proof harness setup omitted the customer-subscriptions table; it stopped before fixture assertions, the harness was corrected to extract the actual billing DDL, and the final run passed. No failing assertion was converted into an expected success.

## Independently caught private-schema regression

Existing phase1/phase3/phase4 fixtures explicitly deny service-role USAGE on the private schema. The proposed broad schema grant introduced for direct exemption management contradicted that authority boundary; this was immediately reported to root/security. Security removed the broad grant and direct exemption CRUD, retaining database-owner-only configuration and the narrow service-only analysis definer RPC. The existing private-schema denial assertions were preserved. Security separately reports native106 checks passing. This contributor did not modify those migrations or weaken the authority assertions.
