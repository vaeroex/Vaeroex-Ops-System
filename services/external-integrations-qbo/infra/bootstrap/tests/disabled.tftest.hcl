mock_provider "google" {}

variables {
  source_commit              = "c1b1982efbf5956ee6053edaefbbed3728eb08c2"
  image_digest               = "us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  callback_edge_image_digest = "us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/callback-edge@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}

run "disabled_ingress_only" {
  command = plan
  assert {
    condition     = length(google_cloud_run_v2_service.service) == 1 && length(google_service_account.service) == 1
    error_message = "Bootstrap must create only the existing ingress mode and its identity."
  }
  assert {
    condition     = google_cloud_run_v2_service.service["oauth_ingress"].ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" && google_cloud_run_v2_service.service["oauth_ingress"].default_uri_disabled && google_cloud_run_v2_service.service["oauth_ingress"].invoker_iam_disabled
    error_message = "Direct ingress must remain closed."
  }
  assert {
    condition = length(google_cloud_run_v2_service.service["oauth_ingress"].template[0].containers[0].env) == 3 && alltrue([
      for item in google_cloud_run_v2_service.service["oauth_ingress"].template[0].containers[0].env :
      contains(["QBO_SERVICE_MODE", "QBO_SOURCE_COMMIT", "QBO_INGRESS_BOOTSTRAP_ONLY"], item.name) && length(item.value_source) == 0
    ])
    error_message = "Bootstrap cannot receive database, secret, credential, queue or operational configuration."
  }
  assert {
    condition     = [for item in google_cloud_run_v2_service.service["oauth_ingress"].template[0].containers[0].env : item.value if item.name == "QBO_INGRESS_BOOTSTRAP_ONLY"] == ["true"]
    error_message = "The bootstrap gate must not be switchable through Terraform inputs."
  }
  assert {
    condition     = google_cloud_run_v2_service.service["oauth_ingress"].template[0].scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.service["oauth_ingress"].template[0].scaling[0].max_instance_count == 1
    error_message = "Bootstrap must scale to zero with one maximum instance."
  }
  assert {
    condition     = !output.processing_state.promotionAuthorized && !output.processing_state.readyForProviderProcessing
    error_message = "Bootstrap is not provider processing readiness."
  }
}

run "reject_mutable_image" {
  command = plan
  variables { image_digest = "us-central1-docker.pkg.dev/vaeroex-qbo-prod-20260827/qbo-production/runtime:latest" }
  expect_failures = [var.image_digest]
}
