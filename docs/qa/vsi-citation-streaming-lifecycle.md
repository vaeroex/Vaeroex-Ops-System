# Citation streaming lifecycle diagnostic

This is a local test-only extension of the passing PR #557 harness. It is not a
retrieval fix. The original twenty-scenario command remains unchanged by default.
The opt-in command is `pnpm test:protected-citation-streaming`.

## Evidence and prioritized differences

1. **Loading boundaries are omitted by the baseline.** The production route sits
   under `app/app/loading.tsx` and `app/app/sources/loading.tsx`. The latter's
   `ModuleLoading` supplies the previously observed spinner text. Copying these
   exact boundaries adds six source files to the baseline's 56-file closure.
   Next can stream a fallback before the protected page finishes. The baseline
   waited for a complete HTTP response under a minimal layout.
2. **Incoming connection cancellation is untested.** The baseline client stays
   connected until completion. The page's own AbortController stops its upstream
   request at ten seconds; it is not explicitly connected to incoming close.
   The production receipt records browser-tool detachment, which does not prove
   that the browser's HTTP connection closed.
3. **The production parent layout adds reads.** `ProtectedAppLayout` creates a
   server client and validates the user, then `getWorkspaceContext` creates
   another client, validates again, and reads profiles and memberships in parallel.
   Non-admin users also read legal acceptance. These operations are outside the
   citation RPC's ten-second timer. They may overlap page work, but actual overlap
   and its effect have not been established. This extension does not copy the
   full parent layout or simulate its authorization logic.
4. **Hosted transport remains different.** The fixtures use loopback HTTP and
   modeled Auth/PostgREST responses. They do not test external DNS/TLS, service
   gateway, real SQL/RLS, connection pooling, or the deployed Node/Undici version.
   Retained receipts do not establish those deployed runtime settings. No mismatch
   is asserted from absence of that metadata.

The installed Next 15.5.24 implementation bypasses fetch deduplication for a
request with an AbortSignal and for non-GET/HEAD methods. The protected RPC has
both. No citation-specific cache/runtime override or PPR configuration was found.
This lowers the priority of a simple duplicate-fetch/cache theory; it does not
prove hosted dispatch. The current service worker has no fetch interception.
Browser CSP does not directly govern this server-side RPC fetch.

## Narrow distinguishing test

The new mode copies the actual loading files and their dependencies, byte-checks
them, and keeps the real middleware, page, SDK and unchanged RPC deadline. It
holds a synthetic RPC response until the loading fallback is received. One case
then releases the response and verifies complete server-stream source content.
Another closes the incoming HTTP connection after fallback plus RPC receipt and
measures upstream closure/trace outcome. Immediate cancellation is not assumed;
the request must stop within the existing deadline plus bounded operational slack.
An independent subsequent request must succeed. Denial/isolation controls and
the network allowlist remain enforced.

The opt-in run has five cases: release after fallback, explicit client disconnect,
independent recovery, RPC denial, and workspace denial. The default twenty-case
suite is still the separate baseline, not replaced by these cases.

The workspace-denial check requires either the actual fixture not-found heading
or an exact structured `NEXT_HTTP_ERROR_FALLBACK;404` Flight error record. Next
15.5.24 can finish a loading stream with that error for its client boundary to
render; it need not include the final heading in server HTML. The harness decodes
only JSON type-1 inline Flight payloads without evaluating scripts. Plain digest
text, a serialized heading, `noindex` alone, malformed/conflicting records and an
empty 200 response are insufficient. Complete response, private/no-store policy,
raw protected-content exclusions and zero citation RPCs remain required.

Only invented sessions and source records are used. Diagnostics retain phase,
duration and counters, never request/response content or credentials. This is
HTTP streaming evidence, not browser hydration or visible fallback replacement.
No production code, authorization rule, timeout, dependency or hosted setting is
changed. No model requests are made.

## Qualification boundary

`node scripts/shared-evidence-citation-next-tests.cjs --streaming-lifecycle --self-check`
checks fixture construction and synthetic transport mechanics only.
The full mode requires production Next build/start on Linux. The existing Mac
compiler signing restriction must not be bypassed. The approved qualification
adds a separate five-minute Linux step after the original twenty-case suite.
Publication and CI are test-only; no merge, deployment or activation is included.

Local preparation passed syntax, file ESLint, both self-check modes and independent
review. The streaming self-check copied 62 files and exercised two synthetic
chunk/close relay cases, in addition to the existing five SDK and two cancellation
checks. Its source fingerprint is
`d551d3ca63cb50a63f787f873eac1223a22cd2a903cf692e9c8eaa17709ff1d6`.
The baseline still copies 56 files with its original fingerprint
`843f70e82fa7064027291e470cd13d8ff5ab0607d11d29fbff24405723fa6fe3`.
Neither self-check executes Next streaming. The first Linux run, `40432265091`
at public head `f0cbb6e5`, passed the original twenty cases. The first four streaming
cases reached completion; the final workspace case failed its server-heading-only
assertion. The other three jobs succeeded. No raw failed response was retained,
so its exact streamed marker has not been observed. The corrected structured-denial
assertion and its positive/negative self-check controls await Linux requalification;
this is not a five-case pass or evidence of an application defect. Failure output
now adds bounded status/marker booleans, RPC count category and denial outcome,
never HTML, Flight content, identities or credentials.

If this test passes, it narrows the omitted streaming/cancellation behavior. It
does not identify the hosted root cause, prove real SQL permissions, or repair
the separate date-alignment quality issue. A failing test must distinguish a
harness defect from a demonstrated application defect before any runtime edit.
