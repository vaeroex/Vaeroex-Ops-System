# Square GCP callback qualification

2026-09-08 UTC. This is a dependent, isolated implementation on PR #354's reviewed base; PR #354 itself is unchanged. The user now approves the described resources and TLS/ACME storage within **USD 20/month before tax**, but explicitly requires code-only completion first. No provisioning, account authentication, external configuration, deployment, secret delivery or live OAuth is performed by this delivery.

## Scope and authority boundary

One direct guest-TLS same-origin portal in existing project `vaeroex-square-sandbox` (number `112579468800`), Oregon `us-west1`, is proposed for the existing isolated operator/database/Square Sandbox binding. It ends at `authorized_unmapped`. It does not authorize mapping, enrollment, refresh, runtime ingestion, notifications/webhooks, Production or QBO changes. The existing empty Vercel project is not the callback ingress, and no Production setting is weakened.

The callback must use the actual request's current authenticated session, checked state intent, actor/membership, host binding and generation/revocation/row fences. Only this invocation's successful atomic state consumption can enable first-consent secret access/exchange/encryption; neither a serialized assertion nor local environment/configuration grants customer authority. The existing enrolled-only adapter is not exempted. The native guest identity must be Google-signed and checked against the exact approved project/zone/instance/service-account tuple; attached identity alone is not current customer authority.

Browser-managed unavoidable outbound Square state navigation and its callback history are accepted only in the dedicated private session. The application must not copy raw state/code/error/description/full callback URLs into history, storage, logs or telemetry. Necessary bounded memory processing and inaccessible provider-host diagnostics are accepted residual risks. Known HTTP logs, configured dumps, swap/suspend, raw exception capture and request-bearing tracing remain failures, not residual-risk waivers. Cleanup must affect only this private qualification session.

## Delivered template boundaries

See [resource template](../../services/square-sandbox-callback/infra/README.md) and [guest runbook](../../services/square-sandbox-callback/ops/README.md). Terraform references the existing keyless broker account, application-secret version and KMS key; it does not import/recreate them or read payloads. Only the DB-secret **metadata** is declared. Its single future version must be privately delivered outside Terraform; there is no `secret_data`, version data source, secret-bearing output/state, cloud credential or automatic deploy hook.

The broker's proposed access is exact application version 1, exact DB-login version 1 and encryption on the existing KMS key, all expiring. No webhook access, decryption, runtime/enroller LOGIN, service-account key, IAM administration or project-wide broker grant is included. Effective inherited IAM and default/service-agent permissions still require metadata-only hosted review. Unix users do not establish separate attached cloud identities.

The live daemon's systemd unit is nonroot with only low-port binding capability, no output storage, core/swap disabled, gated startup and no automatic restart. TLS/ACME source keys are root `0600` on the encrypted boot disk; systemd passes narrow read-only runtime copies. ACME-only bootstrap/renewal never starts or restarts OAuth. The daemon loads renewed credentials at the next operator-approved window. No full Next application, managed HTTP load balancer/proxy, new DNS hosting, backup or log service is part of this callback path.

Required operating inputs are unresolved until action time: exact hostname/DNS route, zone/instance ID, supported dated Ubuntu image and Node/Certbot patches, approved operator access, finite approval expiry, exact database endpoint/session behavior, USD billing account, existing verified email-channel IDs and proof of alert delivery. Null/false examples fail closed; they are not fabricated operational values. The approved resource budget is not permission to skip code-first sequencing or live-consent readiness.

## Finite acceptance gates

Local portions of gates 1–9 are implemented and exercised below; resource-dependent portions remain **pending**. Local synthetic success is not hosted configuration, live OAuth, IAM verification or remote migration application. [Delivery evidence and exact manifest](square-gcp-callback-delivery.md) distinguish local checks from required exact-head CI and hosted gates.

