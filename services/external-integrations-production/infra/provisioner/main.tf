locals {
  project_id                 = "vaeroex-integrations-prod"
  name                       = "square-production-provisioner"
  operator                   = "user:isaac@vaeroex.com"
  network                    = "projects/vaeroex-integrations-prod/global/networks/vaeroex-integrations-production"
  subnetwork                 = "projects/vaeroex-integrations-prod/regions/us-west1/subnetworks/vaeroex-integrations-us-west1"
  profiles                   = toset(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"])
  active_profiles            = var.temporary_access_enabled ? var.temporary_access_profiles : toset([])
  provisioner_member         = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
  private_versions_role_name = "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions"
  window_condition = join(" && ", [
    "request.time >= timestamp('${var.window_starts_at}')",
    "request.time < timestamp('${var.window_expires_at}')",
  ])
  labels = {
    application = "vaeroex-integrations"
    environment = "production"
    purpose     = "bounded-native-provisioning"
    managed_by  = "terraform"
  }
}

data "google_secret_manager_secret_iam_policy" "private_versions" {
  # Cleanup must remain able to revoke the active grant even if an unrelated
  # secret's policy cannot be read. Inspect every peer container only while a
  # successor grant is being opened, never while access is being closed.
  for_each  = var.temporary_access_enabled ? local.profiles : toset([])
  project   = local.project_id
  secret_id = "square-production-${each.key}-db"
}

locals {
  existing_provisioner_private_bindings = flatten([
    for profile, policy in data.google_secret_manager_secret_iam_policy.private_versions : [
      for binding in try(jsondecode(policy.policy_data).bindings, []) : {
        profile     = profile
        role        = binding.role
        title       = try(binding.condition.title, "")
        description = try(binding.condition.description, "")
        expression  = try(binding.condition.expression, "")
      }
      if contains(try(binding.members, []), local.provisioner_member)
    ]
  ])
}

# These are additive APIs only. Existing platform APIs, network, subnet, NAT,
# egress address and all secret containers remain owned by the foundation root.
resource "google_project_service" "administration" {
  for_each           = toset(["iap.googleapis.com"])
  project            = local.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_service_account" "provisioner" {
  project      = local.project_id
  account_id   = "sq-prod-provisioner"
  display_name = "Square Production bounded native provisioner"
}

resource "google_compute_disk" "recovery" {
  project = local.project_id
  name    = local.name
  zone    = var.zone
  type    = "pd-standard"
  size    = 10
  image   = var.boot_image
  labels  = local.labels
  lifecycle { prevent_destroy = true }
}

resource "google_compute_instance" "provisioner" {
  project             = local.project_id
  name                = local.name
  zone                = var.zone
  machine_type        = "e2-small"
  desired_status      = "TERMINATED"
  deletion_protection = true
  labels              = local.labels

  boot_disk {
    source      = google_compute_disk.recovery.id
    auto_delete = false
  }
  network_interface {
    subnetwork = local.subnetwork
    stack_type = "IPV4_ONLY"
    # No access_config: no public address or new NAT/IP resource.
  }
  service_account {
    email  = google_service_account.provisioner.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
  metadata = {
    enable-oslogin           = "TRUE"
    block-project-ssh-keys   = "TRUE"
    serial-port-enable       = "FALSE"
    disable-legacy-endpoints = "TRUE"
  }
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }
  scheduling {
    provisioning_model = "STANDARD"
    automatic_restart  = false
    # Standard E2 requires live migration; termination is Spot-only for E2.
    # The separate maximum-run STOP and no-restart controls remain enforced.
    on_host_maintenance         = "MIGRATE"
    instance_termination_action = "STOP"
    max_run_duration {
      seconds = 3600
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.administration, google_compute_firewall.egress_deny]
}

resource "google_project_iam_custom_role" "private_versions" {
  project     = local.project_id
  role_id     = "squareProductionPrivateVersions"
  title       = "Square Production private database version staging"
  description = "Fixed native staging and checked recovery; no secret creation, deletion, IAM or application credential authority."
  permissions = [
    "secretmanager.versions.add",
    "secretmanager.versions.access",
    "secretmanager.versions.get",
    "secretmanager.versions.disable",
  ]
}

# A selector or time-window change is a new access generation. The default
# destroy-before-create replacement, combined with the IAM dependency and
# replace trigger below, orders every old grant's destruction before the new
# generation exists and any replacement grant can be created. This prevents a
# direct profile-to-profile apply from briefly authorizing both profiles.
resource "terraform_data" "private_access_generation" {
  input = {
    enabled               = var.temporary_access_enabled
    profiles              = sort(tolist(var.temporary_access_profiles))
    starts_at             = var.window_starts_at
    expires_at            = var.window_expires_at
    checkpoint_expires_at = var.temporary_access_enabled ? var.window_expires_at : var.previous_access_expires_at
  }
  triggers_replace = sha256(jsonencode({
    enabled               = var.temporary_access_enabled
    profiles              = sort(tolist(var.temporary_access_profiles))
    starts_at             = var.window_starts_at
    expires_at            = var.window_expires_at
    checkpoint_expires_at = var.temporary_access_enabled ? var.window_expires_at : var.previous_access_expires_at
  }))
}

# IAM policy updates are eventually consistent. A replacement access
# generation therefore waits after every old grant has been destroyed before
# any new grant may be created. Ten minutes exceeds Google's documented
# typical two-minute interval and its noted seven-minute case. Because IAM can
# take longer, normal operations also close and verify between role windows;
# the binding's independent time condition remains the hard access boundary.
resource "time_sleep" "private_access_propagation" {
  create_duration = var.temporary_access_enabled ? "10m" : "0s"
  depends_on      = [terraform_data.private_access_generation]

  triggers = {
    generation = terraform_data.private_access_generation.triggers_replace
  }
}

resource "google_secret_manager_secret_iam_member" "private_versions" {
  for_each  = local.active_profiles
  project   = local.project_id
  secret_id = "square-production-${each.key}-db"
  role      = google_project_iam_custom_role.private_versions.name
  member    = google_service_account.provisioner.member
  # Count-removal transitions must finish destroying setup HTTPS before any
  # grant is created; reverse transitions destroy all grants before setup.
  depends_on = [google_compute_firewall.setup_https, time_sleep.private_access_propagation]
  lifecycle {
    replace_triggered_by = [time_sleep.private_access_propagation]
    precondition {
      condition = length(local.existing_provisioner_private_bindings) == 0 || (
        length(local.existing_provisioner_private_bindings) == 1 &&
        one(local.existing_provisioner_private_bindings).profile == each.key &&
        one(local.existing_provisioner_private_bindings).role == local.private_versions_role_name &&
        one(local.existing_provisioner_private_bindings).title == "bounded-native-provisioning" &&
        one(local.existing_provisioner_private_bindings).description == "One exact database secret during the admitted maintenance window." &&
        one(local.existing_provisioner_private_bindings).expression == local.window_condition
      )
      error_message = "Private access must be fully closed and read back before opening a different profile or time window."
    }
  }
  condition {
    title       = "bounded-native-provisioning"
    description = "One exact database secret during the admitted maintenance window."
    expression  = local.window_condition
  }
}

resource "google_compute_instance_iam_member" "operator_oslogin" {
  count         = var.administrative_access_enabled ? 1 : 0
  project       = local.project_id
  zone          = var.zone
  instance_name = google_compute_instance.provisioner.name
  role          = "roles/compute.osAdminLogin"
  member        = local.operator
  condition {
    title      = "bounded-native-provisioning"
    expression = local.window_condition
  }
}

resource "google_iap_tunnel_instance_iam_member" "operator_tunnel" {
  count    = var.administrative_access_enabled ? 1 : 0
  project  = local.project_id
  zone     = var.zone
  instance = google_compute_instance.provisioner.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = local.operator
  condition {
    title      = "bounded-native-ssh-only"
    expression = "${local.window_condition} && destination.port == 22"
  }
}

resource "google_service_account_iam_member" "operator_oslogin_service_account" {
  count              = var.administrative_access_enabled ? 1 : 0
  service_account_id = google_service_account.provisioner.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.operator
  condition {
    title      = "bounded-native-oslogin"
    expression = local.window_condition
  }
}

resource "google_compute_firewall" "iap_ssh" {
  count                   = var.administrative_access_enabled ? 1 : 0
  project                 = local.project_id
  name                    = "${local.name}-iap"
  network                 = local.network
  direction               = "INGRESS"
  priority                = 1000
  source_ranges           = ["35.235.240.0/20"]
  target_service_accounts = [google_service_account.provisioner.email]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_firewall" "pooler" {
  count                   = var.administrative_access_enabled ? 1 : 0
  project                 = local.project_id
  name                    = "${local.name}-pooler"
  network                 = local.network
  direction               = "EGRESS"
  priority                = 1000
  destination_ranges      = var.verified_pooler_ipv4_cidrs
  target_service_accounts = [google_service_account.provisioner.email]
  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

resource "google_compute_firewall" "google_api_https" {
  count                   = var.administrative_access_enabled ? 1 : 0
  project                 = local.project_id
  name                    = "${local.name}-google-api"
  network                 = local.network
  direction               = "EGRESS"
  priority                = 1000
  destination_ranges      = ["199.36.153.8/30"]
  target_service_accounts = [google_service_account.provisioner.email]
  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "setup_https" {
  count                   = var.setup_https_enabled ? 1 : 0
  project                 = local.project_id
  name                    = "${local.name}-setup-https"
  network                 = local.network
  direction               = "EGRESS"
  priority                = 1000
  destination_ranges      = ["0.0.0.0/0"]
  target_service_accounts = [google_service_account.provisioner.email]
  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "egress_deny" {
  project                 = local.project_id
  name                    = "${local.name}-egress-closed"
  network                 = local.network
  direction               = "EGRESS"
  priority                = 65000
  destination_ranges      = ["0.0.0.0/0"]
  target_service_accounts = [google_service_account.provisioner.email]
  deny { protocol = "all" }
}
