# Guest operations — code-only templates

Nothing here installs, enables, starts or deploys itself. These files are for one isolated Oregon guest after code review and separate action-time authorization. Names, fixed paths and evidence below are operational contracts, not evidence of an existing host. The daemon ends at `authorized_unmapped`; no mapping, enrollment, runtime, refresh, webhook or ingestion work is permitted.

## Sandbox seller consent prerequisite

Use a separate Sandbox test seller, **not the Default Test Account**, with **Automatically create authorizations for all my current apps** cleared. Open that seller's Sandbox Square Dashboard and keep it signed in in the same dedicated private browser session used for consent. Square supports only `session=true` (the default) for Sandbox authorization; the application sends it explicitly. Production continues to require `session=false`. Neither environment may substitute the other's authorization origin or session behavior. These provider session rules do not replace Vaeroex's current actor/workspace/connection-generation checks or single-use expiring OAuth state. [Square's OAuth web-server walkthrough](https://developer.squareup.com/docs/oauth-api/walkthrough).

Do not auto-authorize the seller or alter scope/state to bypass a failed consent page. After an incomplete attempt, return to the clean portal and follow the existing expiry/cancellation and fresh-authorization process; never replay or record the authorization URL or raw state. Successful consent still stops at `authorized_unmapped` and grants no mapping, enrollment or ingestion authority.

## Application-secret payload contract

The pinned application-secret version must contain this strict JSON envelope,
not a raw Square secret string. This is a placeholder-only example; replace
both placeholder values privately in the authorized Secret Manager delivery UI.
The application ID must exactly match the approved Sandbox binding. Do not put
real values in chat, command arguments, shell history, files or diagnostic output.
No new secret read or version creation is authorized by this example.

```json
{
  "schemaVersion": "provider_application_secret_v1",
  "providerKey": "square",
  "environment": "sandbox",
  "clientId": "<approved-Sandbox-application-ID>",
  "clientSecret": "<private-Square-Sandbox-application-secret>"
}
```

The decoder rejects missing/extra fields or a different provider/environment.
The existing checks also reject a mismatched application ID, an unsupported
secret length, or whitespace/control characters. The DB secret is different: it
remains the pinned PostgreSQL DSN, not this JSON envelope. Never infer the content
of an existing version from this example or bypass consumed-intent authority to
probe the application secret.

## Fixed-label consent diagnostics

Only the dedicated native Sandbox `--serve` composition writes
`/run/vaeroex-square-callback/consent-diagnostic.json`. The default sink requires
Linux tmpfs, a service-owned `0700` directory and a regular singly linked `0600`
file; unsafe targets disable diagnostics without changing authorization. Atomic
replacement uses one fixed `0600` temporary filename in that same directory.
There is no new endpoint, database record, remote export, stdout/stderr output or
request-derived filename. The existing unit and authority gates are unchanged.

Each snapshot is at most2048 bytes: fixed stage/outcome enums and aggregate
started/completed/active counters only. No errors, URLs, IDs, tokens, scopes,
headers, request bodies or provider snippets are accepted. At most two attempts
are active and100 begin/finish pairs are recorded per process, within the native
listener's existing limits. Only initial, begin and finalized snapshots are
written; stage updates stay in memory. A nonzero `active` count in a leftover
snapshot is incomplete, not a completed attempt. `lastFailure:null` means no
failure was finalized by this collector; it does not establish successful consent.

Stages identify the last observed boundary, not a diagnosis. In particular,
response-body receipt is not schema validation; `*_validation` means the check
was entered, while verified labels follow the existing corresponding checks.
`fenced_store_returned` means the checked store call returned, not independent
proof of a database commit. `callback_returned` can include seller denial and
must never be treated as `authorized_unmapped`. A later returned callback keeps
the preceding last-failure snapshot and increments the completion counter.
Cancellation finalizes once; late callbacks cannot rewrite that attempt.

Collection starts when the authenticated portal invokes `complete()`. Failures
before that boundary (URL parsing, host/bootstrap/session checks) are not covered.
`unknown` means no more-specific stage was observed. Observer/sink failures never
throw into authorization or trigger retries. A write failure can leave a stale
file; persistence availability is process-local, not attested by the file itself.
Before a future authorized attempt, independently read back the initial snapshot
for the current process and use operator timing/counters, not mere file presence.
Abrupt process/VM loss can prevent final publication; tmpfs is volatile and no
crash-proof, cross-restart history or durable audit guarantee is claimed. Existing
checked database status and audit remain authoritative. Missing/stale diagnostics
do not justify credential probes, replay, broader access or invented failure causes.

`node scripts/run-square-consent-diagnostics-qualification.js` exercises fixed
labels, concurrent completion/cancellation, writer failures, and actual Square
OAuth/discovery/service parsers using synthetic injected dependencies. Its private
temporary-directory file tests do not claim hosted tmpfs/systemd qualification.

## Release and configuration contract

| Location | Ownership and content |
| --- | --- |
| `/opt/vaeroex-square-callback/releases/<reviewed-digest>/` | Root-owned immutable artifact; bundled `dist/index.js` mode `0444`, packaged `dist/node_modules/server-only/{package.json,index.js,empty.js}` from pinned 0.0.1, licenses and this reviewed `ops/` subtree; no dependency download/build on the guest |
| `/opt/vaeroex-square-callback/current` | Root-owned symlink to the exact reviewed release, not writable by the service account |
| `/opt/vaeroex-square-callback/node/bin/node` | Pinned supported Node 24 patch, publisher signature/digest verified; root-owned, not writable by the daemon |
| `/etc/vaeroex-square-callback/config.json` | Nonsecret exact configuration only, root:service-group `0640`; top-level `enabled=false` and null unknown fields until authorized completion |
| `/etc/vaeroex-square-callback/host-policy.json` | Root:service-group `0640`; start-time evidence/expiry record using `host-policy.example.json`; no secrets or request identifiers |
| `/etc/vaeroex-square-callback/supabase-root-2021.crt` | Root-owned public Supabase CA certificate, regular non-symlink file, at most16KiB, not group/world writable; approved SHA256 in config |
| `/etc/letsencrypt/` | Root-owned protected TLS/ACME state on the encrypted boot disk; private keys `0600`; no Square or DB material |
| `/var/lib/vaeroex-square-acme/.well-known/acme-challenge/` | Root-owned non-writable-by-service directories `0755`, public challenge files `0644`; ACME-only content |
| `/run/vaeroex-square-callback/acme` | Read-only systemd bind mount of the preceding webroot; matches the daemon's fixed `challengeWebroot` without copying challenge material |
| `/run/credentials/vaeroex-square-callback.service/` | systemd `LoadCredential` read-only per-service credential copies; configure `tlsKeyPath` as `tls-key` and `tlsCertPath` as `tls-cert` under this directory |

Only root installs files after review; no command is authorized by this runbook's presence. The service gets only `CAP_NET_BIND_SERVICE`, not root. Its systemd output is `/dev/null`; source code also avoids serializing protected values. No secret is placed in environment variables, command arguments, Terraform, build metadata, shell history, images, logs or support bundles. The DB-login secret is fetched in memory through the attached broker identity, not downloaded by this runbook. Its exact private payload contract belongs to runtime composition and must be verified before private delivery; no placeholder password is usable.

`node --conditions=react-server dist/index.js --preflight --config /etc/vaeroex-square-callback/config.json` validates local configuration without secret/network access. `--serve` additionally requires enabled, complete, current binding and host-policy checks. systemd first runs `ops/host-preflight.mjs` as root, then runtime preflight, then serve. The host helper exits `78` silently on denial and does not call metadata, Google, Supabase or Square.

Enabled configuration must set `databaseCaPath` to the exact public path above
and `databaseCaSha256` to the approved certificate-file digest. Obtain/verify
the public CA through the authenticated Supabase database SSL settings, never
by trusting the certificate presented by an unverified connection. CA rotation
requires separately reviewing the replacement and updating its digest; the
digest is configurable, not permanently fixed to one vendor certificate.
Disabled configurations keep both fields null; older disabled configs without
these fields remain valid and perform no CA reads. Enabled preflight rejects a
missing, writable, non-root-owned, malformed, non-CA, expired or digest-mismatched
file before credential/network access. The database receives that CA explicitly
with `rejectUnauthorized:true` and Node/pg's unchanged hostname verification.
The existing DSN v1 is unchanged; no CA, TLS options or trust override is added
to secret payloads. `SQUARE_SANDBOX_DATABASE_CA_PEM` and other ambient TLS
overrides remain rejected, not reinstated. [Supabase CA/hostname verification](https://supabase.com/docs/guides/platform/ssl-enforcement),
[node-postgres explicit SSL configuration](https://node-postgres.com/features/ssl).

After separately authorized host preparation, use the same reviewed entry and
config with `--check-binding` instead of `--serve` for a bounded native check
before asking the operator to sign in to the portal. This mode requires the
same enabled config, CA and current artifact/host policy, reads only the pinned
DB secret through verified Google identity, opens the native broker connection,
compares/rechecks canonical database authority, and closes the connection and
identities. It prints only `square_portal_binding_checked` on success. It has a
30-second process deadline (or earlier host-policy expiry), with cooperative
abort and up to two seconds reserved for cleanup. A peer can stall graceful
`pg.end()` indefinitely; this standalone read-only check therefore exits78
silently at its hard deadline so the OS closes its sockets and unfinished read
transactions. It must not print the success label after interrupted cleanup.
Any rejected binding probe also exits78 immediately: an abort-triggered detached
close may still own a live socket even when a second idempotent close returns.
Failure never clears the deadline and leaves that process running.
Normal callback cleanup is not changed. The check creates no listener, portal user session,
application-secret/KMS access or Square OAuth call, including when
`providerCallsEnabled=false`. Failure is not consent or hosted qualification;
preserve existing privacy controls and approval/budget limits when invoking it.

Host policy has exactly nine keys: `schemaVersion: 1`, finite `approvedUntil`, nonsecret `operator`, `configurationEvidenceId`, `budgetDeliveryEvidenceId`, exact `nodeVersion`, `artifactSha256`, `hostConfigurationReviewed: true`, `syntheticPrivacyPassed: true`. The example's nulls/false values deliberately cannot pass. This record is a local evidence gate, **not** a substitute for Google-signed host identity or current database authority. Its maximum remaining approval is 31 days; actual approved policy can be shorter. Do not fabricate evidence to start the daemon.

## Prepare the guest, then prove known paths closed

Before any OAuth listener, record the exact approved instance ID, zone, service-account unique ID, project, DNS-only origin, image/patch version, public certificate and artifact digest. Verify ancestor policies, no managed HTTP proxy/TLS inspection, no Vercel/Cloudflare/Cloud Run fallback, and effective IAM rather than only this template's proposed grants. Browser-managed unavoidable Square navigation history and inaccessible host-diagnostic uncertainty are accepted residual risks; known logging or dumps are not.

Apply the reviewed guest-only privacy settings during authorized preparation:

- No swap entries/device, no crashkernel/kdump/Apport, core pattern `|/bin/false`, `fs.suid_dumpable=0`, systemd coredump storage and processing disabled. The process's `LimitCORE=0` alone is insufficient for a pipe core handler.
- Mask sleep, suspend, hibernate, hybrid-sleep and suspend-then-hibernate targets; no checkpoints/suspend API workflow. Terraform specifies terminate on host maintenance and no automatic restart. Never restore a memory snapshot containing a consent.
- Merge `instance_configs.cfg` controls under the **effective** `[Core]` section; stop/restart required guest-agent components only under its documented procedure, and verify settings afterward. No Ops Agent, OS Config automatic policy/agent, profiler/tracer, Node inspector, diagnostic report, heap snapshot or TLS key logger. Do not disable a required core guest agent indiscriminately. Inspect installed extensions/policies so they cannot reinstall a collector.
- Install systemd units exactly; do not add an output/log drain override, environment file, automatic daemon restart or boot enablement. The service is read-only except ephemeral OS namespaces; neither `/tmp` nor `/run` is authorized for OAuth persistence. Root/admin compromise remains within the accepted trusted-host risk, not prevented by Unix separation.
- Preserve the unit's TLS/proxy `UnsetEnvironment` entries and the runtime startup rejection. Node reads `NODE_EXTRA_CA_CERTS` before application execution; deleting it inside JavaScript cannot remove the loaded roots. Extra/system/OpenSSL trust overrides, disabled certificate verification and ambient HTTP(S) proxies must reject before configuration or network access (including HTTP metadata). The runtime permits only the unit's exact `--conditions=react-server` Node argument. Review effective drop-ins and the exact signed Node binary; this does not claim protection against a malicious root replacing the binary. [Node 24 TLS environment controls](https://nodejs.org/docs/latest-v24.x/api/cli.html#node_extra_ca_certsfile), [Node proxy controls](https://nodejs.org/docs/latest-v24.x/api/http.html#built-in-proxy-support).
- Check required source files and parent directories are root-owned and not writable by the daemon. No local certificate/secret backups or disk snapshots. Verify actual source key permissions and narrow credential delivery; test unreadable, expired, wrong-host and missing certificates fail closed.

The helper checks a bounded set of local settings; it is not comprehensive attestation of Linux or cloud policy. Hosted configuration review covers its blind spots, including effective unit drop-ins, collectors, packet/TLS inspection, filesystem mounts, ACME account-key permissions and ancestry. Retain only fixed nonsecret outcomes/digests, not raw request logs. [Guest configuration](https://docs.cloud.google.com/compute/docs/images/manage-guest-agent), [host maintenance](https://docs.cloud.google.com/compute/docs/instances/host-maintenance-overview), [systemd credentials](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#Credentials), [Node reports](https://nodejs.org/api/report.html).

## TLS issuance and renewal

Use free ACME HTTP-01 with Certbot `certonly --webroot`, not a reverse proxy or manual DNS. The already-approved persistent storage is root-owned TLS/ACME state on the encrypted boot disk; it does not authorize OAuth material on disk or another KMS/Secret Manager version. Verify the final certificate/ACME package patch versions at action time. Resolve actual hostname, DNS-only route and account terms/contact choice before issuance; no DNS API credential or wildcard is needed.

For initial issuance, create only the approved root-owned challenge directories, install `vaeroex-square-acme-bootstrap.service`, and start that ten-minute **ACME-only** service. It has no application config/credential access or outbound code. It accepts only GET, exact Host, no query/body and one canonical 43-character challenge basename; no catchall/redirect, symlink following, request logging or OAuth handler. A valid token file is bounded public ACME material, not a Square secret. Stop it before starting the portal, whose own HTTP-80 challenge listener takes over.

The later operator-issued Certbot invocation must include these options, with contact/terms separately resolved:

```text
certonly --webroot --webroot-path /var/lib/vaeroex-square-acme
--cert-name square-sandbox.vaeroex.com -d square-sandbox.vaeroex.com
--config-dir /etc/letsencrypt
--logs-dir /run/vaeroex-square-certbot/logs
--work-dir /run/vaeroex-square-certbot/work
```

Require successful staging/renewal checks before live qualification. Configure the supplied timer only after approval; it runs ACME-only renewal twice daily with bounded jitter. If the portal is stopped, its wrapper briefly starts the challenge-only bootstrap and stops it afterward. Successful renewal makes exact lineage key/certificate sources root `0600`. It **does not restart OAuth** or reset per-run counters. `LoadCredential` refreshes at the next operator-approved start, not on SIGHUP. The existing still-valid certificate finishes its maximum one-hour qualification window; refuse a new window when certificate validity cannot cover it. No claim of zero-downtime hot reload. Disable the package's unrelated/default renewal timer to avoid duplicate schedules. [Certbot webroot/renewal](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot), [HTTP-01](https://letsencrypt.org/docs/challenge-types/#http-01-challenge).

## Synthetic qualification before live startup

Do not lie that `syntheticPrivacyPassed` is true merely to run the first probe. The first hosted synthetic exercise uses a separately reviewed mock-only fixture on this exact guest/TLS route, with no real provider, Google identity, database or secrets. It is not a fallback mode in `--serve`. Stop the fixture, record its artifact/configuration/positive-control results, and then approve the real daemon's host policy. Hosted fixture deployment/testing remains pending and separately authorized.

Run maximum-size, query/error, malformed HTTP/TLS, overload, slow-chunk, timeout, crash and renewal/restart canaries. Inspect identified accessible disk/journal/cache/report destinations and effective routing, not merely filtered cloud views. Deliberately unsafe positive controls must be detected. No real codes/secrets, HAR, screenshots, browser tracing or request-bearing process diagnostics may be used. Configuration and synthetic absence close known paths; there is no demand to inspect inaccessible provider diagnostics.

## One bounded operator window

### Bounded existing-task sync

After the existing host, budget, session, mapped binding and shutdown controls
pass, `--run-sync --config /etc/vaeroex-square-callback/config.json` uses the same
root-owned `/etc/vaeroex-square-callback/mapped-task.json` as `--run-page`. No
credentials or task identifiers belong in command arguments. The command never
enrolls a task, changes mapping, refreshes consent, or starts a listener.

Limits: ten sequential attempts, five minutes or the earlier approved host/mapped
deadline, sixty-two seconds remaining before admitting another page,500ms
between acknowledged pages. The existing sixty-second hard native bound remains
per page and includes connection cleanup. Existing page/lease deadlines and
generation/session rechecks remain authoritative. External window cleanup is
still required; this command does not start a new window or change its deadline.

The JSON summary contains finite stop labels and counters only—no URL, cursor,
credential, seller/workspace identifier or provider error. `scan_exhausted` means
only this durable query's cursor is exhausted; never display it as Current or
history-complete. `sourceObservations` is not a count of newly stored versions.
`page_budget` and `deadline` are partial runs. For `retry_deferred`, respect the
reported delay before another invocation of the same task. For
`recovery_required`, wait at least its delay and inspect/reinvoke the existing
durable task; never recreate it or replay a possibly committed transaction.
Blocked/rejected/conflict stops require resolving the actual cause, not retries
or broader authority. Abrupt exit yields no successful summary and is uncertain.

Local synthetic tests qualify orchestration and native integration; hosted use
of this new command remains pending until an approved installed-runtime window.
No systemd timer, unattended schedule, refresh privilege or Production gate is
enabled by installation.

Before each manual start, check spend/aggregate usage, remaining approval, isolated Free database health, actual operator authentication, patch advisories, certificate coverage, exact artifact/configuration and live-run authority. No traffic may be sent just to defeat Free database inactivity pauses. Confirm actual budget email delivery before qualification, not just template syntax.

The daemon has at most two active requests, a global 12-request burst token bucket refilling at six requests/minute (not a strict per-minute ceiling), 100 sensitive open attempts, 10 initiation attempts per run, and a one-hour process window. Failed attempts also consume their budgets. The runtime owns exact enforcement/cancellation tests; systemd adds `RuntimeMaxSec=3600`, `Restart=no`, memory/no-swap and stop bounds. Record only aggregate counts/outcomes. Reaching a cap closes the window. **An operator restart requires cumulative monthly/run-budget review; it is not permission to reset limits indefinitely.** Keep a nonsecret aggregate cumulative usage ledger; no personal IP/request/callback identifiers. Defaults in the cost model are 10,000 KMS operations, 10,000 total secret accesses and 5 GiB US/Canada egress per month, not vendor-enforced caps.

For normal shutdown/patching, close new admission, SIGTERM, await bounded cancellation/drain, and stop. The 70-second systemd stop bound is not proof that an unfinished database transaction was cancelled; preserve runtime idempotency/consume and commit fencing. Uncertain or consumed codes require fresh consent; query checked current status after ambiguous successful commit, never replay the old code. No automatic restart, detached completion, memory checkpoint or raw request queue.

## Patching, recovery and end of approval

### Spot interruption acceptance

The operator approved Spot E2 with `STOP`, maintenance `TERMINATE` and no automatic restart. Treat the shutdown notice as unavailable: acceptance must include an outstanding synthetic request interrupted by an immediate process kill and a guest reset that does not deliver a graceful application drain. Neither a SIGTERM-only test nor a clean VM stop establishes abrupt-loss recovery. Use no real credentials/callbacks in these tests, and record interrupted cases as incomplete rather than passed. Do not introduce crash dumps, memory snapshots, packet capture or request-bearing logs for diagnosis.

After reboot, confirm neither the real daemon nor the mock fixture starts automatically. Keep the real config disabled and provider calls false. Revalidate the exact host/resource identity, privacy settings, root-owned immutable artifact, effective unit, certificate coverage, approved one-hour window, budget and durable aggregate usage ledger before manually starting another synthetic window. The ledger contains only nonsecret aggregate counters/run outcome; it must survive restart and mark a run incomplete unless its completion was explicitly recorded. Reserve bounded usage before admission so abrupt loss cannot reset accounting. Old in-memory sessions, states and receipts must fail on the new process; no raw values are persisted to achieve recovery.

For later authorized database/native testing, inspect checked current authority after an uncertain commit and preserve consume/generation/CAS fencing. Do not retry an old code or infer success from a terminated process. First real consent remains prohibited by this execution. Spot availability, shorter shutdown opportunities and partial test runs are accepted; silently skipping startup checks is not.

Name an operator. Check advisories weekly and before every window, schedule OS/Node/Certbot updates, and keep the service closed for applicable critical remotely exploitable defects until patched/reviewed. Avoid uncoordinated automatic restarts during consent; updates themselves must not be neglected. Use native OS updates, not a new paid VM Manager pipeline. Review package repository HTTPS egress and exact release pins before preparation. After patch/reboot, rerun host preflight and focused privacy/lifecycle/renewal smoke tests; any changed effective artifact/configuration needs fresh evidence.

Rebuild only from immutable code/configuration; no raw-memory restore or secret-bearing image. No backup/PITR/database upgrade is included. One VM/zone and a Free database can interrupt qualification; accept rescheduling. Reserve two operator hours/month plus incident time. Implementation/maintenance labor is not included in the USD 20 provider envelope.

At approval expiry close the service and review expiring IAM/DB approval; access expiry is not deletion. Keep the existing source-retention policy and unresolved credential/discovery/audit disposition explicit. Stopping a VM still charges for disk/static IP. Destruction, secret-version rotation/deletion, snapshots or any retention job requires exact itemized authority; do not use a broad cleanup command. Production and QBO remain out of scope.

## Release-symlink entry validation

Operations commands resolve their invoked script path before comparing it with the module URL. The installed `current` symlink must not turn the ACME command or host preflight into a silent successful no-op. Test direct and symlinked entry points with invalid arguments/missing approval and require silent exit78, then verify an actual listener after startup; systemd's immediate `active` status for a simple service alone is insufficient. This defect was reproduced during no-secret hosted staging before any OAuth listener or credential access.

## Local checks

`node services/square-sandbox-callback/ops/run-ops-qualification.mjs` uses synthetic files and loopback only, checks the policy's denied defaults, static resource/unit scope, shell syntax, actual bounded ACME HTTP behavior and a reflection detector positive control. It never runs Certbot/systemctl/cloud tools or reads credentials. Linux systemd execution, actual Google IAM and hosted renewal/privacy remain pending even when this suite passes.
