terraform {
  backend "gcs" {
    bucket = "vaeroex-integrations-prod-terraform-state"
    prefix = "bounded-square-native-provisioner"
  }
}
