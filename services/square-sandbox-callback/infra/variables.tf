variable "deployment_authorized" {
  description = "Separate action-time deployment authorization, not the approved cost envelope. Keep false for code-only delivery."
  type        = bool
  default     = false
  validation {
    condition     = var.deployment_authorized
    error_message = "Code-only delivery: deployment has not been authorized."
  }
}

variable "approval_expires_at" {
  description = "Exact approved UTC expiry; required, with no invented default. Access expiry does not delete resources or data."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.approval_expires_at)) && can(timeadd(var.approval_expires_at, "0s"))
    error_message = "Supply the approved, valid second-precision UTC expiry."
  }
}

variable "billing_account_id" {
  description = "Verified existing USD billing account ID; no billing-account creation or project relinking."
  type        = string
  validation {
    condition     = can(regex("^[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}$", var.billing_account_id))
    error_message = "Supply the verified billing account ID, not a placeholder."
  }
}

variable "budget_notification_channels" {
  description = "One to five verified existing email notification-channel resource names in this Sandbox project; recipients must confirm delivery before qualification."
  type        = set(string)
  validation {
    condition = length(var.budget_notification_channels) >= 1 && length(var.budget_notification_channels) <= 5 && alltrue([
      for channel in var.budget_notification_channels : can(regex("^projects/(vaeroex-square-sandbox|112579468800)/notificationChannels/[0-9]+$", channel))
    ])
    error_message = "Verified Sandbox email notification channels are required; do not invent IDs."
  }
}

variable "ubuntu_image" {
  description = "Reviewed non-Pro Ubuntu 24.04 LTS x86_64 image self-link pinned to an exact dated image, never an image family. Verify supported patch status before hosting."
  type        = string
  validation {
    condition     = can(regex("^projects/ubuntu-os-cloud/global/images/ubuntu-2404-noble-amd64-v[0-9]{8}$", var.ubuntu_image))
    error_message = "Supply an independently verified, exact dated Ubuntu 24.04 non-Pro image."
  }
}

variable "zone" {
  description = "Exact Oregon zone supported by the native binding and database contract."
  type        = string
  validation {
    condition     = contains(["us-west1-a", "us-west1-b", "us-west1-c"], var.zone)
    error_message = "Only the explicitly supported Oregon zones are permitted; each replacement needs its own verified VM identity binding."
  }
}

variable "operator_ipv4_cidrs" {
  description = "Verified operator IPv4 /32 addresses allowed to reach HTTPS; ACME HTTP-01 alone must be public. No public SSH."
  type        = set(string)
  validation {
    condition = length(var.operator_ipv4_cidrs) >= 1 && length(var.operator_ipv4_cidrs) <= 4 && alltrue([
      for cidr in var.operator_ipv4_cidrs : can(cidrnetmask(cidr)) && endswith(cidr, "/32")
    ])
    error_message = "Supply one to four exact operator IPv4 /32 addresses."
  }
}

variable "database_ipv4_cidrs" {
  description = "Verified isolated Supabase TLS endpoint IPv4 /32 addresses; review changes explicitly. No Production endpoint."
  type        = set(string)
  validation {
    condition = length(var.database_ipv4_cidrs) >= 1 && length(var.database_ipv4_cidrs) <= 8 && alltrue([
      for cidr in var.database_ipv4_cidrs : can(cidrnetmask(cidr)) && endswith(cidr, "/32")
    ])
    error_message = "Supply one to eight verified isolated database IPv4 /32 addresses."
  }
}

variable "database_port" {
  description = "Actual verified isolated TLS database endpoint port; session semantics must satisfy the database qualification."
  type        = number
  validation {
    condition     = contains([5432, 6543], var.database_port)
    error_message = "Only the independently qualified isolated endpoint port is allowed."
  }
}

variable "enable_ingress" {
  description = "Keep false until guest setup and local/hosted privacy prerequisites permit synthetic testing. This is not live OAuth authority."
  type        = bool
  default     = false
}
