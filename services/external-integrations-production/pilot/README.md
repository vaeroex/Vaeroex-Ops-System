# Production Square internal-seller pilot package

This package is an offline, nonsecret gate for the first one-workspace internal
seller pilot. It does not activate Square. The checked-in example intentionally
describes the current blocked state: Production database foundation
`20260902191323` is present, the Square overlay and layered callback are pending,
credential containers are empty, the allowlist is empty, and every gate is
false.

The immutable network contract is:

- project `vaeroex-integrations-prod`, region `us-west1`;
- callback `https://square.vaeroex.com/api/integrations/square/callback`;
- webhook `https://square.vaeroex.com/api/integrations/square/webhook`.

Run the committed baseline check without contacting Production:

```sh
node services/external-integrations-production/pilot/qualify.mjs \
  --evidence services/external-integrations-production/pilot/pilot-state.example.json \
  --expect-head 6b5ccc4513150312e5c3a1dbcce81fab111571e7 \
  --expect-blocked
```

For an activation-review candidate, create a private evidence JSON outside the
repository from sanitized readbacks only and omit `--expect-blocked`. The checker
accepts no extra fields, credential-shaped values, URLs carrying database
credentials, or open gate. A pass means only “eligible for a separate human
activation review”; it neither grants authorization nor mutates a system.

Run the synthetic lifecycle coverage with:

```sh
node --test services/external-integrations-production/pilot/model.test.mjs
```

`verify-database.sql` is a read-only, fail-closed post-provisioning check. It
requires the six native LOGINs to have safe attributes, one exact inherited but
non-settable capability membership each, no direct function ACL for a LOGIN,
and no LOGIN/capability table privilege. The Square overlay remains responsible
for granting its exact checked RPCs to the NOLOGIN capability roles; this package
does not recreate that overlay.

`stage-provider-secret.sh` is intentionally limited to the application and
webhook-signature containers. It refuses noninteractive input, the wrong GCP
project, an unapproved window, trace mode, unknown targets, or any existing
version. It sends private terminal input directly to `gcloud` stdin without a
command argument, environment variable, file or echo. It is never called by a
build, test, deployment, or this package. Database credentials must use a
separately reviewed Production native-SCRAM profile; the Sandbox-pinned profile
must not be repurposed.

The sole manual handoff is [PRIVATE-HANDOFF.md](PRIVATE-HANDOFF.md). Do not put
seller identifiers, credentials, private database endpoints, customer data or
provider payloads in Git, CI artifacts, issues, PR comments, chat, or the
sanitized qualification output.
