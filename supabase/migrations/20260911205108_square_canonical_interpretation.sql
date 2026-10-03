-- Private Sandbox-only deterministic interpretation storage. No runtime grants,
-- credentials, economic contribution tables, registration or provider calls.
begin;
create table private.square_interpretation_facts (
  policy_version text not null check(policy_version='square_canonical_interpretation_v1'),
  version_key text not null references private.square_ingestion_versions(version_key),
  workspace_id uuid not null, business_entity_id uuid not null, connection_id uuid not null, generation bigint not null,
  fact jsonb not null,
  retention_expires_at timestamptz not null check(isfinite(retention_expires_at)),
  created_at timestamptz not null default clock_timestamp(),
  primary key(policy_version,version_key),
  foreign key(workspace_id,business_entity_id,connection_id,generation)
    references private.square_connection_generations(workspace_id,business_entity_id,connection_id,connection_generation),
  check(fact#>>'{value,value,economic}'='blocked' and fact#>>'{accounting,basis}'='not_applicable')
);
create table private.square_interpretation_runs (
  connection_id uuid not null, generation bigint not null, revision bigint not null check(revision>0),
  partition_fingerprint text not null check(private.is_sha256_fingerprint_v1(partition_fingerprint)),
  workspace_id uuid not null, business_entity_id uuid not null,
  approval_fingerprint text not null references private.square_observation_approvals(approval_fingerprint),
  input_fingerprint text not null check(private.is_sha256_fingerprint_v1(input_fingerprint)),
  output jsonb not null check(pg_column_size(output)<=16777216),
  retention_expires_at timestamptz not null check(isfinite(retention_expires_at)),
  created_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,generation,partition_fingerprint,revision), unique(connection_id,generation,partition_fingerprint,input_fingerprint),
  foreign key(workspace_id,business_entity_id,connection_id,generation)
    references private.square_connection_generations(workspace_id,business_entity_id,connection_id,connection_generation)
);
do $tables$ declare t text; begin
  foreach t in array array['square_interpretation_facts','square_interpretation_runs'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger square_interpretation_immutable before update or delete on private.%I for each row execute function private.reject_external_integration_immutable_mutation_v1()',t);
  end loop;
end $tables$;

-- Reuse the existing finite observation approval and its transactional authority
-- checks. The checked native administrative worker is the only caller; browser,
-- runtime and service-role credentials gain no interpretation write authority.
create function public.read_square_interpretation_inputs_v1(p_approval_fingerprint text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,private,public as $$
declare a jsonb; m jsonb; checked jsonb; observed jsonb; inputs jsonb:='[]'; prior jsonb; partition text;
begin
  if session_user<>'postgres' or current_user<>'postgres' then raise exception using errcode='42501',message='square_interpretation_actor_denied'; end if;
  select approval into a from private.square_observation_approvals where approval_fingerprint=p_approval_fingerprint;
  perform private.square_assert_observation_approval_v1(a);
  -- Stable resource-set partition: renewed approvals and corrected versions
  -- reuse the checkpoint; different/overlapping subsets never replace it.
  select private.square_page_hash_v1(jsonb_agg(x->>'resourceKey' order by x->>'resourceKey')) into partition
    from jsonb_array_elements(a->'manifest') x;
  -- Consistent connection-local serialization; lock collisions serialize only,
  -- and do not confer authority. All authority/source locks are retained to commit.
  perform pg_advisory_xact_lock(hashtextextended('square_interpretation/'||(a->>'connectionId'),0));
  for m in select value from jsonb_array_elements(a->'manifest') order by value->>'resourceKey' loop
    checked:=private.square_observation_fact_v1(a,m);
    select fact into observed from private.square_observation_admissions where version_key=m->>'versionKey'
      and workspace_id=(a->>'workspaceId')::uuid and business_entity_id=(a->>'businessEntityId')::uuid
      and connection_id=(a->>'connectionId')::uuid and generation=(a->>'generation')::bigint;
    if observed is null or observed->>'factFingerprint' is distinct from checked->>'factFingerprint' then
      raise exception using errcode='42501',message='square_interpretation_admission_required';
    end if;
    inputs:=inputs||jsonb_build_array((select jsonb_build_object('pending',v.pending,'sourceVersion',v.version,
      'currentAuthority',jsonb_build_object('scopeFingerprint',private.square_page_hash_v1(v.pending->'scope'),'resourceKey',v.resource_key,
      'currentVersionKey',v.version_key,'sourceFingerprint',v.version->>'sourceFingerprint','ordering','same','admittedAt',observed->>'createdAt'))
      from private.square_ingestion_versions v where v.version_key=m->>'versionKey'));
  end loop;
  perform private.square_assert_observation_approval_v1(a);
  if exists(select 1 from jsonb_array_elements(a->'manifest') x
    join private.square_ingestion_versions v on v.version_key=x->>'versionKey'
    join private.square_ingestion_page_receipts p on p.scan_key=x->>'receiptScanKey' and p.page_id=x->>'receiptPageId'
    where least(v.retention_expires_at,p.retention_expires_at)<=clock_timestamp()) then
    raise exception using errcode='42501',message='square_interpretation_retention_expired';
  end if;
  select jsonb_build_object('revision',revision,'inputFingerprint',input_fingerprint,'output',
    case when retention_expires_at>clock_timestamp() then output else null end) into prior
    from private.square_interpretation_runs where connection_id=(a->>'connectionId')::uuid and generation=(a->>'generation')::bigint
    and partition_fingerprint=partition
    order by revision desc limit 1;
  return jsonb_build_object('inputs',inputs,'prior',prior,'partitionFingerprint',partition,'asOf',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

create function public.commit_square_interpretation_v1(p_approval_fingerprint text,p_expected_revision bigint,p_input_fingerprint text,p_output jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,private,public as $$
declare checked jsonb; a jsonb; f jsonb; source jsonb; existing jsonb; revision bigint; prior_fingerprint text;
begin
  checked:=public.read_square_interpretation_inputs_v1(p_approval_fingerprint);
  select approval into a from private.square_observation_approvals where approval_fingerprint=p_approval_fingerprint;
  revision:=coalesce((checked#>>'{prior,revision}')::bigint,0);
  if p_expected_revision is distinct from revision then raise exception using errcode='40001',message='square_interpretation_cas_conflict'; end if;
  if p_input_fingerprint is null or not private.is_sha256_fingerprint_v1(p_input_fingerprint)
    or p_output is null or pg_column_size(p_output)>16777216
    or p_output->>'policyVersion' is distinct from 'square_canonical_interpretation_v1'
    or p_output->>'economic' is distinct from 'blocked' or p_output->>'historical' is distinct from 'unknown'
    or p_output#>>'{coverage,kind}' is distinct from 'approval_resource_set'
    or p_output#>>'{coverage,partitionFingerprint}' is distinct from checked->>'partitionFingerprint'
    or jsonb_typeof(p_output->'facts') is distinct from 'array'
    or jsonb_array_length(p_output->'facts')<>jsonb_array_length(checked->'inputs') then
    raise exception using errcode='42501',message='square_interpretation_output_invalid';
  end if;
  if (select count(distinct x#>>'{value,value,versionKey}') from jsonb_array_elements(p_output->'facts') x)<>jsonb_array_length(checked->'inputs') then
    raise exception using errcode='42501',message='square_interpretation_duplicate';
  end if;
  for f in select value from jsonb_array_elements(p_output->'facts') loop
    select x->'sourceVersion' into source from jsonb_array_elements(checked->'inputs') x where x#>>'{pending,versionKey}'=f#>>'{value,value,versionKey}';
    if source is null or f->>'workspaceId' is distinct from a->>'workspaceId' or f->>'businessEntityId' is distinct from a->>'businessEntityId'
      or f#>>'{value,value,economic}' is distinct from 'blocked' or f#>>'{accounting,basis}' is distinct from 'not_applicable'
      or f->>'transformationVersion' is distinct from 'square_canonical_interpretation_v1'
      or f#>>'{sources,0,sourceRecordVersionId}' is distinct from source->>'id'
      or f#>>'{sources,0,sourceFingerprint}' is distinct from source->>'sourceFingerprint'
      or f->>'immutableVersion' is distinct from source->>'immutableVersion' then
      raise exception using errcode='42501',message='square_interpretation_provenance_invalid';
    end if;
    insert into private.square_interpretation_facts(policy_version,version_key,workspace_id,business_entity_id,connection_id,generation,fact,retention_expires_at)
      values('square_canonical_interpretation_v1',f#>>'{value,value,versionKey}',(a->>'workspaceId')::uuid,(a->>'businessEntityId')::uuid,
      (a->>'connectionId')::uuid,(a->>'generation')::bigint,f,
      (select retention_expires_at from private.square_ingestion_versions where version_key=f#>>'{value,value,versionKey}')) on conflict do nothing;
    select fact into existing from private.square_interpretation_facts where policy_version='square_canonical_interpretation_v1' and version_key=f#>>'{value,value,versionKey}';
    if existing->>'factFingerprint' is distinct from f->>'factFingerprint' then raise exception using errcode='42501',message='square_interpretation_immutable_conflict'; end if;
  end loop;
  select input_fingerprint into prior_fingerprint from private.square_interpretation_runs
    where connection_id=(a->>'connectionId')::uuid and generation=(a->>'generation')::bigint
      and partition_fingerprint=checked->>'partitionFingerprint' and input_fingerprint=p_input_fingerprint;
  if found then return jsonb_build_object('outcome','replayed','revision',revision); end if;
  perform private.square_assert_observation_approval_v1(a);
  if exists(select 1 from jsonb_array_elements(a->'manifest') x
    join private.square_ingestion_versions v on v.version_key=x->>'versionKey'
    join private.square_ingestion_page_receipts p on p.scan_key=x->>'receiptScanKey' and p.page_id=x->>'receiptPageId'
    where least(v.retention_expires_at,p.retention_expires_at)<=clock_timestamp()) then
    raise exception using errcode='42501',message='square_interpretation_retention_expired';
  end if;
  insert into private.square_interpretation_runs(connection_id,generation,partition_fingerprint,revision,workspace_id,business_entity_id,approval_fingerprint,input_fingerprint,output,retention_expires_at)
    values((a->>'connectionId')::uuid,(a->>'generation')::bigint,checked->>'partitionFingerprint',revision+1,(a->>'workspaceId')::uuid,(a->>'businessEntityId')::uuid,p_approval_fingerprint,p_input_fingerprint,p_output,
      (select min(v.retention_expires_at) from private.square_ingestion_versions v join jsonb_array_elements(a->'manifest') m on v.version_key=m->>'versionKey'));
  return jsonb_build_object('outcome','committed','revision',revision+1);
end $$;
revoke all on function public.read_square_interpretation_inputs_v1(text),public.commit_square_interpretation_v1(text,bigint,text,jsonb) from public,anon,authenticated,service_role;
comment on table private.square_interpretation_runs is 'Sandbox descriptive state only; no economic contributions or AI dispatch. Access requires current checked observation authority.';
commit;
