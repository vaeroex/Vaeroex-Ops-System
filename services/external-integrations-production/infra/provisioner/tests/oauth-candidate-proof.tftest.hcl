mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "711446392261" }
  }
  mock_resource "google_service_account" {
    defaults = {
      name   = "projects/vaeroex-integrations-prod/serviceAccounts/sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
      email  = "sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
      member = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com"
    }
  }
  mock_data "google_secret_manager_secret_iam_policy" {
    defaults = { policy_data = "{\"version\":3,\"bindings\":[]}" }
  }
}
mock_provider "external" {
  mock_data "external" {
    defaults = {
      result = {
        status           = "policy_troubleshooter_closed_all_denied"
        checked_secrets  = "7"
        checked_versions = "2"
        checked_tuples   = "17"
      }
    }
  }
}
mock_provider "time" {}

variables {
  zone                          = "us-west1-a"
  boot_image                    = "projects/debian-cloud/global/images/debian-13-trixie-v20260901"
  window_starts_at              = "2099-01-01T00:00:00Z"
  window_expires_at             = "2099-01-01T03:00:00Z"
  previous_access_expires_at    = "2098-12-31T23:00:00Z"
  verified_pooler_ipv4_cidrs    = ["192.0.2.1/32"]
  oauth_candidate_proof_enabled = true
}

run "proof_get_access_only_exact_version_one" {
  command = apply
  plan_options {
    target = [terraform_data.private_access_effective_authority]
  }
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
  }
  override_data {
    target = data.external.private_access_effective[0]
    values = {
      result = {
        status           = "policy_troubleshooter_oauth_candidate_proof_confirmed"
        checked_secrets  = "7"
        checked_versions = "2"
        checked_tuples   = "17"
      }
    }
  }
  assert {
    condition = (
      toset(google_project_iam_custom_role.oauth_candidate_proof.permissions) == toset(["secretmanager.versions.get", "secretmanager.versions.access"]) &&
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth"]) &&
      google_secret_manager_secret_iam_member.private_versions["oauth"].role == "projects/vaeroex-integrations-prod/roles/squareProductionOAuthCandidateProof" &&
      google_secret_manager_secret_iam_member.private_versions["oauth"].condition[0].expression == "resource.service == 'secretmanager.googleapis.com' && resource.type == 'secretmanager.googleapis.com/SecretVersion' && resource.name == 'projects/711446392261/secrets/square-production-oauth-db/versions/1' && request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T03:00:00Z')" &&
      terraform_data.private_access_generation.input.access_mode == "oauth_candidate_proof" &&
      data.external.private_access_closed[0].query.access_mode == "oauth_candidate_proof" &&
      data.external.private_access_effective[0].query.access_mode == "oauth_candidate_proof" &&
      terraform_data.private_access_effective_authority[0].input.checked_tuples == "17"
    )
    error_message = "Proof permits only retained OAuth version 1 get/access and requires the seven-secret proof matrix."
  }
}

run "proof_closed_checkpoint_retains_mode_not_access" {
  command = plan
  variables {
    previous_access_expires_at = "2099-01-01T03:00:00Z"
  }
  assert {
    condition = (
      terraform_data.private_access_generation.input.access_mode == "oauth_candidate_proof" &&
      terraform_data.private_access_generation.input.enabled == false &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0 &&
      length(google_compute_instance_iam_member.operator_oslogin) == 0 &&
      length(google_iap_tunnel_instance_iam_member.operator_tunnel) == 0 &&
      length(google_service_account_iam_member.operator_oslogin_service_account) == 0 &&
      google_compute_instance.provisioner.desired_status == "TERMINATED"
    )
    error_message = "Cleanup must retain the proof denial contract while removing all temporary access."
  }
}

run "proof_rejects_peer_profile" {
  command = plan
  variables {
    window_expires_at             = "2099-01-01T01:00:00Z"
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["broker"]
  }
  expect_failures = [var.oauth_candidate_proof_enabled]
}

run "proof_rejects_administrative_only" {
  command = plan
  variables {
    window_expires_at             = "2099-01-01T01:00:00Z"
    administrative_access_enabled = true
  }
  expect_failures = [var.oauth_candidate_proof_enabled]
}
