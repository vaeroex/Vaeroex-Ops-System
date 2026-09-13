locals {
  all_application_ids = [for binding in values(var.provider_bindings) : binding.application_id]
  all_kms_keys        = [for binding in values(var.provider_bindings) : binding.kms_key_resource]
  all_callbacks       = [for binding in values(var.provider_bindings) : binding.callback_uri]
  all_secret_versions = flatten([
    for binding in values(var.provider_bindings) : values(binding.secret_version_resources)
  ])
  all_service_accounts = flatten([
    for binding in values(var.provider_bindings) : values(binding.service_accounts)
  ])
  all_database_logins = flatten([
    for binding in values(var.provider_bindings) : values(binding.database_logins)
  ])
}

resource "terraform_data" "validated_source_only_composition" {
  input = {
    contract_version = var.platform.contract_version
    project_id       = var.platform.project_id
    project_number   = var.platform.project_number
    region           = var.platform.region
    source_commit    = var.platform.source_commit
    providers        = sort(keys(var.provider_bindings))
    shared_resources = var.platform.shared_resource_names
    gates = {
      infrastructure = var.platform.infrastructure_provisioned
      runtime        = var.platform.runtime_enabled
      economic       = var.platform.economic_enabled
      ai             = var.platform.ai_dispatch_enabled
    }
  }

  lifecycle {
    precondition {
      condition = (
        length(distinct(local.all_application_ids)) == length(local.all_application_ids) &&
        length(distinct(local.all_kms_keys)) == length(local.all_kms_keys) &&
        length(distinct(local.all_callbacks)) == length(local.all_callbacks) &&
        length(distinct(local.all_secret_versions)) == length(local.all_secret_versions) &&
        length(distinct(local.all_service_accounts)) == length(local.all_service_accounts) &&
        length(distinct(local.all_database_logins)) == length(local.all_database_logins)
      )
      error_message = "Provider credentials, callbacks, identities and database authority must never overlap."
    }
    precondition {
      condition = alltrue([
        for provider, binding in var.provider_bindings :
        startswith(binding.kms_key_resource, "projects/${var.platform.project_id}/locations/${var.platform.region}/") &&
        can(regex("^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/locations/[a-z]+-[a-z]+[0-9]/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$", binding.kms_key_resource)) &&
        alltrue([for value in values(binding.secret_version_resources) :
          startswith(value, "projects/${var.platform.project_id}/secrets/") &&
          can(regex("^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}/versions/[1-9][0-9]*$", value)) &&
        !endswith(value, "/latest")]) &&
        alltrue([for value in values(binding.service_accounts) :
          can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\\.iam\\.gserviceaccount\\.com$", value)) &&
        endswith(value, "@${var.platform.project_id}.iam.gserviceaccount.com")]) &&
        alltrue([for value in values(binding.database_logins) :
        length(value) <= 63 && can(regex("^[a-z][a-z0-9_]*$", value)) && startswith(value, "${provider}_production_")]) &&
        binding.source_commit == var.platform.source_commit
      ])
      error_message = "A provider binding escaped its project, region, version or provider namespace."
    }
  }
}
