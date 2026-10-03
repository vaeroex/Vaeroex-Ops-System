# QBO Direct VPC startup readiness

The first Production no-company scheduler invocation exposed a cold-start
networking gap: the broker's port was ready before its Direct VPC/NAT egress.
Native database connection attempts reached their existing ten-second timeout;
the same revision and credentials subsequently succeeded without modification.
Customer connection access and all execution schedules were disabled again.
No company was connected and no provider task was created.

[Google's Direct VPC guidance](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc)
documents startup connection delays and recommends an HTTP startup probe that
tests an application egress destination before accepting requests.

The correction adds an HTTP startup probe only to the credential broker and
provider runtime, the two existing Direct VPC service modes. `GET /health/ready`
opens and releases the existing native PostgreSQL connection with the unchanged
CA, hostname verification, login, and connection timeout. It executes no SQL,
reads no tenant data, calls no provider, and reads no additional secret. Failures
return only `503 {"ready":false}`; success returns `200 {"ready":true}`. Concurrent
probes share one attempt. A failed attempt can be retried; a successful startup
is cached for that process. This is a startup check, not a continuous health claim.

Cloud Run probes every 15 seconds, with a 15-second request timeout and 16-failure
limit. `/health`, operational authorization, credential authority, provider
contracts, IAM, TLS validation, database schemas, and minimum instance counts
remain unchanged. No new infrastructure resource is required.

Release must keep execution paused and customer access disabled until the exact
passing artifact is deployed, both startup probes pass, and a bounded no-company
scheduler invocation completes through normal OIDC without broker/runtime
errors. A real company connection still requires the customer's explicit choice.
