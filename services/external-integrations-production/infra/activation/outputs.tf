output "sanitized_activation" {
  value = {
    project_id                  = var.project_id
    project_number              = data.google_project.current.number
    region                      = var.region
    source_commit               = var.source_commit
    callback_edge_source_commit = var.callback_edge_source_commit
    production_hostname         = var.production_hostname
    runtime_deployed            = local.deployment_enabled
    callback_edge               = local.deployment_enabled ? google_network_services_wasm_plugin.square_callback[0].id : null
    runtime_enabled             = var.runtime_enabled
    provider_calls_enabled      = var.provider_calls_enabled
    onboarding_enabled          = var.customer_onboarding_enabled
    webhook_intake_enabled      = var.webhook_intake_enabled
    economic_enabled            = var.economic_contributions_enabled
    ai_dispatch_enabled         = var.ai_dispatch_enabled
    ingress_address             = google_compute_global_address.ingress.address
    egress_address              = google_compute_address.egress.address
    artifact_repository         = google_artifact_registry_repository.images.name
    build_bucket                = google_storage_bucket.build.name
    build_service_account       = google_service_account.build.email
    image_build_trigger         = google_cloudbuild_trigger.production_images.name
    image_build_approval        = true
    automatic_rollout           = false
    task_queue                  = google_cloud_tasks_queue.provider.id
    kms_key                     = google_kms_crypto_key.square_credentials.id
    alert_channel               = google_monitoring_notification_channel.operator_email.name
    empty_secret_containers = concat(
      [google_secret_manager_secret.application.secret_id, google_secret_manager_secret.webhook.secret_id],
      sort([for secret in values(google_secret_manager_secret.database) : secret.secret_id])
    )
  }
  description = "Non-secret Production activation readback. Secret versions and credential values are intentionally absent."
}
