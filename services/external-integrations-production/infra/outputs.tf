output "review_manifest" {
  description = "Sanitized source-only composition; contains no credential values or deployable authorization."
  value       = terraform_data.validated_source_only_composition.output
}
