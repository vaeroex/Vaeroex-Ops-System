> Historical checkpoint. Current status is [QUALIFICATION.md](QUALIFICATION.md). Later approved captures resolved the database metadata gaps listed here, and native synthetic fence/privacy-erasure CI passed. Statements below about missing wiring, pending metadata, or unrun synthetic races describe that earlier checkpoint, not current status. Installed writer composition and live model quality are separate.

# Reachability qualification checkpoint

Local analysis only. No production changes, provider calls, publication or workflow dispatch. Runtime remains disabled.

The 57 helper names and 42 additional relation names are not 99 new generation dependencies. Their branches differ; no additional fence is justified merely by a lexical reference.

## Function branches

### platform

JWT accessors are reached by the existing authority wrappers. Fixture simulates claims; no additional production accessor-body request or new fence justified.

- `auth.jwt`
- `auth.role`
- `auth.uid`

### direct authority

Reached directly or through existing RLS/insert/update enforcement during authorized read, save, reopen, or saved-copy paths. Preserve installed live session and entitlement restrictions. Need exact helper closure before claiming full composition.

- `private.current_auth_session_live_v1`
- `private.google_sheets_allowed_source_v1`
- `private.workspace_entitlement_active_v1`
- `private.workspace_mutation_entitled_v1`
- `private.workspace_persisted_limit_v1`
- `public.can_contribute_workspace`
- `public.can_manage_workspace`
- `public.workspace_member_role`

### erasure retention writer

Concurrent lifecycle writer, not invoked by AI generation. Must qualify revocation/retention interference. Existing affected source/root/privacy tables are fenced or locked; no fence inferred from helper name.

- `private.google_sheets_erasure_hash_v1`
- `private.google_sheets_register_connection_metadata_v1`
- `private.google_sheets_register_retention_v1`
- `private.retire_google_sheets_facts_v1`

### qbo writer

Provider validation, promotion, mapping or connection lifecycle branch; not a provider fetch from reasoning. Qualify actual relevant writer transaction against existing source/connection/validation-work fence. Pure hashing/serialization helpers within this group can be reconstructed from repo, fingerprint first.

- `private.assert_integration_control_plane_authority_v1`
- `private.assert_integration_provider_source_authority_v1`
- `private.commit_provider_external_source_before_validation_v1`
- `private.invalidate_qbo_accounting_source_v1`
- `private.phase_3_contract_fingerprint_v1`
- `private.phase_8b_source_version_json_v1`
- `private.qbo_accounting_inactive_reference_v1`
- `private.qbo_pending_intent_lock_v1`
- `private.qbo_pending_is_unconsented_v1`
- `private.qbo_pending_name_v1`
- `private.qbo_phase_8b_realm_fingerprint_v1`
- `private.qbo_production_source_has_effects_v1`
- `private.sha256_fingerprint_bytes_v1`
- `private.validate_source_version_payload_v1`
- `public.upsert_integration_workspace_policy_v1`

### square writer

Square backend ingest/map/disconnect branch dependency. Candidate reads stored payment/connection rows directly under owner admission; it does not invoke backend connect/credential operations.

- `private.square_production_customer_require_eligible_v1`
- `private.square_production_customer_require_keys_v1`

### file writer

File import/extraction update and review-provenance trigger branch. Candidate only reads approved stored facts; source status/review changes must invalidate final settlement. Storage and circuit operations do not become reasoning reads.

- `private.workspace_storage_lock_v1`
- `public.can_edit_operations`
- `public.recompute_document_extraction_circuit_v2`
- `public.record_document_extraction_event_v1`
- `public.validate_document_extraction_critical_field_manifest_v1`
- `public.validate_document_extraction_critical_field_manifest_v2`
- `public.validate_google_document_extraction_manifest_v3`

### shared role authority

Shared role authority: repository `can_manage_workspace` calls `has_workspace_role`, in addition to the captured timezone-setting guard. Include it in that root’s dependency hash manifest; installed transitive reachability awaits the caller contract. No new generation API or automatic fence expansion.

- `public.has_workspace_role`

### pure validation

