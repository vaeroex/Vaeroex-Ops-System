# Production Integration Platform operations

This runbook governs the approved single-region hardened configuration. The recurring gross ceiling is USD 150 per month; paid Supabase PITR, reservations, commitments, extra regions/replicas, Enterprise products, AI usage and Marketplace resources are excluded. Budget notifications are not a hard cap.

## Preflight and launch

1. Pin the reviewed Git commit, immutable image digests, migration ledger and provider policy fingerprints. Confirm the plan changes no existing QBO resource or Terraform address. Store state only in the versioned, private `vaeroex-integrations-prod-terraform-state` bucket.
2. Read back project `vaeroex-integrations-prod`, region `us-west1`, credit-bearing billing account, gross-spend budget, DNS/TLS host, WAF rules, VPC/NAT egress, queue limits, service identities, numbered secret versions, KMS IAM, database target, existing Supabase Pro backup policy, 30-day configured log retention and alert channel. Reject Sandbox, Preview, `/latest`, cross-project and shared provider identities.
3. Apply the infrastructure-only plan first with no image digests. It may create empty secret containers but never secret versions. Build the disabled bootstrap and Square callback edge as the dedicated build identity, test both, pin both Artifact Registry digests, then apply the runtime/LB plan with every gate false. The runtime and query-stripping edge must never be deployed independently.
4. Verify the canonical Production ledger and apply only the reviewed migration with a checksumed ledger. Create provider LOGINs separately; grant each only its reviewed capability role and checked RPC set. Confirm FORCE RLS, `session_user`, no direct table access, no `service_role` shortcut, and closed platform/provider/economic/AI gates. If no reviewed RPC exists for a capability, it receives no executable database authority.
5. Deploy by immutable digest with direct `run.app` ingress denied. Prove exact Host/SNI/routes, forwarded-authority rejection, query removal before Cloud Run request logging, forged-handoff-header removal, denial-description omission, OIDC audience/invoker, provider egress allowlist, database `session_user`, webhook raw-body handling, sanitization, bounded concurrency/rate/retry, and zero transaction-level AI.
6. Enter secrets privately, verify versions without reading values, then run one allowlisted controlled consent. Open provider calls only after current seller/location/workspace/entity/connection/generation authority is durable.

## Recovery and rollback

- Stop new dispatch first; close provider onboarding, callback/webhook and runtime gates; fence affected provider/connection generations; do not alter another provider.
- Revoke invoker/IAM and database LOGIN capability before rollback. Preserve encrypted credentials and immutable evidence unless the approved retention/revocation policy requires destruction.
- Roll runtime back by reviewed image digest. Database migrations are forward-only: corrective migrations must preserve source/fact provenance and provider authority. Never restore by editing fingerprints or cursors.
- After database restore, keep every provider gate closed. Reconcile credential versions, provider grants, current generations, task leases/delivery acknowledgements, webhook receipts and checkpoints before dispatch. A backup-restored stale refresh token requires fail-closed reconnect or provider-supported reconciliation.
- Requeue only tasks whose idempotency tuple and generation remain current. Expire stale leases; conflicting webhook/event fingerprints become incidents, not duplicates.

## Revocation and incidents

- Local disconnect fences only that connection and makes no provider call unless a distinct authorized provider-revoke operation is approved.
- Authenticated provider revocation may fence every internally resolved connection sharing the exact verified provider/application/environment grant; never expose cross-workspace results.
- Generic 401, token expiry or refresh failure is not grant-wide evidence. Fence the affected credential/connection, retain sanitized reason codes, and retry only within policy.
- Incident records contain actor/service identity, provider namespace, authority fingerprint, operation, time and sanitized outcome—not tokens, auth codes, raw callback URLs, private cursors, raw webhook/provider payloads, customer identifiers or SQL credentials.

## Monitoring and retention

Alert on callback/webhook availability, signature rejects, queue age/depth, lease expiry, retry/dead-letter rate, refresh deadline, rate-limit circuit, checkpoint non-progress, source/parser rejection, stale freshness, cross-authority denial, backup failure and gate/config drift. Partition every metric by provider/environment without exposing tenant identifiers. Budget alerts are notifications, not hard caps. Apply bounded reviewed retention to logs, task metadata, webhook evidence, encrypted credentials and backups; never silently extend retention.

## Provider addition

A new provider reuses the platform resources and generic durable/data-intelligence machinery but receives a new descriptor/policy version, routes, identities, KMS key, secrets, database roles/LOGINs, endpoint/scope/webhook/schedule/rate partitions and activation gates. Isolation tests must prove that neither provider can read, invoke, fence, replay, rate-limit, reconcile or summarize the other. Existing provider fingerprints and cloud resource addresses remain unchanged unless a separately reviewed migration/import plan proves zero replacement.
