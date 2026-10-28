# All-twelve reasoning release candidate

This candidate carries the application runtime evaluated at
`28d149191d6be403fbc7bbe1fdc5ccf39dda20af` forward from deployed
`5ca06d3a7417c30e5bdbff9e731fb724b601e8cb` (tree
`dc592bfaca82416550a4df43c38a925ada944ac5`). Its application trees are:

- `app`: `d348001c9e91078f6c67cd13f93b36119d30cbf5`
- `lib`: `2a5b780ad0829197b9e6a5005e3627be7c91ec04`

Only `lib/ai/shared-evidence/answer-contract.ts` and `lib/vsi/engine.ts`
change production runtime behavior:

1. Selected QBO, Xero and Zoho Books observations receive an application-owned
   qualification when their protected entity scopes may overlap. It does not
   assert duplication or authorize a combined total. Available but unselected
   records do not gain citation authority; distinct protected entities are excluded.
2. The generated answer schema limits prose missing-information items to one
   packed original plus support, matching the existing validator. Cross-original
   date assessments use the existing application-computed representation. Exact
   bindings, observed premises, independent-source and result checks still run.
3. Shared answers may use the existing 6,000-token configured ceiling, retaining
   lower explicit ceilings and the prior legacy answer limits. Compact guidance
   reduces repeated prose without removing facts, zeros, statuses or timing.

Synthetic labels and the four questions remain in test fixtures. Private
credential input, transport diagnostics, key lifecycle, manifests and retained
answers are not production code or publication dependencies.

## Existing qualification evidence

Evaluation 12 completed four real-model synthetic cases across all twelve offered
formats with eight calls. Each case passed mechanical validation, manual review
against its predeclared question, and isolated atomic save/reopen checks. The
standard uncached token estimate was $0.0088665; the conservative usage estimate
was $0.02937165. These are usage-based estimates, not a provider invoice. The
temporary evaluation key was revoked and the run is retired.

This establishes useful bounded reasoning over the supplied synthetic records.
It does not establish real OAuth/import behavior, hosted cross-user RLS/browser
security, natural session-refresh recovery, citation-page loading, concurrent
writers, large capacity or general accuracy. Draft labels are not semantic proof.
The inventory answer could state the variant/location enumeration limits more
explicitly, although it required those checks before an operational decision.

## Database source reconciliation

The reviewed PT409 incremental patch was already applied in production as
migration `20261027181014`. Keep its exact forward SHA256
`249e8ff836f384680c954cf1197dbe076db6d2256871c6670dc6721efbeeb20b`.
The bootstrap assembler now includes that guarded patch after the original
function rename, so a fresh installation cannot recreate this known custom
`40001` rejection. Historical drafts and other error branches stay unchanged.

**This application release needs no hosted SQL execution.** Neither the
bootstrap package nor the incremental patch should be reapplied to the current
database. The guarded rollback restores the old error code and must not run
automatically with an application rollback.

## Qualification split and release boundary

`pnpm test:vsi` includes the existing aggregate and the self-contained
`test:vsi-qualified-answer` regressions. Fresh Linux CI must run the production
build, TypeScript, lint, security and existing required jobs against the final
public tree. These tests use no model connection or credentials.

The all12 PGlite/worker suites and incremental SQL tests depend on screened
private SQL fixtures. Run them locally with
`SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR` as documented in
`vsi-all12-isolated-synthetic.md`; do not upload captures to CI. Public bootstrap
guards and runtime tests complement those local results, rather than claiming
Linux CI reruns the private-fixture scenarios.

All three VSI switches remain off. Automatic deployment is explicitly disabled
for `main` and `codex/all12-qualified-release`, preserving existing holds. The
next step is one deployment-disabled draft and fresh Linux qualification.
Merge/deployment requires separate approval. Citation opening, Google general
verification and large-capacity proof remain deferred. Accepted checkout is not
reopened as a new blocker; wider onboarding/operational and hosted isolation
evidence remains limited.
