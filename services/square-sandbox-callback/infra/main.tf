locals {
  project_id       = "vaeroex-square-sandbox"
  project_number   = "112579468800"
  broker_email     = "vx-square-sandbox-broker@vaeroex-square-sandbox.iam.gserviceaccount.com"
  kms_key          = "projects/vaeroex-square-sandbox/locations/us-west1/keyRings/square-sandbox/cryptoKeys/oauth-credentials"
  application_id   = "square-sandbox-application"
  database_id      = "square-sandbox-callback-db"
  name             = "square-sandbox-callback"
  expiry_condition = "request.time < timestamp('${var.approval_expires_at}')"
  labels           = { application = "square-sandbox-callback", environment = "sandbox" }
}

# No new project, service account, KMS material, secret version, WIF, DNS,
# registry, load balancer, NAT, backup, managed patching, or HTTP log pipeline.
resource "google_project_service" "required" {
  for_each           = toset(["compute.googleapis.com", "billingbudgets.googleapis.com"])
  project            = local.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_billing_budget" "sandbox" {
  billing_account = var.billing_account_id
  display_name    = "Square Sandbox total monthly USD 20"
  budget_filter {
    projects               = ["projects/${local.project_number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = "20"
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.75, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
  all_updates_rule {
    monitoring_notification_channels = var.budget_notification_channels
    disable_default_iam_recipients   = false
    enable_project_level_recipients  = true
  }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = timecmp(var.approval_expires_at, plantimestamp()) > 0
      error_message = "Approval must be current before preparing an actionable plan."
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_compute_network" "callback" {
  name                    = local.name
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  lifecycle { prevent_destroy = true }
  depends_on = [google_billing_budget.sandbox]
}

resource "google_compute_subnetwork" "callback" {
  name                     = local.name
  region                   = "us-west1"
  ip_cidr_range            = "10.91.0.0/28"
  network                  = google_compute_network.callback.id
  private_ip_google_access = false
  # No log_config block: VPC Flow Logs are not enabled by this template.
  lifecycle { prevent_destroy = true }
}

resource "google_compute_address" "callback" {
  name         = local.name
  region       = "us-west1"
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"
  lifecycle { prevent_destroy = true }
  depends_on = [google_billing_budget.sandbox]
}

resource "google_compute_firewall" "https" {
  name                    = "${local.name}-operator-https"
  network                 = google_compute_network.callback.id
  direction               = "INGRESS"
  priority                = 1000
  source_ranges           = var.operator_ipv4_cidrs
  target_service_accounts = [local.broker_email]
  disabled                = !var.enable_ingress
  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "acme" {
  name                    = "${local.name}-acme-only"
  network                 = google_compute_network.callback.id
  direction               = "INGRESS"
  priority                = 1000
  source_ranges           = ["0.0.0.0/0"]
  target_service_accounts = [local.broker_email]
  disabled                = !var.enable_ingress
  allow {
    protocol = "tcp"
    ports    = ["80"]
  }
}

# L3/L4 firewalls cannot implement the application's fixed HTTPS host allowlist.
# No TLS-inspection appliance is introduced. DNS/metadata are platform paths.
resource "google_compute_firewall" "https_egress" {
  name                    = "${local.name}-tls-egress"
  network                 = google_compute_network.callback.id
  direction               = "EGRESS"
  priority                = 1000
  destination_ranges      = ["0.0.0.0/0"]
  target_service_accounts = [local.broker_email]
  allow {
    protocol = "tcp"
    ports    = ["443"]
  }
}

resource "google_compute_firewall" "database_egress" {
  name                    = "${local.name}-database-egress"
  network                 = google_compute_network.callback.id
  direction               = "EGRESS"
  priority                = 1000
  destination_ranges      = var.database_ipv4_cidrs
  target_service_accounts = [local.broker_email]
  allow {
    protocol = "tcp"
    ports    = [tostring(var.database_port)]
  }
}

resource "google_compute_firewall" "deny_other_egress" {
  name                    = "${local.name}-deny-other-egress"
  network                 = google_compute_network.callback.id
  direction               = "EGRESS"
  priority                = 2000
  destination_ranges      = ["0.0.0.0/0"]
  target_service_accounts = [local.broker_email]
  deny { protocol = "all" }
}

resource "google_compute_instance" "callback" {
  name                      = local.name
  machine_type              = "e2-small"
  zone                      = var.zone
  labels                    = local.labels
  can_ip_forward            = false
  deletion_protection       = true
  allow_stopping_for_update = false
  # No artifact or startup hook is installed. Initial ingress remains closed.
  boot_disk {
    auto_delete = false
    initialize_params {
      image  = var.ubuntu_image
      size   = 10
      type   = "pd-standard"
      labels = local.labels
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.callback.id
    stack_type = "IPV4_ONLY"
    access_config {
      nat_ip       = google_compute_address.callback.address
      network_tier = "PREMIUM"
    }
  }
  service_account {
    email  = local.broker_email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
  scheduling {
    # Standard E2 requires live migration; approved Spot preserves no migration.
    # STOP retains disk/IP. Recovery must not depend on a preemption grace period.
    on_host_maintenance         = "TERMINATE"
    automatic_restart           = false
    provisioning_model          = "SPOT"
    instance_termination_action = "STOP"
  }
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }
  metadata = {
    enable-oslogin             = "TRUE"
    block-project-ssh-keys     = "TRUE"
    serial-port-enable         = "FALSE"
    serial-port-logging-enable = "FALSE"
    enable-guest-attributes    = "FALSE"
    enable-osconfig            = "FALSE"
    disable-guest-telemetry    = "TRUE"
    disable-legacy-endpoints   = "TRUE"
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_billing_budget.sandbox]
}

# Metadata only: the operator delivers exactly one DB LOGIN payload privately,
# later. No secret_data, version resources, version data sources, or random keys.
resource "google_secret_manager_secret" "database" {
  project             = local.project_id
  secret_id           = local.database_id
  labels              = local.labels
  deletion_protection = true
  replication {
    user_managed {
      replicas { location = "us-west1" }
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_billing_budget.sandbox]
}

resource "google_secret_manager_secret_iam_member" "application" {
  project   = local.project_id
  secret_id = local.application_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.broker_email}"
  condition {
    title      = "square-callback-app-v1-expiring"
    expression = "resource.type == 'secretmanager.googleapis.com/SecretVersion' && resource.name == 'projects/${local.project_number}/secrets/${local.application_id}/versions/1' && ${local.expiry_condition}"
  }
  depends_on = [google_billing_budget.sandbox]
}

resource "google_secret_manager_secret_iam_member" "database" {
  project   = local.project_id
  secret_id = google_secret_manager_secret.database.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.broker_email}"
  condition {
    title      = "square-callback-db-v1-expiring"
    expression = "resource.type == 'secretmanager.googleapis.com/SecretVersion' && resource.name == 'projects/${local.project_number}/secrets/${local.database_id}/versions/1' && ${local.expiry_condition}"
  }
}

resource "google_kms_crypto_key_iam_member" "encrypt" {
  crypto_key_id = local.kms_key
  role          = "roles/cloudkms.cryptoKeyEncrypter"
  member        = "serviceAccount:${local.broker_email}"
  condition {
    title      = "square-callback-encrypt-expiring"
    expression = local.expiry_condition
  }
  depends_on = [google_billing_budget.sandbox]
}