| Gate | Required evidence | Current status |
| --- | --- | --- |
| 1. Scope and policy | Exact operator/entity/host/resource tuple, finite approval, risk/storage allowlist; callback-only stop | Code/defaults reviewed; real action-time tuple pending |
| 2. Native host binding | Wrong project/identity/origin/instance/resources/expiry deny; no Vercel spoof/ADC fallback | Local signed synthetic JWT/identity negatives pass; actual host/IAM pending |
| 3. Current authentication | Actual user/session/membership; different user/new session/cleared or revoked cookies and role loss deny before exchange | Local Auth mocks plus actual PostgreSQL session/member/lock checks pass; real isolated Auth pending |
| 4. First-consent authority | Actual separate broker LOGIN; invocation consume required; forgery/replay/stale generation/lock-wait denial | Local real-LOGIN suite and independent review pass; remote install/grants pending |
| 5. Lifecycle and one-use | Duplicate/denial/disconnect/revoke/new-consent races, failure at every await, lost ACK and no stale restore/code retry | Focused and existing local lifecycle suites pass; hosted failure injection pending |
| 6. Privacy transport | Effective TLS/HTTP headers, fixed clean 303, malformed/pre-handler/timeout/crash negatives; no raw reflection/copy | Local native TLS/Chromium, cancellation and certificate negatives pass; actual ingress/guest failures pending |
| 7. Detection works | Distinct synthetic canaries plus unsafe positive controls; inspect accessible log/disk/cache/report sinks | Local response/SDK/ACME detector positive controls pass; accessible hosted sink inspection pending |
| 8. Resource bounds | Slow/maximum/chunk/cancellation/overload tests; measured 2 GiB safety and no retained reaction/queue growth | Local byte/chunk/timeout limits and real 2-active/third-rejected/12-burst tests pass; hosted RSS/cgroup failure sizing pending |
| 9. Compatibility/review | Required repository gates, affected old suites and independent final-head review; PR #354/Production/QBO unchanged | Local parser/architecture/DB/build/security gates and independent source review pass; exact-head CI required on dependent PR |
| 10. Hosted configuration | Exact guest route/IAM, no known capture, supported patches, database and budget-channel health; renewal/restart evidence | Not run; code-first delivery only |
| 11. Hosted synthetic privacy | Separately approved mock-only fixture on actual artifact/route; accessible sink checks with positive controls before real credentials/OAuth | Not run; no hosted fixture/deployment claim |
| 12. Explicit live-run readiness | Actual operator auth, retention/disposition, exact calls, cumulative cost controls, rollback and private-session cleanup | Not run; separate readiness/action-time authority required |

Known failures require a narrow fix and affected retest plus repository gates. Unanswered ingress questions for bypassed Vercel/Cloudflare products and inaccessible host diagnostics are not additional gates for this direct guest-TLS route.

## Local infrastructure/ops evidence

Pinned Terraform `1.16.1` with HashiCorp Google `8.1.0` was initialized with backend disabled and an empty cloud-credential environment; the signed provider lockfile is included. Local provider-schema `validate` passed, and **9 mocked-provider tests passed**: closed exact host/cost/IAM/budget, missing deployment authority, missing/foreign channels, public operator CIDR, floating image, foreign region, an unsupported Oregon zone and expired approval. Terraform plugin sockets required local execution permission on macOS; no Google API authentication/plan/apply occurred. These are schema/mock assertions, not proof that actual resource policies exist.

The ops runner passed **87 local synthetic assertions**: policy-denial/static unit/resource controls, effective guest-agent section/duplicate negatives, renewal-start safety, aligned read-only ACME mount and actual loopback ACME handling with synthetic files. Its reflection detector includes a deliberately unsafe positive control. New native credentials: **2,309 assertions**; real portal/Chromium/native TLS and overload: **697**; joined portal → actual broker LOGIN/database → existing lifecycle → synthetic provider/KMS: **241**. The latter mocks the Auth issuer, and Google identity is independently signed/mocked; this is not one hosted native-composition run. Independent review corrections include ACME/zone alignment, TLS validity and the explicit SOFTWARE KMS version-1 pin. Linux systemd verification, actual guest startup, certificate issuance/renewal and GCP IAM remain pending.

## Cost and operational envelope

Public USD on-demand prices checked 2026-09-08, 730 hours, Oregon, no free/trial/Spot/commitment/paid-image credits. Manual secret replication is one location. The pending already-approved webhook is counted conservatively but not created/accessed by this callback.

