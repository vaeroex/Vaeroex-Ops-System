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
run "closed_generation_barrier_bootstrapped_without_grants" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation]
  }
  variables {
    administrative_access_enabled = false
  }
  assert {
    condition = (
      terraform_data.private_access_generation.input.enabled == false &&
      length(terraform_data.private_access_generation.input.profiles) == 0 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "Generation-barrier adoption must occur closed and create no secret grants."
  }
}

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
    temporary_access_enabled  = true
    temporary_access_profiles = ["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]
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

run "setup_removed_oauth_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation]
  }
  variables {
    temporary_access_enabled  = true
    temporary_access_profiles = ["oauth"]
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 0 &&
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth"])
    )
    error_message = "The OAuth-only transition must remove setup and create only the OAuth grant."
  }
}

run "oauth_destroyed_before_broker_created" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation]
  }
  variables {
    temporary_access_enabled  = true
    temporary_access_profiles = ["broker"]
  }
  assert {
    condition     = toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["broker"])
    error_message = "A direct profile change must leave only the newly selected broker grant."
  }
}

run "broker_old_window_destroyed_before_new_window_created" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation]
  }
  variables {
    temporary_access_enabled  = true
    temporary_access_profiles = ["broker"]
    window_starts_at          = "2099-01-02T00:00:00Z"
    window_expires_at         = "2099-01-02T01:00:00Z"
  }
  assert {
    condition = (
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["broker"]) &&
      google_secret_manager_secret_iam_member.private_versions["broker"].condition[0].expression == "request.time >= timestamp('2099-01-02T00:00:00Z') && request.time < timestamp('2099-01-02T01:00:00Z')"
    )
    error_message = "A time-window change must leave one broker grant with only the new condition."
  }
}

run "broker_removed_setup_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation]
  }
  variables {
    setup_https_enabled = true
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 1 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "The final transition must remove the broker grant before recreating setup."
  }
}
