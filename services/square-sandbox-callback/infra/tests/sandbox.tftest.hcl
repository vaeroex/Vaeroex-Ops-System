# All identifiers here are synthetic fixtures. mock_provider forbids API access.
mock_provider "google" {
  mock_resource "google_compute_address" {
    defaults = { address = "192.0.2.10" }
  }
}

variables {
  deployment_authorized        = true
  approval_expires_at          = timeadd(timestamp(), "24h")
  billing_account_id           = "AAAAAA-BBBBBB-CCCCCC"
  budget_notification_channels = ["projects/vaeroex-square-sandbox/notificationChannels/123"]
  ubuntu_image                 = "projects/ubuntu-os-cloud/global/images/ubuntu-2404-noble-amd64-v20000101"
  zone                         = "us-west1-a"
  operator_ipv4_cidrs          = ["192.0.2.1/32"]
  database_ipv4_cidrs          = ["192.0.2.2/32"]
  database_port                = 5432
}

run "closed_metadata_only_plan" {
  command = plan
  assert {
    condition     = google_compute_instance.callback.machine_type == "e2-small" && google_compute_instance.callback.boot_disk[0].initialize_params[0].size == 10 && google_compute_instance.callback.boot_disk[0].initialize_params[0].type == "pd-standard"
    error_message = "The modeled fixed host cost must not grow."
  }
  assert {
    condition     = google_compute_instance.callback.service_account[0].email == "vx-square-sandbox-broker@vaeroex-square-sandbox.iam.gserviceaccount.com" && google_compute_instance.callback.scheduling[0].on_host_maintenance == "TERMINATE" && !google_compute_instance.callback.scheduling[0].automatic_restart
    error_message = "Dedicated keyless identity and no-memory-migration maintenance are mandatory."
  }
  assert {
    condition     = google_compute_firewall.https.disabled && google_compute_firewall.acme.disabled
    error_message = "Templates must leave ingress closed."
  }
  assert {
    condition     = google_kms_crypto_key_iam_member.encrypt.role == "roles/cloudkms.cryptoKeyEncrypter" && google_secret_manager_secret.database.secret_id == "square-sandbox-callback-db" && length(google_secret_manager_secret.database.replication[0].user_managed[0].replicas) == 1
    error_message = "Only encryption and one DB-secret metadata container are in scope."
  }
  assert {
    condition     = google_billing_budget.sandbox.amount[0].specified_amount[0].units == "20" && google_billing_budget.sandbox.budget_filter[0].projects == toset(["projects/112579468800"]) && google_billing_budget.sandbox.budget_filter[0].credit_types_treatment == "EXCLUDE_ALL_CREDITS"
    error_message = "The total project budget must include all services without relying on credits."
  }
  assert {
    condition     = toset([for rule in google_billing_budget.sandbox.threshold_rules : rule.threshold_percent]) == toset([0.5, 0.75, 0.9, 1.0])
    error_message = "USD 10/15/18/20 actual-spend alerts are mandatory."
  }
  assert {
    condition     = strcontains(google_secret_manager_secret_iam_member.application.condition[0].expression, "projects/112579468800/secrets/square-sandbox-application/versions/1") && strcontains(google_secret_manager_secret_iam_member.database.condition[0].expression, "projects/112579468800/secrets/square-sandbox-callback-db/versions/1")
    error_message = "Accessor grants must be conditional on exact immutable version 1."
  }
}

run "code_only_denies_deployment" {
  command = plan
  variables { deployment_authorized = false }
  expect_failures = [var.deployment_authorized]
}

run "missing_channel_denied" {
  command = plan
  variables { budget_notification_channels = [] }
  expect_failures = [var.budget_notification_channels]
}

run "foreign_channel_denied" {
  command = plan
  variables { budget_notification_channels = ["projects/foreign-project/notificationChannels/123"] }
  expect_failures = [var.budget_notification_channels]
}

run "public_operator_access_denied" {
  command = plan
  variables { operator_ipv4_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.operator_ipv4_cidrs]
}

run "floating_image_denied" {
  command = plan
  variables { ubuntu_image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64" }
  expect_failures = [var.ubuntu_image]
}

run "foreign_region_denied" {
  command = plan
  variables { zone = "us-east1-b" }
  expect_failures = [var.zone]
}

run "unsupported_oregon_zone_denied" {
  command = plan
  variables { zone = "us-west1-b" }
  expect_failures = [var.zone]
}

run "expired_approval_denied" {
  command = plan
  variables { approval_expires_at = "2000-01-01T00:00:00Z" }
  expect_failures = [google_billing_budget.sandbox]
}
