# Vaeroex Super Intelligence

VSI restores open-ended, text-only chat at `/app/si`: **Ask anything. Grounded in your business when it matters.** Legacy freeform `/app/ask` visits redirect here; legacy saved analysis links still resolve to Intelligence. Executive Intelligence model routing and its existing controls are unchanged.

## Behavior and permissions

- The sole reasoning/chat model is `gpt-6-luna` through OpenAI Responses, with `store: false`, no automatic retries, and no alternate-model fallback. Missing model/provider/tool access produces a recoverable error.
- Current public questions use a separate Luna web-search call. Only the public question goes to search; workspace evidence and private history do not. Weather asks for a location when absent. Ordinary writing and explanations need no search or business evidence.
- Business retrieval reuses authenticated workspace loaders, approved Business Notes/Memory, current source authority, Health, KPIs, saved analyses, and the canonical supported-integration dashboard. File-linked evidence is excluded when extraction approval or file lifecycle authority is revoked. Derived findings are interpretations, not independent corroboration. Citations identify original sources and evidence/lookup dates.
- Workspace, actor, active membership, subscription, source authority, and applicable integration permissions are enforced server-side. Source text and web pages are untrusted evidence. No tool performs arbitrary external actions.
- Chats belong to their actor and workspace. RLS prevents direct transcript writes and cross-actor reads. A changed membership role invalidates access to chats created under the previous role; this deliberately fails closed after a downgrade. Source links continue to use their normal current authorization. Historical answers are retained as historical conversation, not re-indexed facts.
- Business Context links to the existing Files & Notes editor. An explicit `Remember this: ...` creates an exact proposal (up to 1,800 characters). Confirmation uses the existing note permissions and review lifecycle: an inactive Business Note draft, never automatic approved Memory. Ordinary conversation creates no note. Recognizable prohibited identifiers are rejected before persistence/provider use; this narrow guard is not a comprehensive patient-information detector.
- No chat attachments, voice, audio, image generation, or computer control are added. Approved image-derived **processed text** is retrieved only through verified Files/Memory authority, with the original file citation; VSI does not independently inspect the image.

## Persistence, limits, and accounting

Migration: `supabase/migrations/20261008190000_vsi_private_chat.sql`.

The migration adds private conversations/exchanges and service-only content-free request/cost ledgers. It makes no destructive change to existing customer tables. Deleting a chat removes its transcript; accounting receipts remain to prevent quota evasion. Workspace/user deletion cascades through the applicable foreign keys. No 24-hour transcript expiry is scheduled.

The database serializes quota reservation by actor and workspace: 100 successfully answered questions per actor across workspaces in a rolling 24 hours; 10 attempted questions/minute; one concurrent request per actor and four per workspace. Stable request IDs replay an existing exchange instead of charging a second question. Failed unanswered requests do not consume the rolling allowance. Their known provider spending is still recorded. Expired or uncertain attempts conservatively retain their reservation. Immutable cost events attribute each retry to the month it actually ran, including retries crossing a month boundary.

At 225 exchanges the UI warns gently. At 250 it makes the original transcript read-only and offers a new chat with a bounded private summary and an authorized link back. The model receives at most 24 recent messages/9,000 characters, a 7,000-character private summary, and bounded evidence—not all 250 exchanges. Summary compaction is deliberately lossy; the complete original transcript remains available.

| Control | Default |
| --- | --- |
| Workspace monthly VSI spending safeguard | USD 50, separate from Executive Intelligence |
| Environment configuration | `VAEROEX_VSI_WORKSPACE_MONTHLY_BUDGET_USD` |
| Question length | 8,000 characters |
| Combined model input | 48,000 characters (`VAEROEX_VSI_MAX_INPUT_CHARS`, 32,000–48,000) |
| Output per provider call | 3,000 tokens (`VAEROEX_VSI_MAX_OUTPUT_TOKENS`, 1,000–6,000) |
| Web calls per question | 2 maximum (`VAEROEX_VSI_MAX_WEB_SEARCH_CALLS`, 1–2) |
| Automatic provider retries | 0 |
| Reservation per logical attempt | USD 0.10 |
| Overall engine deadline | 65 seconds (`VAEROEX_VSI_TIMEOUT_MS`, max 90 seconds) |
| Request lease | 120 seconds |

