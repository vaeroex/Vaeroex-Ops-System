variable "region" {
  type = string
}

variable "source_commit" {
  type = string
}

variable "oauth_callback_hostname" {
  type = string
}

variable "oauth_callback_uri" {
  type = string
}

variable "callback_edge_image_digest" {
  type = string
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

variable "oauth_ingress_service_name" {
  type = string
}