Pure value/check validation on source or control-plane DML, not an independent data source. Reconstruct repository definition and verify fingerprint where the tested branch reaches it; no write fence required.

- `private.is_bounded_identifier_array_v1`
- `private.is_bounded_identifier_v1`
- `private.is_bounded_label_v1`
- `private.is_currency_code_v1`
- `private.is_integration_connection_reason_v1`
- `private.is_integration_connection_transition_v1`
- `private.is_phase_4_capability_snapshot_v1`
- `private.is_phase_4_provider_descriptor_v1`
- `private.is_phase_4_scope_set_v1`
- `private.is_phase_8a0_capability_snapshot_v1`
- `private.is_phase_8a0_provider_descriptor_v1`
- `private.is_phase_8a0_provider_environment_v1`
- `private.is_phase_8a0_scope_set_v1`
- `private.is_provider_entity_mapping_transition_v1`
- `private.is_sha256_fingerprint_v1`
- `private.is_source_validation_issues_v1`
- `private.is_time_zone_v1`

## Relation branches

### direct locked authority

Existing captured owner/session helper holds FOR SHARE on account/session/member. Do not add a workspace trigger to global auth tables. Verify metadata and actual revocation/deletion race using existing locks.

- `auth.sessions`
- `auth.users`

### direct save accounting

Used by final settlement, billing, capacity guard or transaction claim. Need exact schema/constraints/bindings for relevant settlement branch. Not plugin evidence; do not broaden service grants or create exemptions. Determine existing serialization before adding locks.

- `private.ai_run_actor_authorizations`
- `private.platform_admin_subscription_exemptions`
- `private.trusted_derived_run_commits`
- `public.customer_subscriptions`
- `public.vsi_cost_events`

### direct eligibility

Sync run queried by Sheets readability (conditional on table discriminator); intake request consulted by file-state writer guard. Reuse current source/file/privacy invalidation boundary; exact contract needed only for exercised branch.

- `public.google_sheets_sync_runs`
- `public.document_extraction_intake_requests`

### erasure capability

Private per-transaction capability checked by captured erasure guard. Never expose to model. Need shape/issuing contract for actual erasure writer qualification; no workspace fence inferred for ephemeral capabilities.

- `private.google_sheets_erasure_capabilities`

### qbo writer only

Validation/promotion/control-plane transaction dependency; not selected by candidate typed QBO reader. Assemble relevant writer branch locally. Effects touch already-fenced source/connection/mapping/validation rows; no automatic expansion.

- `private.business_fact_sources`
- `private.canonical_business_fact_versions`
- `private.fact_contribution_events`
- `private.reconciliation_cases`
- `private.integration_audit_events`
- `private.integration_qbo_runtime_configurations`
- `private.integration_sync_tasks`
- `private.integration_workspace_policies`
- `private.qbo_accounting_source_applications`

### other qbo reader

Used by accounting-authority browse RPC, not candidate qbo_version reader. Candidate reads protected stored source version, mapping and validation-work status. Exclude this alternate read API from generation qualification unless wiring changes.

- `private.qbo_accounting_authority_versions`

### control plane cleanup

OAuth/credential/config/checkpoint branch supporting existing writer or disconnect. No row values needed. Only relevant branch schema constraints/FKs and trigger effects are needed to exercise synthetic writer transaction; not AI evidence or a new fence target.

- `private.integration_credentials`
- `private.integration_reauthorization_states`
- `private.integration_sync_checkpoints`
- `private.integration_webhook_events`
- `public.loyverse_credentials`
- `public.loyverse_oauth_states`
- `public.reporting_oauth_states`
- `public.wix_order_credentials`
- `public.wix_order_install_states`
- `public.zoho_books_credentials`
- `public.zoho_books_oauth_states`
- `square_customer_private.configuration`
- `square_customer_private.oauth_states`

### credential lifecycle

Katana generation isolation is invalidated by existing candidate trigger on reporting credential lifecycle (draft09); no credential contents selected for reasoning. Test nonce rotation/deletion with synthetic values, preserve private access.

- `public.reporting_credentials`

### file writer only

