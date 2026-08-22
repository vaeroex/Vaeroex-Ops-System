# External Integrations Phase 5 Credential Security Readiness

**Status:** Architecture/security review approved for commit, PR, CI, and merge
**Date:** 2026-08-21
**Branch:** codex/external-integrations-phase-5-credential-security
**Base:** 5bf874733d636c14d0f6ae7064690e3e8a5cf23d
**Scope:** Provider-neutral credential, OAuth, KMS, and Secret Manager security foundation only

## Runtime Boundary

Phase 5 does not authorize a real provider credential, OAuth authorization, or Production integration runtime. It creates no Google Cloud resource, provider credential, provider implementation, queue, webhook, UI, Preview configuration, or Production configuration. Model-call count remains zero and `promotionAuthorized` remains `false`.

OAuth expiration, credential-lifetime recording, refresh-lease validity, and authorization audit/state-transition timestamps use the database transaction clock. Caller-supplied timestamps cannot establish or extend authority.

## Deferred Live-GCP Gate

The lack of live Google Cloud KMS, Secret Manager, and IAM verification is accepted only as a deferred pre-runtime gate, not as Production approval.

Before any real provider credential, OAuth authorization, or Production integration runtime may be used, Vaeroex must successfully validate KMS Encrypt/Decrypt with canonical AAD, Secret Manager numeric-version access, denied unauthorized IAM access, environment isolation, audit logging, key/secret rotation behavior, and cleanup using explicitly isolated non-Production GCP resources.

This gate must remain closed until every listed validation succeeds in the isolated non-Production environment. A repository merge, automatic Git-linked deployment, or passing synthetic test does not satisfy the gate.
