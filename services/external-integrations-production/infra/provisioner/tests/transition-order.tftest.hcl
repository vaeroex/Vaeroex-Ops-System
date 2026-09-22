mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      name   = "projects/vaeroex-integrations-prod/serviceAccounts/sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
      email  = "sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
      member = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
    }
  }
  mock_data "google_secret_manager_secret_iam_policy" {
    defaults = {
      policy_data = "{\"version\":3,\"bindings\":[]}"
    }
  }
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}
mock_provider "external" {
  mock_data "external" {
    defaults = {
      result = {
        status           = "policy_troubleshooter_closed_all_denied"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
}
mock_provider "time" {}

variables {
  zone                          = "us-west1-a"
  boot_image                    = "projects/debian-cloud/global/images/debian-13-trixie-v20260901"
  window_starts_at              = "2099-01-01T00:00:00Z"
  window_expires_at             = "2099-01-01T01:00:00Z"
  previous_access_expires_at    = "2098-12-31T23:00:00Z"
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
    target = [google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation, time_sleep.private_access_propagation]
  }
  variables {
    administrative_access_enabled = false
  }
  assert {
    condition = (
      terraform_data.private_access_generation.input.enabled == false &&
      length(terraform_data.private_access_generation.input.profiles) == 0 &&
      terraform_data.private_access_generation.input.checkpoint_expires_at == "2098-12-31T23:00:00Z" &&
      time_sleep.private_access_propagation.create_duration == "0s" &&
      length(data.google_secret_manager_secret_iam_policy.private_versions) == 0 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "Generation-barrier adoption must occur closed without secret-policy reads or secret grants."
  }
}

run "setup_present" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions, time_sleep.private_access_propagation]
  }
  variables {
    setup_https_enabled = true
  }
}

run "setup_removed_credentials_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, terraform_data.private_access_effective_authority]
  }
  variables {
    temporary_access_enabled  = true
    temporary_access_profiles = ["oauth"]
  }
  override_data {
    target = data.external.private_access_effective[0]
    values = {
      result = {
        status           = "policy_troubleshooter_oauth_only_confirmed"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 0 &&
      time_sleep.private_access_propagation.create_duration == "10m" &&
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth"])
    )
    error_message = "The forward transition must remove setup and create one exact mocked grant."
  }
}

run "credentials_removed_setup_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions, time_sleep.private_access_propagation]
  }
  variables {
    setup_https_enabled        = true
    previous_access_expires_at = "2099-01-01T01:00:00Z"
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 1 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "The reverse transition must remove the exact mocked grant and recreate setup."
  }
}

run "setup_removed_oauth_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, terraform_data.private_access_effective_authority]
  }
  override_data {
    target = data.external.private_access_effective[0]
    values = {
      result = {
        status           = "policy_troubleshooter_oauth_only_confirmed"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
  variables {
    temporary_access_enabled   = true
    temporary_access_profiles  = ["oauth"]
    window_starts_at           = "2099-01-02T00:00:00Z"
    window_expires_at          = "2099-01-02T01:00:00Z"
    previous_access_expires_at = "2099-01-01T01:00:00Z"
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 0 &&
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth"])
    )
    error_message = "The OAuth-only transition must remove setup and create only the OAuth grant."
  }
}

run "oauth_removed_to_fully_closed_checkpoint" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation, time_sleep.private_access_propagation]
  }
  variables {
    temporary_access_enabled   = false
    previous_access_expires_at = "2099-01-02T01:00:00Z"
  }
  assert {
    condition = (
      terraform_data.private_access_generation.input.enabled == false &&
      terraform_data.private_access_generation.input.checkpoint_expires_at == "2099-01-02T01:00:00Z" &&
      time_sleep.private_access_propagation.create_duration == "0s" &&
      length(data.google_secret_manager_secret_iam_policy.private_versions) == 0 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "Changing profiles must first converge to a fully closed checkpoint that does not depend on policy readback."
  }
}

run "closed_checkpoint_to_broker_new_window" {
  command = apply
  plan_options {
    target = [terraform_data.private_access_effective_authority]
  }
  override_data {
    target = data.external.private_access_effective[0]
    values = {
      result = {
        status           = "policy_troubleshooter_broker_only_confirmed"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
  variables {
    temporary_access_enabled   = true
    temporary_access_profiles  = ["broker"]
    window_starts_at           = "2099-01-03T00:00:00Z"
    window_expires_at          = "2099-01-03T01:00:00Z"
    previous_access_expires_at = "2099-01-02T01:00:00Z"
  }
  assert {
    condition = (
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["broker"]) &&
      google_secret_manager_secret_iam_member.private_versions["broker"].condition[0].expression == "request.time >= timestamp('2099-01-03T00:00:00Z') && request.time < timestamp('2099-01-03T01:00:00Z')"
    )
    error_message = "A successor profile may open only from the closed checkpoint after the prior window expires."
  }
}

run "broker_removed_setup_created" {
  command = apply
  plan_options {
    target = [google_compute_firewall.setup_https, google_secret_manager_secret_iam_member.private_versions, terraform_data.private_access_generation, time_sleep.private_access_propagation]
  }
  variables {
    setup_https_enabled        = true
    previous_access_expires_at = "2099-01-03T01:00:00Z"
  }
  assert {
    condition = (
      length(google_compute_firewall.setup_https) == 1 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0
    )
    error_message = "The final transition must remove the broker grant before recreating setup."
  }
}
