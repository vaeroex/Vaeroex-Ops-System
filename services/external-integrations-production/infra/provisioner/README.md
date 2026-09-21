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
`temporary_access_enabled` to grant the six separate four-permission secret
bindings. Terraform rejects simultaneous setup HTTPS and credential staging.

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
no automatic restart and termination on host maintenance. This maximum applies
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
reader permissions remain separate. Six sequential profile operations must
finish fenced with zero sessions before the all-closed checkpoint. Stop
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

Local checks use the signed pinned Google provider and no cloud state:

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
```

The test fixtures use documentation IPs and an artificial future window. They
prove template boundaries only; no hosted identity, capacity, IAM inheritance,
network availability or successful provisioning is implied.
