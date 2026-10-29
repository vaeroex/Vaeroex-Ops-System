# All-twelve harness refresh — local qualification

## Purpose and scope

The shared-answer prompt was intentionally shortened by the context-overhead correction. The isolated all-twelve runner still required that prompt to be longer than the legacy prompt. On the current release tree, the accounting-and-orders case reproduced this assertion failure before answer-response dispatch.

The runner now checks the actual serialized system content for exact equality with the production `VSI_SHARED_SYSTEM_PROMPT`, and separately requires the complete `SHARED_ANSWER_INSTRUCTIONS` suffix with its blank-line separator. It does not reconstruct or pad instructions. The existing 48,000-character / 192,000-byte wire limits, 6,000 output-token ceiling, medium reasoning setting, source coverage, exact bindings, save/reopen and isolation checks are unchanged.

This change affects only the test harness and this documentation. Application code, prompts, schema, SQL definitions, source selection, gates and authorization are unchanged.

## Current local evidence

Qualified on 2026-10-29 against baseline tree `b865e096b29f68db10c682fee0358ededcb3a8f9` (released OFF commit `d33fc571685a88db2e1a2985009142d7f7c80245`). The isolated runner uses disposable in-memory PGlite, existing screened private SQL captures, fictional records and mocked model responses. No credential values, hosted databases or external model transports are used.

| Case | Provider formats | Planner wire characters / bytes | Answer wire characters / bytes |
| --- | --- | --- | --- |
| Accounting and orders | QuickBooks Online, Xero, Zoho Books, Wix Orders | 8,654 / 8,659 | 25,198 / 25,227 |
| Payments and operations | Square, Loyverse, Google Sheets | 8,760 / 8,765 | 24,476 / 24,505 |
| Time coverage | Harvest, Clockify, Toggl | 8,629 / 8,634 | 21,878 / 21,907 |
| Inventory context | Zoho Inventory, Katana, Google Sheets | 8,751 / 8,756 | 22,632 / 22,661 |

All four cases passed real isolated SQL admission, actual engine/validation, exact save/reopen, once-only accounting, wrong-workspace/wrong-actor checks and 13 provider-case revocation checks. Their union covers twelve providers; Sheets occurs in two cases. Each positive case uses two mock responses and reports zero model calls and zero network attempts. The largest answer wire has 22,802 characters of headroom for this small fixed fixture, not a general workspace guarantee.

The four additional preparation paths passed: wrong workspace, immutable binding mutation, empty history and missing currency. The worker suite passed four positive IPC cases and seven negatives: malformed answer, unknown binding, wrong request ID, uncertain transport, credential-environment rejection, planner clarification and disconnected parent. All IPC responses were mocked.

The database-guard suite passed 16 tests covering retained source, session, owner, workspace, ticket-root, erasure/expiry and PT409 boundaries in the bounded fixture. It is not the full hosted schema or production Auth/PostgREST/RLS/browser environment.

Eight focused existing regression suites also passed:

- all-twelve projections and provider selection;
- preparation row/fact limits and strict authority failure;
- large-workspace packing and source coverage;
- full-wire context overhead and character/byte limit rejection;
- exact source/hash bindings;
- review-alignment boundaries for unverified draft prose.

The realistic overhead fixture remains 45,488 characters after reduction, with 2,512 characters of headroom; the 24-source/long-question stress shapes reject when they exceed the unchanged limit. Small all-twelve packing coverage does not establish that every realistic twelve-provider payload fits one request. Preparation, packing and omission mechanisms are covered separately; this does not exactly replay the private hosted fourteen-Sheets-candidate/seven-omitted result.

## Reproduction

Use installed project dependencies and Node, without installing software or loading credentials. Set `SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR` to the existing locally screened captures. Never upload those captures or copy them into public CI. The fixture loader has no network fallback.

```sh
node scripts/vsi-all12-synthetic-tests.cjs
node scripts/vsi-all12-synthetic-worker-tests.cjs
node --test scripts/vsi-all12-synthetic-db-tests.mjs
node scripts/shared-evidence-all12-projection-tests.cjs
node scripts/shared-evidence-selection-tests.cjs
node scripts/shared-evidence-preparation-tests.cjs
node scripts/vsi-large-workspace-context-tests.cjs
node scripts/vsi-source-coverage-tests.cjs
node scripts/vsi-context-overhead-tests.cjs
node scripts/shared-answer-exact-binding-tests.cjs
node scripts/vsi-all12-review-alignment-tests.cjs
```

Run the fixture processes with an explicit minimal environment (UTC and the capture-directory path; optional output-report path), with no API keys, database URL or inherited provider credentials. The default runner blocks network sockets and uses local mocked fetch responses; the worker tests supply mocked responses over IPC. This qualification also ran the eight non-SQL regressions with an external local network-denial preloader. Detailed logs and receipts are retained outside the repository.

## Evidence boundary

This is refreshed **mechanical and synthetic regression evidence on the current runtime**, not a new real-model evaluation. The earlier Evaluation 12 made eight genuine model calls across the four synthetic cases and remains the historical model-behavior evidence. Its outputs were not regenerated or relabeled by this work.

This run establishes neither live provider connection/import/mapping acceptance nor hosted cross-user/session/citation behavior. The latest hosted positive control remains the single Xero demo/synthetic Sheets flow. The earlier preparation failure cause remains unknown, historical incomplete accounting remains unchanged, and global switches still do not implement a named pilot cohort.

No production SQL, runtime changes, provider imports, mappings, credentials, model/API calls, publishing, deployment or activation are part of this correction. The three production gates remain unchanged and OFF in the reviewed release source. Temporary activation PR 568 remains outside this change and must not be merged.
