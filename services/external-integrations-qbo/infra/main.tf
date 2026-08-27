provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {
  project_id = var.project_id
}

locals {
  modes = {
    oauth_ingress     = "oauth_ingress"
    credential_broker = "credential_broker"
    task_scheduler    = "task_scheduler"
    task_dispatcher   = "task_dispatcher"
    provider_runtime  = "provider_runtime"
  }
  service_account_ids = {
    oauth_ingress            = "qbo-oauth-ingress"
    credential_broker        = "qbo-credential-broker"
    task_scheduler           = "qbo-task-scheduler"
    task_dispatcher          = "qbo-task-dispatcher"
    provider_runtime         = "qbo-provider-runtime"
    task_invoker             = "qbo-task-invoker"
    dispatch_scheduler       = "qbo-dispatch-scheduler"
    initialization_scheduler = "qbo-initialization-scheduler"
  }
  queue_resource        = "projects/${var.project_id}/locations/${var.region}/queues/${var.queue_name}"
  callback_edge_version = "v${substr(var.source_commit, 0, 12)}"
}

resource "google_service_account" "service" {
  for_each = local.service_account_ids

  account_id   = each.value
  display_name = "Vaeroex QBO ${replace(each.key, "_", " ")}"
}

resource "google_cloud_tasks_queue" "main" {
  name     = var.queue_name
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
}

resource "google_cloud_run_v2_service" "service" {
  for_each = local.modes

  name                = var.service_names[each.key]
  location            = var.region
  ingress             = each.key == "oauth_ingress" ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.service[each.key].email
    timeout                          = each.key == "provider_runtime" ? "900s" : "120s"
    max_instance_request_concurrency = each.key == "provider_runtime" ? 10 : 40

    scaling {
      min_instance_count = 0
      max_instance_count = each.key == "provider_runtime" ? 20 : 5
    }

    containers {
      image = var.image_digest

      env {
        name  = "QBO_SERVICE_MODE"
        value = each.value
      }
      env {
        name  = "QBO_SOURCE_COMMIT"
        value = var.source_commit
      }
      env {
        name  = "QBO_APPLICATION_ORIGIN"
        value = var.application_origin
      }
      env {
        name  = "QBO_PRODUCTION_CALLBACK_URI"
        value = var.oauth_callback_uri
      }
      env {
        name  = "QBO_BROKER_URL"
        value = var.service_origins.credential_broker
      }
      env {
        name  = "QBO_PROVIDER_RUNTIME_URL"
        value = var.service_origins.provider_runtime
      }
      env {
        name  = "QBO_QUEUE_NAME"
        value = var.queue_name
      }
      env {
        name  = "QBO_QUEUE_RESOURCE"
        value = local.queue_resource
      }
      env {
        name  = "QBO_RUNTIME_INVOKER_SERVICE_ACCOUNT"
        value = google_service_account.service["task_invoker"].email
      }
      env {
        name  = "QBO_KMS_KEY_RESOURCE"
        value = var.kms_key_resource
      }
      env {
        name  = "QBO_PROVIDER_SECRET_VERSION_RESOURCE"
        value = "projects/${var.project_id}/secrets/${var.provider_secret_id}/versions/${var.provider_secret_version}"
      }
      env {
        name  = "QBO_WEBHOOK_SECRET_VERSION_RESOURCE"
        value = "projects/${var.project_id}/secrets/${var.webhook_secret_id}/versions/${var.webhook_secret_version}"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_secret_ids[each.key]
            version = var.database_secret_versions[each.key]
          }
        }
      }
    }
  }

}

