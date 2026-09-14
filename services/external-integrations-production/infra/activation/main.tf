data "google_project" "current" {
  project_id = var.project_id
}

locals {
  labels = {
    application = "vaeroex-integrations"
    environment = "production"
    managed_by  = "terraform"
  }
  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "compute.googleapis.com",
    "containerscanning.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "networkservices.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])
  modes        = toset(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"])
  public_modes = toset(["oauth", "webhook"])
  egress_modes = toset(["broker", "runtime"])
  warm_modes   = toset(["oauth", "broker", "webhook", "runtime"])
  service_account_ids = {
    oauth        = "sq-prod-oauth"
    broker       = "sq-prod-broker"
    scheduler    = "sq-prod-scheduler"
    webhook      = "sq-prod-webhook"
    runtime      = "sq-prod-runtime"
    evidence     = "sq-prod-evidence"
    task_invoker = "sq-prod-task-invoker"
  }
  database_secret_ids = { for mode in local.modes : mode => "square-production-${mode}-db" }
  secret_version_names = {
    application = "projects/${data.google_project.current.number}/secrets/square-production-application/versions/1"
    webhook     = "projects/${data.google_project.current.number}/secrets/square-production-webhook-signature/versions/1"
    database = {
      for mode, secret_id in local.database_secret_ids :
      mode => "projects/${data.google_project.current.number}/secrets/${secret_id}/versions/1"
    }
  }
  callback_edge_version = "v${substr(var.source_commit, 0, 12)}"
  deployment_enabled    = var.bootstrap_image_digest != null && var.callback_edge_image_digest != null
  deployment_inputs_valid = (
    (var.bootstrap_image_digest == null && var.callback_edge_image_digest == null) ||
    (var.bootstrap_image_digest != null && var.callback_edge_image_digest != null)
  )
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_compute_network" "platform" {
  name                    = "vaeroex-integrations-production"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  mtu                     = 1460
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.deployment_inputs_valid
      error_message = "The bootstrap runtime and callback edge must be omitted or deployed together by immutable digest."
    }
  }
  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "platform" {
  name                     = "vaeroex-integrations-us-west1"
  region                   = var.region
  ip_cidr_range            = "10.72.0.0/24"
  network                  = google_compute_network.platform.id
  private_ip_google_access = true
  lifecycle { prevent_destroy = true }
}

resource "google_compute_address" "egress" {
  name         = "vaeroex-integrations-egress"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"
  lifecycle { prevent_destroy = true }
}

resource "google_compute_router" "platform" {
  name    = "vaeroex-integrations-router"
  region  = var.region
  network = google_compute_network.platform.id
  lifecycle { prevent_destroy = true }
}

resource "google_compute_router_nat" "platform" {
  name                               = "vaeroex-integrations-nat"
  router                             = google_compute_router.platform.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.egress.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  endpoint_types                     = ["ENDPOINT_TYPE_VM"]
  min_ports_per_vm                   = 128
  subnetwork {
    name                    = google_compute_subnetwork.platform.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
  lifecycle { prevent_destroy = true }
}

resource "google_artifact_registry_repository" "images" {
  location               = var.region
  repository_id          = "vaeroex-integrations-images"
  description            = "Immutable Vaeroex Production integration images"
  format                 = "DOCKER"
  labels                 = local.labels
  cleanup_policy_dry_run = true
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "build" {
  name                        = "vaeroex-integrations-prod-build"
  project                     = var.project_id
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning {
    enabled = false
  }
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.required]
}

resource "google_service_account" "build" {
  account_id   = "vx-int-prod-build"
  display_name = "Vaeroex Production integrations image builder"
}

resource "google_artifact_registry_repository_iam_member" "build_writer" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.build.member
}

resource "google_storage_bucket_iam_member" "build_source_reader" {
  bucket = google_storage_bucket.build.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.build.member
}

resource "google_project_iam_member" "build_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = google_service_account.build.member
}

