mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}

variables {
  project_id                  = "vaeroex-integrations-prod"
  region                      = "us-west1"
  source_commit               = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  callback_edge_source_commit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  bootstrap_image_digest      = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  oauth_callback_image_digest = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  callback_edge_image_digest  = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
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
