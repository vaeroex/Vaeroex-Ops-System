# Vaeroex Production Integration Platform

This foundation is one provider-neutral Production platform with isolated provider adapters. It is dormant: it creates no cloud resource, LOGIN, secret, connection, task, callback, webhook, provider call, customer surface, economic contribution, or AI dispatch. Its migration remains source-only until a separately approved Production rollout.

## Shared once

The platform reuses one Production Postgres authority/data plane and the existing provider-neutral `integration_connections`, mappings, credentials, sync runs/tasks/checkpoints, webhook events, rate-limit states, source records and versions, reconciliation cases, deterministic change sets, dirty nodes, aggregate states, KPI policies, monitoring, and backup procedures. The proposed cloud composition shares the project boundary, load balancer, managed TLS, WAF policy, VPC/subnet/NAT/static egress, task transport, artifact repository, deployment controls, logging/metrics policy, and recovery runbooks.

The foundation deliberately does **not** create Square-specific schedule, receipt, reconciliation, KPI, monitoring, or backup tables. Square can use the shared durable runtime only after a later checked adapter proves the complete provider/environment/workspace/business-entity/connection/generation tuple at the database boundary. Existing qualified Square tables remain unchanged until that bridge is separately reviewed. The historical QBO provider registry, fingerprints, implementation, Terraform state, gates, and behavior are unchanged; moving any existing QBO cloud resources into the shared composition requires an explicit zero-replacement import/moved-block plan.

## Isolated per provider

Each provider retains a unique callback route, application identity, KMS key, numbered Secret Manager versions, service accounts, database LOGINs and roles, endpoint/scope policy, webhook signature policy, schedule policy, rate-limit partition, parser/descriptor versions, activation gates and audit namespace. Database uniqueness constraints prevent any provider from reusing another provider's KMS key, application/webhook secret, service account, LOGIN, or database credential reference. Shared infrastructure is never authority.

The dormant Square capability roles are `NOLOGIN NOINHERIT` and have no runtime assignment. On PostgreSQL 16 and later, a non-superuser `CREATEROLE` migration administrator receives one automatic administration-only membership in each role it creates. The migration accepts at most that exact edge only when `ADMIN` is true, both `INHERIT` and `SET` are false, and the member is already a superuser or `CREATEROLE` administrator. It rejects every assumable, inheritable, outbound, non-administrative, non-privileged, or additional membership. This records PostgreSQL's role-administration model without turning migration administration into provider execution authority.

Square's overlay pins Production to `https://connect.squareup.com`, API version `2026-08-19`, and exactly `MERCHANT_PROFILE_READ`, `ITEMS_READ`, `INVENTORY_READ`, `ORDERS_READ`, and `PAYMENTS_READ`. Payment-refund reads use `PAYMENTS_READ`; no write scope is present. OAuth state, token encryption AAD, webhook verification, task identity, cursors and source/fact fingerprints remain provider-, environment-, workspace-, entity-, connection- and generation-bound.

All platform and Square gates are structurally false in this change. Provider calls, onboarding, webhook intake, evidence, economics and AI cannot be enabled by configuration alone. No individual Square transaction or raw provider payload is an AI input. Any later compact-snapshot AI route remains a separate, budgeted, deterministic eligibility milestone.

## Production lifecycle

The existing reviewed lifecycle remains authoritative: one-use opaque OAuth state; exact redirect and scope validation; broker-only token exchange; KMS-bound encrypted credential versions; atomic refresh rotation; current-generation CAS; local disconnect; authenticated provider revocation; bounded retry and rate limiting; raw-byte webhook signature verification; provider/application delivery deduplication; atomic page/source/checkpoint commits; immutable provenance; deterministic replay/reconciliation; explicit incomplete history and uncertainty.

Generic 401/expiry/refresh failure fences only the affected credential/connection. Provider-wide fencing requires authoritative evidence. Delayed callbacks, refreshes, webhooks, tasks and page commits cannot restore a revoked or superseded generation. Payments, Refunds, Orders, Catalog and Inventory remain distinct observations; no revenue, profit, netting, accounting truth, stock or valuation inference is introduced.

## Activation boundary

Production launch requires, in order:

1. approve the itemized shared-platform and Square incremental costs;
2. provision the isolated Production project/resources and configure bounded budgets/alerts;
3. apply only reviewed migrations and bind exact native LOGINs to exact checked RPCs, never tables;
4. enter Production Square application/webhook secrets privately and register exact callback/webhook URLs;
5. enable one internal allowlisted seller for a new controlled Production consent and verified location mapping;
6. qualify bounded initial/incremental sync, replay, pagination, refresh, disconnect, provider revocation, stale-generation fencing, webhook deduplication and lost-ack recovery;
7. prove monitoring, retention, backup/restore, rollback and incident-response drills;
8. verify the normal Production workspace evidence/KPI experience with economics and AI still closed;
9. separately approve staged customer onboarding.

Marketplace publication, Square economic contributions and Square-triggered AI are later business/policy decisions and are not prerequisites for a secure deterministic read-only launch.
