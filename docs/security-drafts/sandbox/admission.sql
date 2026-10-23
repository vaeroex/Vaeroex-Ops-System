-- LOCAL DEMO-ONLY DRAFT. Not part of the production forward package.
-- No policy row, activation, provider grant or credential access is installed.
begin;
create table private.sandbox_shared_evidence_policies (
 installation_id uuid primary key, workspace_id uuid not null references public.workspaces(id),
 business_entity_id uuid not null, qbo_connection_id uuid not null, qbo_generation bigint not null check(qbo_generation>0),
 square_connection_id uuid not null, square_generation bigint not null check(square_generation>0),
 expected_issuer text not null, policy_version text not null check(policy_version='sandbox_descriptive_evidence_v1'),
 enabled boolean not null default false, expires_at timestamptz not null check(isfinite(expires_at)),
 check(qbo_connection_id<>square_connection_id)
);
alter table private.sandbox_shared_evidence_policies enable row level security;
create table private.sandbox_shared_resolution_claims (
 transaction_id xid8 primary key, workspace_id uuid not null, actor_id uuid not null, session_id uuid not null,
 installation_id uuid not null references private.sandbox_shared_evidence_policies(installation_id)
);
alter table private.sandbox_shared_resolution_claims enable row level security;
revoke all on private.sandbox_shared_evidence_policies,private.sandbox_shared_resolution_claims from public,anon,authenticated,service_role;
alter table private.shared_evidence_manifests add column sandbox_installation_id uuid references private.sandbox_shared_evidence_policies(installation_id);
alter table private.shared_evidence_manifest_sources drop constraint shared_evidence_manifest_sources_source_kind_check;
alter table private.shared_evidence_manifest_sources add constraint shared_evidence_manifest_sources_source_kind_check check(source_kind in ('legacy_reference','qbo_version','square_payment','sheets_ticket_source','approved_file_fact','approved_note','inherited_artifact','qbo_sandbox_version','square_sandbox_observation'));
create function private.guard_sandbox_evidence_policy_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and to_jsonb(new)-'enabled'=to_jsonb(old)-'enabled' and old.enabled and not new.enabled then return new;end if;
 raise exception 'sandbox_policy_immutable' using errcode='42501';
end $$;
create trigger sandbox_policy_immutable before update or delete on private.sandbox_shared_evidence_policies for each row execute function private.guard_sandbox_evidence_policy_v1();

create function private.require_sandbox_evidence_policy_v1(w uuid,a uuid,s uuid,i uuid) returns private.sandbox_shared_evidence_policies
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare p private.sandbox_shared_evidence_policies;c private.integration_connections;m private.provider_entity_mappings; ac private.square_account_connections;
begin
 perform private.require_shared_evidence_actor_v1(w,a,s);
 if auth.role()='authenticated' and auth.jwt()->>'is_anonymous'='true' then raise exception 'sandbox_actor_denied' using errcode='42501';end if;
 if private.workspace_billing_entitled_v1(w) is distinct from true then raise exception 'sandbox_billing_denied' using errcode='42501';end if;
 perform private.shared_evidence_write_fence_v1(w);
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'sandbox_isolation_denied' using errcode='40001';end if;
 select * into p from private.sandbox_shared_evidence_policies where installation_id=i and workspace_id=w for share;
 if not found or not p.enabled or p.expires_at<=clock_timestamp() then raise exception 'sandbox_model_use_disabled' using errcode='42501';end if;
 -- Reuse the repository-pinned Square Sandbox issuer, never a workspace label.
 if p.expected_issuer is distinct from private.sandbox_evidence_issuer_v1() or (auth.role()='authenticated' and auth.jwt()->>'iss' is distinct from p.expected_issuer) then raise exception 'sandbox_environment_denied' using errcode='42501';end if;
 perform 1 from public.business_entities where workspace_id=w and id=p.business_entity_id and status='active' for share;
 if not found then raise exception 'sandbox_entity_denied' using errcode='42501';end if;
 select * into c from private.integration_connections where id=p.qbo_connection_id and workspace_id=w and business_entity_id=p.business_entity_id
  and provider_key='quickbooks_online' and provider_environment='sandbox' and connection_generation=p.qbo_generation and status in ('active','degraded') for share;
 if not found then raise exception 'sandbox_qbo_connection_denied' using errcode='42501';end if;
 select * into ac from private.square_account_connections where connection_id=p.square_connection_id and workspace_id=w and business_entity_id=p.business_entity_id
  and environment='sandbox' and generation=p.square_generation and state='authorized' and not revocation_pending for share;
 if not found then raise exception 'sandbox_square_connection_denied' using errcode='42501';end if;
 if p.expires_at<=clock_timestamp() then raise exception 'sandbox_model_use_disabled' using errcode='42501';end if;
 return p;
