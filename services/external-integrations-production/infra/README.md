# Production Integration Platform composition template

This module validates a proposed provider-neutral Production composition and emits only a sanitized review manifest. It intentionally creates no cloud resource and cannot apply migrations, create/read secrets, grant IAM, deploy code, or open an activation gate. Resource blocks are added only after one consolidated cost/provisioning approval.

The platform-level names represent the single shared load-balancing, networking, queue, artifact, observability and database/backup stack. `provider_bindings` supplies separate callback routes, KMS keys, numbered secret references, service identities and database LOGINs for each provider. Cross-provider reuse fails during planning.

Use `terraform init -backend=false` and `terraform validate` for offline review. Never place secret values in Terraform inputs or state. The checked JSON output is identifiers/policy only and remains dormant.
