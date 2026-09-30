-- Explicit customer accounting authority. No policy, credentials, connections,
-- schedules or financial contribution is installed by applying this migration.
begin;

-- Pairwise v1 reconciliation cannot honestly represent a singleton admission
-- or a stand-alone withdrawal. Extend the existing storage with explicit v2
-- semantics; every generic v1 RPC and privilege remains unchanged.
alter table private.reconciliation_cases drop constraint reconciliation_cases_contract_version_check;
alter table private.reconciliation_cases drop constraint reconciliation_cases_classification_check;
alter table private.reconciliation_cases add constraint reconciliation_cases_contract_version_check
  check(contract_version in ('reconciliation_case_v1','reconciliation_case_v2'));
alter table private.reconciliation_cases add constraint reconciliation_cases_classification_check check(
  (contract_version='reconciliation_case_v1' and classification in ('same_fact_represented_twice','duplicate_evidence',
    'independent_facts','source_correction','authority_excluded_representation','manual_override','conflicting_sources',
    'ambiguous_review','control_observation_vs_additive_detail'))
  or (contract_version='reconciliation_case_v2' and case_state='resolved' and decision_authority='deterministic_policy'
    and decision_policy_version='qbo_production_accounting_mapping_v1'
    and ((classification='source_admission' and winning_fact_version_id is not null)
      or (classification='source_withdrawal' and winning_fact_version_id is null))));
alter table private.fact_contribution_batches drop constraint fact_contribution_batches_contract_version_check;
alter table private.fact_contribution_batches add constraint fact_contribution_batches_contract_version_check
  check(contract_version in ('fact_contribution_batch_v1','fact_contribution_batch_v2'));

create function private.guard_qbo_accounting_batch_version_v1() returns trigger
language plpgsql security definer set search_path='' as $function$
declare case_version text;
begin
  select contract_version into case_version from private.reconciliation_cases where id=new.reconciliation_case_id
    and workspace_id=new.workspace_id and business_entity_id=new.business_entity_id;
  if case_version is distinct from (case when new.contract_version='fact_contribution_batch_v2'
    then 'reconciliation_case_v2' else 'reconciliation_case_v1' end) then
    raise exception 'qbo_accounting_batch_version_denied' using errcode='42501'; end if;
  return new;
end;
$function$;
create trigger guard_qbo_accounting_batch_version before insert on private.fact_contribution_batches
  for each row execute function private.guard_qbo_accounting_batch_version_v1();
revoke all on function private.guard_qbo_accounting_batch_version_v1()
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;

create function private.guard_qbo_accounting_singleton_v2() returns trigger
language plpgsql security definer set search_path='' as $function$
declare case_id uuid; rc private.reconciliation_cases; batch private.fact_contribution_batches;
  member private.reconciliation_case_members; event private.fact_contribution_events; target private.fact_contribution_events;
begin
  if tg_table_name='reconciliation_cases' then case_id:=new.id; else case_id:=new.reconciliation_case_id; end if;
  select * into rc from private.reconciliation_cases where id=case_id;
  if rc.contract_version<>'reconciliation_case_v2' then return new; end if;
  if (select count(*) from private.reconciliation_case_members where reconciliation_case_id=rc.id)<>1
    or (select count(*) from private.fact_contribution_batches where reconciliation_case_id=rc.id)<>1
    or (select count(*) from private.fact_contribution_events where reconciliation_case_id=rc.id)<>1 then
    raise exception 'qbo_accounting_singleton_incomplete' using errcode='23514'; end if;
  select * into strict member from private.reconciliation_case_members where reconciliation_case_id=rc.id;
  select * into strict batch from private.fact_contribution_batches where reconciliation_case_id=rc.id;
  select * into strict event from private.fact_contribution_events where reconciliation_case_id=rc.id;
  if batch.contract_version<>'fact_contribution_batch_v2' or event.contribution_batch_id<>batch.id
    or event.source_authority_policy_version_id<>rc.source_authority_policy_version_id
    or event.fact_version_id<>member.fact_version_id or event.workspace_id<>rc.workspace_id
    or event.business_entity_id<>rc.business_entity_id or member.member_order<>1
    or not exists(select 1 from private.business_fact_sources edge where edge.fact_version_id=member.fact_version_id
      and edge.source_record_version_id=member.source_record_version_id and edge.source_fingerprint=member.source_fingerprint
      and edge.source_role='primary' and edge.workspace_id=rc.workspace_id and edge.business_entity_id=rc.business_entity_id)
    or (rc.classification='source_admission' and (event.event_kind<>'establish'
      or member.member_role<>'winner' or not member.additive_candidate or rc.winning_fact_version_id<>member.fact_version_id))
    or (rc.classification='source_withdrawal' and (event.event_kind<>'retract'
      or member.member_role<>'excluded' or member.additive_candidate or rc.winning_fact_version_id is not null)) then
    raise exception 'qbo_accounting_singleton_binding_denied' using errcode='23514'; end if;
  if event.event_kind='retract' then
    select * into strict target from private.fact_contribution_events where id=event.target_contribution_event_id;
    if target.event_kind<>'establish' or target.workspace_id<>event.workspace_id or target.business_entity_id<>event.business_entity_id
      or target.fact_version_id<>event.fact_version_id or target.contribution_family_version_id<>event.contribution_family_version_id
      or target.contribution_identity_fingerprint<>event.contribution_identity_fingerprint
      or target.economic_identity_fingerprint<>event.economic_identity_fingerprint
      or target.value<>event.value or target.currency<>event.currency or target.accounting_basis<>event.accounting_basis
      or target.effective_at is distinct from event.effective_at or target.period_start is distinct from event.period_start
      or target.period_end is distinct from event.period_end or target.dimensions<>event.dimensions
      or (select count(*) from private.fact_contribution_events where target_contribution_event_id=target.id and event_kind='retract')<>1 then
      raise exception 'qbo_accounting_withdrawal_target_denied' using errcode='23514'; end if;
  end if;
  return new;
end;
$function$;
create constraint trigger qbo_accounting_case_complete after insert on private.reconciliation_cases
  deferrable initially deferred for each row execute function private.guard_qbo_accounting_singleton_v2();
create constraint trigger qbo_accounting_member_complete after insert on private.reconciliation_case_members
  deferrable initially deferred for each row execute function private.guard_qbo_accounting_singleton_v2();
create constraint trigger qbo_accounting_batch_complete after insert on private.fact_contribution_batches
  deferrable initially deferred for each row execute function private.guard_qbo_accounting_singleton_v2();
create constraint trigger qbo_accounting_event_complete after insert on private.fact_contribution_events
  deferrable initially deferred for each row execute function private.guard_qbo_accounting_singleton_v2();
revoke all on function private.guard_qbo_accounting_singleton_v2()
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;

create table private.qbo_accounting_authority_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null references private.integration_connections(id) on delete restrict,
  connection_generation bigint not null check(connection_generation>0),
  mapping_id uuid not null references private.provider_entity_mappings(id) on delete restrict,
  mapping_row_version bigint not null check(mapping_row_version>0),
  realm_fingerprint bytea not null check(octet_length(realm_fingerprint)=32),
  policy_version_id uuid not null references private.source_authority_policy_versions(id) on delete restrict,
  contribution_family_version_id uuid not null references private.contribution_family_versions(id) on delete restrict,
  immutable_version bigint not null check(immutable_version>0),
  supersedes_id uuid references private.qbo_accounting_authority_versions(id) on delete restrict,
  enabled boolean not null,
  source_currency text not null check(private.is_currency_code_v1(source_currency)),
  effective_from timestamptz not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default transaction_timestamp(),
  unique(workspace_id,business_entity_id,immutable_version),
  unique(workspace_id,business_entity_id,id),
  foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on delete restrict,
  foreign key(workspace_id,business_entity_id,policy_version_id)
    references private.source_authority_policy_versions(workspace_id,business_entity_id,id) on delete restrict,
  foreign key(workspace_id,business_entity_id,contribution_family_version_id)
    references private.contribution_family_versions(workspace_id,business_entity_id,id) on delete restrict,
  foreign key(workspace_id,business_entity_id,supersedes_id)
    references private.qbo_accounting_authority_versions(workspace_id,business_entity_id,id) on delete restrict
);
alter table private.qbo_accounting_authority_versions enable row level security;
alter table private.qbo_accounting_authority_versions force row level security;
revoke all on private.qbo_accounting_authority_versions from public,anon,authenticated,service_role,
  integration_provider_source_authority,integration_provider_runtime_authority;
create trigger qbo_accounting_authority_immutable before update or delete on private.qbo_accounting_authority_versions
  for each row execute function private.reject_external_integration_immutable_mutation_v1();

