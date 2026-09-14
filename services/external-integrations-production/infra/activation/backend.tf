terraform {
  backend "gcs" {
    bucket = "vaeroex-integrations-prod-terraform-state"
    prefix = "shared-production-integration-platform"
  }
}