| Item | Rate/assumption | Monthly modeled cost |
| --- | --- | ---: |
| e2-small, 2 GiB | 730 × USD 0.016752855/hour | $12.229584 |
| Standard boot disk | 10 GiB × 730 × USD 0.000054795/GiB-hour | $0.400004 |
| Attached Premium external IPv4 | 730 × USD 0.005/hour | $3.650000 |
| Existing software KMS version | 730 × USD 0.000082192/hour | $0.060000 |
| Three SM versions | Existing app, approved pending webhook, new DB version; 3 × 730 × USD 0.000082192/hour | $0.180000 |
| KMS operations | 10,000 × USD 0.03/10,000 | $0.030000 |
| Total secret accesses | 10,000 × USD 0.03/10,000 | $0.030000 |
| Premium US/Canada egress | 5 GiB × USD 0.12/GiB | $0.600000 |
| **Total** | **Fixed $16.519588 + usage $0.66** | **$17.179588 ≈ $17.18** |

[Compute](https://cloud.google.com/products/compute/pricing/general-purpose#e2-machine-types), [disk](https://cloud.google.com/compute/disks-image-pricing), [IPv4/egress](https://cloud.google.com/vpc/network-pricing), [KMS](https://cloud.google.com/kms/pricing), [Secret Manager](https://cloud.google.com/secret-manager/pricing).

At 744 hours and the same usage, approximately **$17.50**. The **USD 20/month pre-tax total**, including the existing roughly USD 0.18 baseline, is approved; it is not an additional USD 20 or a guaranteed hard invoice cap. Missing webhook version reduces the estimate by about USD 0.06. No runtime secret/new KMS version, NAT/LB/registry/DNS zone, backup/snapshot/monitoring or paid patching is included. Existing Free database/DNS hosting and ACME add no planned new subscription; existing domain and organization bills are unchanged, not free.

The template's whole-project budget excludes credits, uses actual-spend USD 10/15/18/20 thresholds and requires verified existing email channels before qualification. Alerts lag and do not stop resource charges. One-instance inventory/quota review, fixed outbound hosts, monthly cumulative aggregate usage and finite windows supplement them. Runtime limits are at most two concurrent requests, a global token bucket with a 12-request burst and refill of six requests/minute (not a strict per-minute ceiling), 100 sensitive open attempts, 10 initiation attempts and one hour per manually approved process run. Failed attempts also consume their budgets. Restart cannot silently reset the cumulative budget; no automatic restart is configured. Actual enforcement and no-dump failure tests remain required.

Taxes/FX, abuse, unexpected destinations/usage and future prices can exceed the model. Stopping compute leaves disk/static-IP charges; unused reservations can have different rates. Any destruction needs itemized authority. A paid e2-micro would be approximately USD 11.06 under identical assumptions but halves RAM; no shared free allowance is relied upon. No autoscaling, failover or application SLA is promised.

Reserve **two operator hours/month**, plus incident time; routine cost at hourly rate R is roughly **USD 17.18 + 2R**, before taxes/incidents. The design's 3–5 engineering days was a planning estimate, not an implementation completion claim or vendor quote. Weekly/before-window advisories, planned patching/reboot, certificate renewal, cumulative budget review and privacy smoke checks belong to the named operator. A paused Free database, failed consent or maintenance interruption can require rescheduling.

## Rollback, retention and handoff

No external resource has been changed by this code delivery. Later rollback first closes new consent and bounds/cancels work; it must not restore consumed codes or stale authority. Recover from immutable code/configuration, not raw-memory checkpoints. The existing 30-day Sandbox approval/source-retention policy remains the recorded baseline, not a newly installed deletion job. Access expiry does not delete credential/discovery/audit data. Exact disposition/purge and end-of-qualification handling remain explicit decisions before live readiness.

Full source ingestion qualification still needs independently authorized mapping/enrollment, separate runtime/notification capability and source/cursor scenarios. Those are not completed or activated by a successful callback-only qualification. Production, QBO, the original dirty worktree and PR #354 remain outside this delivery's mutation scope.