Usage is available on demand, with a clear rolling-limit or workspace-spending explanation when relevant. The 100-question ceiling does not promise unlimited spending. The initial USD 50 safeguard is configurable; representative real-provider measurements must accompany the release qualification before treating this as a commercial allowance promise.

The cost catalog dated 2026-10-08 uses the standard Luna prices: USD 0.10/million input tokens, USD 0.01/million cached input tokens, USD 0.50/million output tokens, and USD 0.01/web search call, plus model tokens. Token counts, cached/reasoning tokens, tool calls, retry attempts, provider request ID, latency, and estimated dollars are recorded separately from Executive Intelligence. Estimates are not provider invoices. Sources: [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

## Verification

- `pnpm test:vsi`: Luna-only request/response handling, live-lookup selection, evidence revocation, source validation, bounded context, accounting, origin/body boundaries, prohibited identifiers.
- `pnpm test:vsi-ui`: hydrated desktop/mobile chat behavior, keyboard composer, retries, history, confirmation, pagination, App Router navigation, and cross-tab handoff.
- `VSI_TEST_CONFIG=/private/owned/local-config.json pnpm test:vsi-database`: real local Postgres concurrency, RLS, limits, retry/crash/month-boundary behavior, note confirmation, handoff, deletion. The harness refuses remote databases.
- `node scripts/vsi-database-tests.cjs --supabase-local`: CI variant discovers and verifies its local Docker Supabase container and requires the migration ledger entry; it cannot apply migrations.
- `scripts/vsi-image-pipeline-integration.cjs`: existing Files PNG reader pipeline with controlled bytes/reader response, actual stored run and explicit approval action, atomic Memory publication, then authorized VSI retrieval. This verifies the connection, not live image-reader accuracy.
- `scripts/vsi-retrieval-integration.cjs`: authenticated synthetic workspace retrieval and cross-workspace/source-revocation exclusions against the owned local stack.
- `scripts/vsi-browser-e2e.cjs <local-config> <synthetic-fixture> <private-output-dir> [http://127.0.0.1:49941]`: real browser → authentication → API → retrieval → persisted chat/note. Use `scripts/vsi-provider-stub.cjs` solely as an explicit local Node preload when testing transport without a paid provider. It is never imported by application code and is not proof of Luna answer quality.
- `scripts/vsi-real-provider-qualification.cjs <local-config> <synthetic-fixture> <private-output>`: 12 representative general/current/business cases, requires an externally supplied provider credential, maximum USD 2 reservation envelope, full sanitized answer/usage evidence for human review. Never commit credentials or private fixture files.

Keep real-provider output/quality results separate from mocked transport checks. The local fixture helpers require a repository-owned disposable local stack and refuse hosted targets. For an explicitly authorized hosted release qualification, `scripts/vsi-hosted-fixture-generator.cjs` creates private reviewed seed/cleanup SQL without executing it remotely. `scripts/vsi-hosted-browser-qualification.cjs` accepts only an allowlisted protected Vercel stage and the exact synthetic workspaces; its guard tests run in CI. It dispatches at most 12 questions under a separate USD 2 ceiling and records answers for human grading. Credentials and seed output stay outside the repository. Retire only these synthetic identities/evidence after verification, preserving immutable audit and cost records.

## Release

Preserve `vercel.json`'s main auto-deployment hold. Run normal CI/security/build/database gates. Apply only the reviewed VSI migration through the established explicit migration ledger procedure; never push the entire canonical migration folder onto the production overlay. Stage the exact reviewed commit using the existing Vercel Production settings with `--prod --skip-domain` and verify synthetic authenticated persistence and real Luna answers before explicit promotion. Do not disable Deployment Protection to test a preview. Record the commit, migration hash/ledger version, deployment URL, measured provider costs, human quality findings, and live saved-chat check in the release evidence.
