terraform {
  required_version = "= 1.16.1"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.1.0"
    }
  }
}

# This configuration contains resource metadata only. Never add credentials,
# secret-value data sources, provisioners, startup scripts, or a remote backend.
provider "google" {
  project               = "vaeroex-square-sandbox"
  region                = "us-west1"
  billing_project       = "vaeroex-square-sandbox"
  user_project_override = true
}