Upload/import guard or publication workflow dependency. Reasoning consumes only already-approved chunks/notes. Qualify state-change effects through fenced file/review rows; no storage content or blanket storage fence.

- `private.workspace_legacy_upload_attestations`
- `private.workspace_upload_reservations`
- `public.file_import_rows`
- `storage.objects`

### legacy summary writer

Zoho history writer side effect; candidate consumes history_facts/history_coverage, not daily_summaries. No standalone generation dependency or fence justified.

- `public.zoho_books_daily_summaries`

### foreign key only

Only foreign-key target in captured graph, not proven semantic dependency. Preserve cascade/restrict action in fixture; do not add fence solely for FK reachability.

- `private.integration_sync_runs`
- `public.profiles`
- `public.record_folders`

## Confirmed corrections and bounded evidence

- The composed QBO validation definition matches the capture after applying the existing accounting-intake migration’s v1/v2 tombstone allowance. The earlier original-CREATE comparison was incomplete; do not revert this allowance or call it unexplained drift.
- The installed membership predicate additionally requires `private.current_auth_session_live_v1()`. Its captured wrapper is preserved. The newly approved bounded audit retrieved the screened helper privately. Three repository-backed callers also add this live-session predicate; four match, as does the separate has_workspace_role dependency. Private definitions are not publication fixtures.
- Captured Sheets readability and operational-source functions now run in the local typed-reader qualification. Blocked workspace and expired root cases fail closed.
- Independent review found no stale-save bypass from erasure guard `aa_` preceding write fence `aaa_`. A guard rejection prevents mutation; a pass still reaches the fence. No rename is warranted.
- A privacy-lock / write-fence inversion can abort erasure with 40001 and release locks on rollback. Native verification of that full sequence remains outstanding. The new local test injects contention and uses a synthetic hash; it does not claim a native race or deployed erasure orchestration match.

## Bounded metadata request — completed after separate approval

One read-only request, limited to the following release-critical closure, with no customer rows, credentials, configuration values or mutations:

1. Signature, ACL, security-definer/search-path metadata and normalized definition fingerprints for the eight direct-authority helpers listed above. Retrieve the missing `private.current_auth_session_live_v1()` body; reconstruct the other seven from repository migrations and retrieve their bodies only if fingerprints differ. Use existing captures for callers. Request only a name/signature/hash dependency manifest for further private helper calls; fetch a body only if its reachable branch cannot be reconstructed from the repository or its fingerprint differs.
2. Relation columns, constraints, policies and trigger bindings for `auth.sessions`, `auth.users`, the five direct-save-accounting relations, `public.google_sheets_sync_runs`, `public.document_extraction_intake_requests`, and `private.google_sheets_erasure_capabilities`. Auth schemas need only columns/constraints used by the captured owner/session predicates, not unrelated account data.
3. For the already identified writer helpers, first compare normalized definition hashes against reconstructed repository definitions. Only mismatching/missing definitions on the concrete source-write, disconnect, erasure, file review/publication and settlement branches need body retrieval. Do not request all OAuth/configuration bodies or add all 42 relations to the fence. Exact writer fixture dependencies not already captured should be listed by name before any expanded body/schema read.

This bounded audit subsequently received approval and completed. No new dependencies were fetched beyond the eight helpers, the has_workspace_role fingerprint check, and ten relations. Only the missing session helper and three mismatched caller bodies were retrieved after screening; they remain private. Provider configuration attestation remains separately blocked by the prior Vercel denial; this request does not cover that service.

## Release blockers

- The bounded eight-helper/ten-relation inspection is complete; full trigger/writer composition is not yet qualified. Existing source guards must remain enforced; no service-role bypass or v1 grant restoration.
- Real multi-session erasure/privacy/fence and installed provider-writer races have not run. The earlier native CI tested the fence with synthetic writers, not full deployed ingestion.
- Live provider policy/configuration and real answer quality with owner-approved eligible data remain unverified. Mocked five-plugin + file + note acceptance is application-path evidence only.
- No activation, schema application or deployment is authorized by this local checkpoint. Public-document cleanup remains pending separately.