resource "google_cloud_run_v2_service_iam_member" "public_callback" {
  name     = google_cloud_run_v2_service.service["oauth_ingress"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "ingress_to_broker" {
  name     = google_cloud_run_v2_service.service["credential_broker"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.service["oauth_ingress"].member
}

resource "google_cloud_run_v2_service_iam_member" "runtime_to_broker" {
  name     = google_cloud_run_v2_service.service["credential_broker"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.service["provider_runtime"].member
}

resource "google_cloud_run_v2_service_iam_member" "task_to_runtime" {
  name     = google_cloud_run_v2_service.service["provider_runtime"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.service["task_invoker"].member
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_to_dispatcher" {
  name     = google_cloud_run_v2_service.service["task_dispatcher"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.service["dispatch_scheduler"].member
}

resource "google_cloud_run_v2_service_iam_member" "scheduler_to_initializer" {
  name     = google_cloud_run_v2_service.service["task_scheduler"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.service["initialization_scheduler"].member
}

resource "google_project_iam_member" "dispatcher_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = google_service_account.service["task_dispatcher"].member
}

resource "google_service_account_iam_member" "dispatcher_token_creator" {
  service_account_id = google_service_account.service["task_invoker"].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.service["task_dispatcher"].member
}

resource "google_service_account_iam_member" "tasks_service_agent_token_creator" {
  service_account_id = google_service_account.service["task_invoker"].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
}

resource "google_kms_crypto_key_iam_member" "broker" {
  crypto_key_id = var.kms_key_resource
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = google_service_account.service["credential_broker"].member
}

resource "google_secret_manager_secret_iam_member" "database" {
  for_each = local.modes

  secret_id = var.database_secret_ids[each.key]
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.service[each.key].member
}

resource "google_secret_manager_secret_iam_member" "provider" {
  secret_id = var.provider_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.service["credential_broker"].member
}

resource "google_secret_manager_secret_iam_member" "webhook" {
  secret_id = var.webhook_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.service["credential_broker"].member
}

resource "google_compute_global_address" "callback" {
  name         = var.callback_address_name
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
}

resource "google_compute_managed_ssl_certificate" "callback" {
  name = var.callback_certificate_name

  managed {
    domains = [var.oauth_callback_hostname]
  }
}

resource "google_compute_region_network_endpoint_group" "callback" {
  name                  = var.callback_neg_name
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.service["oauth_ingress"].name
  }
}

resource "google_compute_backend_service" "callback" {
  name                  = var.callback_backend_name
  protocol              = "HTTP"
  timeout_sec           = 30
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.callback.id
  }

  log_config {
    enable = false
  }
}

resource "google_compute_url_map" "callback" {
  name            = var.callback_url_map_name
  default_service = google_compute_backend_service.callback.id

  host_rule {
    hosts        = [var.oauth_callback_hostname]
    path_matcher = "qbo-callback"
  }

  path_matcher {
    name            = "qbo-callback"
    default_service = google_compute_backend_service.callback.id
  }

  lifecycle {
    precondition {
      condition     = var.oauth_callback_uri == "https://${var.oauth_callback_hostname}/oauth/callback"
      error_message = "oauth_callback_uri must terminate at the query-stripping callback edge hostname."
    }
  }
}

resource "google_compute_target_https_proxy" "callback" {
  name             = var.callback_https_proxy_name
  url_map          = google_compute_url_map.callback.id
  ssl_certificates = [google_compute_managed_ssl_certificate.callback.id]
}

resource "google_compute_global_forwarding_rule" "callback" {
  name                  = var.callback_forwarding_rule_name
  target                = google_compute_target_https_proxy.callback.id
  ip_address            = google_compute_global_address.callback.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

resource "google_network_services_wasm_plugin" "callback" {
  name            = var.callback_wasm_plugin_name
  location        = "global"
  description     = "Vaeroex QBO bounded OAuth callback and webhook edge"
  main_version_id = local.callback_edge_version
  deletion_policy = "PREVENT"

  log_config {
    enable = false
  }

  versions {
    version_name = local.callback_edge_version
    description  = "Immutable callback edge for source ${var.source_commit}"
    image_uri    = var.callback_edge_image_digest
  }
}

resource "google_network_services_lb_edge_extension" "callback" {
  name                  = var.callback_edge_extension_name
  location              = "global"
  description           = "Fail-closed QBO callback query handoff and webhook boundary"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  forwarding_rules      = [google_compute_global_forwarding_rule.callback.self_link]
  deletion_policy       = "PREVENT"

  extension_chains {
    name = "qbo-public-edge"

    match_condition {
      cel_expression = "request.host == '${var.oauth_callback_hostname}'"
    }

    extensions {
      name             = "sanitize-qbo-ingress"
      service          = google_network_services_wasm_plugin.callback.id
      fail_open        = false
      supported_events = ["REQUEST_HEADERS"]
      forward_headers = [
        "content-length",
        "expect",
        "transfer-encoding",
        "x-vaeroex-oauth-code",
        "x-vaeroex-oauth-handoff-version",
        "x-vaeroex-oauth-realm-id",
        "x-vaeroex-oauth-state",
      ]
    }
  }
}

resource "google_cloud_scheduler_job" "dispatcher" {
  name      = var.scheduler_name
  region    = var.region
  schedule  = var.dispatcher_schedule
  time_zone = "Etc/UTC"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 2
  }

  http_target {
    uri         = "${var.service_origins.task_dispatcher}/tasks/dispatch"
    http_method = "POST"
    body = base64encode(jsonencode({
      maximumTasks = var.maximum_dispatch_tasks
      queueClass   = "provider_bulk"
    }))
    headers = { "Content-Type" = "application/json" }

    oidc_token {
      service_account_email = google_service_account.service["dispatch_scheduler"].email
      audience              = var.service_origins.task_dispatcher
    }
  }
}

resource "google_cloud_scheduler_job" "initializer" {
  name      = var.initialization_scheduler_name
  region    = var.region
  schedule  = var.initialization_scheduler_schedule
  time_zone = "Etc/UTC"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 2
  }

  http_target {
    uri         = "${var.service_origins.task_scheduler}/tasks/schedule"
    http_method = "POST"
    body = base64encode(jsonencode({
      maximumConnections = var.maximum_initialization_connections
    }))
    headers = { "Content-Type" = "application/json" }

    oidc_token {
      service_account_email = google_service_account.service["initialization_scheduler"].email
      audience              = var.service_origins.task_scheduler
    }
  }
}
