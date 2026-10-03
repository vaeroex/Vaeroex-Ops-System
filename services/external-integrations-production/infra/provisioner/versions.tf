terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.39.0"
    }
    external = {
      source  = "hashicorp/external"
      version = "2.3.5"
    }
    time = {
      source  = "hashicorp/time"
      version = "0.13.1"
    }
  }
}

provider "google" {
  project = "vaeroex-integrations-prod"
  region  = "us-west1"
}
