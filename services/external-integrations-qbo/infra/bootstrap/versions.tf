terraform {
  required_version = ">= 1.9.0"
  backend "local" {}
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.39.0"
    }
  }
}
