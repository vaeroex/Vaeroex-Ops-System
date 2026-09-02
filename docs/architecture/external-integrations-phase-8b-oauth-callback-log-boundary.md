# Phase 8B OAuth Callback Log Boundary

Status: **disposable edge verified; live activation blocked**

This record covers only the disposable QuickBooks Online sandbox callback used
by Phase 8B. It does not authorize Production Intuit access, a provider sync,
or customer-visible integration activation.

## Verified Platform Constraint

Intuit returns the authorization result to the registered redirect URI as a
browser `GET` carrying `code`, `state`, and `realmId` query parameters. The
current Intuit documentation does not describe a `form_post` response mode for
this flow.

Cloud Run writes request logs automatically. The request URL recorded by that
logging surface includes the query string. Cloud Logging exclusions are applied
after Logging receives an entry and do not rewrite an entry in place. Therefore,
application redaction, a Cloud Logging exclusion, or a log-router filter cannot
make the existing public Cloud Run callback safe for OAuth query values.

Authoritative references reviewed on 2026-08-23:

- [Intuit OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging)
- [Cloud Logging routing and sinks](https://docs.cloud.google.com/logging/docs/routing/overview)
- [Service Extensions plugins](https://docs.cloud.google.com/service-extensions/docs/plugins-overview)
- [Create a Service Extensions plugin](https://docs.cloud.google.com/service-extensions/docs/create-plugin)
- [Service Extensions plugin practices](https://docs.cloud.google.com/service-extensions/docs/plugin-best-practices)
- [Cloud Run ingress restrictions](https://docs.cloud.google.com/run/docs/securing/ingress)
- [Cloud Logging `logs.delete`](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/logs/delete)

## Required Callback Architecture

The smallest reviewed architecture that avoids placing OAuth query values on a
Cloud Run request-log surface is:

1. Intuit calls a dedicated Development-only external Application Load
   Balancer callback hostname.
2. Access logging is disabled only for this callback frontend/backend path.
   Other non-sensitive request and security logs remain enabled.
3. A dedicated Service Extensions edge plugin runs with plugin logging disabled.
   It accepts only the exact `GET /oauth/callback` shape, bounds `code`, `state`,
   and `realmId`, rejects duplicates, overwrites the reserved internal handoff
   headers, transfers the three values into those headers, and removes the
   query before forwarding.
4. The callback Cloud Run service uses `internal-and-cloud-load-balancing`
   ingress. It accepts only the clean path plus the exact
   `qbo_oauth_callback_handoff_v1` headers. A query-bearing request or a missing,
   duplicate, or malformed handoff fails closed.
5. The callback service passes the bounded values to the private broker. The
   broker retains database-authoritative, hashed, single-use OAuth-state
   validation. `realmId` remains provider metadata and never tenant authority.
6. The browser receives an immediate `303` to a fixed HTTPS confirmation URL
   with no user info, fragment, or query string.

The disposable Development edge now implements steps 1 through 5 and the fixed
query-free confirmation endpoint used by step 6. A real successful callback was
not attempted because regenerating OAuth is outside this gate. Repository tests
cover the accepted single-use state path and clean `303`; live synthetic probes
used nonexistent states and therefore failed closed before redirect.

The existing `run.app` redirect URI cannot remain the registered Intuit callback
and satisfy this boundary. Phase 8B must not resume until the Development
redirect URI is intentionally changed to the reviewed load-balancer hostname
and the remaining pre-resume gates below pass.

## Authorization UI Semantics

A visible Intuit consent button is not a Phase 8B protocol or security
invariant. Intuit's OAuth examples account for a callback when an account has
already authorized the app, and OAuth 2.0 permits an authorization server to
use an existing authenticated session and previously established approval. For
the same Development app, sandbox company, and exact scope, Intuit may therefore
return directly to the registered callback without displaying a fresh consent
control. Intuit may still display authorization UI based on its session, grant,
scope, or risk state; the absence of that UI alone neither proves a bypass nor
invalidates an otherwise evidenced authorization.

Phase 8B instead requires all of the following provider-independent evidence:

- the browser authorization request contains only `client_id`, `redirect_uri`,
  `response_type=code`, the exact accounting `scope`, and a fresh `state`; it
  contains no caller-selected realm or silent-authorization parameter;
- the hashed, ten-minute, single-use state is consumed exactly once through the
  registered query-stripping callback edge;
- the returned authorization code is exchanged exactly once at Intuit's token
  endpoint with `grant_type=authorization_code` and the same redirect URI;
- the returned realm and granted scope match the trusted active mapping and
  exact requested scope;
- a new encrypted credential version is linked to that consumed state and
  supersedes, rather than reuses or rewrites, the prior credential; and
- callback, application, request, error, and trace logging remain free of OAuth
  query values and credential material.

No Vaeroex path may suppress provider UI, synthesize a successful callback,
reuse stored provider tokens as a new authorization, widen scope, substitute a
realm, or treat OAuth completion as customer-visible activation.

Authorization UI references reviewed on 2026-08-24:

- [Intuit OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [Intuit OAuth2 Java sample](https://github.com/IntuitDeveloper/OAuth2-Java)
- [OAuth 2.0 authorization endpoint](https://www.rfc-editor.org/rfc/rfc6749#section-4.1)

## Disposable Implementation

The edge was provisioned only in project `vaeroex-p8b-20260823-84b2f0`, region
`us-west1`, on 2026-08-23. No Production or Preview resource was accessed or
changed.

- Global address `p8b-oauth-edge-ip` serves
  `p8b-oauth-34-120-247-116.sslip.io` through certificate
  `p8b-oauth-edge-cert`, forwarding rule
  `p8b-oauth-edge-forwarding-rule`, HTTPS proxy
  `p8b-oauth-edge-https-proxy`, and URL map `p8b-oauth-edge-url-map`.
- Backend `p8b-oauth-edge-backend` uses serverless NEG
  `p8b-oauth-edge-neg` for `p8b-ingress`. Backend request logging is disabled
  only on this callback backend.
- `LbTrafficExtension` `p8b-oauth-callback-edge` invokes Wasm plugin
  `p8b-oauth-callback-edge` with plugin logging disabled and fail-open disabled.
  Active version `v6` is pinned to
  `sha256:7b7f39ae07509382c0678a2358228f32033535002facf86853f4e2641c3a66f1`.
- `p8b-ingress` uses `internal-and-cloud-load-balancing` ingress. Revision
  `p8b-ingress-00006-zps` is pinned to runtime image
  `sha256:8601a97de7d7284e05f1d9d1fdce3bdd8d11b4773967eeae61d5c84233b1fb5d`.
- The edge and ingress emit only fixed responses and value-free event names.
  Neither receives a client secret, access token, or refresh token.

The configured Intuit Development callback and broker callback remain unchanged
at `https://p8b-ingress-866520189161.us-west1.run.app/oauth/callback`. That URL
is now blocked by the Cloud Run ingress setting. The exact proposed Development
replacement is
`https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback`. Changing it requires
explicit approval and coordinated Development-only Intuit and broker updates.
No Intuit Production setting may change.

## Existing Disposable Log Entries

Read-only inspection of project `vaeroex-p8b-20260823-84b2f0` found five
Cloud Run request entries whose URL had `/oauth/callback?`. Exactly three held
all three nonempty callback fields. No values were printed or copied during the
inspection.

- The project has the local `_Default` and `_Required` sinks and no custom
  project-level sink. Cloud Run request logs are routed to `_Default`, whose
  observed retention setting is 30 days.
- Individual entries cannot be selectively deleted with the supported
  `logs.delete` method. That method deletes every entry in the named log from
  the global `_Default` bucket, which would remove unrelated security evidence.
- Deleting the disposable project will remove the source project after the
  project recovery window, but any copy already routed to another project,
  bucket, or external destination has its own lifecycle.
- The project has organization `1061441228384` as its direct ancestor and no
  folder ancestor. Organization sink enumeration was denied because the current
  operator lacks `logging.sinks.list` on that organization. Consequently, the
  project-level inspection does **not** prove that an organization aggregated
  sink made no copy, and it does not prove that no Production-owned log
  destination received one. The minimum custom read-only grant needed to close
  this audit is `logging.sinks.list` and `logging.sinks.get` on that organization;
  predefined `roles/logging.viewer` is read-only but broader.

All five entries remain untouched until an authorized hierarchy-level sink audit
is complete. Deleting the entire Cloud Run request log merely to remove them is
not approved because it would destroy unrelated audit evidence. `_Default`
retention remains 30 days. Eventual disposable-project deletion remains the
source-project treatment, while any routed copy would retain its destination's
independent lifecycle.

## Synthetic Canary Result

A recognizable synthetic `code`, `state`, and `realmId` set was sent through
the load-balancer callback twice without printing its values. Verification
found zero value matches in project Cloud Logging, application/error logs, and
Cloud Trace. Callback backend logging and plugin logging were disabled, the
callback-specific Cloud Run request-log exclusion retained zero request entries,
and the private broker recorded four value-free fail-closed POST request events
for the two synthetic completion/recovery attempts.

The live edge also verified:

- direct access through both known `run.app` origins returns a denied response;
- missing and duplicate parameters, a request body, and oversized values return
  fixed `400` responses;
- Internet-supplied reserved handoff headers cannot create a callback and are
  overwritten when a valid query is present;
- the fixed confirmation path returns `200`, while a query-bearing confirmation
  request fails closed;
- a synthetic nonexistent state returns the fixed generic `500` body with no
  redirect or reflected value;
- exact repository tests preserve database-authoritative hashed single-use
  state consumption and keep `realmId` as provider metadata only.

## Remaining Pre-Resume Gates

Before any refresh or provider read is resumed:

1. An explicitly authorized operator must enumerate organization
   `1061441228384` sinks and inspect every aggregated destination. The current
   project-only zero-match result cannot establish whether a historical routed
   copy exists.
2. Vaeroex must explicitly approve the exact Development callback URI above
   before the Intuit Development app and broker are changed together.
3. After that approved Development-only cutover, a fresh single-use sandbox
   authorization must traverse the verified edge and return the clean `303`.
   Production Intuit settings must remain untouched.

Until every item passes, the callback logging gate remains open and Phase 8B is
not safe to resume.
