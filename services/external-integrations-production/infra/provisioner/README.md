# Bounded Production native provisioner

This separate Terraform root prepares exactly one private `e2-small` and one
10-GiB standard boot/recovery disk for the six reviewed native Square database
profiles. It reuses the Production VPC, subnet, private Google access, regional
NAT and six existing database-secret containers. It does not own or change the
foundation root, runtime services, migrations, secret versions, activation
gates, Sandbox or QBO.

No live image, zone, endpoint or maintenance deadline is supplied by this
template. Mandatory variables require a reviewed immutable Debian 13 image,
one compatible `us-west1` zone, exact UTC window boundaries and freshly verified
Production session-pooler IPv4 `/32` addresses. The original reviewed native
pooler transport and username contract are retained. The operator Mac's direct
connection was migration qualification only.

The current readback already has OS Login enabled; this root adds only the
missing IAP API. It does not claim ownership of the existing API resources.

All three access flags default to false. Creation converges to
`desired_status = "TERMINATED"`, with no installer/startup script, secret grants,
IAP/OS Login grant or allow firewall rule. GCE creation can briefly run before
the provider stops the VM; count that boot time against the total approved
execution budget. The instance ID can then be read and pinned in the separately
reviewed installation manifest while stopped. Terraform never opens an input
prompt or invokes the native tool.

`administrative_access_enabled` grants expiring IAP/OS Login access to
`isaac@vaeroex.com` and opens provisioner-specific SSH, pooler and private Google
API network paths. During setup only, `setup_https_enabled` permits package
downloads over TCP/443. It provides no secret authority. After installation,
close that broad setup rule and verify its removal before setting
`temporary_access_enabled` and explicitly selecting one reviewed
`temporary_access_profiles` value for that window. The bounded recovery selects
only `oauth`; later role windows remain separate. Terraform rejects an open
window with zero or multiple profiles, a selection while access is closed,
unknown profiles, a successor starting before the read-back expiry of its
predecessor, and simultaneous setup HTTPS and credential staging.
One state-local `terraform_data` generation barrier carries no cloud authority.
Changing the selection or time window replaces that barrier
destroy-before-create and replaces retained grants, so every old grant is
destroyed before the new generation can be created. A pinned `time_sleep`
provider then enforces a ten-minute IAM propagation interval before any new
grant is created. This exceeds Google's documented typical two-minute interval
and its noted seven-minute case. IAM can take longer, so normal operations also
close and verify access between role windows; the independent IAM time
condition remains the hard boundary. The explicit grant dependencies
also ensure setup-rule deletion completes before any secret grant is created,
and every secret-grant deletion completes before setup HTTPS can be recreated.
The apply-graph tests cover setup in both directions and prove the full
old-grant -> closed generation checkpoint, followed by successor generation ->
propagation interval -> new-grant sequence.

The first apply after adopting this generation barrier must use all three access
flags false and an empty profile selection, with the prior state independently
confirmed to contain no temporary secret grants. That closed bootstrap creates
only the state-local barrier and its zero-duration propagation marker. Do not
combine barrier adoption with opening or changing access: grants created by an
older configuration do not carry the new dependency. Direct open-to-open
profile or time-window changes are unsupported. Every saved plan must be
applied only through `scripts/apply-reviewed-private-access-plan.mjs`. That
entry point privately copies the exact plan, renders it in memory, requires
`scripts/verify-private-access-plan.mjs` to pass, rechecks the copied bytes,
requires the previously reviewed SHA-256, and applies that same copy. Direct
`terraform apply` is unsupported. The verifier requires an opening plan's
prior Terraform state to be an applied
closed checkpoint and rejects any mutation carrying a managed grant on both
sides of the plan. Open-state no-op plans are also rejected. After the bounded
propagation interval, an apply-time Google IAM Policy Troubleshooter sweep must
return definitive denial for `versions.add` on each of the six fixed Secret
resources and for `versions.access`, `versions.get` and `versions.disable` on
every numeric SecretVersion returned by a fresh metadata-only enumeration of
those containers. The matrix therefore contains `6 + 3N` tuples, where `N` is
the exact number of existing numeric versions; it never substitutes the
semantically different `latest` alias. It uses the current beta command so the
top-level decision includes allow, deny and Principal Access Boundary policy
evaluation. Any unknown or unspecified state, failed/malformed enumeration,
missing policy explanation, outcome-relevant conditional ambiguity,
API/process failure, mismatched tuple or unexpected access blocks the grant.
The six direct Secret Manager policy reads remain only supplemental residue
evidence; they are not an effective-authority claim and do not replace
Troubleshooter's inherited policy evaluation. Cleanup instantiates neither
read, so an unrelated read or analyzer failure cannot block revocation.

