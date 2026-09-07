# Dormant Square account connection — implementation contract

Baseline: `0a4b18be14b01d8d2be8d1e4525b47d7d190e551` (PR #351). Square API `2026-08-19`, SDK `45.1.0` at `e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76` remain pinned. All existing parser/request/descriptor fingerprints, business read-only policies, durable bounds, QBO contracts and economic blocking remain unchanged.

## Agreed interfaces and ownership

- Coordinator: `account-connection-contracts.ts`, lifecycle orchestration and checked store adapter, additive migrations, disposable database integration, CI, scope assertions and documentation.
- OAuth workstream: `account-connection-oauth.ts` and its regression suite; confidential authorization-code flow, exact policy/transport, introspection, refresh/revoke and authenticated revocation notification parsing.
- Authority workstream: `account-discovery.ts`, `account-mapping.ts` and their focused tests; authenticated merchant/location/default evidence, invocation-bound handoff and checked explicit mapping/enrollment.
- UI workstream: Square-only safe customer handlers/availability and component, thin disabled-by-default routes/page, focused route and local browser qualification.
- A separate reviewer will inspect the integrated final flow after implementation.

Shared public-safe actor/view/service types are defined in `account-connection-contracts.ts`. Actor/session/workspace evidence comes from the authenticated host, not request bodies. The intended Business Entity is selected before authorization and cannot be changed by callback or reauthorization. Location mapping requires a second explicit confirmation after authenticated discovery.

## OAuth flow and credential boundary

Use Square's confidential server-side authorization-code flow, not PKCE. Request short-lived access tokens (`short_lived: true`) and exactly the existing supported read scopes. ObtainToken is followed by authenticated RetrieveTokenStatus to verify the application, merchant, expiry and granted scope set. Authenticated `/v2/merchants/me`, `/v2/locations` and `/v2/locations/main` corroborate seller and default-location evidence; response shape or supplied IDs alone cannot grant authority. No fallback crosses environments.

Reuse the generic `IntegrationCredentialBroker`, `CredentialBrokerStore`, `ProviderApplicationSecret`, credential envelope and KMS/AAD interfaces through dedicated Square checked persistence. Generic/QBO RPCs and goldens are not broadened. Server-side state stores only a hash, binds the initiating authenticated session/actor/workspace/entity, operation, exact application/environment/redirect/scopes and current connection generation, and is consumed before exchange. An uncertain exchange never replays the consumed authorization code; recovery requires a fresh authorization flow.

The chosen flow uses a non-expiring, multi-use refresh token rather than PKCE rotation assumptions. Absolute short-lived expiry supplies provider issuance time (`expires_at - 24 hours`) with bounded clock-skew checks; encrypted-envelope and database metadata preserve the generic broker's exact lifetime checks. Refresh leases and credential version/generation CAS prevent late installation after revocation. Ciphertext and verified discovery are stored together; a lost acknowledgement is resolved from durable state, never a second code exchange.

Disconnect fences local authority first, then attempts merchant/application revocation through an injected bounded transport. Do not call the generic destroy-after-revoke helper: failed provider revocation must retain explicit bounded retry state, and this milestone authorizes no purge. Provider notification verification uses Square's HMAC-SHA256 over exact notification URL plus raw body, constant-time comparison, durable event-ID replay handling and generation-aware revocation time; legitimate delayed notifications are not rejected by an invented five-minute delivery window.

## Closed enrollment and deployment boundary

No default application/enrollment configuration or role memberships are installed. Dedicated checked LOGIN capabilities and owner-reviewed configuration are required. OAuth-verified enrollment is a separate path from PR #351's synthetic disposable marker; the synthetic path retains its existing gate. Actual seller/operation/location/connection/session evidence, explicit mapping and finite versioned retention approval are prerequisites. Missing retention, revocation-access policy or approval remains a closed gate, not an invented production default.

All public Square routes and UI are unavailable by default. Local qualification explicitly installs synthetic injected dependencies, requires a loopback origin and refuses Vercel/production environments. No public navigation advertises Square. Status can say authorized or mapping required, never Synced/Current/history-complete. Standalone OAuth handoff documents avoid application layouts and third-party assets, replace the callback URL before navigating to a clean page, and use no-store/no-referrer and restrictive CSP. Upstream query-log suppression remains a deployment prerequisite to verify separately.

This contract is implementation guidance, not live sandbox qualification or authorization. Only repository edits, synthetic-provider calls and verified disposable local database/browser tests are authorized. No real credentials, live Square requests, remote migrations, cloud provisioning, manual deployment, purge or Production activation.

## Authoritative references

- [Authorize](https://developer.squareup.com/reference/square/oauth-api/authorize)
- [ObtainToken](https://developer.squareup.com/reference/square/o-auth-api/obtain-token)
- [RetrieveTokenStatus](https://developer.squareup.com/reference/square/o-auth-api/RetrieveTokenStatus)
- [RevokeToken](https://developer.squareup.com/reference/square/oauth-api/revoke-token)
- [Webhook signature validation](https://developer.squareup.com/docs/webhooks/step3validate)
- [Webhook delivery behavior](https://developer.squareup.com/docs/webhooks/overview)

The delivery record will distinguish local implemented evidence from behavior still unverified against an authorized Square sandbox.

## Derived current-schema bounds

These are schema-derived conservative bounds, not maxima inferred from convenient fixtures. The unchanged raw response budget is 20,000 values per discovery response, with expanded shared occurrences charged and cycles rejected. Missing/populated optional fields do not add minimized handoff fields. Only authenticated RetrieveMerchant, ListLocations and RetrieveLocation(`main`) are discovery envelopes; foreign/mixed envelopes deny.

| Boundary | Derivation and limit |
| --- | --- |
| Discovery projections | Current ListLocations has `L <= 500`: root/array/provenance plus three containers per location gives `3 + 3L <= 1,503`. Merchant and main-location projections add six each: combined `<= 1,515`, including repeated shared provenance occurrences. |
| One-use minimized discovery | Root + locations array + location objects: `2 + L <= 502` containers; `10 + 4L <= 2,010` values. No contacts, addresses, coordinates or raw responses survive. Conservative serialized cap: 2 MiB. |
| Broker storage command | Fixed wrapper, credential/scopes and discovery/locations plus 500 location objects fit below 1,050 containers and 5,000 values. Maximum 131,072-character ciphertext is combined with **all** 500 maximum labels/IDs. Even six escaped bytes per 255-unit label plus fixed metadata fit below 2 MiB. Both descriptor snapshot and checked SQL enforce the cap. |
| Customer status | `E <= 1,000` entities, `C <= 32` account records and `L <= 500` locations/mapped IDs. Containers `3 + E + C(3 + L) <= 17,099`; values `4 + 3E + C(9 + 4L) <= 67,292`. Enforced conservative limits: 17,100 containers, 68,000 values, 32 MiB. This includes six-byte JSON escapes, fixed metadata, repeated shared locations and mapped-ID copies. |
| Mapping form | 500 location IDs, each at most 32 characters, plus fixed UUID/confirmation fields: at most `120 + 500(13 + 3*32) = 54,620` URL-encoded bytes. The route caps collection at 64 KiB, 1,024 chunks and one five-second deadline. Punctuation allowed by the unchanged Location parser is preserved. |
| OAuth/notification transport | 64 KiB wire bodies, one outstanding abort-aware wait, one bounded response buffer and five-second deadline per request. Discovery wire cap is 16 MiB. Lexical preflight bounds depth, decoded strings, duplicate keys and at most 40,000 tokens including keys before JSON parsing. Credential-envelope plaintext retains the existing 32 KiB KMS boundary. |

Account seller support is the **intersection** of existing contracts: at most 100 characters, leading alphanumeric and existing Square identifier punctuation; location IDs are at most 32. The standalone OAuth/merchant schemas can describe larger IDs, but do not grant account/durable authority for them. No generic authority, parser or ingestion limit was widened. Unsupported account identifiers reject before discovery/storage rather than leaving un-enrollable trusted evidence.

Every graph snapshot counts repeated shared occurrences, rejects Proxy/revoked Proxy, accessors, cycles and sparse arrays before schema/fingerprint work, and returns a deeply frozen detached value. The command/view regression composes maximum cardinality, label escaping and ciphertext and verifies full-view freezing; it is backed by the algebra above. This milestone changes no previous accepted-result cap.

## Checked lifecycle, storage and concurrency

`20260907174326_square_dormant_account_connection.sql` is additive and transactional. New private tables have forced RLS and no ordinary direct access; public security-definer RPCs have empty search paths and explicit EXECUTE capabilities. Role membership alone is insufficient: actual `session_user` must match the approved broker/enroller/webhook LOGIN. Customer actions also recheck the real `auth.sessions` record, active workspace membership, role, entity and exact application/environment/redirect.

Configuration contains no installed rows or actual retention choices. Verified enrollment snapshots the complete approved policy, binds the exact confirmed generation, and cannot reuse old mappings after reauthorization. Changing approved policy closes that generation until fresh approved enrollment. Cursor deadlines honor the approved duration within the unchanged one-hour maximum. Source versions remain pending/untrusted and economically blocked.

Lock order uses the stable durable connection before account/state/credential rows. Merchant-wide revocation serializes all local connections for the same application/seller, fences them before provider I/O, and prevents pre-disconnect late callbacks—even those whose seller was not known at initiation—from installing authority. Late refresh uses the original credential-version/generation/lease CAS and cannot restore authority. Terminal provider-revoked responses close authority immediately. Signed provider notifications are replay-protected by event ID; old notifications cannot revoke a later authorization merely because delivery was delayed.

The generic credential broker's unchanged UUID lease field is a purpose-separated representation of the Square durable lease fingerprint. Checked SQL independently derives it from the **current full stored lease**, and also enforces actual runtime LOGIN, task, owner, generation and deadline. The UUID conversion is not an authority minting helper; released/stale leases cannot release ciphertext. Decrypted credentials remain one-use capabilities.

Finite no-eviction quotas: 32 accounts per workspace, 128 generations/states and 512 encrypted credential versions per account, 10,000 credential-read evidence rows and 10,000 allowlisted audit events per account, 4,096 revocation receipts per application. App receipt allocation serializes even different merchants; overflow records an immutable capacity latch that closes new/runtime authority without losing the revocation fence or deleting replay evidence. Audit rows contain only fixed enums, authenticated actor IDs and fingerprints, not provider text or secrets. No purge path is installed.

## Local evidence and rerun

Focused suites: OAuth/broker 245 assertions, discovery/mapping 119, routes 195. Combined actual PostgreSQL + synthetic-provider + browser qualification: 243 assertions across 49 scenarios. Existing durable qualification with all three migrations: 572 assertions across 226 scenarios. These are local evidence, **not Square Sandbox qualification**. Final exact-head CI/Preview is reported with the delivery PR.

`node scripts/run-square-account-connection-qualification.js --supabase-local` verifies the isolated local Supabase container before creating owned disposable databases. The native alternative requires an explicit `SQUARE_QUALIFICATION_PG_BIN`; it creates a Unix-socket-only owned PostgreSQL cluster and rejects inherited/remote database configuration. The harness tests clean install, failure immediately before COMMIT, rollback/retry, privileges, unchanged QBO/schema/history, independent-session lifecycle races, actual broker decryption inside pending ingestion, lost commit acknowledgements and private cursor recovery. It cleans only its owned databases, roles and processes.

Playwright 1.62.1 is a pinned development dependency. Install its Chromium with `pnpm exec playwright install --with-deps chromium` for CI; browser installation runs only in the explicit disposable database test job. Native local qualification may explicitly select an installed browser with `SQUARE_QUALIFICATION_BROWSER_EXECUTABLE` and a dependency library with `SQUARE_QUALIFICATION_PLAYWRIGHT_PATH`. There is no silent browser skip.

The browser uses the real panel/handlers, server-held HttpOnly/SameSite=Lax session, actual DB LOGINs and service, checked enrollment and pending commits. Distinct loopback hostnames prove cross-site callback cookie delivery and that the host cookie never reaches the provider. Exact logical HTTPS OAuth URLs are mapped only at the explicit owned loopback fixture transport; this does not test TLS, a deployed auth service or real Square. Denial, reauthorization, disconnect, callback history/referrer/markup/console privacy and default closed 404 behavior are covered. Upstream edge/access-log code-query suppression remains an approval prerequisite, not a local-test claim.

Integrated self-review corrected merchant-wide revocation, mapping-generation reuse, current-lease credential reads, exact provider-issuance diagnostics, supported identifier punctuation and composed storage bounds. A separate read-only reviewer inspected the full working-tree flow and independently reran focused suites; its route-identifier finding was corrected with coverage. No remaining material finding was reported. Final committed refs/checks are separate delivery evidence.
