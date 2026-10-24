# Local VSI consolidation receipt — 2026-10-24

Base: `710bfa5ed93b6f4b01d233c94d5a3a4829fd6b73`.
Scope: production VSI only. Source prepared at `8a609265`; saved-report KPI link
normalization reused from `9ecf8ece`. Sandbox bridge/callback/VM, new standalone
brief generation, workflows and deployment configuration are excluded.

## Build

`node scripts/shared-evidence-release-build.cjs` passed locally with existing
Node 24.19.0 / Next 15.5.24: optimized compilation, lint/type checking, 119 static
pages and build tracing completed with exit 0 in 64.89 seconds. Existing warnings remain; checks
were not disabled. Build wrapper uses an empty service environment, no `.env`
files, and blocks outbound HTTP/fetch/non-loopback TCP. Its `--check` guard passed.
No install, network dependency, provider call or CI dispatch was needed.

Application input fingerprint:
`b52ed9216b04ea6043340e9793922fc0fbd1519036e761d078f65464d7ccaeac`.
Algorithm: sort tracked paths in app/components/lib plus package.json,
pnpm-lock.yaml, next.config.ts, next.config.mjs and tsconfig.json when tracked;
concatenate UTF-8 path, NUL and binary SHA256(file bytes); SHA256 the result.
The application fingerprint was rechecked after packaging; no built application
source changed. Build ID: `BSXrPyXb2K0nKeGeHH1ax`.

## Focused results

All listed scripts passed:

- `vsi-evidence-window-tests.cjs`: five actual suggested prompts, leap-year dates,
  explicit prior-30 comparison and default bounds for unsupported requests.
- `shared-evidence-consumer-tests.cjs`: actual VSI preparation/sealing,
  pre-transport validation, empty manifests, immutable packets, selected 60-day
  window and disclosure. Legacy fallback is forbidden in the fixture.
- `shared-evidence-security-draft-tests.mjs`, selected test name
  `actual 5-plugin file/note VSI generation`: seven admitted originals, seven
  saved/reopened citations, actual generation and SQL save paths. Five negative
  answers fail (missing dependency citation, unsupported transaction match, labor
  ratio, profit and causation). Wrong workspace, another actor and revoked source
  also deny reopening. Twelve provider requests are mocks in process; paid calls 0.
- `vsi-engine-tests.cjs`, `vsi-http-accounting-tests.cjs`,
  `vsi-session-fence-tests.cjs` (six groups),
  `vsi-failure-accounting-application-tests.cjs`,
  `shared-evidence-settlement-tests.cjs`: preserved session checks, failure costs,
  reconciliation and no fallback/repeated mutation on uncertain completion.
- `vsi-citation-links-tests.cjs`: legacy KPI links work in chat and separately saved
  analyses; rendering does not change stored snapshots or unrelated URL types.
- `qualitative-synthesis-tests.cjs`: novel qualified interpretation and 25 negative
  premise/identity/numeric/causal/environment cases. Semantic entailment and real
  model quality are explicitly not proved.
- `business-notes-contextual-integration-regression-tests.js`,
  `shared-evidence-mapping-tests.cjs`, `shared-evidence-mapping-ui-tests.cjs`:
  canonical formatting, explicit owner-confirmed mapping, stale/foreign/disabled
  denials and required unselected form controls. UI test is a static render.
- `shared-evidence-release-package.cjs --check` and `git diff --check` passed.

The session regression initially lacked the new false-gate dependency in its
mock loader; adding that false mock restored all six existing assertions. No
production guard/assertion was weakened. The exact final application was rebuilt after a trailing blank-line cleanup; no broader native campaign was repeated.

## Packaging and review

Live AppShell/VsiWorkspace/Suggested prompts, retired briefing service and existing
Intelligence/history code are byte-identical to production. All thirteen SQL
source files and forward/pause outputs are byte-identical to the prepared package.
Runtime/shared, qualitative and accounting gates are false.

Captured database definitions were removed from the candidate during packaging.
The local SQL fixture now requires the existing screened files via the explicit
absolute `SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR`; it does not fetch or reconstruct
unknown metadata automatically. The selected five-plugin test was rerun after
this loader change and passed. Do not upload these inputs to CI. Pure tests and
the application build do not require them. Sanitization checks found no new
known private project/account identifiers or secret-shaped key literals in the
staged candidate. This is not a claim that existing repository history is clean.

Two unrelated duplicate local files were preserved outside the commit. Previous
independent reviews and native/install receipts apply only to the unchanged
reused contracts. The consolidation delta was locally reviewed for gated routing,
request/session binding, citations, historical reads and bounded date selection;
this receipt does not claim a fresh independent or hosted security review.

No publication, hosted SQL, credentials, provider/model traffic, activation or
deployment occurred. Real-model acceptance, current provider status and eligible
owner data remain as described in PREREQUISITES.md.
