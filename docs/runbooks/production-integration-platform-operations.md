# Production Integration Platform operations

This runbook is a source-only template. It must not be used to provision or activate anything until the itemized Production cost/resource plan, exact identities and rollout window are approved.

## Preflight and launch

1. Pin the reviewed Git commit, immutable image digests, migration ledger and provider policy fingerprints. Confirm the plan changes no existing QBO resource or Terraform address.
2. Read back the Production project/region, DNS/TLS host, WAF rules, VPC/NAT egress, queue limits, service identities, numbered secret versions, KMS IAM, database target, backup policy, log retention and budget alerts. Reject Sandbox, Preview, `/latest`, cross-project and shared provider identities.
3. Apply migrations with a checksumed ledger. Create provider LOGINs separately; grant each only its checked RPC. Confirm FORCE RLS, no direct table access, no `service_role` shortcut, and closed platform/provider/economic/AI gates.
4. Deploy by immutable digest with direct `run.app` ingress denied. Prove exact Host/SNI/routes, OIDC audience/invoker, provider egress allowlist, database `session_user`, callback/webhook raw-body handling, sanitization, bounded concurrency/rate/retry, and zero transaction-level AI.
5. Enter secrets privately, verify versions without reading values, then run one allowlisted controlled consent. Open provider calls only after current seller/location/workspace/entity/generation authority is durable.

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
