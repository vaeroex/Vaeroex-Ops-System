-- Explicit Sandbox administrative observation admission. No runtime gate,
-- source validation, canonical contribution, credential or registration changes.
begin;

create table private.square_observation_approvals (
  approval_fingerprint text primary key check(private.is_sha256_fingerprint_v1(approval_fingerprint)),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  generation bigint not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  approval jsonb not null,
  expires_at timestamptz not null check(isfinite(expires_at)),
  approved_at timestamptz not null,
  approved_by name not null check(approved_by='postgres'),
  foreign key(workspace_id,business_entity_id,connection_id,generation)
    references private.square_connection_generations(workspace_id,business_entity_id,connection_id,connection_generation)
);
create table private.square_observation_admissions (
  policy_version text not null check(policy_version='square_sandbox_observation_admission_v1'),
  version_key text not null references private.square_ingestion_versions(version_key) on delete restrict,
  resource_key text not null,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  generation bigint not null,
  approval_fingerprint text not null references private.square_observation_approvals(approval_fingerprint),
  fact jsonb not null,
  retention_policy_version text not null,
  retention_expires_at timestamptz not null,
  admitted_at timestamptz not null,
  primary key(policy_version,version_key),
  foreign key(resource_key,version_key) references private.square_ingestion_versions(resource_key,version_key),
  foreign key(workspace_id,business_entity_id,connection_id,generation)
    references private.square_connection_generations(workspace_id,business_entity_id,connection_id,connection_generation),
  check(fact#>>'{value,kind}'='structured' and fact#>>'{value,value,economic}'='blocked')
);
do $tables$
declare t text;
begin
  foreach t in array array['square_observation_approvals','square_observation_admissions'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger observation_immutable before update or delete on private.%I for each row execute function private.reject_external_integration_immutable_mutation_v1()',t);
  end loop;
end;
$tables$;

-- Administrative approval does not borrow an expired browser/runtime session.
-- It nevertheless checks current membership, verified generation, revocation and
-- retained-source authority under locks. Closed runtime gates remain closed.
create function private.square_assert_observation_approval_v1(a jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,private,public as $$
declare c private.square_account_configuration; ac private.square_account_connections;
  dc private.square_connections; g private.square_connection_generations;
  e private.square_account_enrollments; role_name text; n timestamptz;
begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='square_observation_actor_denied';
  end if;
  if a is null or pg_column_size(a)>32768 then raise exception using errcode='42501',message='square_observation_approval_invalid'; end if;
  perform private.square_assert_page_json_v1(a);
  if not coalesce(private.jsonb_has_exact_keys_v1(a,array['contractVersion','policyVersion','policyFingerprint','workspaceId','businessEntityId','connectionId','generation','actorId','expiresAt','manifest']),false)
    or a->>'contractVersion' is distinct from 'square_observation_approval_v1'
    or a->>'policyVersion' is distinct from 'square_sandbox_observation_admission_v1'
    or a->>'policyFingerprint' is distinct from 'sha256:b2570f312336d36b4c6ccaa51d4d7b56c7f86a27dd732a0f786343540410d858'
    or jsonb_typeof(a->'manifest') is distinct from 'array' or jsonb_array_length(a->'manifest') not between 1 and 13 then
    raise exception using errcode='42501',message='square_observation_approval_invalid';
  end if;
  select cfg.* into c from private.square_account_configuration cfg join private.square_account_connections ca
    on ca.environment=cfg.environment and ca.application_id=cfg.application_id
    where ca.connection_id=(a->>'connectionId')::uuid for share of cfg;
  if not found then raise exception using errcode='42501',message='square_observation_authority_denied'; end if;
  select * into ac from private.square_account_connections where connection_id=(a->>'connectionId')::uuid for share;
  select * into dc from private.square_connections where connection_id=ac.connection_id for share;
  select * into g from private.square_connection_generations where connection_id=ac.connection_id and connection_generation=ac.generation for share;
  select * into e from private.square_account_enrollments where connection_id=ac.connection_id and generation=ac.generation for share;
  select m.role into role_name from public.workspace_members m join auth.users u on u.id=m.user_id
    join public.business_entities entity on entity.workspace_id=m.workspace_id and entity.id=(a->>'businessEntityId')::uuid and entity.status='active'
    where m.workspace_id=(a->>'workspaceId')::uuid and m.user_id=(a->>'actorId')::uuid and m.status='active' for share of m,u,entity;
  n:=clock_timestamp();
  if role_name is distinct from 'owner' or ac.connection_id is null or dc.connection_id is null or g.connection_id is null or e.connection_id is null
    or ac.workspace_id is distinct from (a->>'workspaceId')::uuid or ac.business_entity_id is distinct from (a->>'businessEntityId')::uuid
    or ac.generation is distinct from (a->>'generation')::bigint or dc.current_generation<>ac.generation
    or dc.workspace_id<>ac.workspace_id or dc.business_entity_id<>ac.business_entity_id
    or ac.environment<>'sandbox' or dc.environment<>'sandbox' or ac.state<>'authorized' or dc.state<>'active'
    or ac.revocation_pending or dc.revoked_at is not null or ac.merchant_id is distinct from dc.seller_id
    or g.identity_mode<>'oauth_verified' or g.identity_evidence_fingerprint is distinct from e.discovery_fingerprint
    or e.credential_id is distinct from ac.credential_id or e.discovery_fingerprint is distinct from ac.discovery->>'fingerprint'
    or c.blocked or c.approval_expires_at<=n or g.retention_expires_at<=n or c.retention_policy_version is distinct from e.retention_policy_version
    or exists(select 1 from private.square_account_capacity_blocks b where b.environment=c.environment and b.application_id=c.application_id)
    or c.retention_approval_fingerprint is distinct from e.retention_approval_fingerprint or c.revocation_access_policy is distinct from 'deny_source_access'
    or c.source_retention_seconds is distinct from e.source_retention_seconds or c.cursor_retention_seconds is distinct from e.cursor_retention_seconds
    or e.revocation_access_policy is distinct from c.revocation_access_policy
    or g.retention_policy_version is distinct from e.retention_policy_version or g.retention_approval_fingerprint is distinct from e.retention_approval_fingerprint
    or a->>'expiresAt' is null or not isfinite((a->>'expiresAt')::timestamptz) or (a->>'expiresAt')::timestamptz<=n
    or (a->>'expiresAt')::timestamptz>least(c.approval_expires_at,g.retention_expires_at)
    or jsonb_array_length(ac.mapped_locations)=0 then
    raise exception using errcode='42501',message='square_observation_authority_denied';
  end if;
end;
$$;

create function private.square_observation_fact_v1(a jsonb,m jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,private,public as $$
declare r private.square_ingestion_resources; v private.square_ingestion_versions;
  p private.square_ingestion_page_receipts; s private.square_ingestion_scans;
  t private.square_ingestion_tasks; source jsonb; fact jsonb; payload jsonb;
  h text; policy constant text:='square_sandbox_observation_admission_v1'; n timestamptz; version_tx text; receipt_tx text;
begin
  if not coalesce(private.jsonb_has_exact_keys_v1(m,array['resourceKey','versionKey','sourceRecordVersionId','sourceFingerprint','expectedCurrentVersionKey','receiptScanKey','receiptPageId']),false) then
    raise exception using errcode='42501',message='square_observation_manifest_invalid';
  end if;
  select * into p from private.square_ingestion_page_receipts where scan_key=m->>'receiptScanKey' and page_id=m->>'receiptPageId';
  -- Only the scan's immutable identity/scope fields are used. Do not lock its
  -- mutable checkpoint before/after resource locks across a multi-stream batch.
  select * into s from private.square_ingestion_scans where scan_key=p.scan_key;
  select * into r from private.square_ingestion_resources where resource_key=m->>'resourceKey' for share;
  select * into v from private.square_ingestion_versions where version_key=m->>'versionKey';
  select * into t from private.square_ingestion_tasks where task_id=p.task_id;
  -- Existing immutable schema records no per-page source list. Matching xmin is
  -- transaction-level receipt corroboration, NOT a claim of exact page membership.
  -- Unavailable, reserved or mismatched transaction identities cannot corroborate
  -- this finite admission; freezing need not erase the displayed original xmin.
  select xmin::text into version_tx from private.square_ingestion_versions where version_key=v.version_key;
  select xmin::text into receipt_tx from private.square_ingestion_page_receipts where scan_key=p.scan_key and page_id=p.page_id;
  n:=clock_timestamp();
  if r.resource_key is null or v.version_key is null or p.page_id is null or s.scan_key is null or t.task_id is null
    or r.workspace_id is distinct from (a->>'workspaceId')::uuid or r.business_entity_id is distinct from (a->>'businessEntityId')::uuid
    or r.connection_id is distinct from (a->>'connectionId')::uuid or v.resource_key<>r.resource_key
    or v.workspace_id<>r.workspace_id or v.business_entity_id<>r.business_entity_id or v.connection_id<>r.connection_id
    or r.current_version_key is distinct from m->>'expectedCurrentVersionKey' or r.current_version_key is distinct from v.version_key
    or v.ordering<>'newer' or v.version_id is distinct from (m->>'sourceRecordVersionId')::uuid
    or exists(select 1 from private.square_ingestion_versions conflicting where conflicting.resource_key=r.resource_key
      and conflicting.ordinal>v.ordinal and conflicting.ordering in ('conflict','unordered'))
    or v.version->>'sourceFingerprint' is distinct from m->>'sourceFingerprint'
    or v.pending->>'deleted' is distinct from 'false' or v.retention_expires_at<=n or p.retention_expires_at<=n
    or p.connection_id<>r.connection_id or p.workspace_id<>r.workspace_id or p.business_entity_id<>r.business_entity_id
    or version_tx is distinct from receipt_tx or version_tx in ('0','1','2')
    or s.stream<>r.stream or s.connection_generation<>(a->>'generation')::bigint
    or t.connection_id<>r.connection_id or t.connection_generation<>s.connection_generation
    or t."grant"->>'stream' is distinct from r.stream
    or r.provider_record_type not in ('square_payment','square_refund','square_order_tenders','square_catalog_primary_item_variation',
      'square_inventory_count_snapshot','square_inventory_physical_count','square_inventory_adjustment') then
    raise exception using errcode='42501',message='square_observation_source_denied';
  end if;
  perform private.square_pending_source_v1(v.pending,t."grant"->'scope',r.stream);
  if v.pending->>'resourceKey' is distinct from r.resource_key or v.pending->>'versionKey' is distinct from v.version_key
    or v.pending->>'providerRecordType' is distinct from r.provider_record_type or v.pending->>'providerRecordId' is distinct from r.provider_record_id
    or v.pending#>>'{scope,environment}' is distinct from 'sandbox'
    or v.pending#>>'{scope,workspaceId}' is distinct from a->>'workspaceId'
    or v.pending#>>'{scope,businessEntityId}' is distinct from a->>'businessEntityId'
    or v.pending#>>'{scope,connectionId}' is distinct from a->>'connectionId'
    or v.pending#>>'{scope,sellerId}' is distinct from (select seller_id from private.square_connections where connection_id=r.connection_id)
    or exists(select 1 from jsonb_array_elements_text(v.pending#>'{scope,authorizedLocationIds}') location_id
      where not exists(select 1 from private.square_location_mappings lm where lm.connection_id=r.connection_id
        and lm.connection_generation=(a->>'generation')::bigint and lm.location_id=location_id.value))
    or (v.pending#>>'{scope,generation}')::bigint is distinct from (a->>'generation')::bigint then
    raise exception using errcode='42501',message='square_observation_source_denied';
  end if;
  source:=private.square_materialize_source_v1(v.pending,v.ordinal,v.prior_version_id);
  if source is distinct from v.version then raise exception using errcode='42501',message='square_observation_source_denied'; end if;
  h:=substr(private.square_page_hash_v1(jsonb_build_object('purpose','square_observation_fact_version_v1','policyVersion',policy,
    'resourceKey',r.resource_key,'versionKey',v.version_key)),8);
  fact:=jsonb_build_object('contractVersion','canonical_business_fact_version_v2','id',substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12),
    'workspaceId',r.workspace_id,'businessEntityId',r.business_entity_id,'immutableVersion',v.ordinal,
    'factKind',r.provider_record_type||'_observation','factKey',private.square_page_hash_v1(jsonb_build_object('purpose','square_observation_fact_identity_v1','policyVersion',policy,'resourceKey',r.resource_key)),
    'dimensions','[]'::jsonb,'temporal','{"effectiveAt":null,"postingDate":null,"periodStart":null,"periodEnd":null,"fiscalYear":null,"fiscalPeriod":null,"sourceTimeZone":null,"closedPeriod":false}'::jsonb,
    'accounting','{"basis":"not_applicable","sourceCurrency":null,"reportingCurrency":null,"exchangeRate":null,"exchangeRateSource":null}'::jsonb,
    'value',jsonb_build_object('kind','structured','value',jsonb_build_object('classification','verified_provider_observation','economic','blocked','historical','unknown',
      'applicability',case when r.stream='catalog' then 'seller_scoped' else 'authorized_locations' end,'providerRecordType',r.provider_record_type,'projection',v.pending#>'{projection,data}')),
    'reconciliationState','accepted','validationState','valid','sources',jsonb_build_array(jsonb_build_object('sourceRecordVersionId',source->'id','sourceFingerprint',source->'sourceFingerprint','sourceRole','control_observation','contributionWeight',null)),
    'decision',jsonb_build_object('authority','deterministic_policy','policyVersion',policy,'actorId',null,'decidedAt',to_char(n at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reasonCodes',jsonb_build_array('provider_observation_only')),
    'normalizationVersion','square_pending_source_mapping_v1','transformationVersion',policy,'sourceObservedAt',source->'receivedAt','createdAt',to_char(n at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  payload:=fact-array['id','immutableVersion','createdAt'];
  payload:=jsonb_set(payload,'{decision}',(fact->'decision')-'decidedAt');
  return fact||jsonb_build_object('factFingerprint',private.square_page_hash_v1(jsonb_build_object('fingerprintPurpose','canonical_business_fact','fingerprintVersion','external_integration_fingerprint_v1','payload',payload)));
end;
$$;

create function public.register_square_observation_approval_v1(p_approval jsonb)
returns text language plpgsql security invoker set search_path=pg_catalog,private,public as $$
declare m jsonb; fingerprint text;
begin
  perform private.square_assert_observation_approval_v1(p_approval);
  if (select count(distinct x->>'resourceKey') from jsonb_array_elements(p_approval->'manifest') x)<>jsonb_array_length(p_approval->'manifest') then
    raise exception using errcode='42501',message='square_observation_manifest_invalid';
  end if;
  for m in select value from jsonb_array_elements(p_approval->'manifest') order by value->>'resourceKey' loop
    perform private.square_observation_fact_v1(p_approval,m);
  end loop;
  -- Recheck time-sensitive authority after all resource lock waits.
  perform private.square_assert_observation_approval_v1(p_approval);
  if exists(select 1 from jsonb_array_elements(p_approval->'manifest') x
    join private.square_ingestion_versions v on v.version_key=x->>'versionKey'
    join private.square_ingestion_page_receipts p on p.scan_key=x->>'receiptScanKey' and p.page_id=x->>'receiptPageId'
    where least(v.retention_expires_at,p.retention_expires_at)<=clock_timestamp()) then
    raise exception using errcode='42501',message='square_observation_source_denied';
  end if;
  fingerprint:=private.square_page_hash_v1(p_approval);
  insert into private.square_observation_approvals values(fingerprint,(p_approval->>'workspaceId')::uuid,(p_approval->>'businessEntityId')::uuid,
    (p_approval->>'connectionId')::uuid,(p_approval->>'generation')::bigint,(p_approval->>'actorId')::uuid,p_approval,
    (p_approval->>'expiresAt')::timestamptz,clock_timestamp(),session_user) on conflict do nothing;
  return fingerprint;
end;
$$;

create function public.admit_square_provider_observations_v1(p_approval_fingerprint text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,private,public as $$
declare a jsonb; m jsonb; f jsonb; existing jsonb; count_admitted integer:=0;
begin
  if session_user<>'postgres' or current_user<>'postgres' then raise exception using errcode='42501',message='square_observation_actor_denied'; end if;
  select approval into a from private.square_observation_approvals where approval_fingerprint=p_approval_fingerprint;
  if a is null or private.square_page_hash_v1(a)<>p_approval_fingerprint then raise exception using errcode='42501',message='square_observation_approval_invalid'; end if;
  perform private.square_assert_observation_approval_v1(a);
  for m in select value from jsonb_array_elements(a->'manifest') order by value->>'resourceKey' loop
    f:=private.square_observation_fact_v1(a,m);
    insert into private.square_observation_admissions
      select a->>'policyVersion',m->>'versionKey',m->>'resourceKey',
        (a->>'workspaceId')::uuid,(a->>'businessEntityId')::uuid,(a->>'connectionId')::uuid,(a->>'generation')::bigint,p_approval_fingerprint,f,
        v.retention_policy_version,v.retention_expires_at,clock_timestamp()
      from private.square_ingestion_versions v where v.version_key=m->>'versionKey' on conflict do nothing;
    select fact into existing from private.square_observation_admissions where policy_version=a->>'policyVersion' and version_key=m->>'versionKey';
    if existing->>'factFingerprint' is distinct from f->>'factFingerprint' then raise exception using errcode='42501',message='square_observation_conflict'; end if;
    count_admitted:=count_admitted+1;
  end loop;
  perform private.square_assert_observation_approval_v1(a);
  if exists(select 1 from jsonb_array_elements(a->'manifest') x
    join private.square_ingestion_versions v on v.version_key=x->>'versionKey'
    join private.square_ingestion_page_receipts p on p.scan_key=x->>'receiptScanKey' and p.page_id=x->>'receiptPageId'
    where least(v.retention_expires_at,p.retention_expires_at)<=clock_timestamp()) then
    raise exception using errcode='42501',message='square_observation_source_denied';
  end if;
  return jsonb_build_object('outcome','admitted','observations',count_admitted,'economic','blocked');
end;
$$;

revoke all on function private.square_assert_observation_approval_v1(jsonb),private.square_observation_fact_v1(jsonb,jsonb),
  public.register_square_observation_approval_v1(jsonb),public.admit_square_provider_observations_v1(text)
  from public,anon,authenticated,service_role;
comment on table private.square_observation_admissions is 'Immutable non-economic observations only. Original ingestion sources remain pending. Not a canonical source, contribution or completeness grant.';
commit;
