# Sandbox resource template — not a deployment

The user approved this resource envelope within **USD 20/month before tax**, but required code-only completion first. Do not authenticate, plan against Google, apply, import, configure DNS, deliver secrets, install guest files, or deploy from this delivery. `deployment_authorized` defaults to false and fails validation. The local tests use a mocked provider, not Google credentials.

## Scope

The template creates one Spot `e2-small`, one 10 GiB `pd-standard` boot disk, one Premium external IPv4, one custom VPC/subnet, narrowly targeted firewall rules, the DB-secret metadata container and a project-wide USD 20 budget. Compute and Billing Budgets API enablement is explicit; existing IAM/KMS/Secret Manager prerequisites are references, not replacements. No startup script or artifact is installed. Both ingress rules start disabled.

### Approved Spot correction — September 8, 2026

The first authorized hosted plan exposed a real provider constraint: standard E2 rejects `onHostMaintenance=TERMINATE`. The operator explicitly approved changing only the provisioning model to Spot within the existing USD20 ceiling, accepting interrupted synthetic windows. The template now requires `SPOT`, termination action `STOP`, maintenance `TERMINATE`, automatic restart false, retained disk and deletion protection. No migration, automatic recovery, replacement instance, paid commitment or weaker privacy control is introduced. [E2 maintenance limitation](https://docs.cloud.google.com/compute/docs/instances/setting-vm-host-options), [Spot behavior](https://docs.cloud.google.com/compute/docs/instances/spot).

This source template still includes later secret/IAM permissions. The no-secret hosted execution must use its reviewed isolated operational plan that omits those blocks; the Spot approval does not authorize granting application-secret access. Do not apply the whole source template merely to create the synthetic host.

Preemption can be abrupt. No correctness argument or completed-test claim may depend on Google's best-effort shutdown interval. Record an interrupted window as incomplete; before manual restart rerun host, artifact, certificate, authority, spend and cumulative-usage checks. No daemon is boot-enabled and no old browser session/consent may be restored from a memory snapshot. The guest runbook specifies the abrupt-loss acceptance test.

Existing references are fixed, not caller-selectable:

| Resource | Reference |
| --- | --- |
| Project | `vaeroex-square-sandbox`, number `112579468800` |
| Broker service account | `vx-square-sandbox-broker@vaeroex-square-sandbox.iam.gserviceaccount.com`; expected unique ID `114364535512720213941` |
| KMS key | `projects/vaeroex-square-sandbox/locations/us-west1/keyRings/square-sandbox/cryptoKeys/oauth-credentials`; existing sole active primary version `1` |
| Application secret | `projects/vaeroex-square-sandbox/secrets/square-sandbox-application/versions/1` |
| New DB-secret metadata | `projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db`; future immutable version `1`, delivered privately outside Terraform |

The broker receives only two `secretAccessor` memberships and one `cryptoKeyEncrypter` membership, with explicit approval expiry. Secret conditions require the exact canonical numeric-project `SecretVersion` resource and `/versions/1`; the runtime uses its pinned text-project reference. `latest` is not interchangeable with a numeric version in IAM conditions. KMS permission is scoped to the existing CryptoKey; the native adapter explicitly targets `/cryptoKeyVersions/1:encrypt` and checks the returned exact version name and `SOFTWARE` protection. Later operator metadata inventory must verify that no extra active version exists; the runtime does not receive key-inventory permission. No claim that the key-level IAM grant itself isolates future versions. [Secret IAM](https://docs.cloud.google.com/secret-manager/docs/access-control), [canonical condition names and versions](https://docs.cloud.google.com/iam/docs/conditions-resource-attributes), [KMS exact-version encryption](https://docs.cloud.google.com/kms/docs/reference/rest/v1/projects.locations.keyRings.cryptoKeys/encrypt).

IAM member resources preserve unrelated grants; they do **not** prove no broader inherited grant exists. Before later hosted qualification, inspect effective organization/folder/project/resource IAM, service-account attachments/keys/impersonators and actual service-account unique ID. Compute API activation can create Google service agents/default identities; verify their effective roles and ensure the VM attaches only the named broker. Do not remove inherited policy or modify Production/QBO to make this template work. The VM is one trusted process/metadata boundary, not per-Unix-user cloud isolation. [Compute service accounts](https://docs.cloud.google.com/compute/docs/access/service-accounts).

## Required later inputs

There is deliberately no operational `.tfvars` example containing invented IDs. Resolve and approve:

- Current deployment authority distinct from the cost approval, with exact finite UTC expiry.
- Existing USD billing account, already linked to this project; no billing relink/create is included.
- Existing verified Sandbox email notification-channel IDs and successful delivery to the named operator. Channels are required even when default billing/project-owner recipients also receive notifications. Missing channels block preparation; do not claim alerts are configured from a template.
- Supported exact dated non-Pro Ubuntu 24.04 x86_64 image, exact `us-west1-a` zone required by the native/database contract, patched Node version and artifact digest. No floating image family or implicit latest dependency.
- Exact operator `/32` source addresses and isolated database `/32` addresses/port. These are private operating configuration, not committed personal IP evidence. The chosen database endpoint must pass the actual LOGIN/session/transaction tests; an unqualified pooler is not an alternative authority model.
- An approved operator-access procedure. This template deliberately creates no public SSH rule or operator/IAP IAM grant. Resolve short-lived IAP/OS Login access before host preparation and patching; add its exact reviewed rule/grant only with action-time authority. Do not silently open SSH to the internet.

Port 80 is public solely because HTTP-01 validation needs it; the guest must reject every non-exact challenge request without redirection or logging. Port 443 accepts only approved operator addresses; Square sends a browser redirect, not a server-to-server callback. Egress TCP 443 is broad at layer 4, so application fixed-host/TLS/redirect checks remain mandatory. The separate database rule is destination-pinned. GCP metadata/DNS platform paths have special firewall behavior: these rules do not prove metadata isolation or eliminate SSRF. Do not introduce a TLS inspection proxy. [VPC firewall behavior](https://docs.cloud.google.com/firewall/docs/firewalls#alwaysallowed).

No load balancer, NAT, Cloud Run, DNS zone, registry, snapshot, backup, logging sink, paid monitoring, managed patching, new KMS key/version, secret payload/version resource, service-account key, WIF or project-wide role is defined. No resources are imported from Production or QBO. Do not reuse another service's backend or Terraform state.

## Local validation

Pins: Terraform `1.16.1`, HashiCorp Google provider `8.1.0`, provider checksums in `.terraform.lock.hcl`. The initial macOS validator archive SHA-256 was `e22cba761ddbd4d218939b28715ab3af37aaf8a42efa41f7d75b2c3d73636060`, checked against the publisher's checksum list. Public dependency download is not cloud authentication. [Terraform release](https://releases.hashicorp.com/terraform/1.16.1/), [provider release](https://github.com/hashicorp/terraform-provider-google/releases/tag/v8.1.0).

From this directory, with no Google credentials or user Terraform configuration:

```sh
terraform fmt -check -recursive
terraform init -backend=false -input=false
terraform validate
terraform test
```

`init` downloads only the pinned public provider and verifies its publisher signatures/checksums. `validate` loads its local schema; `test` is exclusively `mock_provider "google"`. Neither is evidence that Google accepts the real IAM condition, an API is enabled or resources exist. Do **not** substitute a real `plan`/`apply` for these tests during code-only work. Tests contain documentation-range IPs and synthetic IDs, never deployable values.

## Budget and stopping

The budget covers **all services in this project**, including the existing key/secret baseline, excludes credits and sends actual-spend thresholds at USD 10/15/18/20. It depends on verified account/channel configuration, and cost-bearing resources depend on the budget resource. This is an alert, not an enforceable monthly stop. Quotas, one-instance inventory, finite per-run admission and an operator's usage review supplement it. Billing lag, taxes, unexpected egress or abusive traffic can exceed a modeled invoice. [Budget behavior](https://docs.cloud.google.com/billing/docs/how-to/budgets).

No scheduled resource deletion is installed. The VM has automatic restart disabled, no consent listener/artifact on initial creation and no enabled ingress. Spot compute is charged only while running; the retained disk and assigned static IP remain charged while stopped. An unattached reserved IPv4 is currently USD0.01/hour (USD0.24/day); an IP attached to Spot is USD0.0025/hour, including when the VM is stopped. Track each state interval rather than dropping stopped-resource charges. Verify current regional Spot compute pricing before applying; the USD20 total ceiling is unchanged. [IPv4 rates and in-use definition](https://cloud.google.com/vpc/pricing), [Spot pricing](https://cloud.google.com/spot-vms/pricing).

Deletion protection and `prevent_destroy` require an explicit, itemized decommission decision. An expired grant does not destroy secrets, credentials, audit evidence, disks or IPs. The source-retention/disposition decision remains separate.