end $$;
create function private.sandbox_resolution_session_v1(w uuid,a uuid,i uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 if auth.role()='authenticated' and auth.uid()=a then return (auth.jwt()->>'session_id')::uuid;end if;
 if auth.role()='service_role' then
  select session_id into s from private.sandbox_shared_resolution_claims where transaction_id=pg_current_xact_id() and workspace_id=w and actor_id=a and installation_id=i;
 end if;
 if s is null then raise exception 'sandbox_resolution_claim_required' using errcode='42501';end if;return s;
end $$;
-- All Square dependencies below are read by the existing authority/fact checks.
-- SHARE locks freeze their writer-visible state only for the short read/commit
-- transaction, never during the model call. No new global trigger framework.
create function private.lock_sandbox_square_sources_v1() returns void language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
begin
 lock table private.square_account_capacity_blocks,private.square_account_configuration,private.square_account_connections,
  private.square_account_enrollments,private.square_connection_generations,private.square_connections,
  private.square_ingestion_page_receipts,private.square_ingestion_resources,private.square_ingestion_scans,
  private.square_ingestion_tasks,private.square_ingestion_versions,private.square_interpretation_facts,
  private.square_interpretation_runs,private.square_location_mappings,private.square_observation_admissions,private.square_observation_approvals in share mode;
end $$;
create function private.sandbox_evidence_issuer_v1() returns text language sql immutable set search_path='' as $$select 'https://oysjpoondtcrqpghhrbd.supabase.co/auth/v1'::text$$;

-- Repository-derived authority clone; only explicit actor/session binding and owner-only role differ.
create function private.sandbox_square_authority_v1(p_workspace_id uuid,p_actor_id uuid,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public
set statement_timeout='5s' set lock_timeout='2s' as $$
declare c private.square_account_configuration; ac private.square_account_connections;
  dc private.square_connections; g private.square_connection_generations; e private.square_account_enrollments;
  r private.square_interpretation_runs; a jsonb; m jsonb; checked jsonb; observed jsonb;
  f jsonb; kind text; counts jsonb:='{"payment":0,"refund":0,"order":0,"catalog":0,"inventory":0}';
  provenance jsonb:='[]'; partition text; actor uuid; sid uuid; session_expiry timestamptz;
  n timestamptz; last_observed timestamptz; rel jsonb; relationships jsonb; role_name text;
begin
  actor:=p_actor_id; sid:=p_session_id;
  perform private.require_shared_evidence_actor_v1(p_workspace_id,actor,sid);
  select m.role,s.not_after into role_name,session_expiry from public.workspace_members m
    join auth.users u on u.id=m.user_id join auth.sessions s on s.user_id=u.id and s.id=sid
    where m.workspace_id=p_workspace_id and m.user_id=actor and m.status='active'
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u,s;
  if not found or role_name<>'owner' then raise exception using errcode='42501',message='square_evidence_unavailable'; end if;
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

-- Same minimized preview, with sandbox-only environment; production helper unchanged.
CREATE OR REPLACE FUNCTION private.sandbox_qbo_preview_v1(p jsonb, record_type text, record_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare columns_json jsonb; rows_json jsonb; truncated boolean; malformed boolean; amount_json jsonb;
begin
  if p is null or p='null'::jsonb then return jsonb_build_object('state','missing'); end if;
  if pg_catalog.octet_length(p::text)>131072 then return jsonb_build_object('state','oversized'); end if;
  if p#>>'{provider,providerKey}' is distinct from 'quickbooks_online'
    or p#>>'{provider,sourceEnvironment}' is distinct from 'sandbox' then
    return jsonb_build_object('state','unsupported'); end if;
  if p->>'contractVersion'='qbo_source_record_minimized_v1' and p->>'recordType'=record_type
    and p->>'minimizationVersion' in ('qbo_minimizer_v1','qbo_minimizer_v2')
    and p->>'id'=record_id
    and record_type=any(array['Invoice','Payment','CreditMemo','SalesReceipt','RefundReceipt','Bill',
      'BillPayment','VendorCredit','Purchase','Deposit','Transfer','JournalEntry']) then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('amount',p#>>array['amounts',k,'amount'],
      'currency',p#>>array['amounts',k,'currency'])),'{}'::jsonb) into amount_json
      from unnest(array['total','balance']) k where p->'amounts' ? k;
    return jsonb_build_object('state','available','value',jsonb_build_object('kind','record','status',p->>'status',
      'temporal',jsonb_build_object('postingDate',p#>>'{temporal,postingDate}',
        'providerCreatedAt',p#>>'{temporal,providerCreatedAt}','providerUpdatedAt',p#>>'{temporal,providerUpdatedAt}'),
      'accounting',jsonb_build_object('basis',p#>>'{accounting,basis}','sourceCurrency',p#>>'{accounting,sourceCurrency}'),
      'amounts',amount_json));
  end if;
  if p->>'contractVersion' is distinct from 'qbo_report_control_observation_v1'
    or p->>'reportType' is distinct from record_type
    or record_type<>all(array['ProfitAndLoss','BalanceSheet','CashFlow','ARAgingSummary','APAgingSummary','TrialBalance'])
    or p->'additive' is distinct from 'false'::jsonb
    or p->>'contributionFamily' is distinct from 'control_observation'
    or p->>'parserVersion' is distinct from 'qbo_report_parser_v1'
    -- Exact existing qboReportProviderRecordId identity, not economic matching.
    or record_id is distinct from concat_ws(':',p->>'reportType',p->>'reportBasis',coalesce(p->>'periodStart','open'),
      coalesce(p->>'periodEnd','open'),coalesce(p->>'sourceCurrency','currency_unspecified'))
    or jsonb_typeof(p->'columns') is distinct from 'array' or jsonb_typeof(p->'rows') is distinct from 'array' then
    return jsonb_build_object('state','unsupported'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('columnKey',c->>'columnKey','title',c->>'title') order by n),'[]'::jsonb)
    into columns_json from jsonb_array_elements(p->'columns') with ordinality as cols(c,n) where n<=16;
  with recursive tree as (
    select r, array[n] as path, 0 as depth from jsonb_array_elements(p->'rows') with ordinality as roots(r,n)
    union all
    select child.r,t.path||child.n,t.depth+1 from tree t
      cross join lateral jsonb_array_elements(case when jsonb_typeof(t.r->'children')='array'
        then t.r->'children' else '[]'::jsonb end) with ordinality as child(r,n) where t.depth<12
  ), limited as (select * from tree order by path limit 200)
  select coalesce((select jsonb_agg(jsonb_build_object('depth',t.depth,'rowType',t.r->>'rowType',
    'cells',coalesce((select jsonb_agg(jsonb_build_object('columnKey',c->>'columnKey','value',c->>'value') order by n)
      from jsonb_array_elements(case when jsonb_typeof(t.r->'cells')='array' then t.r->'cells' else '[]'::jsonb end)
        with ordinality as cells(c,n)
      where n<=16 and exists(select from jsonb_array_elements(columns_json) col where col->>'columnKey'=c->>'columnKey')),'[]'::jsonb))
    order by t.path) from limited t),'[]'::jsonb),
    jsonb_array_length(p->'columns')>16 or (select count(*) from tree)>200
      or exists(select from tree where depth=12 and case when jsonb_typeof(r->'children')='array' then jsonb_array_length(r->'children') else 0 end>0)
      or exists(select from tree where case when jsonb_typeof(r->'cells')='array' then jsonb_array_length(r->'cells') else 0 end>16),
    exists(select from tree where jsonb_typeof(r->'children') is distinct from 'array'
      or jsonb_typeof(r->'cells') is distinct from 'array' or not coalesce(r->>'rowType' in ('data','section','summary'),false))
    into rows_json,truncated,malformed;
  if malformed then return jsonb_build_object('state','unsupported'); end if;
  return jsonb_build_object('state','available','value',jsonb_build_object('kind','report',
    'reportType',p->>'reportType','reportBasis',p->>'reportBasis','sourceCurrency',p->>'sourceCurrency',
    'periodStart',p->>'periodStart','periodEnd',p->>'periodEnd','columns',columns_json,'rows',rows_json,'truncated',truncated));
end
$function$;


create function private.resolve_sandbox_shared_source_v1(w uuid,a uuid,j jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare i uuid;s uuid;p private.sandbox_shared_evidence_policies;src record;data jsonb;identity jsonb;preview jsonb;
 ac private.square_account_connections;r private.square_interpretation_runs;f jsonb;semantic jsonb;card jsonb;
begin
 if j-array['kind','environment','installation_id','source_id','version_id','resource_key','version_key','interpretation_revision','authority_hash']<>'{}'::jsonb or j->>'environment' is distinct from 'sandbox' then raise exception 'sandbox_identity_denied' using errcode='42501';end if;
 i:=private.safe_evidence_uuid_v1(j->>'installation_id');s:=private.sandbox_resolution_session_v1(w,a,i);
 perform private.lock_sandbox_square_sources_v1();p:=private.require_sandbox_evidence_policy_v1(w,a,s,i);
 card:=private.sandbox_square_authority_v1(w,a,s);
 if j->>'kind'='qbo_sandbox_version' then
  if j-array['kind','environment','installation_id','source_id','version_id','authority_hash']<>'{}'::jsonb then raise exception 'sandbox_identity_denied' using errcode='42501';end if;
  select sr.*,v.normalized_projection,v.validation_state,v.change_kind,v.accounting_currency,v.accounting_basis,v.posting_date,v.period_start,v.period_end,v.source_timezone,
   v.source_fingerprint,m.row_version mapping_version,m.provider_entity_reference_fingerprint
   into src from private.external_source_records sr
   join private.integration_connections c on c.id=sr.connection_id and c.workspace_id=sr.workspace_id and c.business_entity_id=sr.business_entity_id
   join private.provider_entity_mappings m on m.id=sr.mapping_id and m.workspace_id=sr.workspace_id and m.business_entity_id=sr.business_entity_id and m.connection_id=sr.connection_id
   join private.external_source_record_versions v on v.id=sr.current_version_id and v.source_record_id=sr.id and v.workspace_id=sr.workspace_id and v.connection_id=sr.connection_id and v.business_entity_id=sr.business_entity_id and v.provider_key=sr.provider_key and v.provider_record_id=sr.provider_record_id and v.provider_record_type=sr.provider_record_type
   where sr.id=private.safe_evidence_uuid_v1(j->>'source_id') and v.id=private.safe_evidence_uuid_v1(j->>'version_id')
    and sr.workspace_id=w and sr.business_entity_id=p.business_entity_id and sr.connection_id=p.qbo_connection_id
    and sr.provider_key='quickbooks_online' and sr.source_kind='provider' and sr.lifecycle_state='active'
    and c.provider_key='quickbooks_online' and c.provider_environment='sandbox' and c.connection_generation=p.qbo_generation and c.status in ('active','degraded')
    and m.provider_key='quickbooks_online' and m.provider_environment='sandbox' and m.status='active' and m.verified_at is not null
    and v.source_kind='provider' and v.validation_state='valid' and v.change_kind='unchanged'
    and private.is_qbo_phase_8b_validated_projection_v1(v.normalized_projection)
    and m.provider_entity_reference_fingerprint=private.qbo_phase_8b_realm_fingerprint_v1(v.normalized_projection#>>'{provider,realmId}') for share of sr,c,m,v;
  if not found then raise exception 'sandbox_qbo_source_denied' using errcode='42501';end if;
  preview:=private.sandbox_qbo_preview_v1(src.normalized_projection,src.provider_record_type,src.provider_record_id);
  if preview->>'state' is distinct from 'available' or coalesce((preview#>>'{value,truncated}')::boolean,false) then raise exception 'sandbox_qbo_projection_denied' using errcode='42501';end if;
  if preview#>>'{value,kind}'='report' then
   if preview#>>'{value,sourceCurrency}' is distinct from src.accounting_currency or preview#>>'{value,reportBasis}' is distinct from src.accounting_basis
    or preview#>>'{value,periodStart}' is distinct from src.period_start::text or preview#>>'{value,periodEnd}' is distinct from src.period_end::text
    or src.accounting_currency is null or src.accounting_basis not in ('cash','accrual') or src.period_start is null or src.period_end is null or src.period_start>src.period_end then raise exception 'sandbox_qbo_scope_denied' using errcode='42501';end if;
  else
   if preview#>>'{value,accounting,sourceCurrency}' is distinct from src.accounting_currency or preview#>>'{value,accounting,basis}' is distinct from src.accounting_basis or preview#>>'{value,temporal,postingDate}' is distinct from src.posting_date::text or src.accounting_currency is null then raise exception 'sandbox_qbo_scope_denied' using errcode='42501';end if;
  end if;
  identity:=jsonb_build_object('kind','qbo_sandbox_version','environment','sandbox','installation_id',i,'source_id',src.id,'version_id',src.current_version_id);
  data:=jsonb_build_object('provider','quickbooks_online','connection_id',p.qbo_connection_id,'generation',p.qbo_generation,'mapping_id',src.mapping_id,'mapping_version',src.mapping_version,
   'source_id',src.id,'version_id',src.current_version_id,'source_fingerprint',encode(src.source_fingerprint,'hex'),'realm_binding',encode(src.provider_entity_reference_fingerprint,'hex'),
   'record_type',src.provider_record_type,'preview',preview->'value','period_start',src.period_start,'period_end',src.period_end,'posting_date',src.posting_date,'basis',src.accounting_basis,'currency',src.accounting_currency,'time_zone',src.source_timezone);
 elsif j->>'kind'='square_sandbox_observation' then
  if j-array['kind','environment','installation_id','resource_key','version_key','interpretation_revision','authority_hash']<>'{}'::jsonb then raise exception 'sandbox_identity_denied' using errcode='42501';end if;
  select * into ac from private.square_account_connections where connection_id=p.square_connection_id and workspace_id=w and generation=p.square_generation;
  select * into r from private.square_interpretation_runs where connection_id=p.square_connection_id and workspace_id=w and business_entity_id=p.business_entity_id
   and generation=p.square_generation and partition_fingerprint=(select private.square_page_hash_v1(jsonb_agg(resource_key order by resource_key)) from (select distinct resource_key from private.square_observation_admissions where workspace_id=w and business_entity_id=p.business_entity_id and connection_id=p.square_connection_id and generation=p.square_generation) resources) and revision=(card->>'checkpointRevision')::bigint;
  if not found or j->>'interpretation_revision' is distinct from r.revision::text then raise exception 'sandbox_square_revision_denied' using errcode='42501';end if;
  select value into strict f from jsonb_array_elements(r.output->'facts') where value#>>'{value,value,resourceKey}'=j->>'resource_key' and value#>>'{value,value,versionKey}'=j->>'version_key';
  if f is null or f#>>'{value,value,economic}' is distinct from 'blocked' or f#>>'{value,value,historical}' is distinct from 'unknown' then raise exception 'sandbox_square_source_denied' using errcode='42501';end if;
  semantic:=f#>'{value,value}';
  identity:=jsonb_build_object('kind','square_sandbox_observation','environment','sandbox','installation_id',i,'resource_key',j->>'resource_key','version_key',j->>'version_key','interpretation_revision',r.revision);
  data:=jsonb_build_object('provider','square','connection_id',p.square_connection_id,'generation',p.square_generation,'resource_key',j->>'resource_key','version_key',j->>'version_key',
   'interpretation_revision',r.revision,'fact_fingerprint',f->>'factFingerprint','observation_fingerprint',semantic->>'observationFingerprint',
   'observation',jsonb_build_object('kind',semantic->>'kind','status',semantic->>'status','observed_at',f->>'sourceObservedAt',
    'amount_minor',coalesce(semantic#>>'{money,amount,amountMinor}',semantic#>>'{money,total,amountMinor}'),'currency',coalesce(semantic#>>'{money,amount,currency}',semantic#>>'{money,total,currency}')));
 else raise exception 'sandbox_source_kind_denied' using errcode='42501';end if;
 data:=data||jsonb_build_object('workspace_id',w,'entity_id',p.business_entity_id,'environment','sandbox','installation_id',i,'model_use_policy',p.policy_version,'coverage','unknown','economic','blocked','historical','unknown','read_sources','[]'::jsonb);
 perform private.require_sandbox_evidence_policy_v1(w,a,s,i);
 identity:=identity||jsonb_build_object('authority_hash',private.evidence_digest_v1(data));
 return jsonb_build_object('identity',identity,'hash',private.evidence_digest_v1(data),'data',data);
end $$;

alter function private.shared_evidence_original_v1(uuid,jsonb,uuid) rename to shared_evidence_before_sandbox_v1;
create function private.shared_evidence_original_v1(w uuid,j jsonb,a uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved jsonb;
begin
 if j->>'kind' in ('qbo_sandbox_version','square_sandbox_observation') then
  resolved:=private.resolve_sandbox_shared_source_v1(w,a,j);
  if j is distinct from resolved->'identity' then raise exception 'sandbox_identity_changed' using errcode='40001';end if;
  return resolved;
 end if;
 return private.shared_evidence_before_sandbox_v1(w,j,a);
end $$;
create function public.read_sandbox_shared_evidence_v1(p_workspace_id uuid,p_identity jsonb,p_installation_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare a uuid;result jsonb;
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);
 perform private.lock_sandbox_square_sources_v1();perform private.require_sandbox_evidence_policy_v1(p_workspace_id,a,(auth.jwt()->>'session_id')::uuid,p_installation_id);
 if p_identity->>'kind' in ('qbo_sandbox_version','square_sandbox_observation') and p_identity->>'installation_id' is distinct from p_installation_id::text then raise exception 'sandbox_installation_denied' using errcode='42501';end if;
 if p_identity->>'kind' not in ('qbo_sandbox_version','square_sandbox_observation','approved_file_fact','approved_note') then raise exception 'sandbox_source_kind_denied' using errcode='42501';end if;
 if p_identity->>'kind' in ('approved_file_fact','approved_note') then return public.read_shared_typed_evidence_v1(p_workspace_id,p_identity);end if;
 result:=private.resolve_sandbox_shared_source_v1(p_workspace_id,a,p_identity);
 if p_identity ? 'authority_hash' and p_identity is distinct from result->'identity' then raise exception 'sandbox_identity_changed' using errcode='40001';end if;
 return jsonb_build_object('stage','unadmitted','resolved',result);
end $$;

create function public.discover_sandbox_shared_evidence_v1(p_workspace_id uuid,p_start date,p_end date,p_installation_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare p private.sandbox_shared_evidence_policies;a uuid;s uuid;card jsonb;result jsonb;mem jsonb;
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);s:=(auth.jwt()->>'session_id')::uuid;
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>366 then raise exception 'sandbox_period_denied' using errcode='22023';end if;
 perform private.lock_sandbox_square_sources_v1();p:=private.require_sandbox_evidence_policy_v1(p_workspace_id,a,s,p_installation_id);card:=private.sandbox_square_authority_v1(p_workspace_id,a,s);
 select coalesce(jsonb_agg(candidate order by candidate->>'provider',candidate#>>'{identity,source_id}',candidate#>>'{identity,resource_key}'),'[]'::jsonb) into result from (
  select jsonb_build_object('provider','quickbooks_online','identity',jsonb_build_object('kind','qbo_sandbox_version','environment','sandbox','installation_id',p_installation_id,'source_id',sr.id,'version_id',sr.current_version_id)) candidate
   from private.external_source_records sr join private.external_source_record_versions v on v.id=sr.current_version_id and v.source_record_id=sr.id
   where sr.workspace_id=p_workspace_id and sr.connection_id=p.qbo_connection_id and sr.business_entity_id=p.business_entity_id and sr.lifecycle_state='active' and sr.source_kind='provider'
    and v.validation_state='valid' and v.change_kind='unchanged' and (v.posting_date between p_start and p_end or (v.period_start<=p_end and v.period_end>=p_start))
  union all select jsonb_build_object('provider','square','identity',jsonb_build_object('kind','square_sandbox_observation','environment','sandbox','installation_id',p_installation_id,
   'resource_key',fact#>>'{value,value,resourceKey}','version_key',fact#>>'{value,value,versionKey}','interpretation_revision',r.revision))
   from private.square_interpretation_runs r cross join lateral jsonb_array_elements(r.output->'facts') fact
   where r.workspace_id=p_workspace_id and r.connection_id=p.square_connection_id and r.generation=p.square_generation and r.partition_fingerprint=(select private.square_page_hash_v1(jsonb_agg(resource_key order by resource_key)) from (select distinct resource_key from private.square_observation_admissions where workspace_id=p_workspace_id and business_entity_id=p.business_entity_id and connection_id=p.square_connection_id and generation=p.square_generation) resources) and r.revision=(card->>'checkpointRevision')::bigint
    and (fact->>'sourceObservedAt')::date between p_start and p_end
 ) sources;
 -- Keep existing reviewed files/approved notes, with unchanged canonical admission.
 mem:=public.discover_shared_evidence_v1(p_workspace_id,p_start,p_end);
 select result||coalesce(jsonb_agg(c),'[]'::jsonb) into result from jsonb_array_elements(mem->'candidates') c where c#>>'{identity,kind}' in ('approved_file_fact','approved_note');
 return jsonb_build_object('stage','catalog_only','candidates',coalesce((select jsonb_agg(c) from (select c from jsonb_array_elements(result) c limit 97) t),'[]'::jsonb),'truncated',jsonb_array_length(result)>96 or coalesce((mem->>'truncated')::boolean,false));
end $$;

-- Exact shared sealing algorithm, with only sandbox binding/kinds/header changes.
create function public.seal_sandbox_shared_evidence_v1(p_workspace_id uuid,p_target_kind text,p_target_id uuid,p_attempt integer,p_read_ticket_id uuid,p_sources jsonb,p_inherited_manifest_ids uuid[],p_installation_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare a uuid;s uuid;target jsonb;ticket jsonb;source jsonb;resolved jsonb;projections jsonb:='[]';identities jsonb:='[]';m uuid;ordinal integer:=0;parent uuid;required uuid;src record;dependency jsonb;
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);s:=(auth.jwt()->>'session_id')::uuid;
 perform private.lock_sandbox_square_sources_v1();perform private.require_sandbox_evidence_policy_v1(p_workspace_id,a,s,p_installation_id);
 foreach parent in array p_inherited_manifest_ids loop
  if not exists(select 1 from private.shared_evidence_manifests where id=parent and workspace_id=p_workspace_id and sandbox_installation_id=p_installation_id) then raise exception 'sandbox_inherited_environment_denied' using errcode='42501';end if;
 end loop;
 target:=private.shared_evidence_target_v1(p_workspace_id,a,p_target_kind,p_target_id,p_attempt,p_read_ticket_id);
 ticket:=private.shared_evidence_ticket_v1(p_workspace_id,a,p_read_ticket_id);
 if p_target_kind='briefing_run' and exists(select 1 from jsonb_array_elements(ticket->'sources') ts
  join private.derived_evidence_audiences da on da.workspace_id=p_workspace_id and da.artifact_kind='reports'
  and da.artifact_id=private.safe_evidence_uuid_v1(ts->>'id') where ts->>'table'='reports' and da.actor_private) then
  raise exception 'shared_evidence_private_brief_input_denied' using errcode='42501';end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or p_inherited_manifest_ids is null then raise exception 'shared_evidence_sources_invalid' using errcode='22023';end if;
 if jsonb_array_length(p_sources)>24 or cardinality(p_inherited_manifest_ids)>24 then raise exception 'shared_evidence_budget_exceeded' using errcode='54000';end if;
 -- Every inherited artifact read via the existing ticket must retain its seals.
 for required in select distinct am.manifest_id from private.shared_evidence_artifact_manifests am
  join jsonb_array_elements(ticket->'sources') ts on am.artifact_id=private.safe_evidence_uuid_v1(ts->>'id')
  where am.workspace_id=p_workspace_id and am.artifact_kind=case ts->>'table' when 'reports' then 'report' when 'ai_agent_runs' then 'briefing_run'
   when 'vsi_exchanges' then 'vsi_exchange' when 'vsi_conversations' then 'vsi_conversation_context' end
  union select am.manifest_id from private.shared_evidence_artifact_manifests am where p_target_kind='vsi_request'
   and am.workspace_id=p_workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=private.safe_evidence_uuid_v1(target->>'conversation_id')
 loop
  if not(required=any(p_inherited_manifest_ids)) then raise exception 'shared_evidence_inherited_dependency_missing' using errcode='42501';end if;
 end loop;
 for source in select value from jsonb_array_elements(p_sources) loop
  if source->>'kind' is null or source->>'kind' not in ('qbo_sandbox_version','square_sandbox_observation','approved_file_fact','approved_note') then
   raise exception 'shared_evidence_direct_source_kind_denied' using errcode='42501';end if;
  if source->>'kind' in ('qbo_sandbox_version','square_sandbox_observation') and source->>'installation_id' is distinct from p_installation_id::text then raise exception 'sandbox_installation_denied' using errcode='42501';end if;
  resolved:=private.shared_evidence_original_v1(p_workspace_id,source,a);
  for dependency in select value from jsonb_array_elements(coalesce(resolved#>'{data,read_sources}','[]'::jsonb)) loop
   if not (ticket->'sources') @> jsonb_build_array(dependency) then raise exception 'shared_evidence_ticket_dependency_missing' using errcode='42501';end if;
  end loop;
  if source->>'kind'='legacy_reference' and not exists(select 1 from private.legacy_evidence_references where id=(source->>'reference_id')::uuid and captured_by=a and captured_session_id=s) then raise exception 'shared_evidence_capture_actor_mismatch' using errcode='42501';end if;
  if not identities @> jsonb_build_array(resolved->'identity') then identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);end if;
 end loop;
 foreach parent in array p_inherited_manifest_ids loop
  -- Owner-wide briefs cannot consume actor-private VSI history, including copies.
  if p_target_kind='briefing_run' and exists(select 1 from private.shared_evidence_manifests pm
   where pm.id=parent and pm.workspace_id=p_workspace_id and pm.target_kind='vsi_request') then
   raise exception 'shared_evidence_private_brief_input_denied' using errcode='42501';end if;
  -- Retain the immutable output identity behind context, plus each saved report
  -- actually present in the ticket. Mutable context is separately input-hashed.
  for src in select am.* from private.shared_evidence_artifact_manifests am
   join private.shared_evidence_manifests pm on pm.id=am.manifest_id and pm.workspace_id=am.workspace_id
   where am.manifest_id=parent and am.workspace_id=p_workspace_id and
    ((am.artifact_id=pm.target_id and am.artifact_kind=case pm.target_kind when 'vsi_request' then 'vsi_exchange' else 'briefing_run' end)
     or (am.artifact_kind='report' and exists(select 1 from jsonb_array_elements(ticket->'sources') ts where ts->>'table'='reports' and private.safe_evidence_uuid_v1(ts->>'id')=am.artifact_id)))
  loop
   resolved:=private.shared_evidence_inherited_v1(p_workspace_id,a,jsonb_build_object('kind','inherited_artifact','parent_manifest_id',parent,
    'artifact_kind',src.artifact_kind,'artifact_id',src.artifact_id,'artifact_revision',src.artifact_revision));
   if not identities @> jsonb_build_array(resolved->'identity') then identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);end if;
  end loop;
  if not found then raise exception 'shared_evidence_inherited_artifact_denied' using errcode='42501';end if;
  for src in select ms.original_identity from private.shared_evidence_manifest_sources ms where ms.manifest_id=parent and ms.workspace_id=p_workspace_id order by ms.ordinal loop
   resolved:=private.shared_evidence_original_v1(p_workspace_id,src.original_identity,a);
   for dependency in select value from jsonb_array_elements(coalesce(resolved#>'{data,read_sources}','[]'::jsonb)) loop
    if not (ticket->'sources') @> jsonb_build_array(dependency) then raise exception 'shared_evidence_ticket_dependency_missing' using errcode='42501';end if;
   end loop;
   if not identities @> jsonb_build_array(resolved->'identity') then identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);end if;
  end loop;
 end loop;
 if jsonb_array_length(projections)>24 or octet_length(projections::text)>2000000 then raise exception 'shared_evidence_budget_exceeded' using errcode='54000';end if;
 insert into private.shared_evidence_manifests(workspace_id,actor_id,session_id,target_kind,target_id,attempt,google_sheets_read_ticket_id,input_hash,manifest_hash,parser_contract,sandbox_installation_id)
 values(p_workspace_id,a,s,p_target_kind,p_target_id,p_attempt,p_read_ticket_id,private.evidence_digest_v1(jsonb_build_array(target,ticket)),private.evidence_digest_v1(projections),'shared_evidence_v1',p_installation_id) returning id into m;
 for resolved in select value from jsonb_array_elements(projections) loop
  insert into private.shared_evidence_manifest_sources values(p_workspace_id,m,ordinal,resolved#>>'{identity,kind}',resolved->'identity',resolved->>'hash');ordinal:=ordinal+1;
 end loop;
 if p_target_kind='vsi_request' then update public.vsi_requests set shared_evidence_required=true where id=p_target_id and workspace_id=p_workspace_id;end if;
 return jsonb_build_object('stage','database_bound','manifest_id',m,'projections',projections,'provider_policy_required',true);
end $$;


create function private.guard_sandbox_manifest_source_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare installation uuid;parent_installation uuid;
begin
 select sandbox_installation_id into installation from private.shared_evidence_manifests where id=new.manifest_id and workspace_id=new.workspace_id;
 if new.source_kind in ('qbo_sandbox_version','square_sandbox_observation') then
  if installation is null or new.original_identity->>'environment' is distinct from 'sandbox' or new.original_identity->>'installation_id' is distinct from installation::text then raise exception 'sandbox_manifest_environment_denied' using errcode='42501';end if;
 elsif new.source_kind='inherited_artifact' then
  select sandbox_installation_id into parent_installation from private.shared_evidence_manifests where id=private.safe_evidence_uuid_v1(new.original_identity->>'parent_manifest_id') and workspace_id=new.workspace_id;
  if parent_installation is distinct from installation then raise exception 'sandbox_inherited_environment_denied' using errcode='42501';end if;
 elsif installation is not null and new.source_kind not in ('approved_file_fact','approved_note') then raise exception 'sandbox_mixed_environment_denied' using errcode='42501';end if;
 return new;
end $$;
create trigger sandbox_manifest_source_binding before insert on private.shared_evidence_manifest_sources for each row execute function private.guard_sandbox_manifest_source_v1();

alter function private.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer,uuid,uuid) rename to validate_shared_evidence_before_sandbox_v1;
create function private.validate_shared_evidence_manifest_v1(w uuid,m uuid,k text,i uuid,attempt integer,a uuid,s uuid) returns void language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare installation uuid;
begin
 perform private.require_shared_evidence_actor_v1(w,a,s);
 select sandbox_installation_id into installation from private.shared_evidence_manifests where id=m and workspace_id=w;
 if installation is not null then
  perform private.lock_sandbox_square_sources_v1();perform private.require_sandbox_evidence_policy_v1(w,a,s,installation);
  insert into private.sandbox_shared_resolution_claims values(pg_current_xact_id(),w,a,s,installation);
 end if;
 perform private.validate_shared_evidence_before_sandbox_v1(w,m,k,i,attempt,a,s);
 if installation is not null then delete from private.sandbox_shared_resolution_claims where transaction_id=pg_current_xact_id();end if;
end $$;
alter function private.shared_evidence_inherited_v1(uuid,uuid,jsonb) rename to shared_evidence_inherited_before_sandbox_v1;
create function private.shared_evidence_inherited_v1(w uuid,a uuid,j jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare installation uuid;s uuid;
begin
 select sandbox_installation_id into installation from private.shared_evidence_manifests where id=private.safe_evidence_uuid_v1(j->>'parent_manifest_id') and workspace_id=w;
 if installation is not null then
  s:=private.sandbox_resolution_session_v1(w,a,installation);perform private.lock_sandbox_square_sources_v1();perform private.require_sandbox_evidence_policy_v1(w,a,s,installation);
 end if;
 return private.shared_evidence_inherited_before_sandbox_v1(w,a,j);
end $$;

-- No existing validation/source/runtime RPC gains any privilege.
revoke all on function private.guard_sandbox_evidence_policy_v1(),private.sandbox_evidence_issuer_v1(),private.sandbox_qbo_preview_v1(jsonb,text,text),private.require_sandbox_evidence_policy_v1(uuid,uuid,uuid,uuid),
 private.sandbox_resolution_session_v1(uuid,uuid,uuid),private.lock_sandbox_square_sources_v1(),private.sandbox_square_authority_v1(uuid,uuid,uuid),private.resolve_sandbox_shared_source_v1(uuid,uuid,jsonb),
 private.shared_evidence_original_v1(uuid,jsonb,uuid),private.shared_evidence_before_sandbox_v1(uuid,jsonb,uuid),private.guard_sandbox_manifest_source_v1(),
 private.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer,uuid,uuid),private.validate_shared_evidence_before_sandbox_v1(uuid,uuid,text,uuid,integer,uuid,uuid),
 private.shared_evidence_inherited_v1(uuid,uuid,jsonb),private.shared_evidence_inherited_before_sandbox_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_sandbox_shared_evidence_v1(uuid,jsonb,uuid),public.discover_sandbox_shared_evidence_v1(uuid,date,date,uuid),public.seal_sandbox_shared_evidence_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_sandbox_shared_evidence_v1(uuid,jsonb,uuid),public.discover_sandbox_shared_evidence_v1(uuid,date,date,uuid),public.seal_sandbox_shared_evidence_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[],uuid) to authenticated;
-- No policy INSERT: both database admission and code defaults remain closed.
commit;
