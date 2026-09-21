mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      name   = "projects/vaeroex-integrations-prod/serviceAccounts/sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
      email  = "sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
      member = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
    }
  }
}

variables {
  zone                          = "us-west1-a"
  boot_image                    = "projects/debian-cloud/global/images/debian-13-trixie-v20260901"
  window_starts_at              = "2099-01-01T00:00:00Z"
  window_expires_at             = "2099-01-01T01:00:00Z"
  verified_pooler_ipv4_cidrs    = ["192.0.2.1/32"]
  administrative_access_enabled = true
}

# Real Terraform state transitions, with every Google operation mocked.
# verify-transition-order.mjs also checks the apply graph's dependency edges
# and completed-operation order, so final-state counts alone cannot pass.
# Target only this transition and its real dependency closure: the retained
# VM/disk must not be mock-created then destroyed by unrelated test teardown.
run "setup_present" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    setup_https_enabled = true
  }
}

run "setup_removed_credentials_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    temporary_access_enabled = true
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 0 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 6
    )
    error_message = "The forward transition must remove setup and create all six mocked grants."
  }
}

run "credentials_removed_setup_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    setup_https_enabled = true
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 1 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "The reverse transition must remove all six mocked grants and recreate setup."
  }
}
