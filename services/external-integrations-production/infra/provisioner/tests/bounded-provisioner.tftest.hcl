mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
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

# Documentation-only addresses and a synthetic image pin; never a hosted plan.
variables {
  zone                       = "us-west1-a"
  boot_image                 = "projects/debian-cloud/global/images/debian-13-trixie-v20260901"
  window_starts_at           = "2099-01-01T00:00:00Z"
  window_expires_at          = "2099-01-01T01:00:00Z"
  previous_access_expires_at = "2098-12-31T23:00:00Z"
  verified_pooler_ipv4_cidrs = ["192.0.2.1/32", "192.0.2.2/32"]
}

run "initial_installation_is_stopped_and_inaccessible" {
  command = plan

  assert {
    condition = (
      google_compute_instance.provisioner.desired_status == "TERMINATED" &&
      google_compute_instance.provisioner.machine_type == "e2-small" &&
      google_compute_instance.provisioner.scheduling[0].provisioning_model == "STANDARD" &&
      google_compute_instance.provisioner.scheduling[0].automatic_restart == false &&
      google_compute_instance.provisioner.scheduling[0].on_host_maintenance == "MIGRATE" &&
      google_compute_instance.provisioner.scheduling[0].instance_termination_action == "STOP" &&
      google_compute_instance.provisioner.scheduling[0].max_run_duration[0].seconds == 3600
    )
    error_message = "Closed state must converge to stopped, non-Spot e2-small with one-hour STOP and no restart."
  }
  assert {
    condition = (
      length(google_compute_instance.provisioner.network_interface) == 1 &&
      google_compute_instance.provisioner.network_interface[0].subnetwork == "projects/vaeroex-integrations-prod/regions/us-west1/subnetworks/vaeroex-integrations-us-west1" &&
      google_compute_instance.provisioner.network_interface[0].stack_type == "IPV4_ONLY" &&
      length(google_compute_instance.provisioner.network_interface[0].access_config) == 0 &&
      length(google_compute_instance.provisioner.network_interface[0].ipv6_access_config) == 0
    )
    error_message = "Reuse only the existing private IPv4 subnet, with no external address."
  }
  assert {
    condition = (
      google_compute_disk.recovery.size == 10 && google_compute_disk.recovery.type == "pd-standard" &&
      google_compute_instance.provisioner.boot_disk[0].auto_delete == false &&
      google_compute_instance.provisioner.deletion_protection == true &&
      google_compute_instance.provisioner.metadata["enable-oslogin"] == "TRUE" &&
      google_compute_instance.provisioner.metadata["block-project-ssh-keys"] == "TRUE" &&
      google_compute_instance.provisioner.metadata["serial-port-enable"] == "FALSE" &&
      !contains(keys(google_compute_instance.provisioner.metadata), "startup-script")
    )
    error_message = "Preserve the recovery disk and private administrative boundary; creation must run no installer."
  }
  assert {
    condition = (
      length(data.google_secret_manager_secret_iam_policy.private_versions) == 0 &&
      length(google_secret_manager_secret_iam_member.private_versions) == 0 &&
      length(google_compute_instance_iam_member.operator_oslogin) == 0 &&
      length(google_iap_tunnel_instance_iam_member.operator_tunnel) == 0 &&
      length(google_service_account_iam_member.operator_oslogin_service_account) == 0 &&
      length(google_compute_firewall.iap_ssh) == 0 &&
      length(google_compute_firewall.pooler) == 0 && length(google_compute_firewall.google_api_https) == 0 &&
      length(google_compute_firewall.setup_https) == 0 &&
      length(data.google_project.current) == 0 &&
      length(data.external.private_access_closed) == 0 &&
      length(data.external.private_access_effective) == 0 &&
      length(terraform_data.private_access_effective_authority) == 0
    )
    error_message = "Closed access must require no secret-policy readback and create no temporary administration, secret authority or allowed network access."
  }
}

