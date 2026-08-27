variable "project_id" {
  type = string
}

variable "region" {
  type = string
  validation {
    condition     = var.region == "us-central1"
    error_message = "The Production QBO runtime must remain in us-central1."
  }
}

variable "image_digest" {
  type = string
  validation {
    condition     = can(regex("^[^@]+@sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "image_digest must be an immutable sha256 image reference."
  }
}

variable "source_commit" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.source_commit))
    error_message = "source_commit must be a full Git commit SHA."
  }
}

variable "service_names" {
  type = object({
    oauth_ingress     = string
    credential_broker = string
    task_scheduler    = string
    task_dispatcher   = string
    provider_runtime  = string
  })
  validation {
    condition = alltrue([
      for name in values(var.service_names) :
      can(regex("^[a-z][a-z0-9-]{0,62}$", name)) &&
      length(regexall("(?i)(phase8b|p8b|canary|sandbox)", name)) == 0
    ])
    error_message = "Production service names may not use qualification resource names."
  }
}

variable "service_origins" {
  type = object({
    credential_broker = string
    provider_runtime  = string
    task_scheduler    = string
    task_dispatcher   = string
  })
  validation {
    condition = alltrue([
      for origin in values(var.service_origins) :
      can(regex("^https://[A-Za-z0-9.-]+$", origin)) &&
      length(regexall("(?i)(phase8b|p8b|canary|sandbox|sslip\\.io)", origin)) == 0
    ])
    error_message = "Service origins must be exact Production HTTPS origins."
  }
}

variable "application_origin" {
  type = string
  validation {
    condition = (
      can(regex("^https://[A-Za-z0-9.-]+$", var.application_origin)) &&
      length(regexall("(?i)(phase8b|p8b|canary|sandbox|sslip\\.io)", var.application_origin)) == 0
    )
    error_message = "application_origin must be the exact Production application origin."
  }
}

variable "oauth_callback_uri" {
  type = string
  validation {
    condition = (
      can(regex("^https://[A-Za-z0-9.-]+/oauth/callback$", var.oauth_callback_uri)) &&
      length(regexall("(?i)(phase8b|p8b|canary|sandbox|sslip\\.io)", var.oauth_callback_uri)) == 0
    )
    error_message = "oauth_callback_uri must be the exact Production callback URI."
  }
}

variable "oauth_callback_hostname" {
  type = string
  validation {
    condition = (
      can(regex("^[A-Za-z0-9.-]+$", var.oauth_callback_hostname)) &&
      length(regexall("(?i)(phase8b|p8b|canary|sandbox|sslip\\.io)", var.oauth_callback_hostname)) == 0
    )
    error_message = "oauth_callback_hostname must be a permanent Production hostname."
  }
}

variable "callback_edge_image_digest" {
  type = string
  validation {
    condition     = can(regex("^[^@]+@sha256:[a-f0-9]{64}$", var.callback_edge_image_digest))
    error_message = "callback_edge_image_digest must be an immutable sha256 image reference."
  }
}

variable "callback_address_name" {
  type = string
}

variable "callback_certificate_name" {
  type = string
}

variable "callback_neg_name" {
  type = string
}

variable "callback_backend_name" {
  type = string
}

variable "callback_url_map_name" {
  type = string
}

variable "callback_https_proxy_name" {
  type = string
}

variable "callback_forwarding_rule_name" {
  type = string
}

variable "callback_wasm_plugin_name" {
  type = string
}

variable "callback_edge_extension_name" {
  type = string
}

variable "queue_name" {
  type = string
  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{0,62}$", var.queue_name)) &&
      length(regexall("(?i)(phase8b|p8b|canary|sandbox)", var.queue_name)) == 0
    )
    error_message = "queue_name must be a permanent Production queue name."
  }
}

variable "scheduler_name" {
  type = string
}

variable "initialization_scheduler_name" {
  type = string
}

variable "database_secret_ids" {
  type = object({
    oauth_ingress     = string
    credential_broker = string
    task_scheduler    = string
    task_dispatcher   = string
    provider_runtime  = string
  })
}

variable "database_secret_versions" {
  type = object({
    oauth_ingress     = string
    credential_broker = string
    task_scheduler    = string
    task_dispatcher   = string
    provider_runtime  = string
  })
  validation {
    condition = alltrue([
      for version in values(var.database_secret_versions) :
      can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "Database secret versions must be explicit numeric versions."
  }
}

variable "provider_secret_id" {
  type = string
}

variable "provider_secret_version" {
  type = string
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.provider_secret_version))
    error_message = "Provider credentials must use an explicit Secret Manager version."
  }
}

variable "webhook_secret_id" {
  type = string
}

variable "webhook_secret_version" {
  type = string
  validation {
    condition     = can(regex("^[1-9][0-9]*$", var.webhook_secret_version))
    error_message = "Webhook verifier must use an explicit Secret Manager version."
  }
}

variable "kms_key_resource" {
  type = string
  validation {
    condition = can(regex(
      "^projects/[a-z][a-z0-9-]{4,28}/locations/[a-z0-9-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+$",
      var.kms_key_resource
    ))
    error_message = "kms_key_resource must identify one exact KMS CryptoKey."
  }
}

variable "dispatcher_schedule" {
  type    = string
  default = "*/5 * * * *"
}

variable "maximum_dispatch_tasks" {
  type    = number
  default = 50
  validation {
    condition     = var.maximum_dispatch_tasks >= 1 && var.maximum_dispatch_tasks <= 100
    error_message = "maximum_dispatch_tasks must be between 1 and 100."
  }
}

variable "initialization_scheduler_schedule" {
  type    = string
  default = "*/5 * * * *"
}

variable "maximum_initialization_connections" {
  type    = number
  default = 5
  validation {
    condition = (
      var.maximum_initialization_connections >= 1 &&
      var.maximum_initialization_connections <= 25
    )
    error_message = "maximum_initialization_connections must be between 1 and 25."
  }
}
