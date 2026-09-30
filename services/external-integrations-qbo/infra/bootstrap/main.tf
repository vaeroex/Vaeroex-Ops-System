provider "google" {
  project = local.project_id
  region  = local.region
}

locals {
  project_id = "vaeroex-qbo-prod-20260827"
  region     = "us-central1"
  hostname   = "integrations.vaeroex.com"
}

resource "google_service_account" "service" {
  for_each     = { oauth_ingress = "qbo-oauth-ingress" }
  account_id   = each.value
  display_name = "Vaeroex QBO oauth ingress"
}

resource "google_cloud_run_v2_service" "service" {
  for_each             = { oauth_ingress = "qbo-production-oauth-ingress" }
  name                 = each.value
  location             = local.region
  ingress              = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  default_uri_disabled = true
  invoker_iam_disabled = true
  deletion_protection  = true
  template {
    service_account                  = google_service_account.service[each.key].email
    timeout                          = "10s"
    max_instance_request_concurrency = 8
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.image_digest
      resources {
        limits            = { cpu = "1", memory = "256Mi" }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      dynamic "env" {
        for_each = {
          QBO_SERVICE_MODE           = "oauth_ingress"
          QBO_INGRESS_BOOTSTRAP_ONLY = "true"
          QBO_SOURCE_COMMIT          = var.source_commit
        }
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }
}

module "callback" {
  source                        = "../modules/callback"
  region                        = local.region
  source_commit                 = var.source_commit
  oauth_ingress_service_name    = google_cloud_run_v2_service.service["oauth_ingress"].name
  oauth_callback_hostname       = local.hostname
  oauth_callback_uri            = "https://${local.hostname}/oauth/callback"
  callback_edge_image_digest    = var.callback_edge_image_digest
  callback_address_name         = "qbo-production-callback-ip"
  callback_certificate_name     = "qbo-production-callback-cert"
  callback_neg_name             = "qbo-production-callback-neg"
  callback_backend_name         = "qbo-production-callback-backend"
  callback_url_map_name         = "qbo-production-callback-url-map"
  callback_https_proxy_name     = "qbo-production-callback-https-proxy"
  callback_forwarding_rule_name = "qbo-production-callback-https"
  callback_wasm_plugin_name     = "qbo-production-callback-edge"
  callback_edge_extension_name  = "qbo-production-callback-extension"
}

output "public_ingress" {
  value = module.callback.public_ingress
}

output "processing_state" {
  value = {
    bootstrapOnly              = true
    oauthProcessingEnabled     = false
    webhookProcessingEnabled   = false
    readyForProviderProcessing = false
    promotionAuthorized        = false
    modelCallCount             = 0
  }
}