Every successful opening then waits through a second ten-minute propagation
interval and freshly enumerates the same six containers. The resulting
`6 + 3N` matrix must report the selected profile's Secret and existing numeric
versions available and every peer Secret/version tuple denied before Terraform
records the opening as qualified. With an empty selected container, the opening
proves only `versions.add`; the native store then canonicalizes the exact
numeric version returned by `addVersion`, accesses and verifies that exact
version's payload/checksum, and gets the same exact version again before the
staged-ready acknowledgement. The earlier `STORED` frame is a private database
transaction handshake sent only after exact-version access verification; it is
not the operator success acknowledgement. The coordinator accepts only the
later exact-version `staged_ready` result. It never guesses or acknowledges
`latest`.
The OAuth recovery window therefore permits only OAuth and denies the five peer
containers. A post-grant analysis failure is an applied-but-unverified state:
close and reconcile it without retrying or treating the apply as successful.
The verifier invokes no ancestry command and never uses `testIamPermissions` as
its authorization gate. It supplies exact request-time and
Secret/SecretVersion condition context, captures and discards raw CLI output,
and emits only fixed labels. Secret Manager version-list consistency is a
documented pilot limitation; the controlled window admits no concurrent
provisioning, and no generalized concurrent-administrator claim is made.
An operator-process loss in the narrow interval after Google accepts a grant
but before Terraform checkpoints it is recovered only through the verified
open-generation-without-managed-grant to closed plan. Before applying that
cleanup, the entry point reads and validates all six fixed Secret policies,
allows only absence or the one exact provisioner member/role/profile/time
condition derived from the plan, removes only that exact tuple, and rereads all
six policies. Any other provisioner binding, condition mismatch, malformed
policy, failed enumeration or residual tuple blocks Terraform apply. A failed
or lost removal acknowledgement is accepted only when the complete readback
proves exact absence. The resulting
direct-policy-absence label is narrow reconciliation evidence, not proof of
effective closure. After it passes, the reviewed close apply removes the
temporary OS Login, IAP, firewall and state resources. The entry point then
waits ten minutes and requires the full `6 + 3N` Policy Troubleshooter matrix
to return definitive denial before reporting success. Analyzer uncertainty
does not undo the already-closed resources, but it reports revocation as
uncertain. A normal tracked close receives the same post-apply direct readback
and effective-denial proof. If the operator process is lost after a tracked
close commits but before those checks finish, the unchanged reviewed
closed/no-transition plan must be applied through the same wrapper. It requires
zero direct provisioner bindings, waits the full propagation interval and
reruns the complete denial matrix before acknowledging closure. Failed opening
and tracked-closing applies perform
exact reconciliation and the denial check, so a remotely accepted grant is
revoked even when Terraform does not checkpoint it. An uncatchable process
loss before a close commits, including `SIGKILL`, must be followed by the
open-generation recovery close plan; a loss after commit uses the unchanged
closed/no-transition proof above. Never retry the opening or infer closure
from direct policy absence. The independent
condition expiry remains the hard bound.
Normal operation also waits for the predecessor's time condition to expire,
supplies that exact expiry as the next plan's
`previous_access_expires_at`, and verifies the exact zero-grant set before
opening a replacement window. The bounded propagation interval is additional
defense against stale policy enforcement, not a claim of instantaneous IAM
consistency.

