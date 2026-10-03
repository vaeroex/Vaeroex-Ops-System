moved {
  from = google_compute_global_address.callback
  to   = module.callback.google_compute_global_address.callback
}

moved {
  from = google_compute_managed_ssl_certificate.callback
  to   = module.callback.google_compute_managed_ssl_certificate.callback
}

moved {
  from = google_compute_region_network_endpoint_group.callback
  to   = module.callback.google_compute_region_network_endpoint_group.callback
}

moved {
  from = google_compute_backend_service.callback
  to   = module.callback.google_compute_backend_service.callback
}

moved {
  from = google_compute_url_map.callback
  to   = module.callback.google_compute_url_map.callback
}

moved {
  from = google_compute_target_https_proxy.callback
  to   = module.callback.google_compute_target_https_proxy.callback
}

moved {
  from = google_compute_global_forwarding_rule.callback
  to   = module.callback.google_compute_global_forwarding_rule.callback
}

moved {
  from = google_network_services_wasm_plugin.callback
  to   = module.callback.google_network_services_wasm_plugin.callback
}

moved {
  from = google_network_services_lb_edge_extension.callback
  to   = module.callback.google_network_services_lb_edge_extension.callback
}