resource "google_service_account_iam_member" "cloudbuild_token_creator" {
  service_account_id = google_service_account.build.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
  depends_on         = [google_project_service.required]
}

resource "google_service_account_iam_member" "operator_build_user" {
  service_account_id = google_service_account.build.name
  role               = "roles/iam.serviceAccountUser"
  member             = "user:${var.operator_email}"
}

resource "google_project_iam_member" "operator_build_editor" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "user:${var.operator_email}"
}

resource "google_cloud_tasks_queue" "provider" {
  name     = "vaeroex-integrations-tasks"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 5
  }
  retry_config {
    max_attempts       = 8
    max_retry_duration = "3600s"
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 5
  }
  depends_on = [google_project_service.required]
}

resource "google_service_account" "square" {
  for_each     = local.service_account_ids
  account_id   = each.value
  display_name = "Vaeroex Square Production ${replace(each.key, "_", " ")}"
}

resource "google_kms_key_ring" "square" {
  name     = "square-production"
  location = var.region
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "square_credentials" {
  name            = "provider-credentials"
  key_ring        = google_kms_key_ring.square.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s"
  lifecycle { prevent_destroy = true }
}

resource "google_kms_crypto_key_iam_member" "broker" {
  crypto_key_id = google_kms_crypto_key.square_credentials.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = google_service_account.square["broker"].member
}

resource "google_secret_manager_secret" "application" {
  secret_id           = "square-production-application"
  labels              = local.labels
  deletion_protection = true
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "webhook" {
  secret_id           = "square-production-webhook-signature"
  labels              = local.labels
  deletion_protection = true
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "database" {
  for_each            = local.database_secret_ids
  secret_id           = each.value
  labels              = local.labels
  deletion_protection = true
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "application_broker" {
  secret_id = google_secret_manager_secret.application.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.square["broker"].member
  condition {
    title       = "square-production-application-version-1-only"
    description = "The broker may read only the separately delivered, reviewed version 1."
    expression  = "resource.name == '${local.secret_version_names.application}'"
  }
}

resource "google_secret_manager_secret_iam_member" "webhook_verifier" {
  secret_id = google_secret_manager_secret.webhook.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.square["webhook"].member
  condition {
    title       = "square-production-webhook-version-1-only"
    description = "The verifier may read only the separately delivered, reviewed version 1."
    expression  = "resource.name == '${local.secret_version_names.webhook}'"
  }
}

resource "google_secret_manager_secret_iam_member" "database" {
  for_each  = local.database_secret_ids
  secret_id = google_secret_manager_secret.database[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.square[each.key].member
  condition {
    title       = "square-production-${each.key}-database-version-1-only"
    description = "This runtime may read only its separately delivered, reviewed database credential version 1."
    expression  = "resource.name == '${local.secret_version_names.database[each.key]}'"
  }
}

resource "google_project_iam_member" "scheduler_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = google_service_account.square["scheduler"].member
}

resource "google_service_account_iam_member" "scheduler_acts_as_invoker" {
  service_account_id = google_service_account.square["task_invoker"].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.square["scheduler"].member
}

resource "google_logging_project_bucket_config" "default" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "_Default"
  retention_days = 30
  depends_on     = [google_project_service.required]
}

resource "google_monitoring_notification_channel" "operator_email" {
  display_name = "Vaeroex Production integrations operator"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  force_delete = false
  depends_on   = [google_project_service.required]
}

resource "google_compute_security_policy" "ingress" {
  name        = "vaeroex-integrations-production"
  description = "Fail-closed Production integration ingress policy"
  type        = "CLOUD_ARMOR"

  rule {
    action   = "deny(404)"
    priority = 1000
    match {
      expr {
        expression = "!has(request.headers['host']) || request.headers['host'] != '${var.production_hostname}'"
      }
    }
    description = "Reject missing or alternate hosts"
  }
  rule {
    action   = "deny(404)"
    priority = 1050
    match {
      expr {
        expression = "has(request.headers['forwarded']) || has(request.headers['x-forwarded-host'])"
      }
    }
    description = "Reject client-supplied forwarding authority"
  }
  rule {
    action   = "deny(404)"
    priority = 1100
    match {
      expr {
        expression = "request.path != '/healthz' && request.path != '/api/integrations/square/callback' && request.path != '/api/integrations/square/webhook'"
      }
    }
    description = "Reject every unapproved route before runtime"
  }
  rule {
    action   = "deny(404)"
    priority = 1150
    match {
      expr {
        expression = "(request.path == '/healthz' && request.method != 'GET' && request.method != 'HEAD') || (request.path == '/api/integrations/square/callback' && request.method != 'GET') || (request.path == '/api/integrations/square/webhook' && request.method != 'POST')"
      }
    }
    description = "Reject unsupported methods"
  }
  rule {
    action   = "rate_based_ban"
    priority = 1200
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 120
        interval_sec = 60
      }
      ban_duration_sec = 300
      ban_threshold {
        count        = 600
        interval_sec = 300
      }
    }
    description = "Bound public callback and webhook request rates"
  }
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Allow only after exact host, method, and rate gates"
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_compute_global_address" "ingress" {
  name         = "vaeroex-integrations-ingress"
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service" "square" {
  for_each = local.deployment_enabled ? local.modes : toset([])

  name                = "square-production-${each.key}"
  location            = var.region
  ingress             = contains(local.public_modes, each.key) ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = true
  labels              = local.labels

  template {
    service_account                  = google_service_account.square[each.key].email
    timeout                          = each.key == "runtime" ? "900s" : "120s"
    max_instance_request_concurrency = each.key == "runtime" ? 10 : 40
    scaling {
      min_instance_count = contains(local.warm_modes, each.key) ? 1 : 0
      max_instance_count = each.key == "runtime" ? 20 : 5
    }
    dynamic "vpc_access" {
      for_each = contains(local.egress_modes, each.key) ? [each.key] : []
      content {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = google_compute_network.platform.id
          subnetwork = google_compute_subnetwork.platform.id
          tags       = ["square-production-provider-egress"]
        }
      }
    }
    containers {
      image = var.bootstrap_image_digest
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      env {
        name  = "VAEROEX_SOURCE_COMMIT"
        value = var.source_commit
      }
      env {
        name  = "VAEROEX_RUNTIME_ENABLED"
        value = tostring(var.runtime_enabled)
      }
      env {
        name  = "SQUARE_PROVIDER_CALLS_ENABLED"
        value = tostring(var.provider_calls_enabled)
      }
      env {
        name  = "SQUARE_CUSTOMER_ONBOARDING_ENABLED"
        value = tostring(var.customer_onboarding_enabled)
      }
      env {
        name  = "SQUARE_WEBHOOK_INTAKE_ENABLED"
        value = tostring(var.webhook_intake_enabled)
      }
      env {
        name  = "SQUARE_ECONOMIC_CONTRIBUTIONS_ENABLED"
        value = tostring(var.economic_contributions_enabled)
      }
      env {
        name  = "SQUARE_AI_DISPATCH_ENABLED"
        value = tostring(var.ai_dispatch_enabled)
      }
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "google_cloud_run_v2_service_iam_member" "public_ingress" {
  for_each = local.deployment_enabled ? local.public_modes : toset([])
  name     = google_cloud_run_v2_service.square[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_compute_region_network_endpoint_group" "public" {
  for_each              = local.deployment_enabled ? local.public_modes : toset([])
  name                  = "square-production-${each.key}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.square[each.key].name
  }
}

resource "google_compute_backend_service" "public" {
  for_each              = local.deployment_enabled ? local.public_modes : toset([])
  name                  = "square-production-${each.key}"
  protocol              = "HTTP"
  timeout_sec           = 30
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.ingress.id
  backend {
    group = google_compute_region_network_endpoint_group.public[each.key].id
  }
  log_config {
    enable = false
  }
}

resource "google_compute_managed_ssl_certificate" "square" {
  count = local.deployment_enabled ? 1 : 0
  name  = "square-production"
  managed {
    domains = [var.production_hostname]
  }
  lifecycle { prevent_destroy = true }
}

resource "google_compute_url_map" "square" {
  count           = local.deployment_enabled ? 1 : 0
  name            = "square-production"
  default_service = google_compute_backend_service.public["oauth"].id
  host_rule {
    hosts        = [var.production_hostname]
    path_matcher = "square-production"
  }
  path_matcher {
    name            = "square-production"
    default_service = google_compute_backend_service.public["oauth"].id
    path_rule {
      paths   = ["/api/integrations/square/webhook"]
      service = google_compute_backend_service.public["webhook"].id
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "google_compute_target_https_proxy" "square" {
  count            = local.deployment_enabled ? 1 : 0
  name             = "square-production"
  url_map          = google_compute_url_map.square[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.square[0].id]
  lifecycle { prevent_destroy = true }
}

resource "google_compute_global_forwarding_rule" "square" {
  count                 = local.deployment_enabled ? 1 : 0
  name                  = "square-production"
  target                = google_compute_target_https_proxy.square[0].id
  ip_address            = google_compute_global_address.ingress.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
  lifecycle { prevent_destroy = true }
}

resource "google_network_services_wasm_plugin" "square_callback" {
  count           = local.deployment_enabled ? 1 : 0
  name            = "square-production-callback"
  location        = "global"
  description     = "Vaeroex Square bounded OAuth callback query-stripping edge"
  main_version_id = local.callback_edge_version
  deletion_policy = "PREVENT"

  log_config {
    enable = false
  }

  versions {
    version_name = local.callback_edge_version
    description  = "Immutable Square callback edge for source ${var.source_commit}"
    image_uri    = var.callback_edge_image_digest
  }
}

resource "google_network_services_lb_edge_extension" "square_callback" {
  count                 = local.deployment_enabled ? 1 : 0
  name                  = "square-production-callback"
  location              = "global"
  description           = "Fail-closed Square callback query handoff and webhook boundary"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  forwarding_rules      = [google_compute_global_forwarding_rule.square[0].self_link]
  deletion_policy       = "PREVENT"

  extension_chains {
    name = "square-public-edge"

    match_condition {
      cel_expression = "request.host == '${var.production_hostname}'"
    }

    extensions {
      name             = "sanitize-square-ingress"
      service          = google_network_services_wasm_plugin.square_callback[0].id
      fail_open        = false
      supported_events = ["REQUEST_HEADERS"]
      forward_headers = [
        "content-length",
        "expect",
        "transfer-encoding",
        "x-vaeroex-oauth-code",
        "x-vaeroex-oauth-denied",
        "x-vaeroex-oauth-handoff-version",
        "x-vaeroex-oauth-state",
      ]
    }
  }
}

resource "google_monitoring_uptime_check_config" "bootstrap" {
  count            = local.deployment_enabled ? 1 : 0
  display_name     = "Square Production closed-runtime TLS"
  timeout          = "10s"
  period           = "60s"
  selected_regions = ["USA"]
  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.production_hostname
      project_id = var.project_id
    }
  }
  http_check {
    path           = "/healthz"
    port           = 443
    request_method = "GET"
    use_ssl        = true
    validate_ssl   = true
  }
  content_matchers {
    content = "\"status\":\"disabled\""
    matcher = "CONTAINS_STRING"
  }
  depends_on = [google_compute_global_forwarding_rule.square]
}

resource "google_monitoring_alert_policy" "bootstrap_uptime" {
  count        = local.deployment_enabled ? 1 : 0
  display_name = "Square Production closed runtime unavailable"
  combiner     = "OR"
  conditions {
    display_name = "TLS health check fails"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.bootstrap[0].uptime_check_id}\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_TRUE"
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.operator_email.name]
  alert_strategy {
    auto_close = "1800s"
  }
}
