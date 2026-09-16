# Private Production pilot actions for Isaac

Use this handoff only after agent-run steps 1–4 in `README.md` and resolution of
all named blockers have produced a fresh, sanitized readback of the exact
reviewed Production state. Do not repeat
the overlay, Terraform, database, routing, alert or qualification work here.
If the README's six-LOGIN native-SCRAM blocker or executable Production
binding/runtime blocker is unresolved, this handoff must not begin.
Keep every Square gate false until the separately reviewed one-customer consent
step. Never put a credential, MFA response, seller identifier, private database
endpoint or provider payload in Git, CI, an issue, a PR, chat or a recorded
terminal.

1. Complete the private account and credential steps. Sign in to the exact
   Square Production account and complete any account or MFA challenge only in
   Square's private UI. Register exactly
   `https://square.vaeroex.com/api/integrations/square/callback` and
   `https://square.vaeroex.com/api/integrations/square/webhook`; do not register
   a Preview, Sandbox, Vercel, IP, alternate-host, query or trailing-slash form.
   In one approved, private, non-recorded GCP Secret Manager console session,
   verify the signed-in operator is exactly `isaac@vaeroex.com`, the project is
   exactly `vaeroex-integrations-prod`, and the already-existing
   `square-production-application` and
   `square-production-webhook-signature` containers are empty. Proceed only if
   the current provider UI presents a verified protected entry surface that
   does not render or reveal the value. A plaintext textarea or unverified
   masking is not a no-echo path: stop and wait for a separately reviewed
   private delivery mechanism. Do not use a local CLI, helper, second
   host/window, clipboard capture or value readback. Retain only sanitized operator/audit metadata and
   a metadata-only result showing enabled version `1` with total count `1` for
   each exact container. If creation is cancelled, times out or loses its
   acknowledgement, do not retry: keep all gates false, reconcile metadata and
   the operator audit event, and escalate an unresolved result for a reviewed
   recovery/rotation decision. Never inspect payload bytes, adopt `latest`,
   disable or destroy an uncertain version, or create version 2 to make the
   check pass.

2. Select the exact Vaeroex-owned internal pilot subject. In the private
   operating record, choose one Production workspace and one internal Square
   seller, then explicitly record the merchant, business entity and location
   IDs. Compare provider discovery to that record; do not infer a mapping from
   names or the provider default. Approve only that exact tuple for the private
   allowlist and stop if any identity is ambiguous. A separately reviewed
   backend/agent procedure—not this personal handoff—must apply the approved
   private tuple and verify that a foreign workspace, seller, business entity and
   location each fail closed. Retain those exact checks only in the private
   operating record. The procedure may export at most a sanitized count readback
   showing one allowlist entry, one distinct workspace and one distinct seller.
   Those counts do not prove the mapping. Seller, workspace, entity and location
   identifiers must not enter the repository, qualification JSON, CI artifacts,
   issues, PR comments or chat.

3. Give consent only after the sanitized qualifier reports a passed preflight,
   mapping still required outside the qualifier and no activation authority, and
   after the separate private operating record verifies the exact one allowlisted
   tuple. Together they must cover the reviewed overlay, database closure, six
   deployed release identities, version-1 credential metadata, clean
   callback/webhook boundaries, passing lifecycle/rollback evidence and every
   gate still false. Neither record substitutes for the other.
   Authorize only that one internal seller with the five reviewed read scopes
   and only the minimum separately approved read-only pilot gates. Do not enable
   a second customer, economics, Vaeroex dispatch, QBO changes or additional
   infrastructure. Name the incident owner, rollback owner and expiry time in
   the private operating record. Any stale, partial or ambiguous readback means
   no consent and the pilot remains closed.
