# One-internal-seller Production consent

This is a repository-only executable candidate for the **existing** OAuth and
broker Cloud Run services. It does not enable the general customer routes,
create database objects, or provision/deploy anything. `entry.ts` is dormant
unless the separately approved, nonsecret permit configuration is installed.

The currently deployed bootstrap still returns its fixed disabled response.
Synthetic tests prove these new handlers, not a completed real consent.

## Minimal path

1. Provision only the existing native OAuth and broker profiles, each into its
   own existing numeric database-secret version. Runtime/evidence are later
   prerequisites for the first Payments read; scheduler/webhook are deferred.
2. Using the already-applied migration 25, install one exact, expiring permit
   for the internal operator's current Vaeroex session, workspace, entity,
   seller, location, generation and configuration fingerprint. This existing
   postgres-only procedure is a separately approved activation action. No new
   general activation flag is used: all seven flags remain false.
3. Build `entry.ts` with the repository's pinned ncc/lockfile, scan this new
   `square-internal-consent` candidate independently and pin its immutable
   digest. **Do not substitute it for the empty-dependency bootstrap or reuse
   the bootstrap's accepted compression/CVE finding as this image's evidence.**
   The existing repository-bound trigger builds this exact third image from
   approved main with the unchanged builder identity, frozen dependency lock
   and existing candidate staging path. It requires completed scans; this
   image rejects every HIGH/CRITICAL finding including the bootstrap's zlib
   exception. Independent secret scanning and a reviewed digest pin remain
   mandatory before eligibility. No automatic rollout or alternate submission
   path is introduced.
4. The optional `internal_consent` Terraform input switches only existing
   OAuth/broker service images, gives OAuth the existing shared VPC path, adds
   only OAuth-SA invocation on the existing broker, and allows the single
   bodyless `POST /api/integrations/square/connect` through Cloud Armor.
   Its default is null, so current deployment/network/permissions stay dormant.
   The corresponding reviewed edge image adds that exact initiation envelope;
   callback envelope/query semantics are unchanged. No new service, network,
   role definition, scheduler or paid resource is created.
5. In the Vaeroex application, `SQUARE_INTERNAL_PILOT_WORKSPACE` contains only
   `{operatorId,operatorSessionId,workspaceId,applicationId,approvalExpiresAt}`.
   It enables only `/app/settings/integrations/square/internal` for that exact
   authenticated, subscribed workspace/operator session on the existing
   canonical `https://www.vaeroex.com` host. Its form calls a
   dedicated internal API which sends the existing Supabase access token
   server-to-server, never into navigation, HTML, logs or query parameters.
   The OAuth service verifies that token with the exact Production Supabase
   Auth endpoint; the database rechecks session expiry and live membership.
6. The managed-edge callback is parsed by the unchanged shared parser. Only
   state hashes enter OAuth SQL. The broker latches its DB acquisition before
   one code exchange, verifies token status/scopes and authenticated seller/main
   location, KMS-encrypts the envelope and commits only encrypted provenance.
   The result is `mapping_required`, not mapped/enrolled/economic. Mapping is a
   subsequent explicit use of the existing `confirm_mapping` RPC.

The configuration supplied to each service has exact `profile`, `permit`,
`databaseVersion`, `databaseCa`, `brokerOrigin` and `supabasePublishableKey`
fields. The private database material itself is read only from the matching
existing Secret Manager version under native service identity. No database
password, Square secret, refresh token or access token belongs in Terraform
configuration, environment configuration, source or logs.

The broker origin is pinned to the authenticated existing-service readback,
`https://square-production-broker-u5c6zahmpq-uw.a.run.app`. It is both the
request destination and Google identity-token audience. The outer initiation
proxy has a 15-second deadline and performs only state creation; the 90-second
broker exchange runs only on the later provider callback.

The applied permit installer requires six provider-capability metadata rows
and their reviewed secret *references*. Those rows are not LOGIN credentials
or Secret Manager versions. The focused disposable-PostgreSQL consent case
creates only OAuth/broker LOGINs, leaves all four peers absent, and completes
encrypted storage before running the separate runtime/evidence test fixture.

## Recovery and boundaries

- A lost create-state response stops; no create-state retry contract exists.
- Lost consume/acquire/commit acknowledgments use migration 25's exact receipt
  operations. They never retry token exchange. Duplicate callback consumption
  does not invoke the broker. An uncertain provider result fences through the
  existing exchange reconciliation RPC and requires operator reconciliation.
- Native LOGIN identity is checked before exact `SET ROLE` and the one granted
  OAuth/broker RPC. Each call gets a fresh connection and closes it, including
  a lost acknowledgment. No table SELECT, arbitrary SQL, administrator or
  service-role fallback is exposed.
- Broker ingress remains internal-only and still requires Cloud Run IAM. The
  handler additionally validates the exact OAuth service identity/audience.
- Revocation, customer onboarding, webhooks, scheduling, economics and AI are
  not installed by this slice. Provider reads stop at identity/location
  verification. No accounting, inventory or history claims are made.

## Focused local checks

```
node scripts/square-production-internal-consent-tests.js
node --test services/external-integrations-production/bootstrap-runtime/callback-boundary.test.mjs
pnpm typecheck
pnpm exec ncc build services/external-integrations-production/internal-consent/entry.ts -o services/external-integrations-production/internal-consent/dist --no-cache --transpile-only --external server-only
node services/external-integrations-production/internal-consent/package-release.cjs
```

The packager copies the exact pinned `server-only` dependency and launches an
isolated dormant release with its `react-server` condition; it does not invent
a replacement stub. Type checking is the existing required exact-head job,
separate from transpilation. This Dockerfile is a candidate,
not authorization to build, push, deploy, access credentials or enable consent.
