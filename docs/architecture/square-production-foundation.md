# Square Production foundation

This slice creates a separate, dormant Production authority plane. It does not
activate Square, create infrastructure, apply a remote migration, access a
credential, reuse Sandbox state, change QBO, or enable economic or AI behavior.

## Selected architecture

The normal authenticated Vaeroex workspace owns customer connection management
and sanitized evidence presentation. A dedicated public OAuth/webhook ingress,
private credential broker, scheduler, ingestion runtime, and evidence reader run
under distinct service and database identities. Durable work and generation
authority remain in PostgreSQL. Provider reads are performed only by the runtime
through a fixed Production endpoint and the five read scopes.

The binding requires the Production Square endpoints, exact application and dedicated callback origins,
pinned API version, numbered Secret Manager versions, a dedicated KMS key,
distinct service accounts, distinct native database LOGINs, one bounded task
queue, and a reviewed source commit. Every GCP resource and service identity is
bound to the declared Production project, regional resources are bound to its
declared region, and Sandbox/private/numeric hosts and identities are rejected.

Every gate starts closed. The foundation schema deliberately grants no checked
function or table capability. Later deployment-composition migrations must bind
each actual `session_user` to only its fixed RPCs. Direct table access remains
forbidden and FORCE RLS remains the default.

## Durable work

`square_production_sync_schedule` is generation-scoped and references both the
immutable generation and the exact Production account application authority. A
Sandbox connection cannot satisfy its composite authority key. It can represent refresh and incremental synchronization
deadlines without granting execution. Refresh must be scheduled no later than
seven days after the last verified refresh, with a shorter operational target.

`square_production_webhook_receipts` accepts only the supported read-side event
types and `oauth.authorization.revoked`. It retains a payload fingerprint and a
sanitized processing outcome, not raw webhook bodies. Signature verification,
exact notification-URL binding, deduplication, authority lookup and task creation
must be atomic in the later checked RPC.

Catalog deletion detection must use a supported read path with explicit deleted
objects. Orders retain late-arrival and incomplete-history states. Payments,
Refunds, Orders, Catalog and Inventory remain distinct observations and facts.

## Launch gates

Production launch requires, in order:

1. reviewed service composition, checked RPC grants and complete local/database tests;
2. approved itemized infrastructure cost and separately provisioned Production resources;
3. Production Square application secret and webhook signature key entered privately;
4. one allowlisted seller consent with exact read scopes and verified seller/location mapping;
5. bounded first sync, replay, refresh, revocation and stale-generation qualification;
6. monitoring, rollback and disaster-recovery checks;
7. staged customer-onboarding gate.

Economic contributions and Square AI dispatch remain structurally false. If a
future compact-snapshot AI route is qualified, it must be a separate deterministic
eligibility and budgeted dispatch milestone; raw Square records never enter it.

## Cost approval boundary

No resource is created by this change. Before provisioning, the operator receives
one consolidated proposal covering the Production GCP project/billing, non-Spot
compute, load balancing/DNS/TLS, queue/scheduler, static egress, KMS, Secret
Manager, logging/monitoring, database plan/compute/storage/backups and expected
variable provider/runtime traffic. Budget alerts are monitoring, not a hard cap.
