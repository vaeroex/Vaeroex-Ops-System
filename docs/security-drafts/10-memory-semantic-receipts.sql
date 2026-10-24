-- INACTIVE. New privileged attestation authority; requires reviewed server callsites.
begin;
create table private.shared_memory_semantic_receipts (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_kind text not null check(source_kind in ('approved_file_fact','approved_note')),
 original_identity jsonb not null, authority_hash text not null check(authority_hash ~ '^[a-f0-9]{64}$'),
 validator_contract text not null check(validator_contract='canonical_memory_semantics_v1'),
 certified_by uuid not null, certified_session uuid not null, created_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,source_kind,authority_hash,validator_contract),
 check(original_identity->>'kind'=source_kind and original_identity->>'authority_hash'=authority_hash)
);
alter table private.shared_memory_semantic_receipts enable row level security;
revoke all on private.shared_memory_semantic_receipts from public,anon,authenticated,service_role;
create function private.guard_shared_semantic_receipt_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.workspaces where id=old.workspace_id) then return old;end if;
 raise exception 'shared_semantic_receipt_immutable' using errcode='42501';
end $$;
create trigger shared_semantic_receipt_immutable before update or delete on private.shared_memory_semantic_receipts for each row execute function private.guard_shared_semantic_receipt_v1();
create function public.certify_shared_memory_semantics_v1(p_workspace_id uuid,p_actor_id uuid,p_session_id uuid,p_identity jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501';end if;
 perform private.require_shared_evidence_actor_v1(p_workspace_id,p_actor_id,p_session_id);
 if p_identity->>'kind' is null or p_identity->>'kind' not in ('approved_file_fact','approved_note') then raise exception 'shared_semantic_kind_denied' using errcode='42501';end if;
 r:=private.shared_evidence_typed_v1(p_workspace_id,p_actor_id,p_identity);
 if p_identity is distinct from r->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 insert into private.shared_memory_semantic_receipts(workspace_id,source_kind,original_identity,authority_hash,validator_contract,certified_by,certified_session)
 values(p_workspace_id,p_identity->>'kind',p_identity,r->>'hash','canonical_memory_semantics_v1',p_actor_id,p_session_id) on conflict do nothing;
 return true;
end $$;
alter function private.shared_evidence_original_v1(uuid,jsonb,uuid) rename to shared_evidence_before_memory_receipts_v1;
create function private.shared_evidence_original_v1(w uuid,j jsonb,a uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if j->>'kind' not in ('approved_file_fact','approved_note') then return private.shared_evidence_before_memory_receipts_v1(w,j,a);end if;
 r:=private.shared_evidence_typed_v1(w,a,j);
 if j is distinct from r->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 if not exists(select 1 from private.shared_memory_semantic_receipts where workspace_id=w and source_kind=j->>'kind' and original_identity=j
  and authority_hash=r->>'hash' and validator_contract='canonical_memory_semantics_v1') then raise exception 'shared_semantic_receipt_required' using errcode='42501';end if;
 return r;
end $$;
revoke all on function private.guard_shared_semantic_receipt_v1(),private.shared_evidence_original_v1(uuid,jsonb,uuid),private.shared_evidence_before_memory_receipts_v1(uuid,jsonb,uuid),public.certify_shared_memory_semantics_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.certify_shared_memory_semantics_v1(uuid,uuid,uuid,jsonb) to service_role;
commit;
-- The server-owned contract must change when canonical validators/formatters change.
-- A receipt proves the trusted server attested to these exact bytes; it is not a
-- claim that PostgreSQL executed TypeScript. Source authority is still rechecked.
