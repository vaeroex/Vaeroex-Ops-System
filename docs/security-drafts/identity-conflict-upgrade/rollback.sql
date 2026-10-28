-- LOCAL REVIEW ONLY. Never executed by the assembler.
-- EMERGENCY REVIEW ONLY: restores the known vulnerable 40001 contract. Never automatic.
-- No source data, saved records, ACLs, credentials, gates, schedules or sessions are changed.
-- Guard failures abort the entire transaction. Concurrent schema changes must be excluded operationally.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $guard$
declare p pg_catalog.pg_proc;
begin
 select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('private.shared_evidence_before_memory_receipts_v1(uuid,jsonb,uuid)');
 if not found then raise exception 'identity_conflict_rollback_before_missing_function';end if;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>'460322cb8730ac1ff72438027771b14b42a8533b0a152836f5ba0443205e82a3' then
  raise exception 'identity_conflict_rollback_before_body_drift';end if;
 if p.proowner<>'postgres'::pg_catalog.regrole or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.prorettype<>'jsonb'::pg_catalog.regtype or p.proretset or p.provariadic<>0
  or p.pronargdefaults<>0 or p.proargnames is distinct from array['w','j','a']::text[]
  or p.provolatile<>'v' or not p.prosecdef or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.procost<>100 or p.prorows<>0 or p.prosupport<>0
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl is distinct from array['postgres=X/postgres']::pg_catalog.aclitem[] then
  raise exception 'identity_conflict_rollback_before_security_drift';end if;
end $guard$;

create or replace function private.shared_evidence_before_memory_receipts_v1(w uuid,j jsonb,a uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare resolved jsonb;
begin
 if j->>'kind' in ('legacy_reference','inherited_artifact') then return private.shared_evidence_legacy_original_v1(w,j,a);end if;
 -- These projections establish provenance only. The full existing memory
 -- eligibility predicate and reviewed-text validator are not yet required by a
 -- consumer bridge. Do not let an authenticated seal imply semantic admission.
 if j->>'kind' in ('approved_file_fact','approved_note') then
  raise exception 'shared_typed_semantic_admission_unqualified' using errcode='42501';end if;
 resolved:=private.shared_evidence_typed_v1(w,a,j);
 if j is distinct from resolved->'identity' then raise exception 'shared_typed_identity_changed' using errcode='40001';end if;
 return resolved;
end $$;

do $guard$
declare p pg_catalog.pg_proc;
begin
 select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('private.shared_evidence_before_memory_receipts_v1(uuid,jsonb,uuid)');
 if not found then raise exception 'identity_conflict_rollback_after_missing_function';end if;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>'525df2decebd8c4dce1bdbc2aef1593acbea6470572b58260b1047fee242c576' then
  raise exception 'identity_conflict_rollback_after_body_drift';end if;
 if p.proowner<>'postgres'::pg_catalog.regrole or p.prolang<>(select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.prorettype<>'jsonb'::pg_catalog.regtype or p.proretset or p.provariadic<>0
  or p.pronargdefaults<>0 or p.proargnames is distinct from array['w','j','a']::text[]
  or p.provolatile<>'v' or not p.prosecdef or p.proisstrict or p.proleakproof or p.proparallel<>'u'
  or p.procost<>100 or p.prorows<>0 or p.prosupport<>0
  or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl is distinct from array['postgres=X/postgres']::pg_catalog.aclitem[] then
  raise exception 'identity_conflict_rollback_after_security_drift';end if;
end $guard$;
commit;
