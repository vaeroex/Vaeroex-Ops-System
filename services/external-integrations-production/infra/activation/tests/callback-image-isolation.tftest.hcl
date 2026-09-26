mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}

run "customer_consent_selects_exact_customer_runtime_configuration" {
  command = plan
  variables {
    internal_consent = {
      image_digest      = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-internal-consent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      source_commit     = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      mode              = "customer_owner_v1"
      application_id    = "sq0idp-synthetic-application"
      broker_origin     = "https://square-production-broker-u5c6zahmpq-uw.a.run.app"
      database_versions = { oauth = 1, broker = 1 }
      database_ca       = file("../../../../tools/jit-access-feasibility/supabase-root-2021.crt")
    }
  }
  assert {
    condition = alltrue([for mode in ["oauth", "broker"] :
      toset(keys(jsondecode([for env in google_cloud_run_v2_service.square[mode].template[0].containers[0].env :
      env.value if env.name == "SQUARE_INTERNAL_CONSENT_CONFIGURATION"][0]))) ==
      toset(["mode", "profile", "applicationId", "databaseVersion", "databaseCa", "brokerOrigin"]) &&
      jsondecode([for env in google_cloud_run_v2_service.square[mode].template[0].containers[0].env :
    env.value if env.name == "SQUARE_INTERNAL_CONSENT_CONFIGURATION"][0]).mode == "customer_owner_v1"])
    error_message = "Customer mode must serialize exactly the strict customer runtime schema, without an internal permit or publishable key."
  }
  assert {
    condition = (alltrue([for mode in ["runtime", "evidence", "scheduler", "webhook"] :
      google_cloud_run_v2_service.square[mode].template[0].containers[0].image == var.bootstrap_image_digest]) &&
      length(google_cloud_run_v2_service_iam_member.manual_read_invoker) == 0 &&
      !var.runtime_enabled && !var.provider_calls_enabled && !var.customer_onboarding_enabled &&
    !var.webhook_intake_enabled && !var.economic_contributions_enabled && !var.ai_dispatch_enabled)
    error_message = "Customer consent configuration must retain peer dormancy and all closed general gates."
  }
}

run "customer_configuration_rejects_mixed_internal_permit" {
  command = plan
  variables {
    internal_consent = {
      image_digest      = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-internal-consent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      source_commit     = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      mode              = "customer_owner_v1"
      application_id    = "sq0idp-synthetic-application"
      permit            = {}
      broker_origin     = "https://square-production-broker-u5c6zahmpq-uw.a.run.app"
      database_versions = { oauth = 1, broker = 1 }
      database_ca       = file("../../../../tools/jit-access-feasibility/supabase-root-2021.crt")
    }
  }
  expect_failures = [var.internal_consent]
}

run "manual_read_uses_existing_services_and_exact_invokers" {
  command = plan
  variables {
    internal_consent = {
      image_digest             = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-internal-consent@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      source_commit            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      broker_origin            = "https://square-production-broker-u5c6zahmpq-uw.a.run.app"
      permit                   = {}
      database_versions        = { oauth = 1, broker = 1 }
      read_database_versions   = { runtime = 1, evidence = 1 }
      database_ca              = file("../../../../tools/jit-access-feasibility/supabase-root-2021.crt")
      supabase_publishable_key = "synthetic_publishable_key_only"
      manual_read              = { credentialVersion = 1 }
    }
  }
  assert {
    condition = alltrue([for mode in ["oauth", "broker", "runtime", "evidence"] :
    google_cloud_run_v2_service.square[mode].template[0].containers[0].image == var.internal_consent.image_digest])
    error_message = "Manual read must reuse only the four existing service identities."
  }
  assert {
    condition = alltrue([for mode in ["scheduler", "webhook"] :
    google_cloud_run_v2_service.square[mode].template[0].containers[0].image == var.bootstrap_image_digest])
    error_message = "Scheduler and webhook must retain the dormant image."
  }
  assert {
    condition     = toset(keys(google_cloud_run_v2_service_iam_member.manual_read_invoker)) == toset(["oauth_runtime", "oauth_evidence", "runtime_broker"])
    error_message = "Only the three manual service call edges may be added."
  }
  assert {
    condition = alltrue([for mode in ["runtime", "evidence"] :
    jsondecode([for env in google_cloud_run_v2_service.square[mode].template[0].containers[0].env : env.value if env.name == "SQUARE_INTERNAL_CONSENT_CONFIGURATION"][0]).databaseVersion == 1])
    error_message = "Read services must use exactly database version one."
  }
  assert {
    condition     = !var.runtime_enabled && !var.provider_calls_enabled && !var.customer_onboarding_enabled && !var.webhook_intake_enabled && !var.economic_contributions_enabled && !var.ai_dispatch_enabled
    error_message = "Manual configuration never opens general activation gates."
  }
}

variables {
  project_id                   = "vaeroex-integrations-prod"
  region                       = "us-west1"
  source_commit                = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  oauth_callback_source_commit = "ffffffffffffffffffffffffffffffffffffffff"
  callback_edge_source_commit  = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  bootstrap_image_digest       = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  oauth_callback_image_digest  = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  callback_edge_image_digest   = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
}

run "callback_images_are_existing_resource_updates_only" {
  command = plan

  assert {
    condition = toset(keys(google_cloud_run_v2_service.square)) == toset([
      "oauth", "broker", "scheduler", "webhook", "runtime", "evidence"
    ])
    error_message = "The callback release must retain exactly the six existing Square service resources."
  }

  assert {
    condition     = google_cloud_run_v2_service.square["oauth"].template[0].containers[0].image == var.oauth_callback_image_digest
    error_message = "Only the existing OAuth service may use the callback-specific image input."
  }

  assert {
    condition = alltrue([
      for mode in ["broker", "scheduler", "webhook", "runtime", "evidence"] :
      google_cloud_run_v2_service.square[mode].template[0].containers[0].image == var.bootstrap_image_digest
    ])
    error_message = "Every non-OAuth service must remain pinned to the shared bootstrap digest."
  }

  assert {
    condition = (
      [for item in google_cloud_run_v2_service.square["oauth"].template[0].containers[0].env : item.value if item.name == "VAEROEX_SOURCE_COMMIT"][0] == var.oauth_callback_source_commit &&
      alltrue([
        for mode in ["broker", "scheduler", "webhook", "runtime", "evidence"] :
        [for item in google_cloud_run_v2_service.square[mode].template[0].containers[0].env : item.value if item.name == "VAEROEX_SOURCE_COMMIT"][0] == var.source_commit
      ])
    )
    error_message = "Callback-only release provenance must update OAuth without revising peer services."
  }

  assert {
    condition     = one(google_network_services_wasm_plugin.square_callback[0].versions).image_uri == var.callback_edge_image_digest
    error_message = "The callback-specific Wasm digest must remain bound to the existing edge plugin."
  }

  assert {
    condition = (
      var.runtime_enabled == false &&
      var.provider_calls_enabled == false &&
      var.customer_onboarding_enabled == false &&
      var.webhook_intake_enabled == false &&
      var.economic_contributions_enabled == false &&
      var.ai_dispatch_enabled == false
    )
    error_message = "A callback-only image plan must keep every Production gate closed."
  }
}