run "open_window_has_only_exact_expiring_permission" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
  }

  assert {
    condition = (
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth"]) &&
      toset(google_project_iam_custom_role.private_versions.permissions) == toset([
        "secretmanager.versions.add", "secretmanager.versions.access",
        "secretmanager.versions.get", "secretmanager.versions.disable"
      ]) &&
      length(data.external.private_access_closed) == 1 &&
      length(data.external.private_access_effective) == 1 &&
      time_sleep.private_access_effective_propagation[0].create_duration == "10m" &&
      alltrue([for profile, binding in google_secret_manager_secret_iam_member.private_versions :
        binding.secret_id == "square-production-${profile}-db" &&
        binding.project == "vaeroex-integrations-prod" &&
        binding.condition[0].expression == "request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T01:00:00Z')"
      ])
    )
    error_message = "Grant only four version-staging permissions to one exact database secret during one window."
  }
  assert {
    condition = (
      google_compute_instance_iam_member.operator_oslogin[0].member == "user:isaac@vaeroex.com" &&
      google_compute_instance_iam_member.operator_oslogin[0].role == "roles/compute.osAdminLogin" &&
      google_iap_tunnel_instance_iam_member.operator_tunnel[0].member == "user:isaac@vaeroex.com" &&
      google_iap_tunnel_instance_iam_member.operator_tunnel[0].role == "roles/iap.tunnelResourceAccessor" &&
      google_iap_tunnel_instance_iam_member.operator_tunnel[0].instance == google_compute_instance.provisioner.name &&
      endswith(google_iap_tunnel_instance_iam_member.operator_tunnel[0].condition[0].expression, " && destination.port == 22") &&
      google_service_account_iam_member.operator_oslogin_service_account[0].role == "roles/iam.serviceAccountUser" &&
      google_service_account_iam_member.operator_oslogin_service_account[0].member == "user:isaac@vaeroex.com" &&
      google_compute_instance.provisioner.desired_status == "TERMINATED"
    )
    error_message = "Private administration is limited to Isaac and SSH; IAM enablement must not start the VM."
  }
  assert {
    condition = (
      toset(google_compute_firewall.iap_ssh[0].source_ranges) == toset(["35.235.240.0/20"]) &&
      one(google_compute_firewall.iap_ssh[0].allow).protocol == "tcp" &&
      toset(one(google_compute_firewall.iap_ssh[0].allow).ports) == toset(["22"]) &&
      toset(google_compute_firewall.pooler[0].destination_ranges) == var.verified_pooler_ipv4_cidrs &&
      one(google_compute_firewall.pooler[0].allow).protocol == "tcp" &&
      toset(one(google_compute_firewall.pooler[0].allow).ports) == toset(["5432"]) &&
      toset(one(google_compute_firewall.google_api_https[0].allow).ports) == toset(["443"]) &&
      toset(google_compute_firewall.google_api_https[0].destination_ranges) == toset(["199.36.153.8/30"]) &&
      length(google_compute_firewall.setup_https) == 0 &&
      one(google_compute_firewall.egress_deny.deny).protocol == "all"
    )
    error_message = "Only IAP SSH, pinned pooler TCP/5432 and private Google API HTTPS may pass during credential entry."
  }
}

run "oauth_only_window_has_only_oauth_secret_authority" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
  }

  assert {
    condition = (
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth"]) &&
      google_secret_manager_secret_iam_member.private_versions["oauth"].secret_id == "square-production-oauth-db" &&
      google_secret_manager_secret_iam_member.private_versions["oauth"].condition[0].expression == "request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T01:00:00Z')"
    )
    error_message = "An OAuth-only window must grant the provisioner authority on only the OAuth database-secret container."
  }
  assert {
    condition     = time_sleep.private_access_propagation.create_duration == "10m"
    error_message = "Opening private version authority must wait for the bounded IAM propagation interval."
  }
}