-- Authenticated owners select a connection, not a tenant/entity, and approve a
-- fixed accounting policy. This RPC never accepts amounts, rules or fact IDs.
create function public.set_qbo_customer_accounting_authority_v1(
  p_connection_id uuid,p_expected_authority_id uuid,p_enabled boolean,p_effective_from timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  c private.integration_connections; m private.provider_entity_mappings;
  previous private.qbo_accounting_authority_versions; current_authority private.qbo_accounting_authority_versions;
  actor uuid; session_id uuid; currency text; policy uuid:=gen_random_uuid(); family uuid;
  policy_version bigint; previous_policy uuid; authority_version bigint; policy_hash bytea;
  rules jsonb; entry jsonb; ordinal bigint; now_at timestamptz:=transaction_timestamp();
begin
  if auth.role() is distinct from 'authenticated' or p_connection_id is null or p_enabled is null
    or p_effective_from is null or not isfinite(p_effective_from) or p_effective_from>now_at then
    raise exception 'qbo_accounting_authority_denied' using errcode='42501';
  end if;
  actor:=auth.uid();
  begin session_id:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'qbo_accounting_authority_denied' using errcode='42501'; end;
  select * into c from private.integration_connections where id=p_connection_id;
  if not found or c.provider_key<>'quickbooks_online' or c.provider_environment<>'production'
    or (p_enabled and c.status not in ('initializing','active','degraded')) then
    raise exception 'qbo_accounting_authority_denied' using errcode='42501'; end if;
  perform private.qbo_customer_require_owner_v1(actor,session_id,c.workspace_id,c.business_entity_id,true);
  -- The entity row serializes every accounting-authority change, including
  -- competing connections. A client cannot win by selecting a different one.
  select e.reporting_currency into currency from public.business_entities e
    where e.id=c.business_entity_id and e.workspace_id=c.workspace_id for update;
  if currency is null then select e.base_currency into currency from public.business_entities e
    where e.id=c.business_entity_id and e.workspace_id=c.workspace_id; end if;
  select * into c from private.integration_connections where id=p_connection_id for share;
  if p_enabled and c.status not in ('initializing','active','degraded') then
    raise exception 'qbo_accounting_authority_denied' using errcode='42501'; end if;
  select * into previous from private.qbo_accounting_authority_versions
    where workspace_id=c.workspace_id and business_entity_id=c.business_entity_id order by immutable_version desc limit 1;
  select * into m from private.provider_entity_mappings where connection_id=c.id
    and workspace_id=c.workspace_id and business_entity_id=c.business_entity_id and provider_key='quickbooks_online'
    and provider_environment='production' and ((p_enabled and status='active') or (not p_enabled and id=previous.mapping_id)) for share;
  if not found or (not p_enabled and previous.connection_id is distinct from c.id)
    or (p_enabled and (select count(*) from private.provider_entity_mappings where connection_id=c.id
      and workspace_id=c.workspace_id and business_entity_id=c.business_entity_id and status='active')<>1) then
    raise exception 'qbo_accounting_mapping_denied' using errcode='42501'; end if;
  if (previous.id is not distinct from p_expected_authority_id or previous.supersedes_id is not distinct from p_expected_authority_id)
    and previous.actor_id=actor and previous.enabled=p_enabled
    and previous.connection_id=c.id and previous.connection_generation=c.connection_generation
    and previous.mapping_id=m.id and previous.mapping_row_version=m.row_version
    and previous.realm_fingerprint=m.provider_entity_reference_fingerprint
    and previous.source_currency=currency and previous.effective_from=p_effective_from then
    return jsonb_build_object('authorityId',previous.id,'enabled',previous.enabled,'idempotent',true);
  end if;
  if previous.id is distinct from p_expected_authority_id then
    raise exception 'qbo_accounting_authority_stale' using errcode='40001'; end if;
  if p_enabled and exists(select 1 from private.source_authority_policy_versions p
    where p.workspace_id=c.workspace_id and p.business_entity_id=c.business_entity_id and p.domain_key='revenue'
      and p.policy_key<>'qbo_posted_revenue' and p.effective_from<=now_at
      and (p.effective_through is null or p.effective_through>now_at)) then
    raise exception 'qbo_accounting_authority_conflict' using errcode='42501'; end if;
  select id,immutable_version+1 into previous_policy,policy_version from private.source_authority_policy_versions
    where workspace_id=c.workspace_id and business_entity_id=c.business_entity_id
      and domain_key='revenue' and policy_key='qbo_posted_revenue' order by immutable_version desc limit 1;
  policy_version:=coalesce(policy_version,1); authority_version:=coalesce(previous.immutable_version,0)+1;
  rules:=jsonb_build_array(
    jsonb_build_object('sourceKind','provider','providerKey','quickbooks_online','sourceClass','transaction_detail',
      'authorityRole',case when p_enabled then 'authoritative' else 'excluded' end,'authorityRank',1,'contributionMode','additive_transaction'),
    jsonb_build_object('sourceKind','provider','providerKey','quickbooks_online','sourceClass','report_control',
      'authorityRole','control_only','authorityRank',2,'contributionMode','non_additive_control'),
    jsonb_build_object('sourceKind','provider','providerKey','square','sourceClass','transaction_detail',
      'authorityRole','excluded','authorityRank',3,'contributionMode','additive_transaction'),
    jsonb_build_object('sourceKind','manual','providerKey',null,'sourceClass','manual_entry',
      'authorityRole','excluded','authorityRank',4,'contributionMode','additive_transaction'),
    jsonb_build_object('sourceKind','upload','providerKey',null,'sourceClass','upload_observation',
      'authorityRole','excluded','authorityRank',5,'contributionMode','additive_transaction'));
  policy_hash:=private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'contract','qbo_posted_revenue_authority_v1','workspace',c.workspace_id,'entity',c.business_entity_id,
    'connection',c.id,'generation',c.connection_generation,'mapping',m.id,'mappingRowVersion',m.row_version,
    'realm',encode(m.provider_entity_reference_fingerprint,'hex'),
    'currency',currency,'effectiveFrom',p_effective_from,'version',policy_version,'actor',actor,'rules',rules,
    'conflictBehavior','hold_all','fallbackMode','review_required'));
  insert into private.source_authority_policy_versions(id,contract_version,workspace_id,business_entity_id,
    domain_key,policy_key,immutable_version,supersedes_policy_version_id,effective_from,conflict_behavior,fallback_mode,
    decision_authority,decision_actor_id,decision_decided_at,decision_reason_codes,policy_fingerprint)
  values(policy,'source_authority_policy_v1',c.workspace_id,c.business_entity_id,'revenue','qbo_posted_revenue',
    policy_version,previous_policy,p_effective_from,'hold_all','review_required','customer_authorized_user',actor,now_at,
    array['qbo_posted_revenue_owner_confirmation'],policy_hash);
  for entry,ordinal in select value,ordinality from jsonb_array_elements(rules) with ordinality loop
    insert into private.source_authority_policy_rules(workspace_id,business_entity_id,policy_version_id,rule_order,
      source_kind,provider_key,source_class,authority_role,authority_rank,contribution_mode)
    values(c.workspace_id,c.business_entity_id,policy,ordinal::smallint,entry->>'sourceKind',entry->>'providerKey',
      entry->>'sourceClass',entry->>'authorityRole',(entry->>'authorityRank')::integer,entry->>'contributionMode');
  end loop;
  if previous.id is null then
    family:=gen_random_uuid();
    if exists(select 1 from private.contribution_family_versions f where f.workspace_id=c.workspace_id
      and f.business_entity_id=c.business_entity_id and f.family_key='recognized_revenue_transactions') then
      raise exception 'qbo_accounting_family_conflict' using errcode='42501'; end if;
    insert into private.contribution_family_versions(id,contract_version,workspace_id,business_entity_id,family_key,
      immutable_version,domain_key,measure_key,aggregate_key,contribution_mode,allowed_fact_kinds,registry_version,
      effective_from,decision_authority,decision_actor_id,decision_decided_at,decision_reason_codes,family_fingerprint)
    values(family,'contribution_family_v1',c.workspace_id,c.business_entity_id,'recognized_revenue_transactions',1,
      'revenue','recognized_revenue','recognized_revenue_actual','additive_transaction',array['recognized_revenue'],
      'vaeroex_deterministic_dependencies_v1',p_effective_from,'customer_authorized_user',actor,now_at,
      array['qbo_posted_revenue_owner_confirmation'],private.phase_3_contract_fingerprint_v1(jsonb_build_object(
        'contract','qbo_posted_revenue_family_v1','workspace',c.workspace_id,'entity',c.business_entity_id,'id',family)));
  else family:=previous.contribution_family_version_id; end if;
  insert into private.qbo_accounting_authority_versions(workspace_id,business_entity_id,connection_id,connection_generation,
    mapping_id,mapping_row_version,realm_fingerprint,policy_version_id,contribution_family_version_id,immutable_version,supersedes_id,
    enabled,source_currency,effective_from,actor_id)
  values(c.workspace_id,c.business_entity_id,c.id,c.connection_generation,m.id,m.row_version,m.provider_entity_reference_fingerprint,
    policy,family,authority_version,previous.id,p_enabled,currency,p_effective_from,actor) returning * into current_authority;
  insert into private.integration_audit_events(workspace_id,business_entity_id,connection_id,actor_type,actor_id,
    action,outcome,target_type,target_id,metadata,retention_class)
  values(c.workspace_id,c.business_entity_id,c.id,'user',actor::text,'source_authority_policy.commit','succeeded',
    'source_authority_policy_version',policy::text,jsonb_build_object('domain_key','revenue','policy_key','qbo_posted_revenue',
      'immutable_version',policy_version,'conflict_behavior','hold_all'),'authorization');
  return jsonb_build_object('authorityId',current_authority.id,'enabled',p_enabled,'idempotent',false);
end;
$function$;
revoke all on function public.set_qbo_customer_accounting_authority_v1(uuid,uuid,boolean,timestamptz)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority;
grant execute on function public.set_qbo_customer_accounting_authority_v1(uuid,uuid,boolean,timestamptz) to authenticated;

-- Reuse the existing canonical writer without granting its broad runtime role.
-- The public writer and its original authorization remain unchanged. The private
-- copy has no execution grant and is reachable only after the QBO commit fence.
do $share_writer$
declare definition text; guard constant text:='  perform private.assert_external_integrations_authority_v1();';
begin
  definition:=pg_get_functiondef('public.commit_canonical_business_fact_version_v2(text,jsonb,text,text)'::regprocedure);
  if (length(definition)-length(replace(definition,guard,'')))/length(guard)<>1
    or position('CREATE OR REPLACE FUNCTION public.commit_canonical_business_fact_version_v2(' in definition)<>1 then
    raise exception 'qbo_canonical_writer_contract_changed'; end if;
  definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.commit_canonical_business_fact_version_v2(',
    'CREATE OR REPLACE FUNCTION private.commit_qbo_accounting_fact_internal_v1(');
  execute replace(definition,guard,'');
end;
$share_writer$;
revoke all on function private.commit_qbo_accounting_fact_internal_v1(text,jsonb,text,text)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;

-- A processing receipt is the idempotency boundary for the atomic financial
-- transaction, not a credential, provider-request or recovery evidence store.
create table private.qbo_accounting_source_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  authority_id uuid not null,
  source_record_id uuid not null references private.external_source_records(id) on delete restrict,
  source_version_id uuid not null,
  account_context_fingerprint bytea not null check(octet_length(account_context_fingerprint)=32),
  normalization_version text not null check(normalization_version='qbo_production_accounting_mapping_v1'),
  disposition text not null check(disposition in ('mapped_partial','non_contributing','review_required','retraction_required')),
  reason_codes text[] not null check(private.is_bounded_identifier_array_v1(reason_codes,32)),
  fact_version_ids uuid[] not null default '{}',
  prior_application_id uuid references private.qbo_accounting_source_applications(id) on delete restrict,
  plan_fingerprint bytea not null check(octet_length(plan_fingerprint)=32),
  created_at timestamptz not null default transaction_timestamp(),
  unique(source_version_id,authority_id,account_context_fingerprint,normalization_version),
  foreign key(workspace_id,business_entity_id,authority_id)
    references private.qbo_accounting_authority_versions(workspace_id,business_entity_id,id) on delete restrict,
  foreign key(workspace_id,business_entity_id,source_record_id,source_version_id)
    references private.external_source_record_versions(workspace_id,business_entity_id,source_record_id,id) on delete restrict
);
alter table private.qbo_accounting_source_applications enable row level security;
alter table private.qbo_accounting_source_applications force row level security;
revoke all on private.qbo_accounting_source_applications from public,anon,authenticated,service_role,
  integration_provider_source_authority,integration_provider_runtime_authority;
create trigger qbo_accounting_application_immutable before update or delete on private.qbo_accounting_source_applications
  for each row execute function private.reject_external_integration_immutable_mutation_v1();
create index qbo_accounting_application_source_idx on private.qbo_accounting_source_applications(source_record_id,created_at desc,id);

create function private.qbo_accounting_current_authority_v1(p_connection uuid)
returns private.qbo_accounting_authority_versions language plpgsql security definer set search_path='' as $function$
declare a private.qbo_accounting_authority_versions; c private.integration_connections;
begin
  select * into c from private.integration_connections where id=p_connection
    and provider_key='quickbooks_online' and provider_environment='production'
    and status in ('initializing','active','degraded');
  if not found then raise exception 'qbo_accounting_scope_denied' using errcode='42501'; end if;
  perform e.id from public.business_entities e where e.id=c.business_entity_id and e.workspace_id=c.workspace_id for share;
  select * into c from private.integration_connections where id=p_connection
    and provider_key='quickbooks_online' and provider_environment='production'
    and status in ('initializing','active','degraded') for share;
  if not found then raise exception 'qbo_accounting_scope_denied' using errcode='42501'; end if;
  select * into a from private.qbo_accounting_authority_versions where workspace_id=c.workspace_id
    and business_entity_id=c.business_entity_id order by immutable_version desc limit 1;
  if not found or not a.enabled or a.connection_id<>c.id or a.connection_generation<>c.connection_generation
    or a.effective_from>transaction_timestamp() then
    raise exception 'qbo_accounting_authority_required' using errcode='42501'; end if;
  perform m.id from private.provider_entity_mappings m where m.id=a.mapping_id and m.connection_id=c.id
    and m.workspace_id=c.workspace_id and m.business_entity_id=c.business_entity_id and m.provider_key=c.provider_key
    and m.provider_environment=c.provider_environment and m.status='active' and m.row_version=a.mapping_row_version
    and m.provider_entity_reference_fingerprint=a.realm_fingerprint for share;
  if not found or not exists(select 1 from public.business_entities e where e.workspace_id=c.workspace_id
      and e.id=c.business_entity_id and e.status='active' and coalesce(e.reporting_currency,e.base_currency)=a.source_currency)
    or exists(select 1 from private.source_authority_policy_versions p where p.workspace_id=c.workspace_id
      and p.business_entity_id=c.business_entity_id and p.domain_key='revenue' and p.effective_from<=transaction_timestamp()
      and (p.effective_through is null or p.effective_through>transaction_timestamp())
      and (p.policy_key<>'qbo_posted_revenue' or p.immutable_version>(select immutable_version
        from private.source_authority_policy_versions where id=a.policy_version_id))) then
    raise exception 'qbo_accounting_authority_conflict' using errcode='42501'; end if;
  return a;
end;
$function$;

create function private.qbo_accounting_account_context_v1(p_authority private.qbo_accounting_authority_versions)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('sourceRecordId',s.id,'sourceVersionId',v.id,
      'sourceFingerprint','sha256:'||encode(v.source_fingerprint,'hex'),
      'version',private.phase_8b_source_version_json_v1(v)) order by s.id),'[]'::jsonb)
  into result from private.external_source_records s join private.external_source_record_versions v on v.id=s.current_version_id
    where s.workspace_id=p_authority.workspace_id and s.business_entity_id=p_authority.business_entity_id
      and s.connection_id=p_authority.connection_id and s.mapping_id=p_authority.mapping_id
      and s.provider_key='quickbooks_online' and s.provider_record_type='Account'
      and v.validation_state='valid' and v.normalized_projection is not null and exists(
        select 1 from private.qbo_production_source_validation_work w where w.source_record_id=s.id
          and w.completed_version_id=v.id and w.state='valid' and w.connection_generation=p_authority.connection_generation
          and w.mapping_id=p_authority.mapping_id and w.realm_fingerprint=p_authority.realm_fingerprint);
  if jsonb_array_length(result)>2000 then raise exception 'qbo_accounting_account_limit' using errcode='54000'; end if;
  return result;
end;
$function$;

