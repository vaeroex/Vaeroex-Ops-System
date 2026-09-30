variable "source_commit" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.source_commit))
    error_message = "Pin the reviewed source commit."
  }
}

variable "image_digest" {
  type = string
  validation {
    condition     = can(regex("^us-central1-docker[.]pkg[.]dev/vaeroex-qbo-prod-20260827/qbo-production/runtime@sha256:[a-f0-9]{64}$", var.image_digest))
    error_message = "Pin the reviewed Production runtime image digest."
  }
}

variable "callback_edge_image_digest" {
  type = string
  validation {
    condition     = can(regex("^us-central1-docker[.]pkg[.]dev/vaeroex-qbo-prod-20260827/qbo-production/callback-edge@sha256:[a-f0-9]{64}$", var.callback_edge_image_digest))
    error_message = "Pin the reviewed Production callback edge image digest."
  }
}