During private entry, HTTPS reaches only `199.36.153.8/30` (the
`private.googleapis.com` VIP). The reviewed guest setup must resolve exactly
`secretmanager.googleapis.com` to those VIPs, prove hostname/CA verification and
make no alternate DNS or token fallback; this root adds no DNS/network resource.
The reviewed Secret Manager client fixes that API host, verifies TLS and accepts
no redirect. Database egress is only TCP/5432 to supplied session-pooler addresses.
Network rules do not expire automatically: coordinating cleanup must return all
three flags to false after the task, interruption or deadline. Their sole target
is the dedicated provisioner SA. Review existing higher-priority network rules
before applying; these additions do not replace platform security policy.

Start the VM explicitly only in the admitted window. Its standard, non-Spot
scheduling uses `max_run_duration = 3600`, `instance_termination_action = STOP`,
no automatic restart and E2-required live migration on host maintenance. GCP
rejected `TERMINATE` for non-Spot E2; live migration does not change the separate
one-hour STOP limit or permit an automatic restart. This maximum applies
to each start; it is not a cumulative budget cap or authority for repeated starts.
Count creation, setup and any recovery runtime together under the approved
$0.25 execution admission. The retained 10-GiB disk is approximately $0.40/month
at the reviewed planning rate and counts within the existing $150/month ceiling.
Current pricing and marginal NAT/Secret Manager usage must be included in the
concrete plan readback. No new reservation, public IP, NAT, key, queue or paid
commitment is needed.

Use the existing root-owned static native launcher, exact GCE identity check,
immutable code/CA hashes, private TTY, per-role journal and checked recovery
procedure. This template creates no database password or cloud key. Runtime
reader permissions remain separate. Each role operation must finish fenced
with zero sessions and return to an all-closed checkpoint before the next role
window. Stop
credential admission at least two minutes before the scheduled stop. A failed
or uncertain acknowledgement requires read-only role/version/journal
reconciliation; never recreate credentials or assume an audit event proves a
commit. Stop the VM and preserve its disk/journal on interruption. Do not delete
the disk, which has `prevent_destroy` and `auto_delete = false`, as routine cleanup.

After success or timeout, close all three access flags, verify all roles/sessions and
gates closed, stop the VM, and require a clean plan. Changing window timestamps
must not silently reopen a previous session. Backend configuration and concrete
variables belong to the separately inspected operating plan, not committed
credentials or inferred defaults.

Local checks use the signed pinned External, Google and time providers and no
cloud state:

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
node tests/verify-transition-order.mjs
node tests/verify-effective-private-access.test.mjs
node tests/verify-private-access-plan.test.mjs
node tests/reconcile-private-access.test.mjs
node tests/apply-reviewed-private-access-plan.test.mjs
```

For every hosted mutation, set `umask 077`, create a full saved plan, inspect
its complete action set, record its SHA-256 and confirm the source plan has no
group or other permission bits. Then use the single reviewed apply entry point;
it verifies and applies the same private copy without persisting or printing
the JSON rendering:

```sh
node scripts/apply-reviewed-private-access-plan.mjs reviewed.tfplan <reviewed-sha256>
```

Only fixed transition/completion labels are added by the entry point. The
verifier never prints or stores the rendered plan, provider values or state.
A failed label blocks apply and the private copy is removed. Both Terraform
children run without inherited `TF_LOG*` settings; their ordinary output and
errors are captured and discarded. Reapplying or refreshing an open window is
intentionally unsupported; close it first.

The transition verifier runs the real firewall/IAM resource dependency closure
through eight isolated mocked Terraform apply steps, checking graph edges and
completion/start ordering. It excludes the backend, credentials and real state;
provider schemas come only from the pinned local cache. Its in-memory trace is
not printed or persisted, and its disposable files are removed afterward.

The test fixtures use documentation IPs and an artificial future window. They
prove template boundaries only; no hosted identity, capacity, IAM inheritance,
network availability or successful provisioning is implied.
