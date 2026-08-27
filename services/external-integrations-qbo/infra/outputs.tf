output "service_accounts" {
  value = { for key, service in google_service_account.service : key => service.email }
}

output "service_uris" {
  value = { for key, service in google_cloud_run_v2_service.service : key => service.uri }
}

output "queue_resource" {
  value = local.queue_resource
}

output "public_ingress" {
  value = {
    address          = google_compute_global_address.callback.address
    oauthCallbackUri = var.oauth_callback_uri
    webhookUri       = "https://${var.oauth_callback_hostname}/webhooks/qbo"
    edgePlugin       = google_network_services_wasm_plugin.callback.id
  }
}

output "runtime_configuration_registration" {
  value = {
    contractVersion           = "qbo_runtime_configuration_v2"
    providerEnvironment       = "production"
    deploymentTier            = "production"
    configurationVersion      = 1
    authorizationRedirectUri  = var.oauth_callback_uri
    authorizationReturnIntent = "/app/settings"
    providerApiOrigin         = "https://quickbooks.api.intuit.com"
    queueName                 = var.queue_name
    queueAudience             = var.service_origins.provider_runtime
  }
}
