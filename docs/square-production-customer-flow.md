# Production Square customer connection candidate

This repository change adds an owner-controlled connect, connection status, and
workspace disconnect experience. The current Production database and services
remain dormant. This candidate is not a deployment or activation authorization.

The workspace app derives the actor and session from its authenticated Supabase
client. The checked RPC independently verifies the live session, active owner
membership, workspace/entity binding, paid entitlement, generation, and gates.
The Square callback uses the existing managed-edge handoff. A separately
authenticated broker consumes a one-shot exchange latch, checks authority before
each provider request, verifies the seller through authenticated discovery, and
stores an encrypted credential with workspace/connection/generation AAD.

Disconnect fences this workspace locally, including failed consent, and permits
a new connection after disconnected history. It does not claim that provider
revocation has happened. A provider request already authorized and in flight at
disconnect may finish; later requests and credential commit must recheck authority.
Mapping and data reads remain unavailable in this customer slice.

## Validation

The focused service tests exercise managed callback shape, duplicate replay,
broker identity/context mismatch, authority revocation between provider requests,
encrypted-only commit, and zero AI imports. Workspace tests cover owner/session,
host/CSRF/form validation, disconnect confirmation, recovery and reconnect.
Existing internal consent/manual read regressions remain unchanged.

CI runs the customer database test even after the known QBO lease failure, only
when disposable database setup succeeded. Its runner stages exactly the 104
canonical Production migrations through `20260902191325`, then this customer
migration; it rejects remote database targets and does not edit ledger history.
The candidate resides in `supabase/production-migrations`, outside the mixed
Sandbox history; an explicitly authorized Production staging operation must copy
that exact reviewed file beside the 104 canonical files. Ordinary local migration
commands cannot accidentally apply it after the Sandbox chain.
Current false-only activation constraints remain intact, so successful customer
consent SQL branches require a later coordinated activation contract.

## Required before a live deployment

The current native provisioner rejects versions after `20260902191325` and rejects
the extra customer RPC grant to the OAuth/broker authority roles. Its exact source,
ledger, catalog, and admission contract must be updated and qualified before this
migration can be applied or the customer service admitted. This is a current
compatibility blocker, not an approved bypass of native checks.

After code/database qualification and native compatibility, build the changed
consent image through the repository-bound trigger and run vulnerability and
secret analysis on its immutable digest. The previously qualified consent digest
does not contain this customer implementation.
The historical consent-image CVE exception also remains byte-bound to its old
bundle. This candidate does not update that exception: its regression requires
the changed bundle to be rejected by the old exception. Any necessary exception
for a new image requires new reachability evidence and separate approval.

Only then prepare separately authorized private provisioning for OAuth and broker.
The native no-echo PostgreSQL flow generates each role's credential and binds its
acknowledged numeric Secret Manager version. Verify version 1 exists and is enabled
before referring to it in Terraform. The Square application secret is entered
privately into its existing container and verified by metadata only. Never put
values in chat or manufacture version references. Roles remain fenced until
reviewed admission; no scheduler, webhook, economic, or AI authority is enabled.
