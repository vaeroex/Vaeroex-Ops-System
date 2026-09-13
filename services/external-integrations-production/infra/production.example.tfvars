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
      webhook     = "projects/vaeroex-integrations-prod/secrets/square-webhook/versions/1"
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