run "setup_downloads_have_no_secret_authority" {
  command = plan
  variables {
    administrative_access_enabled = true
    setup_https_enabled           = true
  }
  assert {
    condition = (
      length(google_secret_manager_secret_iam_member.private_versions) == 0 &&
      length(google_iap_tunnel_instance_iam_member.operator_tunnel) == 1 &&
      length(google_compute_firewall.setup_https) == 1 &&
      toset(google_compute_firewall.setup_https[0].destination_ranges) == toset(["0.0.0.0/0"]) &&
      toset(one(google_compute_firewall.setup_https[0].allow).ports) == toset(["443"]) &&
      google_compute_instance.provisioner.desired_status == "TERMINATED"
    )
    error_message = "The setup phase may permit downloads but must not grant private version authority or start the VM."
  }
}

run "reject_secret_staging_with_setup_egress" {
  command = plan
  variables {
    administrative_access_enabled = true
    setup_https_enabled           = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
  }
  expect_failures = [var.temporary_access_enabled]
}

run "reject_secret_staging_without_private_administration" {
  command = plan
  variables {
    temporary_access_enabled  = true
    temporary_access_profiles = ["oauth"]
  }
  expect_failures = [var.temporary_access_enabled]
}

run "reject_open_temporary_access_without_a_profile" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
  }
  expect_failures = [var.temporary_access_profiles]
}

run "reject_multiple_profiles_in_one_window" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth", "broker"]
  }
  expect_failures = [var.temporary_access_profiles]
}

run "reject_profile_selection_while_temporary_access_is_closed" {
  command = plan
  variables { temporary_access_profiles = ["oauth"] }
  expect_failures = [var.temporary_access_profiles]
}

run "reject_unknown_temporary_access_profile" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["unknown"]
  }
  expect_failures = [var.temporary_access_profiles]
}

run "reject_setup_without_private_administration" {
  command = plan
  variables { setup_https_enabled = true }
  expect_failures = [var.setup_https_enabled]
}

run "reject_other_region" {
  command = plan
  variables { zone = "us-central1-a" }
  expect_failures = [var.zone]
}

run "reject_mutable_image_family" {
  command = plan
  variables { boot_image = "projects/debian-cloud/global/images/family/debian-13" }
  expect_failures = [var.boot_image]
}

run "reject_unbounded_pooler_range" {
  command = plan
  variables { verified_pooler_ipv4_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.verified_pooler_ipv4_cidrs]
}

run "reject_empty_pooler_input" {
  command = plan
  variables { verified_pooler_ipv4_cidrs = [] }
  expect_failures = [var.verified_pooler_ipv4_cidrs]
}

run "accept_two_hour_window" {
  command = plan
  variables { window_expires_at = "2099-01-01T02:00:00Z" }
}

run "reject_window_longer_than_two_hours" {
  command = plan
  variables { window_expires_at = "2099-01-01T02:00:01Z" }
  expect_failures = [var.window_expires_at]
}

run "reject_reversed_window" {
  command = plan
  variables { window_expires_at = "2098-12-31T23:59:59Z" }
  expect_failures = [var.window_expires_at]
}

run "reject_window_start_before_previous_expiry" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
    previous_access_expires_at    = "2099-01-01T00:00:01Z"
  }
  expect_failures = [var.previous_access_expires_at]
}

run "reject_changed_window_while_old_binding_is_still_present" {
  # The secret-policy read is deliberately deferred until apply, after the
  # propagation barrier. A plan-only assertion would reintroduce the stale
  # plan/apply observation this regression protects against.
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
    window_starts_at              = "2099-01-02T00:00:00Z"
    window_expires_at             = "2099-01-02T01:00:00Z"
  }
  override_data {
    target = data.google_secret_manager_secret_iam_policy.private_versions["oauth"]
    values = {
      policy_data = "{\"version\":3,\"bindings\":[{\"role\":\"projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions\",\"members\":[\"serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com\"],\"condition\":{\"title\":\"bounded-native-provisioning\",\"description\":\"One exact database secret during the admitted maintenance window.\",\"expression\":\"request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T01:00:00Z')\"}}]}"
    }
  }
  expect_failures = [google_secret_manager_secret_iam_member.private_versions["oauth"]]
}

