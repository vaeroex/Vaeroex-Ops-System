variable "zone" {
  description = "Verified compatible us-west1 zone; no capacity retry loop."
  type        = string
  nullable    = false
  validation {
    condition     = contains(["us-west1-a", "us-west1-b", "us-west1-c"], var.zone)
    error_message = "Select one verified us-west1 zone."
  }
}

variable "boot_image" {
  description = "Reviewed immutable Debian 13 image resource, never an image family."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^projects/debian-cloud/global/images/debian-13-trixie-v[0-9]{8}$", var.boot_image))
    error_message = "Supply the exact reviewed Debian 13 image resource."
  }
}

variable "administrative_access_enabled" {
  description = "Open expiring private administration only after the stopped instance identity is reviewed. This never starts the VM."
  type        = bool
  default     = false
  nullable    = false
}

variable "setup_https_enabled" {
  description = "Temporary package-download HTTPS egress; forbidden while private version-staging permissions are open."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.setup_https_enabled || var.administrative_access_enabled
    error_message = "Setup HTTPS requires the admitted administrative window."
  }
}

variable "temporary_access_enabled" {
  description = "Grant private version permissions only to the explicitly selected reviewed profiles after installation and restricted egress are verified."
  type        = bool
  default     = false
  nullable    = false
  validation {
    condition     = !var.temporary_access_enabled || (var.administrative_access_enabled && !var.setup_https_enabled)
    error_message = "Credential staging requires private administration and closed setup HTTPS."
  }
}

variable "temporary_access_profiles" {
  description = "Exact reviewed database-secret profiles admitted for this window; empty whenever temporary access is closed."
  type        = set(string)
  default     = []
  nullable    = false
  validation {
    condition = alltrue([
      for profile in var.temporary_access_profiles :
      contains(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"], profile)
    ])
    error_message = "Temporary access may target only the six reviewed database-secret profiles."
  }
  validation {
    condition = (
      var.temporary_access_enabled
      ? length(var.temporary_access_profiles) > 0
      : length(var.temporary_access_profiles) == 0
    )
    error_message = "Select at least one exact profile when temporary access is open, and none while it is closed."
  }
}

variable "window_starts_at" {
  description = "Exact UTC start of the separately admitted private maintenance window."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.window_starts_at)) && can(timeadd(var.window_starts_at, "0s"))
    error_message = "Supply an exact UTC RFC3339 start."
  }
}

variable "window_expires_at" {
  description = "Exact IAM expiry, more than zero and no more than 60 minutes after start."
  type        = string
  nullable    = false
  validation {
    condition = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$", var.window_expires_at)) && try(
      timecmp(var.window_expires_at, var.window_starts_at) > 0 &&
    timecmp(var.window_expires_at, timeadd(var.window_starts_at, "60m")) <= 0, false)
    error_message = "The exact UTC expiry must follow start by at most 60 minutes."
  }
}

variable "verified_pooler_ipv4_cidrs" {
  description = "Current verified Production session-pooler IPv4 endpoints, each expressed as /32. No direct endpoint or broad range."
  type        = set(string)
  nullable    = false
  validation {
    condition = length(var.verified_pooler_ipv4_cidrs) > 0 && length(var.verified_pooler_ipv4_cidrs) <= 8 && alltrue([
      for cidr in var.verified_pooler_ipv4_cidrs :
      can(cidrnetmask(cidr)) && can(regex("^[0-9.]+/32$", cidr))
    ])
    error_message = "Supply one to eight independently verified IPv4 /32 pooler endpoints."
  }
}
