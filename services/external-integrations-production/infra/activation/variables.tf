variable "project_id" {
  type = string
  validation {
    condition     = var.project_id == "vaeroex-integrations-prod"
    error_message = "Activation is pinned to the isolated Production integrations project."
  }
}

variable "region" {
  type    = string
  default = "us-west1"
  validation {
    condition     = var.region == "us-west1"
    error_message = "The reviewed Production platform is single-region us-west1."
  }
}

variable "source_commit" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.source_commit))
    error_message = "source_commit must be an exact full Git SHA."
  }
}

variable "callback_edge_source_commit" {
  type     = string
  default  = null
  nullable = true
  validation {
    condition = (
      var.callback_edge_source_commit == null ||
      can(regex("^[a-f0-9]{40}$", var.callback_edge_source_commit))
    )
    error_message = "callback_edge_source_commit must be null or an exact full Git SHA."
  }
}

variable "oauth_callback_source_commit" {
  type     = string
  default  = null
  nullable = true
  validation {
    condition = (
      var.oauth_callback_source_commit == null ||
      can(regex("^[a-f0-9]{40}$", var.oauth_callback_source_commit))
    )
    error_message = "oauth_callback_source_commit must be null or an exact full Git SHA."
  }
}

variable "operator_email" {
  type    = string
  default = "isaac@vaeroex.com"
  validation {
    condition     = var.operator_email == "isaac@vaeroex.com"
    error_message = "The reviewed Production operator identity is exact."
  }
}

variable "alert_email" {
  type    = string
  default = "isaac@vaeroex.com"
  validation {
    condition     = var.alert_email == "isaac@vaeroex.com"
    error_message = "The reviewed Production alert recipient is exact."
  }
}

variable "bootstrap_image_digest" {
  type      = string
  default   = null
  nullable  = true
  sensitive = false
  validation {
    condition = (
      var.bootstrap_image_digest == null ||
      can(regex("^us-west1-docker\\.pkg\\.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:[a-f0-9]{64}$", var.bootstrap_image_digest))
    )
    error_message = "The bootstrap image must be an immutable digest in the reviewed Production repository."
  }
}

variable "internal_consent" {
  description = "Separately reviewed one-seller consent deployment; null preserves the dormant services. Public configuration/references only, never secret values."
  type = object({
    image_digest             = string
    source_commit            = string
    broker_origin            = string
    permit                   = any
    database_versions        = object({ oauth = number, broker = number })
    database_ca              = string
    supabase_publishable_key = string
  })
  default  = null
  nullable = true
  validation {
    condition = var.internal_consent == null ? true : (
      can(regex("^us-west1-docker\\.pkg\\.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-internal-consent@sha256:[a-f0-9]{64}$", var.internal_consent.image_digest)) &&
      can(regex("^[a-f0-9]{40}$", var.internal_consent.source_commit)) &&
      var.internal_consent.broker_origin == "https://square-production-broker-u5c6zahmpq-uw.a.run.app" &&
      var.internal_consent.database_versions.oauth >= 1 && floor(var.internal_consent.database_versions.oauth) == var.internal_consent.database_versions.oauth &&
      var.internal_consent.database_versions.broker >= 1 && floor(var.internal_consent.database_versions.broker) == var.internal_consent.database_versions.broker &&
      sha256(var.internal_consent.database_ca) == "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"
    )
    error_message = "Internal consent requires the reviewed immutable image/source, exact existing broker, numeric OAuth/broker versions and pinned public database CA."
  }
}

variable "oauth_callback_image_digest" {
  type      = string
  default   = null
  nullable  = true
  sensitive = false
  validation {
    condition = (
      var.oauth_callback_image_digest == null ||
      can(regex("^us-west1-docker\\.pkg\\.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:[a-f0-9]{64}$", var.oauth_callback_image_digest))
    )
    error_message = "The OAuth callback image must be an immutable disabled-bootstrap digest in the reviewed Production repository."
  }
}

variable "callback_edge_image_digest" {
  type      = string
  default   = null
  nullable  = true
  sensitive = false
  validation {
    condition = (
      var.callback_edge_image_digest == null ||
      can(regex("^us-west1-docker\\.pkg\\.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:[a-f0-9]{64}$", var.callback_edge_image_digest))
    )
    error_message = "The callback edge must be an immutable digest in the reviewed Production repository."
  }
}

variable "production_hostname" {
  type    = string
  default = "square.vaeroex.com"
  validation {
    condition     = var.production_hostname == "square.vaeroex.com"
    error_message = "The Square Production ingress host is exact."
  }
}

variable "runtime_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.runtime_enabled
    error_message = "The bootstrap activation cannot enable a provider runtime."
  }
}

variable "provider_calls_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.provider_calls_enabled
    error_message = "Provider calls remain structurally disabled."
  }
}

variable "customer_onboarding_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.customer_onboarding_enabled
    error_message = "Customer onboarding remains structurally disabled."
  }
}

variable "webhook_intake_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.webhook_intake_enabled
    error_message = "Webhook intake remains structurally disabled."
  }
}

variable "economic_contributions_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.economic_contributions_enabled
    error_message = "Economic contributions remain structurally disabled."
  }
}

variable "ai_dispatch_enabled" {
  type    = bool
  default = false
  validation {
    condition     = !var.ai_dispatch_enabled
    error_message = "AI dispatch remains structurally disabled."
  }
}
