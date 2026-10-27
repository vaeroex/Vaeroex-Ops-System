# Protected citation HTTP qualification

This test-only candidate closes a specific harness gap. The earlier citation SSR
suite directly invokes the page with substituted `next/headers` and `global.fetch`.
The new command, `pnpm test:protected-citation-http`, builds and starts isolated
production-mode Next fixtures with the installed SDK and a synthetic local service.
It does not change application code or diagnose the hosted timeout by itself.

The fixture must exercise the actual page, middleware, authentication, workspace
and subscription guards, cookie-backed server clients, fetch tracing, citation
deadline and projection checks. The synthetic service stands in for Auth and
PostgREST. It is not execution or proof of the production SQL/RLS contracts.

The production reasoning gate stays off. The test enables only its private copy
of that gate in the temporary fixture, with an exact source assertion. It never
changes the repository gate or deploys the fixture. The child receives a minimal
environment containing invented loopback credentials only. No production env
files, browser sessions or saved answers are loaded.

The source closure currently contains 56 files. Both fixture copies are checked
against repository bytes, with the enabled copy allowing exactly one gate-helper
replacement. The minimal surrounding layout is synthetic; the full workspace
shell is not exercised. The modeled six-original packet has one Xero source and
five Sheets sources, with three displayed citation anchors. An unavailable uncited
original still denies reopening the packet.

Qualification must establish rendered protected content and source anchors, not
merely status 200 or serialized React data. Negative cases must preserve owner,
workspace, active-session and source-revalidation boundaries. Stalled responses
must exercise the unchanged ten-second deadline and cancellation. Outbound
network activity outside the fixture is forbidden, and child processes, sockets
and temporary files must be cleaned up on failure as well as success.

The default run defines 20 HTTP scenarios: off-state access, refreshed and fresh
sessions, owner/workspace/billing failures, RPC denials and changed sources,
malformed or foreign projections, concurrent actors/workspaces, and stalled
headers/body reads followed by an independent successful request. Positive
assertions parse visible HTML sections and source JSON; denial assertions also
inspect the raw Flight payload for evidence leakage. Parent and child socket/fetch
allowlists permit only the exact fixture endpoints, and record blocked attempts.

## Execution boundary

The existing Mac compiler restriction prevents the signed bundled Node process
from loading the installed SWC module with a different Team ID. No signing
settings, dependencies or alternative runtime are changed to bypass it. Syntax,
fixture self-checks and independent review are separate from full HTTP execution;
they must not be reported as a passing Next test.

`node scripts/shared-evidence-citation-next-tests.cjs --self-check` avoids the
native compiler. It checks source copying/transpilation, five installed-SDK
synthetic transport cases, two local cancellation cases, parent access to both
fixture ports, and deliberate blocked outbound probes. It does not render the
protected page or qualify the 20 HTTP scenarios.

The proposed Linux qualification adds this command to the existing credential-free
CI job after the production build and session-refresh HTTP suite, with a five-minute
step limit. Publication and CI execution require approval; this local preparation
does neither. A failure is a test or application finding to diagnose, not permission
to weaken a guard or deploy a speculative fix.

Hosted citation retrieval, browser continuity, SQL revalidation and the separate
date-alignment answer-quality issue remain unverified by this local fixture.
