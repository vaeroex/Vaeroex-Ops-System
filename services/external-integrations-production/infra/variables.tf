variable "platform" {
  type = object({
    contract_version             = string
    project_id                   = string
    project_number               = string
    region                       = string
    shared_resource_names        = map(string)
    database_authority_target    = string
    runtime_policy_version       = string
    retention_policy_version     = string
    observability_policy_version = string
    backup_policy_version        = string
    source_commit                = string
    infrastructure_provisioned   = bool
    runtime_enabled              = bool
    economic_enabled             = bool
    ai_dispatch_enabled          = bool
  })
  validation {
    condition = (
      var.platform.contract_version == "production_integration_platform_v1" &&
      can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.platform.project_id)) &&
      length(regexall("(?i)(sandbox|preview|qualification)", var.platform.project_id)) == 0 &&
      can(regex("^[1-9][0-9]{5,19}$", var.platform.project_number)) &&
      can(regex("^[a-z]+-[a-z]+[0-9]$", var.platform.region)) &&
      var.platform.database_authority_target == "existing_production_postgres" &&
      can(regex("^[a-f0-9]{40}$", var.platform.source_commit)) &&
      !var.platform.infrastructure_provisioned && !var.platform.runtime_enabled &&
      !var.platform.economic_enabled && !var.platform.ai_dispatch_enabled
    )
    error_message = "The source-only Production platform must be exact and fully dormant."
  }
  validation {
    condition = (
      toset(keys(var.platform.shared_resource_names)) == toset([
        "network", "subnet", "router", "nat", "egress_address", "ingress_address", "task_queue", "artifact_repository"
      ]) &&
      length(distinct(values(var.platform.shared_resource_names))) == 8 &&
      alltrue([for value in values(var.platform.shared_resource_names) :
      can(regex("^[a-z][a-z0-9-]{0,61}[a-z0-9]$", value))])
    )
    error_message = "Exactly eight distinct shared platform resource names are required."
  }
}

variable "provider_bindings" {
  type = map(object({
    contract_version               = string
    environment                    = string
    application_id                 = string
    route_namespace                = string
    callback_uri                   = string
    kms_key_resource               = string
    secret_version_resources       = map(string)
    service_accounts               = map(string)
    database_logins                = map(string)
    source_commit                  = string
    enabled                        = bool
    provider_calls_enabled         = bool
    customer_onboarding_enabled    = bool
    webhook_intake_enabled         = bool
    evidence_enabled               = bool
    economic_contributions_enabled = bool
    ai_dispatch_enabled            = bool
  }))
  validation {
    condition = length(var.provider_bindings) > 0 && alltrue([
      for provider, binding in var.provider_bindings :
      can(regex("^[a-z][a-z0-9_]{0,63}$", provider)) &&
      binding.contract_version == "production_provider_isolation_v1" &&
      binding.environment == "production" &&
      can(regex("^[A-Za-z0-9._-]{8,512}$", binding.application_id)) &&
      binding.route_namespace == "/api/integrations/${replace(provider, "_", "-")}" &&
      can(regex("^https://[a-z0-9.-]+${binding.route_namespace}/callback$", binding.callback_uri)) &&
      can(regex("^https://[^/]+\\.[^/]+/", binding.callback_uri)) &&
      length(regexall("(?i)(sandbox|preview|localhost|sslip\\.io)", binding.callback_uri)) == 0 &&
      length(regexall("^https://[0-9]+(?:\\.[0-9]+){3}/", binding.callback_uri)) == 0 &&
      length(regexall("\\.\\.", binding.callback_uri)) == 0 &&
      can(regex("^[a-f0-9]{40}$", binding.source_commit)) &&
      length(binding.secret_version_resources) > 0 && length(binding.service_accounts) > 0 &&
      length(binding.database_logins) > 0 &&
      !binding.enabled && !binding.provider_calls_enabled && !binding.customer_onboarding_enabled &&
      !binding.webhook_intake_enabled && !binding.evidence_enabled &&
      !binding.economic_contributions_enabled && !binding.ai_dispatch_enabled
    ])
    error_message = "Every provider binding must have an exact Production namespace and all gates closed."
  }
}