create function private.qbo_accounting_fact_json_v1(p_version private.canonical_business_fact_versions)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object('contractVersion',p_version.contract_version,'id',p_version.id,
    'workspaceId',p_version.workspace_id,'businessEntityId',p_version.business_entity_id,
    'immutableVersion',p_version.immutable_version,'factKind',f.fact_kind,'factKey',f.fact_key,'dimensions',p_version.dimensions,
    'temporal',jsonb_build_object('effectiveAt',case when p_version.effective_at is null then null else
        to_char(p_version.effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'postingDate',p_version.posting_date,'periodStart',p_version.period_start,'periodEnd',p_version.period_end,
      'fiscalYear',p_version.fiscal_year,'fiscalPeriod',p_version.fiscal_period,'sourceTimeZone',p_version.source_timezone,
      'closedPeriod',p_version.closed_period),
    'accounting',jsonb_build_object('basis',p_version.accounting_basis,'sourceCurrency',p_version.source_currency,
      'reportingCurrency',p_version.reporting_currency,'exchangeRate',p_version.exchange_rate_canonical,
      'exchangeRateSource',p_version.exchange_rate_source),
    'value',case when p_version.value_kind is null then null else jsonb_build_object('kind','money',
      'amount',p_version.numeric_value_canonical,'currency',p_version.value_currency) end,
    'reconciliationState',p_version.reconciliation_state,'validationState',p_version.validation_state,
    'sources',(select jsonb_agg(jsonb_build_object('sourceRecordVersionId',e.source_record_version_id,
        'sourceFingerprint','sha256:'||encode(e.source_fingerprint,'hex'),'sourceRole',e.source_role,
        'contributionWeight',e.contribution_weight_canonical) order by e.source_record_version_id)
      from private.business_fact_sources e where e.fact_version_id=p_version.id),
    'decision',jsonb_build_object('authority',p_version.decision_authority,'policyVersion',p_version.decision_policy_version,
      'actorId',p_version.decision_actor_id,'decidedAt',to_char(p_version.decision_decided_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reasonCodes',p_version.decision_reason_codes),
    'normalizationVersion',p_version.normalization_version,'transformationVersion',p_version.transformation_version,
    'sourceObservedAt',to_char(p_version.source_observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt',to_char(p_version.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'factFingerprint','sha256:'||encode(p_version.fact_fingerprint,'hex'))
  from private.canonical_business_facts f where f.id=p_version.fact_id and f.fact_kind='recognized_revenue'
    and (p_version.value_kind='money' or p_version.reconciliation_state='tombstone');
$function$;

create function public.discover_qbo_accounting_connections_v1(p_after_connection_id uuid,p_maximum_results integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare result jsonb;
begin
  perform private.assert_integration_provider_source_authority_v1();
  if p_maximum_results is null or p_maximum_results not between 1 and 25 then
    raise exception 'qbo_accounting_page_invalid' using errcode='22023'; end if;
  select coalesce(jsonb_agg(connection_id order by connection_id),'[]'::jsonb) into result from (
    select a.connection_id from private.qbo_accounting_authority_versions a
    join private.integration_connections c on c.id=a.connection_id and c.workspace_id=a.workspace_id
      and c.business_entity_id=a.business_entity_id and c.connection_generation=a.connection_generation
    where a.enabled and a.effective_from<=transaction_timestamp() and c.provider_environment='production'
      and (p_after_connection_id is null or a.connection_id>p_after_connection_id)
      and c.provider_key='quickbooks_online' and c.status in ('initializing','active','degraded')
      and not exists(select 1 from private.qbo_accounting_authority_versions newer where newer.workspace_id=a.workspace_id
        and newer.business_entity_id=a.business_entity_id and newer.immutable_version>a.immutable_version)
    order by a.connection_id limit p_maximum_results) candidates;
  return result;
end;
$function$;

create function public.read_qbo_accounting_page_v1(p_connection_id uuid,p_after_source_id uuid,p_maximum_results integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a private.qbo_accounting_authority_versions; accounts jsonb; account_hash bytea; realm text; refs jsonb;
  sources jsonb; from_date date; through_date date; mapped_at timestamptz:=date_trunc('milliseconds',transaction_timestamp());
begin
  perform private.assert_integration_provider_source_authority_v1();
  if p_connection_id is null or p_maximum_results is null or p_maximum_results not between 1 and 25 then
    raise exception 'qbo_accounting_page_invalid' using errcode='22023'; end if;
  a:=private.qbo_accounting_current_authority_v1(p_connection_id);
  accounts:=private.qbo_accounting_account_context_v1(a);
  account_hash:=private.phase_3_contract_fingerprint_v1(accounts);
  realm:=accounts #>> '{0,version,normalizedProjection,provider,realmId}';
  if realm is null or private.qbo_phase_8b_realm_fingerprint_v1(realm)<>a.realm_fingerprint then
    raise exception 'qbo_accounting_accounts_unavailable' using errcode='55000'; end if;
  select coalesce(jsonb_agg(value #>> '{version,normalizedProjection,id}' order by value #>> '{version,normalizedProjection,id}'),'[]'::jsonb)
    into refs from jsonb_array_elements(accounts) where value #>> '{version,normalizedProjection,relationships,AccountType,value}' in ('Income','Other Income');
  if jsonb_array_length(refs)=0 then raise exception 'qbo_accounting_revenue_accounts_unavailable' using errcode='55000'; end if;
  select (min((t.control_metadata->>'windowStartAt')::timestamptz) at time zone 'UTC')::date,
      (max((t.control_metadata->>'windowEndAt')::timestamptz) at time zone 'UTC')::date into from_date,through_date
    from private.integration_sync_tasks t where t.connection_id=a.connection_id and t.workspace_id=a.workspace_id
      and t.business_entity_id=a.business_entity_id and t.connection_generation=a.connection_generation
      and t.provider_key='quickbooks_online' and t.provider_environment='production' and t.stream_key='qbo_invoice';
  if from_date is null or through_date is null or through_date>(mapped_at at time zone 'UTC')::date then
    raise exception 'qbo_accounting_coverage_boundary_unavailable' using errcode='55000'; end if;
  select coalesce(jsonb_agg(payload order by source_id),'[]'::jsonb) into sources from (
    select s.id as source_id,jsonb_build_object('sourceRecordId',s.id,
      'sourceIdentityFingerprint','sha256:'||encode(s.source_identity_fingerprint,'hex'),
      'sourceVersion',private.phase_8b_source_version_json_v1(v),
      'effectiveValidationState','valid',
      'priorSourceVersion',case when previous.id is null then null else private.phase_8b_source_version_json_v1(prior_version) end,
      'priorEffectiveValidationState',case when previous.id is null then null else 'valid' end,
      'priorFacts',coalesce((select jsonb_agg(private.qbo_accounting_fact_json_v1(fv) order by f.fact_key)
        from private.canonical_business_fact_versions fv join private.canonical_business_facts f on f.current_version_id=fv.id
        where fv.id=any(previous.fact_version_ids) and fv.reconciliation_state='accepted'),'[]'::jsonb),
      'factHeads',coalesce((select jsonb_agg(jsonb_build_object('factKey',f.fact_key,'id',head.id,
          'immutableVersion',head.immutable_version) order by f.fact_key)
        from private.canonical_business_facts f join private.canonical_business_fact_versions head on head.id=f.current_version_id
        where f.workspace_id=a.workspace_id and f.business_entity_id=a.business_entity_id
          and f.fact_kind='recognized_revenue' and head.normalization_version='qbo_production_accounting_mapping_v1'
          and exists(select 1 from private.business_fact_sources edge
            join private.external_source_record_versions origin on origin.id=edge.source_record_version_id
            where edge.fact_version_id=head.id and edge.source_role='primary' and origin.source_record_id=s.id)),
        '[]'::jsonb)) as payload
    from private.external_source_records s join private.external_source_record_versions v on v.id=s.current_version_id
    left join lateral(select p.* from private.qbo_accounting_source_applications p where p.source_record_id=s.id
      order by p.created_at desc,p.id desc limit 1) previous on true
    left join private.external_source_record_versions prior_version on prior_version.id=previous.source_version_id
    where s.workspace_id=a.workspace_id and s.business_entity_id=a.business_entity_id and s.connection_id=a.connection_id
      and s.mapping_id=a.mapping_id and s.provider_key='quickbooks_online'
      and (p_after_source_id is null or s.id>p_after_source_id)
      and (v.validation_state='valid' or (v.change_kind='deleted' and exists(select 1 from private.qbo_production_source_validation_work w
        where w.source_version_id=v.id and w.state='valid')))
      and exists(select 1 from private.qbo_production_source_validation_work w where w.source_record_id=s.id
        and (w.completed_version_id=v.id or (w.source_version_id=v.id and v.change_kind='deleted')) and w.state='valid'
        and w.connection_generation=a.connection_generation and w.mapping_id=a.mapping_id and w.realm_fingerprint=a.realm_fingerprint)
      and not exists(select 1 from private.qbo_accounting_source_applications done where done.source_version_id=v.id
        and done.authority_id=a.id and done.account_context_fingerprint=account_hash
        and done.normalization_version='qbo_production_accounting_mapping_v1')
    order by s.id limit p_maximum_results) page;
  return jsonb_build_object('authorityId',a.id,'connectionGeneration',a.connection_generation,'mappingId',a.mapping_id,
    'mappedAt',to_char(mapped_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'accountContextFingerprint','sha256:'||encode(account_hash,'hex'),
    'context',jsonb_build_object('workspaceId',a.workspace_id,'businessEntityId',a.business_entity_id,'connectionId',a.connection_id,
      'realmId',realm,'providerEnvironment','production','sourceAuthorityPolicyVersionId',a.policy_version_id,
      'policyEffectiveFrom',to_char(a.effective_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'accountingBasis','accrual','reportingCurrency',a.source_currency,'postingDateFrom',from_date,
      'postingDateThrough',through_date,'revenueAccountRefs',refs),
    'accountSources',accounts,
    'sources',sources);
end;
$function$;

create function private.qbo_accounting_fact_fingerprint_v1(p_fact jsonb)
returns bytea language sql immutable set search_path='' as $function$
  select private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'fingerprintPurpose','canonical_business_fact','fingerprintVersion','external_integration_fingerprint_v1',
    'payload',(p_fact-array['id','immutableVersion','createdAt','factFingerprint'])||jsonb_build_object(
      'dimensions',(select coalesce(jsonb_agg(value order by private.phase_3_canonical_json_v1(value) collate "C"),'[]')
        from jsonb_array_elements(p_fact->'dimensions')),
      'sources',(select jsonb_agg(value order by private.phase_3_canonical_json_v1(value) collate "C")
        from jsonb_array_elements(p_fact->'sources')),
      'decision',((p_fact->'decision')-'decidedAt')||jsonb_build_object('reasonCodes',
        (select coalesce(jsonb_agg(value order by private.phase_3_canonical_json_v1(value) collate "C"),'[]')
          from jsonb_array_elements(p_fact#>'{decision,reasonCodes}'))))));
$function$;

-- One exact source identity may establish a first contribution without
-- inventing a duplicate reconciliation candidate. Corrections retract the
-- exact prior event; report observations never enter this helper.
create function private.qbo_accounting_event_v1(
  p_authority private.qbo_accounting_authority_versions,p_fact uuid,p_target uuid,p_request_id text
) returns uuid language plpgsql security definer set search_path='' as $function$
declare fv private.canonical_business_fact_versions; f private.canonical_business_facts;
  target private.fact_contribution_events; case_id uuid:=gen_random_uuid(); batch_id uuid:=gen_random_uuid();
  event_id uuid:=gen_random_uuid(); economic bytea; identity_hash bytea; source_id uuid; source_hash bytea;
  kind text:=case when p_target is null then 'establish' else 'retract' end; now_at timestamptz:=transaction_timestamp();
begin
  select * into strict fv from private.canonical_business_fact_versions where id=p_fact
    and workspace_id=p_authority.workspace_id and business_entity_id=p_authority.business_entity_id;
  select * into strict f from private.canonical_business_facts where id=fv.fact_id;
  if f.fact_kind<>'recognized_revenue' or fv.value_kind<>'money' or fv.accounting_basis<>'accrual'
    or fv.value_currency<>p_authority.source_currency then
    raise exception 'qbo_accounting_contribution_denied' using errcode='42501'; end if;
  select e.source_record_version_id,e.source_fingerprint into strict source_id,source_hash
    from private.business_fact_sources e where e.fact_version_id=fv.id and e.source_role='primary';
  identity_hash:=private.phase_3_contract_fingerprint_v1(jsonb_build_object('contract','qbo_posted_revenue_contribution_v1',
    'workspace',f.workspace_id,'entity',f.business_entity_id,'fact',f.id,'family',p_authority.contribution_family_version_id));
  economic:=f.identity_fingerprint;
  if kind='retract' then
    select * into strict target from private.fact_contribution_events where id=p_target and fact_version_id=fv.id
      and workspace_id=f.workspace_id and business_entity_id=f.business_entity_id and event_kind='establish'
      and contribution_family_version_id=p_authority.contribution_family_version_id for update;
    if exists(select 1 from private.fact_contribution_events where target_contribution_event_id=target.id and event_kind='retract') then
      return null; end if;
    identity_hash:=target.contribution_identity_fingerprint; economic:=target.economic_identity_fingerprint;
  elsif fv.reconciliation_state<>'accepted' or fv.validation_state<>'valid' or f.current_version_id<>fv.id
    or exists(select 1 from private.fact_contribution_events e where e.workspace_id=f.workspace_id
      and e.business_entity_id=f.business_entity_id and e.contribution_identity_fingerprint=identity_hash and e.event_kind='establish'
      and not exists(select 1 from private.fact_contribution_events r where r.target_contribution_event_id=e.id and r.event_kind='retract')) then
    raise exception 'qbo_accounting_contribution_duplicate' using errcode='42501';
  end if;
  insert into private.reconciliation_cases(id,contract_version,workspace_id,business_entity_id,source_authority_policy_version_id,
    case_fingerprint,evaluated_at,effective_at,match_rule_version,match_tier,classification,case_state,winning_fact_version_id,
    deterministic_features,decision_authority,decision_policy_version,decision_decided_at,decision_reason_codes)
  values(case_id,'reconciliation_case_v2',f.workspace_id,f.business_entity_id,p_authority.policy_version_id,
    private.phase_3_contract_fingerprint_v1(jsonb_build_object('contract','qbo_accounting_case_v1','fact',fv.id,
      'target',p_target,'authority',p_authority.id,'kind',kind)),now_at,now_at,'qbo_production_accounting_mapping_v1',
    'exact_source_identity_version',case when kind='retract' then 'source_withdrawal' else 'source_admission' end,
    'resolved',case when kind='establish' then fv.id else null end,
    jsonb_build_object('sourceIdentityMatch',false,'explicitLineageMatch',false,'economicIdentityMatch',false,
      'valueMatch',false,'accountingBasisMatch',false,'currencyMatch',false,'periodMatch',false,'dimensionsMatch',false,'fuzzyProposalOnly',false),
    'deterministic_policy','qbo_production_accounting_mapping_v1',now_at,array['qbo_exact_source_accounting_policy']);
  insert into private.fact_contribution_batches(id,contract_version,workspace_id,business_entity_id,reconciliation_case_id,
    source_authority_policy_version_id,contribution_family_version_id,batch_fingerprint,decision_authority,decision_policy_version,
    decision_decided_at,decision_reason_codes)
  values(batch_id,'fact_contribution_batch_v2',f.workspace_id,f.business_entity_id,case_id,p_authority.policy_version_id,
    p_authority.contribution_family_version_id,private.phase_3_contract_fingerprint_v1(jsonb_build_object('case',case_id,'kind',kind)),
    'deterministic_policy','qbo_production_accounting_mapping_v1',now_at,array['qbo_exact_source_accounting_policy']);
  insert into private.fact_contribution_events(id,contract_version,workspace_id,business_entity_id,contribution_batch_id,
    reconciliation_case_id,source_authority_policy_version_id,contribution_family_version_id,fact_version_id,event_kind,
    target_contribution_event_id,contribution_identity_fingerprint,economic_identity_fingerprint,measure_key,aggregate_key,
    effective_at,period_start,period_end,dimensions,accounting_basis,currency,value_canonical,value,registry_version,event_fingerprint)
  values(event_id,'fact_contribution_event_v1',f.workspace_id,f.business_entity_id,batch_id,case_id,p_authority.policy_version_id,
    p_authority.contribution_family_version_id,fv.id,kind,p_target,identity_hash,economic,'recognized_revenue','recognized_revenue_actual',
    fv.effective_at,fv.period_start,fv.period_end,fv.dimensions,fv.accounting_basis,fv.value_currency,
    fv.numeric_value_canonical,fv.numeric_value,'vaeroex_deterministic_dependencies_v1',
    private.phase_3_contract_fingerprint_v1(jsonb_build_object('contract','qbo_accounting_event_v1','authority',p_authority.id,
      'fact',fv.id,'factFingerprint',encode(fv.fact_fingerprint,'hex'),'target',p_target,'kind',kind,
      'identity',encode(identity_hash,'hex'),'amount',fv.numeric_value_canonical)));
  insert into private.reconciliation_case_members(workspace_id,business_entity_id,reconciliation_case_id,member_order,
    fact_version_id,source_record_version_id,source_fingerprint,economic_identity_fingerprint,member_role,authority_rank,
    additive_candidate,canonical_value)
  values(f.workspace_id,f.business_entity_id,case_id,1,fv.id,source_id,source_hash,economic,
    case when kind='retract' then 'excluded' else 'winner' end,1,kind='establish',fv.numeric_value_canonical);
  insert into private.integration_audit_events(workspace_id,business_entity_id,connection_id,actor_type,actor_id,action,outcome,
    target_type,target_id,request_id,metadata,retention_class)
  values(f.workspace_id,f.business_entity_id,p_authority.connection_id,'service','integration_provider_source_authority',
    'fact_contribution_batch.commit','succeeded','fact_contribution_batch',batch_id::text,p_request_id,
    jsonb_build_object('inserted_events',1),'operational');
  return event_id;
end;
$function$;

-- Historical provenance is required for a retraction, but cannot authorize a
-- positive contribution. Permit only the exact prior edge of an already
-- recorded same-transaction retraction or a tombstone's immutable predecessor.
create function private.qbo_accounting_inactive_reference_v1(p_workspace uuid,p_entity uuid,p_fact uuid,p_version uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare valid boolean;
begin
  -- An inactive ledger account is historical classification evidence, not an
  -- additive financial source. It must still be the current validated Account.
  perform c.id from private.external_source_record_versions v
    join private.external_source_records s on s.id=v.source_record_id and s.current_version_id=v.id
    join private.integration_connections c on c.id=s.connection_id and c.workspace_id=s.workspace_id and c.business_entity_id=s.business_entity_id
    join private.provider_entity_mappings m on m.id=s.mapping_id and m.connection_id=c.id
    where v.id=p_version and c.workspace_id=p_workspace and c.business_entity_id=p_entity
      and c.provider_key='quickbooks_online' and c.provider_environment='production'
      and c.status in ('initializing','active','degraded') and m.status='active'
    for share of c,m,s;
  if not found then return false; end if;
  select exists(select 1 from private.external_source_record_versions v
    join private.external_source_records s on s.id=v.source_record_id and s.current_version_id=v.id
    join private.integration_connections c on c.id=s.connection_id and c.workspace_id=s.workspace_id and c.business_entity_id=s.business_entity_id
    join private.provider_entity_mappings m on m.id=s.mapping_id and m.connection_id=c.id
    join private.qbo_production_source_validation_work w on w.completed_version_id=v.id and w.source_record_id=s.id
      and w.connection_id=c.id and w.mapping_id=m.id and w.connection_generation=c.connection_generation
    join private.canonical_business_fact_versions fact on fact.id=p_fact and fact.workspace_id=p_workspace and fact.business_entity_id=p_entity
    where v.id=p_version and v.workspace_id=p_workspace and v.business_entity_id=p_entity
      and v.provider_record_type='Account' and v.provider_key='quickbooks_online'
      and v.validation_state='valid' and v.change_kind not in ('deleted','voided')
      and v.normalized_projection->>'status'='inactive' and v.normalized_projection->'active'='false'::jsonb
      and w.state='valid' and w.realm_fingerprint=m.provider_entity_reference_fingerprint
      and fact.normalization_version='qbo_production_accounting_mapping_v1' and fact.reconciliation_state='accepted'
      and exists(select 1 from private.business_fact_sources primary_edge join private.external_source_record_versions primary_version
        on primary_version.id=primary_edge.source_record_version_id where primary_edge.fact_version_id=fact.id
          and primary_edge.source_role='primary' and primary_version.connection_id=c.id
          and primary_version.workspace_id=p_workspace and primary_version.business_entity_id=p_entity)) into valid;
  return valid;
end;
$function$;
revoke all on function private.qbo_accounting_inactive_reference_v1(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;

create or replace function private.guard_qbo_production_source_promotion_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare edge record;
begin
  if tg_table_name='fact_contribution_events' then
    if new.event_kind='retract' then return new; end if;
    for edge in select e.source_record_version_id,e.source_role,e.contribution_weight_canonical from private.business_fact_sources e
      join private.external_source_record_versions v on v.id=e.source_record_version_id
      where e.fact_version_id=new.fact_version_id and e.workspace_id=new.workspace_id
        and e.business_entity_id=new.business_entity_id order by v.source_record_id,e.source_record_version_id
    loop
      if edge.source_role='corroborating' and edge.contribution_weight_canonical='0'
        and private.qbo_accounting_inactive_reference_v1(new.workspace_id,new.business_entity_id,new.fact_version_id,edge.source_record_version_id)
        then continue; end if;
      perform private.assert_qbo_production_source_promotable_v1(new.workspace_id,new.business_entity_id,edge.source_record_version_id);
    end loop;
  elsif tg_table_name='reconciliation_case_members' then
    if new.member_role='excluded' and not new.additive_candidate and exists(
      select 1 from private.fact_contribution_events r join private.fact_contribution_events original
        on original.id=r.target_contribution_event_id and original.event_kind='establish'
      join private.reconciliation_cases rc on rc.id=r.reconciliation_case_id
        and rc.contract_version='reconciliation_case_v2' and rc.classification='source_withdrawal'
      join private.business_fact_sources e on e.fact_version_id=original.fact_version_id
      where r.event_kind='retract' and r.reconciliation_case_id=new.reconciliation_case_id
        and r.workspace_id=new.workspace_id and r.business_entity_id=new.business_entity_id
        and r.fact_version_id=new.fact_version_id and e.source_record_version_id=new.source_record_version_id
        and e.source_fingerprint=new.source_fingerprint) then return new; end if;
    perform private.assert_qbo_production_source_promotable_v1(new.workspace_id,new.business_entity_id,new.source_record_version_id);
  else
    if exists(select 1 from private.canonical_business_fact_versions v join private.business_fact_sources prior_edge
      on prior_edge.fact_version_id=v.prior_version_id and prior_edge.workspace_id=v.workspace_id
        and prior_edge.business_entity_id=v.business_entity_id
      where v.id=new.fact_version_id and v.workspace_id=new.workspace_id and v.business_entity_id=new.business_entity_id
        and v.reconciliation_state='tombstone' and v.value_kind is null
        and prior_edge.source_record_version_id=new.source_record_version_id and prior_edge.source_fingerprint=new.source_fingerprint
        and prior_edge.source_role=new.source_role) then return new; end if;
    if new.source_role='corroborating' and new.contribution_weight_canonical='0'
      and private.qbo_accounting_inactive_reference_v1(new.workspace_id,new.business_entity_id,new.fact_version_id,new.source_record_version_id)
      then return new; end if;
    perform private.assert_qbo_production_source_promotable_v1(new.workspace_id,new.business_entity_id,new.source_record_version_id);
  end if;
  return new;
end;
$function$;

create function private.qbo_accounting_retract_source_v1(
  p_source uuid,p_authority private.qbo_accounting_authority_versions,p_keep_keys text[],p_request_id text,
  p_keep_fact_versions uuid[] default '{}'
) returns integer language plpgsql security definer set search_path='' as $function$
declare item record; v private.canonical_business_fact_versions; payload jsonb; identity_hash bytea;
  now_text text:=to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); count_events integer:=0;
begin
  for item in select e.id,e.fact_version_id from private.fact_contribution_events e
    join private.business_fact_sources edge on edge.fact_version_id=e.fact_version_id and edge.source_role='primary'
    join private.external_source_record_versions source on source.id=edge.source_record_version_id
    where source.source_record_id=p_source and e.workspace_id=p_authority.workspace_id
      and e.business_entity_id=p_authority.business_entity_id and e.contribution_family_version_id=p_authority.contribution_family_version_id
      and not(e.fact_version_id=any(p_keep_fact_versions))
      and e.event_kind='establish' and not exists(select 1 from private.fact_contribution_events r
        where r.target_contribution_event_id=e.id and r.event_kind='retract') order by e.id for update of e
  loop
    perform private.qbo_accounting_event_v1(p_authority,item.fact_version_id,item.id,p_request_id);
    count_events:=count_events+1;
  end loop;
  for item in select distinct f.id,f.fact_key,f.identity_fingerprint from private.canonical_business_facts f
    join private.canonical_business_fact_versions fv on fv.id=f.current_version_id
    join private.business_fact_sources edge on edge.fact_version_id=fv.id and edge.source_role='primary'
    join private.external_source_record_versions source on source.id=edge.source_record_version_id
    where source.source_record_id=p_source and f.workspace_id=p_authority.workspace_id
      and f.business_entity_id=p_authority.business_entity_id and f.fact_kind='recognized_revenue'
      and fv.reconciliation_state='accepted' and not(f.fact_key=any(p_keep_keys)) order by f.id
  loop
    select fv.* into strict v from private.canonical_business_facts f
      join private.canonical_business_fact_versions fv on fv.id=f.current_version_id where f.id=item.id for update of f;
    payload:=private.qbo_accounting_fact_json_v1(v)||jsonb_build_object('id',gen_random_uuid(),'immutableVersion',v.immutable_version+1,
      'value',null,'reconciliationState','tombstone','createdAt',now_text,
      'decision',jsonb_build_object('authority','deterministic_policy','policyVersion','qbo_production_accounting_mapping_v1',
        'actorId',null,'decidedAt',now_text,'reasonCodes',jsonb_build_array('qbo_source_authority_retracted')));
    payload:=payload||jsonb_build_object('factFingerprint','sha256:'||encode(private.qbo_accounting_fact_fingerprint_v1(payload),'hex'));
    identity_hash:=item.identity_fingerprint;
    perform private.commit_qbo_accounting_fact_internal_v1('sha256:'||encode(identity_hash,'hex'),payload,p_request_id,
      'integration_provider_source_authority');
  end loop;
  return count_events;
end;
$function$;

-- Negative authority is derived from a real source-head or owner-policy change,
-- never from a mapper's claimed disposition. Old history remains immutable.
create function private.invalidate_qbo_accounting_source_v1(p_source uuid,p_request_id text,p_authority_only boolean default false)
returns void language plpgsql security definer set search_path='' as $function$
declare affected record; authority private.qbo_accounting_authority_versions; keep_keys text[];
begin
  for affected in select distinct primary_source.source_record_id,a.id authority_id
    from private.business_fact_sources changed_edge
    join private.external_source_record_versions changed_source on changed_source.id=changed_edge.source_record_version_id
    join private.canonical_business_facts f on f.current_version_id=changed_edge.fact_version_id
    join private.canonical_business_fact_versions fv on fv.id=f.current_version_id
    join private.business_fact_sources primary_edge on primary_edge.fact_version_id=fv.id and primary_edge.source_role='primary'
    join private.external_source_record_versions primary_source on primary_source.id=primary_edge.source_record_version_id
    join private.qbo_accounting_source_applications app on fv.id=any(app.fact_version_ids)
    join private.qbo_accounting_authority_versions a on a.id=app.authority_id
    where changed_source.source_record_id=p_source and fv.reconciliation_state='accepted'
      and fv.normalization_version='qbo_production_accounting_mapping_v1'
      and fv.workspace_id=a.workspace_id and fv.business_entity_id=a.business_entity_id
      and primary_source.connection_id=a.connection_id
    order by primary_source.source_record_id,a.id
  loop
    select * into strict authority from private.qbo_accounting_authority_versions where id=affected.authority_id;
    keep_keys:='{}';
    if p_authority_only then
      select coalesce(array_agg(f.fact_key),'{}') into keep_keys from private.canonical_business_facts f
        join private.business_fact_sources e on e.fact_version_id=f.current_version_id and e.source_role='primary'
        join private.external_source_record_versions v on v.id=e.source_record_version_id
        where v.source_record_id=affected.source_record_id and f.workspace_id=authority.workspace_id
          and f.business_entity_id=authority.business_entity_id;
    end if;
    perform private.qbo_accounting_retract_source_v1(affected.source_record_id,authority,keep_keys,p_request_id);
  end loop;
end;
$function$;

create function private.guard_qbo_accounting_authority_change_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare source_id uuid;
begin
  if tg_table_name='external_source_records' then
    if old.current_version_id is distinct from new.current_version_id and old.current_version_id is not null then
      perform private.invalidate_qbo_accounting_source_v1(new.id,'qbo_source_head_invalidated');
    end if;
  elsif tg_table_name='integration_connections' or tg_table_name='provider_entity_mappings' then
    if new.provider_key<>'quickbooks_online' or new.provider_environment<>'production' then return new; end if;
    if tg_table_name='integration_connections' then
      -- Connectivity failures hide currentness and block new admission, but do
      -- not erase already admitted accounting truth. A same-generation retry
      -- must not orphan that truth behind its immutable application receipt.
      if new.status not in ('disconnecting','disconnected','deleting','deleted') and old.connection_generation=new.connection_generation then return new; end if;
    else
      if new.status='active' and new.row_version=old.row_version then return new; end if;
    end if;
    for source_id in select s.id from private.external_source_records s
      where s.workspace_id=new.workspace_id and s.business_entity_id=new.business_entity_id
        and ((tg_table_name='integration_connections' and s.connection_id=new.id)
          or (tg_table_name='provider_entity_mappings' and s.mapping_id=new.id)) order by s.id for update
    loop perform private.invalidate_qbo_accounting_source_v1(source_id,'qbo_connection_authority_changed',true); end loop;
  else
    for source_id in select s.id from private.external_source_records s
      where s.workspace_id=new.workspace_id and s.business_entity_id=new.business_entity_id
        and exists(select 1 from private.qbo_accounting_source_applications app where app.source_record_id=s.id
          and app.authority_id<>new.id) order by s.id for update
    loop perform private.invalidate_qbo_accounting_source_v1(source_id,'qbo_owner_authority_changed',true); end loop;
  end if;
  return new;
end;
$function$;
create trigger invalidate_qbo_accounting_source after update of current_version_id on private.external_source_records
  for each row execute function private.guard_qbo_accounting_authority_change_v1();
create trigger invalidate_qbo_accounting_authority after insert on private.qbo_accounting_authority_versions
  for each row execute function private.guard_qbo_accounting_authority_change_v1();
create trigger invalidate_qbo_accounting_connection after update of status,connection_generation on private.integration_connections
  for each row execute function private.guard_qbo_accounting_authority_change_v1();
create trigger invalidate_qbo_accounting_mapping after update of status,row_version on private.provider_entity_mappings
  for each row execute function private.guard_qbo_accounting_authority_change_v1();
revoke all on function private.invalidate_qbo_accounting_source_v1(uuid,text,boolean),private.guard_qbo_accounting_authority_change_v1()
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;

-- A tombstoned fact and a fully retracted membership are historical evidence,
-- not a surviving economic effect. Unrecognized/partially retracted history
-- still blocks tombstone validation and freshness.
create or replace function private.qbo_production_source_has_effects_v1(p_source uuid)
returns boolean language sql volatile security definer set search_path='' as $function$
  select exists(select 1 from private.external_source_record_versions v join private.business_fact_sources e
    on e.source_record_version_id=v.id join private.canonical_business_facts f on f.id=(
      select fact_id from private.canonical_business_fact_versions where id=e.fact_version_id)
    join private.canonical_business_fact_versions head on head.id=f.current_version_id
    where v.source_record_id=p_source and head.reconciliation_state<>'tombstone')
    or exists(select 1 from private.external_source_record_versions v join private.reconciliation_case_members m
      on m.source_record_version_id=v.id where v.source_record_id=p_source and not exists(
        select 1 from private.fact_contribution_events original join private.fact_contribution_events retract
          on retract.target_contribution_event_id=original.id and retract.event_kind='retract'
        where original.event_kind='establish' and original.fact_version_id=m.fact_version_id
          and original.reconciliation_case_id=m.reconciliation_case_id
          and original.workspace_id=m.workspace_id and original.business_entity_id=m.business_entity_id)
      and not exists(select 1 from private.fact_contribution_events retract
        where retract.event_kind='retract' and retract.fact_version_id=m.fact_version_id
          and retract.reconciliation_case_id=m.reconciliation_case_id
          and retract.workspace_id=m.workspace_id and retract.business_entity_id=m.business_entity_id
          and m.member_role='excluded' and not m.additive_candidate and exists(select 1
            from private.reconciliation_cases rc where rc.id=m.reconciliation_case_id
              and rc.contract_version='reconciliation_case_v2' and rc.classification='source_withdrawal')));
$function$;

create function public.commit_qbo_accounting_source_v1(
  p_connection_id uuid,p_source_record_id uuid,p_source_version_id uuid,p_authority_id uuid,
  p_account_context_fingerprint text,p_disposition text,p_reason_codes text[],p_facts jsonb,p_request_id text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare a private.qbo_accounting_authority_versions; s private.external_source_records; v private.external_source_record_versions;
  prior private.qbo_accounting_source_applications; existing private.qbo_accounting_source_applications;
  accounts jsonb; account_hash bytea; plan_hash bytea; fact jsonb; line jsonb; account jsonb; payload jsonb;
  record_type text; record_id text; realm text; line_id text; account_id text; v_fact_key text; canonical_amount text;
  identity_hash bytea; outcome jsonb; application_id uuid; ids uuid[]:='{}'; keys text[]:='{}';
  keep_fact_versions uuid[]:='{}'; unchanged_fact private.canonical_business_fact_versions;
  expected_dimensions jsonb; from_date date; through_date date;
  expected_fact_count integer:=0; economic_line_count integer:=0; retracted integer; total numeric:=0; amount numeric;
  is_journal boolean; doc jsonb; evidence jsonb; source_ids uuid[];
begin
  perform private.assert_integration_provider_source_authority_v1();
  if p_disposition is null or p_disposition not in ('mapped_partial','non_contributing','review_required','retraction_required')
    or not coalesce(private.is_bounded_identifier_array_v1(p_reason_codes,32),false) or cardinality(p_reason_codes)=0
    or not coalesce(private.is_bounded_identifier_v1(p_request_id),false)
    or not coalesce(private.is_sha256_fingerprint_v1(p_account_context_fingerprint),false)
    or jsonb_typeof(p_facts) is distinct from 'array' or jsonb_array_length(p_facts)>500 then
    raise exception 'qbo_accounting_commit_invalid' using errcode='22023'; end if;
  a:=private.qbo_accounting_current_authority_v1(p_connection_id);
  if a.id is distinct from p_authority_id then raise exception 'qbo_accounting_authority_stale' using errcode='40001'; end if;
  -- Lock every referenced source in a stable order. Native ingestion/validation
  -- uses connection/mapping before source, so a changed account or transaction
  -- cannot race a positive financial admission.
  perform r.id from private.external_source_records r where r.connection_id=a.connection_id and r.mapping_id=a.mapping_id
    and r.workspace_id=a.workspace_id and r.business_entity_id=a.business_entity_id
    and (r.id=p_source_record_id or r.provider_record_type='Account') order by r.id for update;
  select * into s from private.external_source_records where id=p_source_record_id and connection_id=a.connection_id
    and workspace_id=a.workspace_id and business_entity_id=a.business_entity_id and mapping_id=a.mapping_id
    and provider_key='quickbooks_online';
  if not found or s.current_version_id is distinct from p_source_version_id then
    raise exception 'qbo_accounting_source_stale' using errcode='40001'; end if;
  select * into strict v from private.external_source_record_versions where id=s.current_version_id;
  if not exists(select 1 from private.qbo_production_source_validation_work w where w.source_record_id=s.id
    and (w.completed_version_id=v.id or (w.source_version_id=v.id and v.change_kind='deleted')) and w.state='valid'
    and w.connection_generation=a.connection_generation and w.mapping_id=a.mapping_id and w.realm_fingerprint=a.realm_fingerprint) then
    raise exception 'qbo_accounting_source_validation_required' using errcode='42501'; end if;
  accounts:=private.qbo_accounting_account_context_v1(a); account_hash:=private.phase_3_contract_fingerprint_v1(accounts);
  if account_hash<>private.sha256_fingerprint_bytes_v1(p_account_context_fingerprint) then
    raise exception 'qbo_accounting_accounts_stale' using errcode='40001'; end if;
  plan_hash:=private.phase_3_contract_fingerprint_v1(jsonb_build_object('source',v.id,'authority',a.id,
    'accounts',p_account_context_fingerprint,'disposition',p_disposition,'reasons',p_reason_codes,
    'facts',(select coalesce(jsonb_agg(jsonb_build_object('factKey',f->>'factKey','factFingerprint',f->>'factFingerprint')
      order by f->>'factKey'),'[]'::jsonb) from jsonb_array_elements(p_facts) f)));
  select * into existing from private.qbo_accounting_source_applications where source_version_id=v.id
    and authority_id=a.id and account_context_fingerprint=account_hash and normalization_version='qbo_production_accounting_mapping_v1';
  if found then
    if existing.plan_fingerprint<>plan_hash then raise exception 'qbo_accounting_replay_conflict' using errcode='42501'; end if;
    return jsonb_build_object('applicationId',existing.id,'factVersionIds',existing.fact_version_ids,'idempotent',true);
  end if;
  select * into prior from private.qbo_accounting_source_applications where source_record_id=s.id order by created_at desc,id desc limit 1;
  if p_disposition<>'mapped_partial' and jsonb_array_length(p_facts)<>0 then
    raise exception 'qbo_accounting_nonadditive_denied' using errcode='42501'; end if;
  doc:=v.normalized_projection; record_type:=v.provider_record_type; record_id:=v.provider_record_id;
  realm:=doc#>>'{provider,realmId}'; is_journal:=record_type='JournalEntry';
  if p_disposition='mapped_partial' then
    perform private.assert_qbo_production_source_promotable_v1(a.workspace_id,a.business_entity_id,v.id);
    select (min((t.control_metadata->>'windowStartAt')::timestamptz) at time zone 'UTC')::date,
      (max((t.control_metadata->>'windowEndAt')::timestamptz) at time zone 'UTC')::date into from_date,through_date
      from private.integration_sync_tasks t where t.connection_id=a.connection_id and t.workspace_id=a.workspace_id
        and t.business_entity_id=a.business_entity_id and t.connection_generation=a.connection_generation
        and t.provider_environment='production' and t.provider_key='quickbooks_online' and t.stream_key='qbo_invoice';
    if from_date is null or through_date is null or v.posting_date is null or v.posting_date<from_date
      or v.posting_date>through_date or v.posting_date>(transaction_timestamp() at time zone 'UTC')::date
      or v.posting_date<(a.effective_from at time zone 'UTC')::date then
      raise exception 'qbo_accounting_posting_interval_denied' using errcode='42501'; end if;
    evidence:=doc->'accountingEvidence';
    if record_type not in ('Invoice','SalesReceipt','CreditMemo','RefundReceipt','JournalEntry')
      or doc->>'minimizationVersion' is distinct from 'qbo_minimizer_v2' or v.normalized_schema_version<>'qbo_minimizer_v2'
      or doc->>'status' is distinct from 'active' or doc->>'id' is distinct from record_id
      or doc->>'recordType' is distinct from record_type or doc#>>'{provider,sourceEnvironment}' is distinct from 'production'
      or private.qbo_phase_8b_realm_fingerprint_v1(realm) is distinct from a.realm_fingerprint
      or v.accounting_currency is distinct from a.source_currency
      or evidence->'sparse' is distinct from 'false'::jsonb or evidence->'hasDiscountDetail' is distinct from 'false'::jsonb
      or evidence->'hasTaxLines' is distinct from 'false'::jsonb
      or (evidence->>'globalTaxCalculation' is not null and evidence->>'globalTaxCalculation' not in ('TaxExcluded','NotApplicable'))
      or (evidence->'hasTaxDetail'='true'::jsonb and evidence#>>'{totalTax,amount}' is distinct from '0')
      or (evidence#>>'{totalTax,amount}' is not null and evidence#>>'{totalTax,amount}'<>'0')
      or (doc#>>'{accounting,exchangeRate}' is not null and doc#>>'{accounting,exchangeRate}'<>'1')
      or (doc#>>'{accounting,homeCurrency}' is not null and doc#>>'{accounting,homeCurrency}'<>a.source_currency) then
      raise exception 'qbo_accounting_posting_semantics_denied' using errcode='42501'; end if;
    if (select count(*) from jsonb_array_elements(doc->'lines') l where l->>'lineId' is not null)<>
      (select count(distinct l->>'lineId') from jsonb_array_elements(doc->'lines') l) then
      raise exception 'qbo_accounting_line_identity_denied' using errcode='42501'; end if;
    for line in select value from jsonb_array_elements(doc->'lines') loop
      if line#>'{accountingEvidence,hasGroupDetail}' is distinct from 'false'::jsonb then
        raise exception 'qbo_accounting_line_semantics_denied' using errcode='42501'; end if;
      if not is_journal and (line->>'detailType' in ('DescriptionOnly','SubTotalLineDetail')
        or (line->>'detailType'='SalesItemLineDetail' and line->'itemRef'='null'::jsonb)) then continue; end if;
      if line#>'{accountingEvidence,hasDiscountDetail}' is distinct from 'false'::jsonb
        or line#>'{accountingEvidence,hasTaxDetail}' is distinct from 'false'::jsonb
        or line#>'{accountingEvidence,taxInclusiveAmount}' is distinct from 'null'::jsonb
        or (line#>>'{accountingEvidence,taxCodeRef,value}' is not null and line#>>'{accountingEvidence,taxCodeRef,value}'<>'NON') then
        raise exception 'qbo_accounting_line_semantics_denied' using errcode='42501'; end if;
      if line->>'detailType' is distinct from (case when is_journal then 'JournalEntryLineDetail' else 'SalesItemLineDetail' end)
        or line->>'lineId' is null or line#>>'{amount,currency}' is distinct from a.source_currency
        or not coalesce(private.is_canonical_numeric_v1(line#>>'{amount,amount}',30,9,true,false,false),false)
        or line#>>'{accountingEvidence,accountReferenceKind}' is distinct from (case when is_journal then 'account_ref' else 'item_account_ref' end) then
        raise exception 'qbo_accounting_posting_account_denied' using errcode='42501'; end if;
      account_id:=line#>>'{accountRef,value}';
      select value into account from jsonb_array_elements(accounts) where value#>>'{version,normalizedProjection,id}'=account_id;
      if not found then raise exception 'qbo_accounting_account_evidence_missing' using errcode='42501'; end if;
      amount:=(line#>>'{amount,amount}')::numeric;
      if is_journal then
        if amount<0 or line->>'postingType' not in ('credit','debit') or line->>'postingType' is null then
          raise exception 'qbo_accounting_journal_sign_denied' using errcode='42501'; end if;
        if line->>'postingType'='debit' then amount:=-amount; end if;
      end if;
      total:=total+amount; economic_line_count:=economic_line_count+1;
      if account#>>'{version,normalizedProjection,relationships,AccountType,value}' in ('Income','Other Income') then
        expected_fact_count:=expected_fact_count+1;
        v_fact_key:='qbo_recognized_revenue/'||lower(record_type)||'/'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
          'fingerprintPurpose','qbo_canonical_fact_identity','fingerprintVersion','qbo_canonical_fact_identity_v2',
          'realmId',realm,'recordType',record_type,'recordId',record_id,'lineIdentity',line->>'lineId',
          'measure','recognized_revenue','providerEnvironment','production')),'hex');
        select value into fact from jsonb_array_elements(p_facts) where value->>'factKey'=v_fact_key;
        if not found or (select count(*) from jsonb_array_elements(p_facts) f where f->>'factKey'=v_fact_key)<>1 then
          raise exception 'qbo_accounting_complete_fact_set_required' using errcode='42501'; end if;
        if record_type in ('CreditMemo','RefundReceipt') then amount:=-amount; end if;
        select coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value) order by ordinal),'[]'::jsonb)
          into expected_dimensions from (values
            (1,'item_ref',line#>>'{itemRef,value}'),(2,'account_ref',line#>>'{accountRef,value}'),
            (3,'entity_ref',line#>>'{entityRef,value}')) dimensions(ordinal,key,value) where value is not null;
        perform private.validate_canonical_fact_payload_v2(fact);
        if fact->>'workspaceId'<>a.workspace_id::text or fact->>'businessEntityId'<>a.business_entity_id::text
          or fact->>'factKind'<>'recognized_revenue' or fact->>'reconciliationState'<>'accepted' or fact->>'validationState'<>'valid'
          or fact->>'normalizationVersion'<>'qbo_production_accounting_mapping_v1'
          or fact->>'transformationVersion'<>'qbo_production_accounting_mapping_v1'
          or fact#>>'{accounting,basis}'<>'accrual' or fact#>>'{value,kind}'<>'money'
          or fact#>>'{accounting,sourceCurrency}'<>a.source_currency or fact#>>'{accounting,reportingCurrency}'<>a.source_currency
          or fact#>>'{value,currency}'<>a.source_currency or (fact#>>'{value,amount}')::numeric<>amount
          or fact#>>'{temporal,postingDate}' is distinct from v.posting_date::text
          or (fact#>>'{temporal,effectiveAt}')::timestamptz is distinct from (v.posting_date::text||'T00:00:00Z')::timestamptz
          or fact#>'{temporal,periodStart}' is distinct from 'null'::jsonb or fact#>'{temporal,periodEnd}' is distinct from 'null'::jsonb
          or fact#>'{temporal,fiscalYear}' is distinct from 'null'::jsonb or fact#>'{temporal,fiscalPeriod}' is distinct from 'null'::jsonb
          or fact#>'{temporal,sourceTimeZone}' is distinct from 'null'::jsonb or fact#>'{temporal,closedPeriod}' is distinct from 'false'::jsonb
          or fact->'dimensions' is distinct from expected_dimensions
          or (fact->>'sourceObservedAt')::timestamptz is distinct from v.observed_at
          or fact#>'{accounting,exchangeRate}' is distinct from 'null'::jsonb
          or fact#>'{accounting,exchangeRateSource}' is distinct from 'null'::jsonb
          or fact#>>'{decision,authority}'<>'deterministic_policy' or fact#>>'{decision,policyVersion}'<>'qbo_production_accounting_mapping_v1'
          or private.qbo_accounting_fact_fingerprint_v1(fact)<>private.sha256_fingerprint_bytes_v1(fact->>'factFingerprint')
          or jsonb_array_length(fact->'sources')<>2
          or not exists(select 1 from jsonb_array_elements(fact->'sources') e where e->>'sourceRecordVersionId'=v.id::text
            and e->>'sourceFingerprint'='sha256:'||encode(v.source_fingerprint,'hex') and e->>'sourceRole'='primary' and e->>'contributionWeight'='1')
          or not exists(select 1 from jsonb_array_elements(fact->'sources') e where e->>'sourceRecordVersionId'=account->>'sourceVersionId'
            and e->>'sourceFingerprint'=account->>'sourceFingerprint' and e->>'sourceRole'='corroborating' and e->>'contributionWeight'='0') then
          raise exception 'qbo_accounting_fact_binding_denied' using errcode='42501'; end if;
        keys:=array_append(keys,v_fact_key);
        select fv.* into unchanged_fact from private.canonical_business_facts f
          join private.canonical_business_fact_versions fv on fv.id=f.current_version_id
          where f.workspace_id=a.workspace_id and f.business_entity_id=a.business_entity_id
            and f.fact_kind='recognized_revenue' and f.fact_key=v_fact_key and fv.reconciliation_state='accepted'
            and fv.fact_fingerprint=private.sha256_fingerprint_bytes_v1(fact->>'factFingerprint');
        if found and exists(select 1 from private.fact_contribution_events e where e.fact_version_id=unchanged_fact.id
          and e.event_kind='establish' and not exists(select 1 from private.fact_contribution_events r
            where r.target_contribution_event_id=e.id and r.event_kind='retract')) then
          keep_fact_versions:=array_append(keep_fact_versions,unchanged_fact.id); end if;
      end if;
    end loop;
    if expected_fact_count<>jsonb_array_length(p_facts) or expected_fact_count=0
      or (is_journal and (economic_line_count<2 or total<>0))
      or (not is_journal and (doc#>>'{amounts,total,amount}' is null or total<>(doc#>>'{amounts,total,amount}')::numeric)) then
      raise exception 'qbo_accounting_document_balance_denied' using errcode='42501'; end if;
  end if;
  if p_disposition='mapped_partial' then
    retracted:=private.qbo_accounting_retract_source_v1(s.id,a,keys,p_request_id,keep_fact_versions);
  else
    -- Only native source/authority transitions may withdraw financial effects.
    -- A worker-provided classification is not withdrawal authority.
    if exists(select 1 from private.fact_contribution_events e join private.business_fact_sources edge on edge.fact_version_id=e.fact_version_id
      join private.external_source_record_versions origin on origin.id=edge.source_record_version_id
      where origin.source_record_id=s.id and edge.source_role='primary' and e.event_kind='establish' and not exists(select 1
        from private.fact_contribution_events r where r.target_contribution_event_id=e.id and r.event_kind='retract')) then
      raise exception 'qbo_accounting_native_withdrawal_required' using errcode='42501'; end if;
    retracted:=0;
  end if;
  for fact in select value from jsonb_array_elements(p_facts) loop
    select * into unchanged_fact from private.canonical_business_fact_versions where id=any(keep_fact_versions)
      and fact_fingerprint=private.sha256_fingerprint_bytes_v1(fact->>'factFingerprint');
    if found then ids:=array_append(ids,unchanged_fact.id); continue; end if;
    select fv.* into unchanged_fact from private.canonical_business_facts f
      join private.canonical_business_fact_versions fv on fv.id=f.current_version_id
      where f.workspace_id=a.workspace_id and f.business_entity_id=a.business_entity_id
        and f.fact_kind='recognized_revenue' and f.fact_key=fact->>'factKey'
        and fv.reconciliation_state='accepted' and fv.fact_fingerprint=private.sha256_fingerprint_bytes_v1(fact->>'factFingerprint');
    if found then
      ids:=array_append(ids,unchanged_fact.id);
      perform private.qbo_accounting_event_v1(a,unchanged_fact.id,null,p_request_id);
      continue;
    end if;
    identity_hash:=private.phase_3_contract_fingerprint_v1(jsonb_build_object('identityVersion','canonical_fact_identity_v1',
      'workspaceId',a.workspace_id,'businessEntityId',a.business_entity_id,'factKind','recognized_revenue','factKey',fact->>'factKey'));
    outcome:=private.commit_qbo_accounting_fact_internal_v1('sha256:'||encode(identity_hash,'hex'),fact,p_request_id,
      'integration_provider_source_authority');
    ids:=array_append(ids,(outcome->>'factVersionId')::uuid);
    perform private.qbo_accounting_event_v1(a,(outcome->>'factVersionId')::uuid,null,p_request_id);
  end loop;
  insert into private.qbo_accounting_source_applications(workspace_id,business_entity_id,authority_id,source_record_id,
    source_version_id,account_context_fingerprint,normalization_version,disposition,reason_codes,fact_version_ids,
    prior_application_id,plan_fingerprint)
  values(a.workspace_id,a.business_entity_id,a.id,s.id,v.id,account_hash,'qbo_production_accounting_mapping_v1',p_disposition,
    p_reason_codes,ids,prior.id,plan_hash) returning id into application_id;
  return jsonb_build_object('applicationId',application_id,'factVersionIds',ids,'retractedCount',retracted,'idempotent',false);
end;
$function$;

revoke all on function private.qbo_accounting_current_authority_v1(uuid),
  private.qbo_accounting_account_context_v1(private.qbo_accounting_authority_versions)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;
revoke all on function private.qbo_accounting_fact_json_v1(private.canonical_business_fact_versions)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;
revoke all on function public.discover_qbo_accounting_connections_v1(uuid,integer),public.read_qbo_accounting_page_v1(uuid,uuid,integer)
  from public,anon,authenticated,service_role,integration_provider_runtime_authority,integration_provider_validation_authority,
    external_integrations_authority;
grant execute on function public.discover_qbo_accounting_connections_v1(uuid,integer),public.read_qbo_accounting_page_v1(uuid,uuid,integer)
  to integration_provider_source_authority;
revoke all on function private.qbo_accounting_fact_fingerprint_v1(jsonb),
  private.qbo_accounting_event_v1(private.qbo_accounting_authority_versions,uuid,uuid,text),
  private.qbo_accounting_retract_source_v1(uuid,private.qbo_accounting_authority_versions,text[],text,uuid[])
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;
revoke all on function public.commit_qbo_accounting_source_v1(uuid,uuid,uuid,uuid,text,text,text[],jsonb,text)
  from public,anon,authenticated,service_role,integration_provider_runtime_authority,integration_provider_validation_authority,
    external_integrations_authority;
grant execute on function public.commit_qbo_accounting_source_v1(uuid,uuid,uuid,uuid,text,text,text[],jsonb,text)
  to integration_provider_source_authority;

-- Advance only the projection-version allowlists. The original migration files,
-- validation scope checks and customer-preview minimization remain unchanged.
do $projection_version$
declare definition text; original text; replacement text; target regprocedure;
begin
  for target,original,replacement in values
    ('public.complete_qbo_production_source_validation_v1(uuid,uuid,text,jsonb,text)'::regprocedure,
      'v_pending.normalized_schema_version=''qbo_minimizer_v1''',
      'v_pending.normalized_schema_version in (''qbo_minimizer_v1'',''qbo_minimizer_v2'')'),
    ('private.qbo_customer_preview_v1(jsonb,text,text)'::regprocedure,
      'p->>''minimizationVersion''=''qbo_minimizer_v1''',
      'p->>''minimizationVersion'' in (''qbo_minimizer_v1'',''qbo_minimizer_v2'')')
  loop
    definition:=pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,original,'')))/length(original)<>1 then
      raise exception 'qbo_projection_version_contract_changed'; end if;
    execute replace(definition,original,replacement);
  end loop;
end;
$projection_version$;

create function public.read_qbo_customer_accounting_authority_v1(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c private.integration_connections; a private.qbo_accounting_authority_versions; session_id uuid;
  entity_name text; currency text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception 'qbo_accounting_authority_denied' using errcode='42501'; end if;
  begin session_id:=(auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'qbo_accounting_authority_denied' using errcode='42501'; end;
  select * into c from private.integration_connections where id=p_connection_id
    and provider_key='quickbooks_online' and provider_environment='production';
  if not found then raise exception 'qbo_accounting_authority_denied' using errcode='42501'; end if;
  perform private.qbo_customer_require_owner_v1(auth.uid(),session_id,c.workspace_id,c.business_entity_id,true);
  select display_name,coalesce(reporting_currency,base_currency) into entity_name,currency
    from public.business_entities where id=c.business_entity_id and workspace_id=c.workspace_id;
  select * into a from private.qbo_accounting_authority_versions where workspace_id=c.workspace_id
    and business_entity_id=c.business_entity_id order by immutable_version desc limit 1;
  return jsonb_build_object('connectionId',c.id,'businessEntityId',c.business_entity_id,'businessEntityName',entity_name,
    'authorityId',a.id,'enabled',coalesce(a.enabled and a.connection_id=c.id
      and a.connection_generation=c.connection_generation and exists(select 1 from private.provider_entity_mappings m
        where m.id=a.mapping_id and m.status='active' and m.row_version=a.mapping_row_version),false),
    'effectiveFrom',case when a.id is null then null else
      to_char(a.effective_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'currency',currency,'coverage','not_assessed');
end;
$function$;
revoke all on function public.read_qbo_customer_accounting_authority_v1(uuid)
  from public,anon,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;
grant execute on function public.read_qbo_customer_accounting_authority_v1(uuid) to authenticated;

-- Reuse the existing deterministic writer behind a connection-derived narrow
-- fence. The broad deterministic role and its public RPCs remain inaccessible
-- to the QBO source worker.
-- Returning to a former contribution set (notably empty after another owner
-- withdrawal) is a new transition, not a replay of an old predecessor. Keep
-- historical rows unchanged and fence idempotency by predecessor watermark.
alter table private.deterministic_change_sets drop constraint deterministic_change_sets_input_idempotency_key;
alter table private.deterministic_change_sets add constraint deterministic_change_sets_input_idempotency_key
  unique nulls not distinct(workspace_id,business_entity_id,input_contribution_fingerprint,
    dependency_registry_fingerprint,calculation_policy_version,execution_mode,prior_deterministic_watermark);
do $calculation_predecessor$
declare definition text; needle text:='and change_set.execution_mode = p_change_set ->> ''executionMode''';
begin
  definition:=pg_get_functiondef('public.begin_deterministic_change_set_v1(jsonb,text,text)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'qbo_calculation_predecessor_contract_changed'; end if;
  execute replace(definition,needle,needle||E'\n        and change_set.prior_deterministic_watermark is not distinct from '||
    E'\n          case when p_change_set -> ''priorDeterministicWatermark'' = ''null''::jsonb then null '||
    E'\n            else private.sha256_fingerprint_bytes_v1(p_change_set ->> ''priorDeterministicWatermark'') end');
end;
$calculation_predecessor$;

do $deterministic_primitives$
declare item record; definition text; header text; guard text:='  perform private.assert_deterministic_calculation_authority_v1();';
begin
  for item in select * from (values
    ('read_current_contribution_state_v1','uuid,uuid'),
    ('read_current_deterministic_state_v1','uuid,uuid'),
    ('begin_deterministic_change_set_v1','jsonb,text,text'),
    ('coalesce_dependency_dirty_nodes_v1','jsonb,text,text'),
    ('finalize_deterministic_change_set_v1','jsonb,text,text')) as entries(name,args)
  loop
    definition:=pg_get_functiondef(('public.'||item.name||'('||item.args||')')::regprocedure);
    header:='CREATE OR REPLACE FUNCTION public.'||item.name||'(';
    if strpos(definition,header)<>1 or (length(definition)-length(replace(definition,guard,'')))/length(guard)<>1 then
      raise exception 'qbo_deterministic_primitive_contract_changed'; end if;
    execute replace(replace(definition,header,'CREATE OR REPLACE FUNCTION private.qbo_'||item.name||'('),guard,'');
    execute 'revoke all on function private.qbo_'||item.name||'('||item.args||') from public,anon,authenticated,service_role,'||
      'integration_provider_source_authority,integration_provider_runtime_authority,integration_provider_validation_authority,'||
      'external_integrations_authority,deterministic_calculation_authority';
  end loop;
end;
$deterministic_primitives$;

create function private.qbo_accounting_calculation_scope_v1(p_connection uuid)
returns private.qbo_accounting_authority_versions language plpgsql security definer set search_path='' as $function$
declare c private.integration_connections; a private.qbo_accounting_authority_versions;
begin
  select * into c from private.integration_connections where id=p_connection
    and provider_key='quickbooks_online' and provider_environment='production';
  if not found then raise exception 'qbo_accounting_calculation_scope_denied' using errcode='42501'; end if;
  -- Includes withdrawn authority so an owner revocation can clear old calculated
  -- values. It does not authorize any source admission or credential access.
  perform id from public.business_entities where id=c.business_entity_id and workspace_id=c.workspace_id for update;
  select * into a from private.qbo_accounting_authority_versions where workspace_id=c.workspace_id
    and business_entity_id=c.business_entity_id order by immutable_version desc limit 1;
  if not found or a.connection_id<>c.id then
    raise exception 'qbo_accounting_calculation_scope_denied' using errcode='42501'; end if;
  return a;
end;
$function$;

create function public.read_qbo_accounting_calculation_v1(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a private.qbo_accounting_authority_versions; contributions jsonb; previous jsonb;
begin
  perform private.assert_integration_provider_source_authority_v1();
  a:=private.qbo_accounting_calculation_scope_v1(p_connection_id);
  contributions:=private.qbo_read_current_contribution_state_v1(a.workspace_id,a.business_entity_id);
  if jsonb_array_length(contributions)>100000 then raise exception 'qbo_accounting_calculation_limit' using errcode='54000'; end if;
  previous:=private.qbo_read_current_deterministic_state_v1(a.workspace_id,a.business_entity_id);
  return jsonb_build_object('connectionId',a.connection_id,'authorityId',a.id,'contributions',contributions,
    'prior',previous,'asOfDate',(transaction_timestamp() at time zone 'UTC')::date,
    'calculatedAt',to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$function$;

create function public.commit_qbo_accounting_calculation_v1(p_connection_id uuid,p_authority_id uuid,
  p_change_set jsonb,p_nodes jsonb,p_result jsonb,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a private.qbo_accounting_authority_versions; begun jsonb; contributions jsonb; state jsonb;
  current_state jsonb; expected numeric; expected_count bigint; matching_count bigint;
  native_start date; native_end date; native_currency text; current_row_version bigint;
  native_completed_at timestamptz;
begin
  perform private.assert_integration_provider_source_authority_v1();
  a:=private.qbo_accounting_calculation_scope_v1(p_connection_id);
  if a.id is distinct from p_authority_id or (p_change_set->>'workspaceId')::uuid is distinct from a.workspace_id
    or (p_change_set->>'businessEntityId')::uuid is distinct from a.business_entity_id
    or p_change_set->>'executionMode' is distinct from 'clean_full'
    or (p_result->>'changeSetId')::uuid is distinct from (p_change_set->>'id')::uuid
    or p_result->>'equivalenceStatus' is distinct from 'matched'
    or jsonb_typeof(p_nodes) is distinct from 'array' or jsonb_typeof(p_result->'states') is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(p_nodes) n where (n->>'workspaceId')::uuid is distinct from a.workspace_id
      or (n->>'businessEntityId')::uuid is distinct from a.business_entity_id
      or (n->>'changeSetId')::uuid is distinct from (p_change_set->>'id')::uuid) then
    raise exception 'qbo_accounting_calculation_binding_denied' using errcode='42501'; end if;
  lock table private.fact_contribution_events in share mode;
  contributions:=private.qbo_read_current_contribution_state_v1(a.workspace_id,a.business_entity_id);
  current_state:=private.qbo_read_current_deterministic_state_v1(a.workspace_id,a.business_entity_id);
  if current_state->'watermark'<>'null'::jsonb and private.phase_3_state_fingerprint_v1(current_state->'states')
      is distinct from private.sha256_fingerprint_bytes_v1(current_state#>>'{watermark,stateFingerprint}') then
    raise exception 'qbo_accounting_calculation_head_mismatch' using errcode='42501'; end if;
  if jsonb_array_length(contributions)>100000 then raise exception 'qbo_accounting_calculation_limit' using errcode='54000'; end if;
  -- The worker calculates with the reviewed engine; SQL independently checks
  -- every admitted monthly amount/count. No report total or payment can become
  -- accounting revenue by supplying a correctly hashed result payload.
  for state in select value from jsonb_array_elements(p_result->'states') loop
    native_start:=(state #>> '{scope,periodStart}')::date; native_end:=(state #>> '{scope,periodEnd}')::date;
    native_currency:=state #>> '{scope,currency}';
    if state->>'nodeKey' not in ('recognized_revenue_month_total','revenue')
      or state->>'nodeKind'<>(case when state->>'nodeKey'='revenue' then 'kpi' else 'aggregate' end)
      or native_start is null or native_end is null or native_start<>date_trunc('month',native_start)::date
      or native_end<>(native_start+interval '1 month - 1 day')::date
      or state #> '{scope,dimensions}' is distinct from '[]'::jsonb
      or state #>> '{scope,accountingBasis}' is distinct from 'accrual' or native_currency is null then
      raise exception 'qbo_accounting_calculation_semantics_denied' using errcode='42501'; end if;
    select coalesce(sum((c->>'valueCanonical')::numeric),0),count(*) into expected,expected_count
      from jsonb_array_elements(contributions) c where c->>'observationKind'='active_additive'
        and c->>'contributionFamilyKey'='recognized_revenue_transactions' and c->>'contributionFamilyKind'='additive_transaction'
        and c->>'measureKey'='recognized_revenue' and c->>'aggregateKey'='recognized_revenue_actual'
        and c->>'accountingBasis'='accrual' and c->>'currency'=native_currency
        and (c->>'economicDate')::date between native_start and native_end;
    if (state->>'valueCanonical')::numeric is distinct from expected
      or (state->>'supportingContributionCount')::bigint is distinct from expected_count then
      raise exception 'qbo_accounting_calculation_amount_denied' using errcode='42501'; end if;
  end loop;
  for native_start,native_currency in
    select distinct date_trunc('month',(c->>'economicDate')::date)::date,c->>'currency'
      from jsonb_array_elements(contributions) c where c->>'observationKind'='active_additive'
        and c->>'contributionFamilyKey'='recognized_revenue_transactions' and c->>'contributionFamilyKind'='additive_transaction'
        and c->>'measureKey'='recognized_revenue' and c->>'aggregateKey'='recognized_revenue_actual' and c->>'accountingBasis'='accrual'
    union select (s #>> '{scope,periodStart}')::date,s #>> '{scope,currency}' from jsonb_array_elements(current_state->'states') s
  loop
    select count(distinct s->>'nodeKey') into matching_count from jsonb_array_elements(p_result->'states') s
      where (s #>> '{scope,periodStart}')::date=native_start and s #>> '{scope,currency}'=native_currency;
    if matching_count<>2 then raise exception 'qbo_accounting_calculation_scope_incomplete' using errcode='42501'; end if;
  end loop;
  if current_state #>> '{watermark,inputContributionFingerprint}'=p_change_set->>'inputContributionFingerprint' then
    if current_state #>> '{watermark,stateFingerprint}' is distinct from p_result->>'resultStateFingerprint' then
      raise exception 'qbo_accounting_calculation_replay_mismatch' using errcode='42501'; end if;
    return jsonb_build_object('state','completed','publishedStateCount',0,'idempotent',true);
  end if;
  -- Completion order is database-owned. Worker time cannot choose the latest
  -- watermark or resurrect a stale result after a withdrawal/reconsent cycle.
  select greatest(clock_timestamp(),coalesce(max(history.completed_at)+interval '1 microsecond',clock_timestamp()))
    into native_completed_at from private.deterministic_change_sets history where history.workspace_id=a.workspace_id
      and history.business_entity_id=a.business_entity_id and history.state='completed';
  p_change_set:=jsonb_set(p_change_set,'{requestedAt}',to_jsonb(native_completed_at));
  p_result:=jsonb_set(p_result,'{completedAt}',to_jsonb(native_completed_at));
  begun:=private.qbo_begin_deterministic_change_set_v1(p_change_set,p_request_id,'qbo_accounting_worker');
  if begun->>'state'<>'running' or (begun->>'changeSetId')::uuid<>(p_change_set->>'id')::uuid then
    raise exception 'qbo_accounting_calculation_conflict' using errcode='40001'; end if;
  if jsonb_array_length(p_nodes)>0 then
    perform private.qbo_coalesce_dependency_dirty_nodes_v1(p_nodes,p_request_id,'qbo_accounting_worker'); end if;
  select row_version into strict current_row_version from private.deterministic_change_sets
    where id=(begun->>'changeSetId')::uuid;
  perform private.qbo_finalize_deterministic_change_set_v1(
    jsonb_set(p_result,'{expectedRowVersion}',to_jsonb(current_row_version)),p_request_id,'qbo_accounting_worker');
  return jsonb_build_object('state','completed','publishedStateCount',jsonb_array_length(p_result->'states'),'idempotent',false);
end;
$function$;
revoke all on function private.qbo_accounting_calculation_scope_v1(uuid)
  from public,anon,authenticated,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;
revoke all on function public.read_qbo_accounting_calculation_v1(uuid),
  public.commit_qbo_accounting_calculation_v1(uuid,uuid,jsonb,jsonb,jsonb,text)
  from public,anon,authenticated,service_role,integration_provider_runtime_authority,integration_provider_validation_authority,
    external_integrations_authority;
grant execute on function public.read_qbo_accounting_calculation_v1(uuid),
  public.commit_qbo_accounting_calculation_v1(uuid,uuid,jsonb,jsonb,jsonb,text) to integration_provider_source_authority;

create function public.read_qbo_customer_accounting_summary_v1(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare consent jsonb; c private.integration_connections; a private.qbo_accounting_authority_versions;
  latest private.deterministic_change_sets; calculation_current boolean:=false; months jsonb:='[]'::jsonb;
  counts jsonb; account_hash bytea; snapshot jsonb;
begin
  -- Reuses the live-session owner and entity entitlement checks, never a
  -- privileged customer client or caller-supplied workspace/entity identity.
  consent:=public.read_qbo_customer_accounting_authority_v1(p_connection_id);
  select * into strict c from private.integration_connections where id=p_connection_id;
  select * into a from private.qbo_accounting_authority_versions where id=(consent->>'authorityId')::uuid;
  if a.id is not null and (consent->>'enabled')::boolean
    and c.status in ('initializing','active','degraded') then
    -- Same current authority fence as admission. Revocation, currency changes,
    -- mapping/generation changes and conflicting policies cannot show old totals.
    begin a:=private.qbo_accounting_current_authority_v1(c.id);
    exception when insufficient_privilege then a:=null; end;
  else a:=null; end if;
  if a.id is not null then
    -- Hold the same financial write fence as the publisher until amounts,
    -- currentness and immutable provenance have all been assembled.
    lock table private.fact_contribution_events,private.deterministic_aggregate_states in share mode;
    select * into latest from private.deterministic_change_sets where workspace_id=c.workspace_id
      and business_entity_id=c.business_entity_id and state='completed' order by completed_at desc,id desc limit 1;
    snapshot:=private.qbo_read_current_deterministic_state_v1(c.workspace_id,c.business_entity_id);
    calculation_current:=latest.id is not null and latest.input_contribution_fingerprint=
      private.current_contribution_state_fingerprint_v1(c.workspace_id,c.business_entity_id)
      and latest.result_state_fingerprint=private.phase_3_state_fingerprint_v1(snapshot->'states');
    account_hash:=private.phase_3_contract_fingerprint_v1(private.qbo_accounting_account_context_v1(a));
  end if;
  select jsonb_build_object('mapped',count(*) filter(where disposition='mapped_partial')::text,
    'reviewRequired',count(*) filter(where disposition='review_required')::text,
    'nonContributing',count(*) filter(where disposition='non_contributing')::text,
    'withdrawn',count(*) filter(where disposition='retraction_required')::text) into counts
    from private.qbo_accounting_source_applications p join private.external_source_records s
      on s.id=p.source_record_id and s.current_version_id=p.source_version_id
    where p.authority_id=a.id and p.account_context_fingerprint=account_hash;
  if calculation_current then
    select coalesce(jsonb_agg(payload order by period_start),'[]'::jsonb) into months from (
      select state.period_start,jsonb_build_object('stateId',state.id,'periodStart',state.period_start,'periodEnd',state.period_end,
        'currency',state.currency,'valueCanonical',state.value_canonical,'supportingContributionCount',state.supporting_contribution_count::text,
        'stateFingerprint','sha256:'||encode(state.node_state_fingerprint,'hex'),
        'provenance',coalesce((select jsonb_agg(jsonb_build_object('factVersionId',fact_id,'sourceVersionId',source_version_id,
            'sourceRecordId',source_record_id,'factFingerprint','sha256:'||encode(fact_fingerprint,'hex')) order by fact_id)
          from (select distinct fv.id fact_id,v.id source_version_id,v.source_record_id,fv.fact_fingerprint
            from private.fact_contribution_events event
            join private.canonical_business_fact_versions fv on fv.id=event.fact_version_id
            join private.business_fact_sources edge on edge.fact_version_id=fv.id and edge.source_role='primary'
            join private.external_source_record_versions v on v.id=edge.source_record_version_id
            where event.workspace_id=c.workspace_id and event.business_entity_id=c.business_entity_id
              and event.source_authority_policy_version_id=a.policy_version_id and event.event_kind='establish'
              and event.currency=state.currency and fv.posting_date between state.period_start and state.period_end
              and not exists(select 1 from private.fact_contribution_events r
                where r.event_kind='retract' and r.target_contribution_event_id=event.id)
            order by fv.id limit 32) refs),'[]'::jsonb)) payload
      from private.deterministic_aggregate_states state where state.workspace_id=c.workspace_id
        and state.business_entity_id=c.business_entity_id and state.node_key='revenue'
        and state.currency=a.source_currency and state.accounting_basis='accrual'
      order by state.period_start desc limit 24) bounded;
  end if;
  return jsonb_build_object('contractVersion','qbo_customer_accounting_summary_v1','workspaceId',c.workspace_id,
    'businessEntityId',c.business_entity_id,'businessEntityName',consent->>'businessEntityName','connectionId',c.id,
    'authorityId',consent->'authorityId','authorityEnabled',a.id is not null,'coverage','partial',
    'fullPostedRevenue',false,'calculationState',case when a.id is null then 'disabled'
      when calculation_current then 'current' else 'pending' end,'counts',counts,'months',months,
    'calculatedAt',case when calculation_current then to_char(latest.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else null end,
    'watermark',case when calculation_current then 'sha256:'||encode(latest.result_deterministic_watermark,'hex') else null end);
end;
$function$;
revoke all on function public.read_qbo_customer_accounting_summary_v1(uuid)
  from public,anon,service_role,integration_provider_source_authority,integration_provider_runtime_authority,
    integration_provider_validation_authority,external_integrations_authority;
grant execute on function public.read_qbo_customer_accounting_summary_v1(uuid) to authenticated;

-- Reuse the existing scheduler visit row for independent accounting fairness.
-- This timestamp is not a synchronization checkpoint or financial authority.
alter table private.qbo_production_scheduler_visits add column accounting_checked_at timestamptz;
create function public.claim_qbo_accounting_work_v1(p_maximum_connections integer)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c private.integration_connections; a private.qbo_accounting_authority_versions; result jsonb:='[]'::jsonb;
begin
  perform private.assert_integration_provider_source_authority_v1();
  if p_maximum_connections is null or p_maximum_connections not between 1 and 25 then
    raise exception 'qbo_accounting_page_invalid' using errcode='22023'; end if;
  for c in select connection.* from private.integration_connections connection
    join lateral(select authority.* from private.qbo_accounting_authority_versions authority
      where authority.workspace_id=connection.workspace_id and authority.business_entity_id=connection.business_entity_id
      order by immutable_version desc limit 1) authority on authority.connection_id=connection.id
    left join private.qbo_production_scheduler_visits visit on visit.connection_id=connection.id
      and visit.workspace_id=connection.workspace_id and visit.business_entity_id=connection.business_entity_id
      and visit.connection_generation=connection.connection_generation
    where connection.provider_key='quickbooks_online' and connection.provider_environment='production'
    order by visit.accounting_checked_at nulls first,connection.id
    limit p_maximum_connections for update of connection skip locked
  loop
    select * into a from private.qbo_accounting_authority_versions where workspace_id=c.workspace_id
      and business_entity_id=c.business_entity_id order by immutable_version desc limit 1;
    insert into private.qbo_production_scheduler_visits(workspace_id,business_entity_id,connection_id,connection_generation,
      checked_at,accounting_checked_at)
    values(c.workspace_id,c.business_entity_id,c.id,c.connection_generation,'1970-01-01T00:00:00Z',clock_timestamp())
    on conflict(workspace_id,business_entity_id,connection_id,connection_generation)
      do update set accounting_checked_at=excluded.accounting_checked_at;
    result:=result||jsonb_build_array(jsonb_build_object('connectionId',c.id,
      'admissionEnabled',a.enabled and a.connection_generation=c.connection_generation
        and c.status in ('initializing','active','degraded') and exists(select 1 from private.provider_entity_mappings m
          where m.id=a.mapping_id and m.status='active' and m.row_version=a.mapping_row_version)));
  end loop;
  return result;
end;
$function$;
revoke all on function public.claim_qbo_accounting_work_v1(integer)
  from public,anon,authenticated,service_role,integration_provider_runtime_authority,integration_provider_validation_authority,
    external_integrations_authority;
grant execute on function public.claim_qbo_accounting_work_v1(integer) to integration_provider_source_authority;

commit;
