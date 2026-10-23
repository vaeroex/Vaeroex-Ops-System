-- LOCAL REVIEW DRAFT ONLY. Storage foundation; partial admission is in 05.
-- Do not register/apply without the protected functions and trigger contracts in
-- README.md. No application role can read or mutate these tables directly.
begin;
create table private.shared_evidence_manifests (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 actor_id uuid not null,
 session_id uuid not null,
 target_kind text not null check(target_kind in ('vsi_request','briefing_run')),
 target_id uuid not null,
 attempt integer not null check(attempt>0),
 google_sheets_read_ticket_id uuid not null,
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),
 parser_contract text not null check(parser_contract='shared_evidence_v1'),
 sealed_at timestamptz not null default now(),
 unique(workspace_id,target_kind,target_id,attempt),
 unique(workspace_id,id)
);
create table private.shared_evidence_manifest_sources (
 workspace_id uuid not null,
 manifest_id uuid not null,
 ordinal integer not null check(ordinal>=0),
 source_kind text not null check(source_kind in ('legacy_reference','qbo_version','square_payment','sheets_ticket_source','approved_file_fact','approved_note','inherited_artifact')),
 original_identity jsonb not null check(jsonb_typeof(original_identity)='object'),
 authority_hash text not null check(authority_hash ~ '^[a-f0-9]{64}$'),
 primary key(manifest_id,ordinal),
 foreign key(workspace_id,manifest_id) references private.shared_evidence_manifests(workspace_id,id) on delete cascade
);
-- Exact typed original_identity variants are documented in README and must be
-- constructed by protected dispatch, never accepted as caller-authorized JSON.
-- Hashing an unverified caller payload is NOT source authorization.
create table private.shared_evidence_artifact_manifests (
 workspace_id uuid not null,
 artifact_kind text not null check(artifact_kind in ('vsi_exchange','vsi_conversation_context','briefing_run','report')),
 artifact_id uuid not null,
 artifact_revision text not null,
 manifest_id uuid not null,
 primary key(artifact_kind,artifact_id,artifact_revision,manifest_id),
 foreign key(workspace_id,manifest_id) references private.shared_evidence_manifests(workspace_id,id) on delete cascade
);
-- Transaction-bound claim complements, and does not replace, trusted run claims.
create table private.shared_evidence_commit_claims (
 transaction_id xid8 not null,
 workspace_id uuid not null,
 manifest_id uuid not null,
 target_kind text not null check(target_kind in ('vsi_request','briefing_run')),
 target_id uuid not null,
 attempt integer not null check(attempt>0),
 primary key(transaction_id,manifest_id),
 foreign key(workspace_id,manifest_id) references private.shared_evidence_manifests(workspace_id,id) on delete cascade
);
alter table private.shared_evidence_manifests enable row level security;
alter table private.shared_evidence_manifest_sources enable row level security;
alter table private.shared_evidence_artifact_manifests enable row level security;
alter table private.shared_evidence_commit_claims enable row level security;
revoke all on private.shared_evidence_manifests,private.shared_evidence_manifest_sources,
 private.shared_evidence_artifact_manifests,private.shared_evidence_commit_claims from public,anon,authenticated,service_role;
-- Rows are inserted only after a complete protected resolution in one transaction.
-- These triggers protect sealed provenance against later application rewrites.
create function private.reject_shared_manifest_change_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.workspaces where id=old.workspace_id) then return old; end if;
 raise exception 'evidence_manifest_immutable' using errcode='42501';
end $$;
revoke all on function private.reject_shared_manifest_change_v1() from public,anon,authenticated,service_role;
create trigger shared_manifest_immutable before update or delete on private.shared_evidence_manifests
 for each row execute function private.reject_shared_manifest_change_v1();
create trigger shared_manifest_sources_immutable before update or delete on private.shared_evidence_manifest_sources
 for each row execute function private.reject_shared_manifest_change_v1();
create trigger shared_artifact_manifest_immutable before update or delete on private.shared_evidence_artifact_manifests
 for each row execute function private.reject_shared_manifest_change_v1();
commit;
