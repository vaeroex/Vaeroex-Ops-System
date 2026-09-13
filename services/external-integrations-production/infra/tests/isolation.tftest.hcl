variables {
  platform = {
    contract_version = "production_integration_platform_v1"
    project_id       = "vaeroex-integrations-prod"
    project_number   = "123456789012"
    region           = "us-west1"
    shared_resource_names = {
      network             = "vaeroex-integrations-production"
      subnet              = "vaeroex-integrations-us-west1"
      router              = "vaeroex-integrations-router"
      nat                 = "vaeroex-integrations-nat"
      egress_address      = "vaeroex-integrations-egress"
      ingress_address     = "vaeroex-integrations-ingress"
      task_queue          = "vaeroex-integrations-tasks"
      artifact_repository = "vaeroex-integrations-images"
    }
    database_authority_target    = "existing_production_postgres"
    runtime_policy_version       = "production_runtime_v1"
    retention_policy_version     = "production_retention_v1"
    observability_policy_version = "production_observability_v1"
    backup_policy_version        = "production_backup_v1"
    source_commit                = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    infrastructure_provisioned   = false
    runtime_enabled              = false
    economic_enabled             = false
    ai_dispatch_enabled          = false
  }
  provider_bindings = {
    square = {
      contract_version = "production_provider_isolation_v1"
      environment      = "production"
      application_id   = "sq0idp-production-placeholder"
      route_namespace  = "/api/integrations/square"
      callback_uri     = "https://square.vaeroex.com/api/integrations/square/callback"
      kms_key_resource = "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials"
      secret_version_resources = {
        application = "projects/vaeroex-integrations-prod/secrets/square-application/versions/1"
      }
      service_accounts               = { broker = "square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com" }
      database_logins                = { broker = "square_production_broker" }
      source_commit                  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      enabled                        = false
      provider_calls_enabled         = false
      customer_onboarding_enabled    = false
      webhook_intake_enabled         = false
      evidence_enabled               = false
      economic_contributions_enabled = false
      ai_dispatch_enabled            = false
    }
  }
}

run "valid_dormant_composition" {
  command = apply
  assert {
    condition     = output.review_manifest.gates.runtime == false && length(output.review_manifest.providers) == 1 && output.review_manifest.providers[0] == "square"
    error_message = "The reviewed composition must remain dormant and provider-scoped."
  }
}

run "single_label_callback_denied" {
  command = plan
  variables {
    provider_bindings = {
      square = {
        contract_version = "production_provider_isolation_v1"
        environment      = "production"
        application_id   = "sq0idp-production-placeholder"
        route_namespace  = "/api/integrations/square"
        callback_uri     = "https://internal/api/integrations/square/callback"
        kms_key_resource = "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials"
        secret_version_resources = {
          application = "projects/vaeroex-integrations-prod/secrets/square-application/versions/1"
        }
        service_accounts               = { broker = "square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com" }
        database_logins                = { broker = "square_production_broker" }
        source_commit                  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        enabled                        = false
        provider_calls_enabled         = false
        customer_onboarding_enabled    = false
        webhook_intake_enabled         = false
        evidence_enabled               = false
        economic_contributions_enabled = false
        ai_dispatch_enabled            = false
      }
    }
  }
  expect_failures = [var.provider_bindings]
}

run "malformed_kms_resource_denied" {
  command = plan
  variables {
    provider_bindings = {
      square = {
        contract_version = "production_provider_isolation_v1"
        environment      = "production"
        application_id   = "sq0idp-production-placeholder"
        route_namespace  = "/api/integrations/square"
        callback_uri     = "https://square.vaeroex.com/api/integrations/square/callback"
        kms_key_resource = "garbage/vaeroex-integrations-prod/garbage/us-west1/keyRings/square-production/cryptoKeys/provider-credentials"
        secret_version_resources = {
          application = "projects/vaeroex-integrations-prod/secrets/square-application/versions/1"
        }
        service_accounts               = { broker = "square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com" }
        database_logins                = { broker = "square_production_broker" }
        source_commit                  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        enabled                        = false
        provider_calls_enabled         = false
        customer_onboarding_enabled    = false
        webhook_intake_enabled         = false
        evidence_enabled               = false
        economic_contributions_enabled = false
        ai_dispatch_enabled            = false
      }
    }
  }
  expect_failures = [terraform_data.validated_source_only_composition]
}

run "oversized_project_id_denied" {
  command = plan
  variables {
    platform = {
      contract_version = "production_integration_platform_v1"
      project_id       = "p${join("", [for i in range(30) : "x"])}"
      project_number   = "123456789012"
      region           = "us-west1"
      shared_resource_names = {
        network             = "vaeroex-integrations-production"
        subnet              = "vaeroex-integrations-us-west1"
        router              = "vaeroex-integrations-router"
        nat                 = "vaeroex-integrations-nat"
        egress_address      = "vaeroex-integrations-egress"
        ingress_address     = "vaeroex-integrations-ingress"
        task_queue          = "vaeroex-integrations-tasks"
        artifact_repository = "vaeroex-integrations-images"
      }
      database_authority_target    = "existing_production_postgres"
      runtime_policy_version       = "production_runtime_v1"
      retention_policy_version     = "production_retention_v1"
      observability_policy_version = "production_observability_v1"
      backup_policy_version        = "production_backup_v1"
      source_commit                = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      infrastructure_provisioned   = false
      runtime_enabled              = false
      economic_enabled             = false
      ai_dispatch_enabled          = false
    }
  }
  expect_failures = [var.platform]
}

run "oversized_kms_key_name_denied" {
  command = plan
  variables {
    provider_bindings = {
      square = {
        contract_version = "production_provider_isolation_v1"
        environment      = "production"
        application_id   = "sq0idp-production-placeholder"
        route_namespace  = "/api/integrations/square"
        callback_uri     = "https://square.vaeroex.com/api/integrations/square/callback"
        kms_key_resource = "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/${join("", [for i in range(64) : "x"])}"
        secret_version_resources = {
          application = "projects/vaeroex-integrations-prod/secrets/square-application/versions/1"
        }
        service_accounts               = { broker = "square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com" }
        database_logins                = { broker = "square_production_broker" }
        source_commit                  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        enabled                        = false
        provider_calls_enabled         = false
        customer_onboarding_enabled    = false
        webhook_intake_enabled         = false
        evidence_enabled               = false
        economic_contributions_enabled = false
        ai_dispatch_enabled            = false
      }
    }
  }
  expect_failures = [terraform_data.validated_source_only_composition]
}
