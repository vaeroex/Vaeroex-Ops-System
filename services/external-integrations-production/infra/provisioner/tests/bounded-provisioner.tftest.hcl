mock_provider "google" {}

# Documentation-only addresses and a synthetic image pin; never a hosted plan.
variables {
  zone                       = "us-west1-a"
  boot_image                 = "projects/debian-cloud/global/images/debian-13-trixie-v20260901"
  window_starts_at           = "2099-01-01T00:00:00Z"
  window_expires_at          = "2099-01-01T01:00:00Z"
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
      google_compute_instance.provisioner.scheduling[0].instance_termination_action == "STOP" &&
      google_compute_instance.provisioner.scheduling[0].max_run_duration[0].seconds == 3600
    )
    error_message = "Creation must converge to stopped, non-Spot e2-small with one-hour STOP and no restart."
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
      length(google_secret_manager_secret_iam_member.private_versions) == 0 &&
      length(google_compute_instance_iam_member.operator_oslogin) == 0 &&
      length(google_iap_tunnel_instance_iam_member.operator_tunnel) == 0 &&
      length(google_service_account_iam_member.operator_oslogin_service_account) == 0 &&
      length(google_compute_firewall.iap_ssh) == 0 &&
      length(google_compute_firewall.pooler) == 0 && length(google_compute_firewall.google_api_https) == 0 &&
      length(google_compute_firewall.setup_https) == 0
    )
    error_message = "No temporary administration, secret authority or allowed network access exists by default."
  }
}

run "open_window_has_only_exact_expiring_permissions" {
  command = plan
  variables {
    administrative_access_enabled = true
    temporary_access_enabled      = true
  }

  assert {
    condition = (
      toset(keys(google_secret_manager_secret_iam_member.private_versions)) == toset(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]) &&
      toset(google_project_iam_custom_role.private_versions.permissions) == toset([
        "secretmanager.versions.add", "secretmanager.versions.access",
        "secretmanager.versions.get", "secretmanager.versions.disable"
      ]) &&
      alltrue([for profile, binding in google_secret_manager_secret_iam_member.private_versions :
        binding.secret_id == "square-production-${profile}-db" &&
        binding.project == "vaeroex-integrations-prod" &&
        binding.condition[0].expression == "request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T01:00:00Z')"
      ])
    )
    error_message = "Grant only four version-staging permissions to the six exact database secrets during one window."
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
  }
  expect_failures = [var.temporary_access_enabled]
}

run "reject_secret_staging_without_private_administration" {
  command = plan
  variables { temporary_access_enabled = true }
  expect_failures = [var.temporary_access_enabled]
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

run "reject_window_longer_than_one_hour" {
  command = plan
  variables { window_expires_at = "2099-01-01T01:00:01Z" }
  expect_failures = [var.window_expires_at]
}

run "reject_reversed_window" {
  command = plan
  variables { window_expires_at = "2098-12-31T23:59:59Z" }
  expect_failures = [var.window_expires_at]
}
