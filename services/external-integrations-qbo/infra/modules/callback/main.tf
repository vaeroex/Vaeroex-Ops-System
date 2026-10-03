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
    service = var.oauth_ingress_service_name
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
  main_version_id = "v${substr(var.source_commit, 0, 12)}"
  deletion_policy = "PREVENT"

  # The API omits disabled logging; google 7.39.0 flattens it to no block.
  # log_config is optional, not computed: remote enablement still produces drift.
  lifecycle {
    postcondition {
      condition     = alltrue([for logging in self.log_config : logging.enable == false])
      error_message = "QBO callback plugin logging must remain disabled."
    }
  }

  versions {
    version_name       = "v${substr(var.source_commit, 0, 12)}"
    description        = "Immutable callback edge for source ${var.source_commit}"
    image_uri          = var.callback_edge_image_digest
    plugin_config_data = base64encode(jsonencode({ allowedHost = var.oauth_callback_hostname }))
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
      cel_expression = "true"
    }

    extensions {
      name             = "sanitize-qbo-ingress"
      service          = google_network_services_wasm_plugin.callback.id
      fail_open        = false
      supported_events = ["REQUEST_HEADERS"]
      forward_attributes = [
        "request.host",
        "request.method",
        "request.path",
        "request.query",
      ]
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
