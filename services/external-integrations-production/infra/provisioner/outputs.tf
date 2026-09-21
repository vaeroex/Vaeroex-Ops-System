output "installation_identity" {
  description = "Nonsecret identities to read back and pin before building the Production native installation."
  value = {
    project_id      = local.project_id
    instance_name   = google_compute_instance.provisioner.name
    instance_id     = google_compute_instance.provisioner.instance_id
    zone            = var.zone
    service_account = google_service_account.provisioner.email
    recovery_disk   = google_compute_disk.recovery.id
  }
}

output "closed_checkpoint" {
  value = {
    desired_status          = google_compute_instance.provisioner.desired_status
    temporary_access        = var.temporary_access_enabled
    administrative_access   = var.administrative_access_enabled
    setup_https             = var.setup_https_enabled
    secret_container_count  = length(local.profiles)
    maximum_run_seconds     = 3600
    activation_authority    = false
    retained_disk_gib       = 10
    secret_versions_created = 0
  }
}