run "reject_profile_switch_while_old_binding_is_still_present" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["broker"]
  }
  override_data {
    target = data.google_secret_manager_secret_iam_policy.private_versions["oauth"]
    values = {
      policy_data = "{\"version\":3,\"bindings\":[{\"role\":\"projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions\",\"members\":[\"serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com\"],\"condition\":{\"title\":\"bounded-native-provisioning\",\"description\":\"One exact database secret during the admitted maintenance window.\",\"expression\":\"request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T01:00:00Z')\"}}]}"
    }
  }
  expect_failures = [google_secret_manager_secret_iam_member.private_versions["broker"]]
}

run "reject_residual_provisioner_binding_under_another_role" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
  }
  override_data {
    target = data.google_secret_manager_secret_iam_policy.private_versions["broker"]
    values = {
      policy_data = "{\"version\":3,\"bindings\":[{\"role\":\"roles/secretmanager.secretAccessor\",\"members\":[\"serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com\"]}]}"
    }
  }
  expect_failures = [google_secret_manager_secret_iam_member.private_versions["oauth"]]
}

run "reject_exact_residual_binding_when_state_is_closed" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
    window_starts_at              = "2099-01-04T00:00:00Z"
    window_expires_at             = "2099-01-04T01:00:00Z"
  }
  override_data {
    target = data.google_secret_manager_secret_iam_policy.private_versions["oauth"]
    values = {
      policy_data = "{\"version\":3,\"bindings\":[{\"role\":\"projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions\",\"members\":[\"serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com\"],\"condition\":{\"title\":\"bounded-native-provisioning\",\"description\":\"One exact database secret during the admitted maintenance window.\",\"expression\":\"request.time >= timestamp('2099-01-04T00:00:00Z') && request.time < timestamp('2099-01-04T01:00:00Z')\"}}]}"
    }
  }
  expect_failures = [google_secret_manager_secret_iam_member.private_versions["oauth"]]
}

run "reject_effective_authority_at_closed_checkpoint" {
  command = apply
  plan_options {
    target = [google_secret_manager_secret_iam_member.private_versions]
  }
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
    temporary_access_profiles     = ["oauth"]
  }
  override_data {
    target = data.external.private_access_closed[0]
    values = {
      result = {
        status           = "policy_troubleshooter_oauth_only_confirmed"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
  expect_failures = [google_secret_manager_secret_iam_member.private_versions["oauth"]]
}

run "reject_peer_authority_after_oauth_open" {
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
        status           = "policy_troubleshooter_broker_only_confirmed"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
  expect_failures = [terraform_data.private_access_effective_authority[0]]
}

run "oauth_effective_authority_exact_matrix_confirmed" {
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
        status           = "policy_troubleshooter_oauth_only_confirmed"
        checked_secrets  = "6"
        checked_versions = "0"
        checked_tuples   = "6"
      }
    }
  }
  assert {
    condition = (
      terraform_data.private_access_effective_authority[0].input.profile == "oauth" &&
      terraform_data.private_access_effective_authority[0].input.status == "policy_troubleshooter_oauth_only_confirmed" &&
      terraform_data.private_access_effective_authority[0].input.checked_secrets == "6" &&
      terraform_data.private_access_effective_authority[0].input.checked_versions == "0" &&
      terraform_data.private_access_effective_authority[0].input.checked_tuples == "6"
    )
    error_message = "The OAuth opening may complete only after the exact live numeric-version effective-access matrix is confirmed."
  }
}
