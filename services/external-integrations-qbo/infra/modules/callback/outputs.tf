output "public_ingress" {
  value = {
    address          = google_compute_global_address.callback.address
    oauthCallbackUri = var.oauth_callback_uri
    webhookUri       = "https://${var.oauth_callback_hostname}/webhooks/qbo"
    edgePlugin       = google_network_services_wasm_plugin.callback.id
  }
}
