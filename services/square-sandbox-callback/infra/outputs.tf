output "callback_instance_id" {
  description = "Nonsecret provider-assigned ID. Requires later exact DB host approval; not itself authority."
  value       = google_compute_instance.callback.instance_id
}

output "callback_ipv4" {
  description = "Nonsecret DNS-only target. This template makes no DNS change."
  value       = google_compute_address.callback.address
}

output "database_secret_reference" {
  description = "Planned immutable reference only; this template never creates or accesses its payload."
  value       = "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1"
}
