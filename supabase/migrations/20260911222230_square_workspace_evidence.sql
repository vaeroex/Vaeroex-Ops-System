-- Read-only Sandbox evidence, never a registration, admission or runtime grant.
-- Private definer is necessary to minimize private facts for a verified user;
-- no private schema/table access is granted to application roles.
begin;
create function private.square_workspace_evidence_v1(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public
set statement_timeout='5s' set lock_timeout='2s' as $$
declare c private.square_account_configuration; ac private.square_account_connections;
  dc private.square_connections; g private.square_connection_generations; e private.square_account_enrollments;
  r private.square_interpretation_runs; a jsonb; m jsonb; checked jsonb; observed jsonb;
  f jsonb; kind text; counts jsonb:='{"payment":0,"refund":0,"order":0,"catalog":0,"inventory":0}';
  provenance jsonb:='[]'; partition text; actor uuid; sid uuid; session_expiry timestamptz;
  n timestamptz; last_observed timestamptz; rel jsonb; relationships jsonb; role_name text;
begin
  actor:=auth.uid(); sid:=(auth.jwt()->>'session_id')::uuid;
  if actor is null or sid is null or auth.jwt()->>'role' is distinct from 'authenticated'
    or auth.jwt()->>'iss' is distinct from 'https://oysjpoondtcrqpghhrbd.supabase.co/auth/v1'
    or auth.jwt()->>'is_anonymous'='true' then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  select m.role,s.not_after into role_name,session_expiry from public.workspace_members m
    join auth.users u on u.id=m.user_id join auth.sessions s on s.user_id=u.id and s.id=sid
    where m.workspace_id=p_workspace_id and m.user_id=actor and m.status='active'
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u,s;
  if not found or role_name not in ('owner','admin','manager') then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  -- Never guess which entity/connection to display or combine overlapping sets.
  if (select count(*) from private.square_account_connections where workspace_id=p_workspace_id
    and environment='sandbox' and application_id='sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw')<>1 then
    raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  select * into strict ac from private.square_account_connections where workspace_id=p_workspace_id
    and environment='sandbox' and application_id='sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw' for share;
  select * into c from private.square_account_configuration where environment=ac.environment and application_id=ac.application_id for share;
  perform 1 from public.business_entities where id=ac.business_entity_id and workspace_id=p_workspace_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  select * into dc from private.square_connections where connection_id=ac.connection_id for share;
  select * into g from private.square_connection_generations where connection_id=ac.connection_id and connection_generation=ac.generation for share;
  select * into e from private.square_account_enrollments where connection_id=ac.connection_id and generation=ac.generation for share;
  if c.application_id is null or dc.connection_id is null or g.connection_id is null or e.connection_id is null
    or c.blocked or ac.state<>'authorized' or ac.revocation_pending or dc.state<>'active' or dc.revoked_at is not null
    or dc.environment<>'sandbox' or dc.workspace_id<>p_workspace_id or dc.business_entity_id<>ac.business_entity_id
    or dc.current_generation<>ac.generation or dc.seller_id is distinct from ac.merchant_id
    or g.identity_mode<>'oauth_verified' or g.identity_evidence_fingerprint is distinct from e.discovery_fingerprint
    or e.discovery_fingerprint is distinct from ac.discovery->>'fingerprint' or e.credential_id is distinct from ac.credential_id
    or c.retention_policy_version is distinct from e.retention_policy_version
    or g.retention_policy_version is distinct from e.retention_policy_version
    or c.retention_approval_fingerprint is distinct from e.retention_approval_fingerprint
    or g.retention_approval_fingerprint is distinct from e.retention_approval_fingerprint
    or c.source_retention_seconds is distinct from e.source_retention_seconds or c.cursor_retention_seconds is distinct from e.cursor_retention_seconds
    or c.revocation_access_policy<>'deny_source_access' or e.revocation_access_policy is distinct from c.revocation_access_policy
    or jsonb_array_length(ac.mapped_locations)=0
    or exists(select 1 from private.square_account_capacity_blocks where environment=c.environment and application_id=c.application_id)
    then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  select private.square_page_hash_v1(jsonb_agg(resource_key order by resource_key)) into partition from
    (select distinct resource_key from private.square_observation_admissions where workspace_id=p_workspace_id
      and business_entity_id=ac.business_entity_id and connection_id=ac.connection_id and generation=ac.generation) resources;
  select * into r from private.square_interpretation_runs where connection_id=ac.connection_id and generation=ac.generation
    and workspace_id=p_workspace_id and business_entity_id=ac.business_entity_id and partition_fingerprint=partition order by revision desc limit 1;
  if not found or r.output->>'economic' is distinct from 'blocked' or r.output->>'historical' is distinct from 'unknown'
    or r.output->>'policyVersion' is distinct from 'square_canonical_interpretation_v1' then
    raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  select approval into a from private.square_observation_approvals where approval_fingerprint=r.approval_fingerprint;
  if a is null or a->>'workspaceId' is distinct from p_workspace_id::text or a->>'businessEntityId' is distinct from ac.business_entity_id::text
    or a->>'connectionId' is distinct from ac.connection_id::text or (a->>'generation')::bigint is distinct from ac.generation
    or jsonb_array_length(a->'manifest') not between 1 and 13 or jsonb_array_length(r.output->'facts')<>jsonb_array_length(a->'manifest') then
    raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  -- Read authority is current session + current generation, not an expired
  -- write-approval deadline. Reuse the checked source/version/mapping validator.
  for m in select value from jsonb_array_elements(a->'manifest') order by value->>'resourceKey' loop
    checked:=private.square_observation_fact_v1(a,m);
    select fact into observed from private.square_observation_admissions where version_key=m->>'versionKey'
      and workspace_id=p_workspace_id and business_entity_id=ac.business_entity_id and connection_id=ac.connection_id
      and generation=ac.generation and retention_expires_at>clock_timestamp();
    select fact into f from private.square_interpretation_facts where version_key=m->>'versionKey'
      and workspace_id=p_workspace_id and business_entity_id=ac.business_entity_id and connection_id=ac.connection_id
      and generation=ac.generation and retention_expires_at>clock_timestamp();
    if observed is null or f is null or observed->>'factFingerprint' is distinct from checked->>'factFingerprint'
      or not exists(select 1 from jsonb_array_elements(r.output->'facts') x where x=f)
      or f#>>'{value,value,economic}' is distinct from 'blocked' then
      raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
    kind:=f#>>'{value,value,kind}';
    if not counts ? kind then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
    counts:=jsonb_set(counts,array[kind],to_jsonb((counts->>kind)::int+1));
    last_observed:=greatest(last_observed,(f->>'sourceObservedAt')::timestamptz);
    provenance:=provenance||jsonb_build_array(jsonb_build_object('kind',kind,
      'sourceVersion',(select ordinal from private.square_ingestion_versions where version_key=m->>'versionKey'),
      'observedAt',f->>'sourceObservedAt','scope',case when kind='catalog' then 'seller_with_location_applicability' else 'mapped_location_or_explicitly_unresolved' end));
  end loop;
  rel:=r.output#>'{relationships,links}';
  if jsonb_typeof(rel) is distinct from 'array' or jsonb_array_length(rel)>20000 then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  select jsonb_build_object('unresolvedLocation',count(*) filter(where x->>'state'='location_unknown'),
    'conflict',count(*) filter(where x->>'state'='reference_conflict'), 'idMatch',count(*) filter(where x->>'state'='observed_id_match'),
    'otherUncertain',count(*) filter(where x->>'state' not in ('location_unknown','reference_conflict','observed_id_match'))) into relationships from jsonb_array_elements(rel) x;
  n:=clock_timestamp();
  if session_expiry<=n or c.approval_expires_at<=n or g.retention_expires_at<=n or r.retention_expires_at<=n or last_observed>n then
    raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
  return jsonb_build_object('version','square_workspace_evidence_v1','source','Square Sandbox','status','verified_non_economic',
    'policy','square_canonical_interpretation_v1','counts',counts,'relationships',relationships,'historical','unknown','economic','blocked',
    'checkpointRevision',r.revision,'interpretedAt',r.created_at,'lastObservedAt',last_observed,'checkedAt',n,'syncStatus','unknown','provenance',provenance);
exception when others then raise exception using errcode='42501',message='square_evidence_unavailable';
end $$;
revoke all on function private.square_workspace_evidence_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function private.square_workspace_evidence_v1(uuid) to authenticated;
-- SQL-standard body resolves the private name at creation, without giving the
-- caller USAGE on private or exposing any other private functions/tables.
create function public.read_square_workspace_evidence_v1(p_workspace_id uuid)
returns jsonb language sql security invoker set search_path=''
begin atomic;
  select private.square_workspace_evidence_v1(p_workspace_id);
end;
revoke all on function public.read_square_workspace_evidence_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_square_workspace_evidence_v1(uuid) to authenticated;
commit;
