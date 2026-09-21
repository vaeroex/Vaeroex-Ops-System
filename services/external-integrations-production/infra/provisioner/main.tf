locals {
  project_id      = "vaeroex-integrations-prod"
  name            = "square-production-provisioner"
  operator        = "user:isaac@vaeroex.com"
  network         = "projects/vaeroex-integrations-prod/global/networks/vaeroex-integrations-production"
  subnetwork      = "projects/vaeroex-integrations-prod/regions/us-west1/subnetworks/vaeroex-integrations-us-west1"
  profiles        = toset(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"])
  active_profiles = var.temporary_access_enabled ? local.profiles : toset([])
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
    provisioning_model          = "STANDARD"
    automatic_restart           = false
    on_host_maintenance         = "TERMINATE"
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

resource "google_secret_manager_secret_iam_member" "private_versions" {
  for_each  = local.active_profiles
  project   = local.project_id
  secret_id = "square-production-${each.key}-db"
  role      = google_project_iam_custom_role.private_versions.name
  member    = google_service_account.provisioner.member
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
