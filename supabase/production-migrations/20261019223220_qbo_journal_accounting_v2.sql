begin;
-- Versioned v2 journal admission. Explicit opt-in; no changes to v1 authority,
-- contribution families, report treatment, Health eligibility or shared artifacts.
create table private.qbo_journal_authorities_v2 (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, business_entity_id uuid not null,
 connection_id uuid not null references private.integration_connections(id), connection_generation bigint not null,
 mapping_id uuid not null references private.provider_entity_mappings(id), mapping_row_version bigint not null,
 realm_fingerprint bytea not null, currency text not null, effective_from date not null,
 enabled boolean not null, actor_id uuid not null references auth.users(id),
 account_classes jsonb not null, prior_id uuid references private.qbo_journal_authorities_v2(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id)
);
alter table private.qbo_journal_authorities_v2 enable row level security;
alter table private.qbo_journal_authorities_v2 force row level security;
revoke all on private.qbo_journal_authorities_v2 from public,anon,authenticated,service_role;
create trigger qbo_journal_authority_immutable_v2 before update or delete on private.qbo_journal_authorities_v2
 for each row execute function private.reject_external_integration_immutable_mutation_v1();
create index qbo_journal_authority_head_v2 on private.qbo_journal_authorities_v2(connection_id,created_at desc,id);

create table private.qbo_journal_admissions_v2 (
 id uuid primary key default gen_random_uuid(), authority_id uuid not null references private.qbo_journal_authorities_v2(id),
 workspace_id uuid not null,business_entity_id uuid not null,source_record_id uuid not null,
 source_version_id uuid not null, fact_version_ids uuid[] not null, posting_date date not null,
 receipt_hash bytea not null check(octet_length(receipt_hash)=32), created_at timestamptz not null default clock_timestamp(),
 unique(authority_id,source_version_id),
 foreign key(workspace_id,business_entity_id,source_record_id,source_version_id)
 references private.external_source_record_versions(workspace_id,business_entity_id,source_record_id,id)
);
alter table private.qbo_journal_admissions_v2 enable row level security;
alter table private.qbo_journal_admissions_v2 force row level security;
revoke all on private.qbo_journal_admissions_v2 from public,anon,authenticated,service_role;
create trigger qbo_journal_admission_immutable_v2 before update or delete on private.qbo_journal_admissions_v2
 for each row execute function private.reject_external_integration_immutable_mutation_v1();

create function private.qbo_journal_category_matches_v2(category text, account_type text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(case category when 'revenue' then account_type='Income'
 when 'cost_of_goods_sold' then account_type='Cost of Goods Sold'
 when 'labor' then account_type='Expense' when 'other_operating_costs' then account_type='Expense'
 when 'balance_sheet' then account_type in ('Bank','Accounts Receivable','Other Current Asset','Fixed Asset','Other Asset',
 'Accounts Payable','Credit Card','Other Current Liability','Long Term Liability','Equity') else false end,false)
$$;

-- Checked owner chooses account categories, never amounts. Existing v1 consent
-- does not opt in, and this policy never establishes complete ledger coverage.
create function public.set_qbo_customer_journal_authority_v2(p_connection_id uuid,p_expected_authority_id uuid,
 p_enabled boolean,p_effective_from date,p_account_classes jsonb,p_consent text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.integration_connections;m private.provider_entity_mappings;prior private.qbo_journal_authorities_v2;
 a private.qbo_journal_authorities_v2; v private.external_source_record_versions; item jsonb; classes jsonb:='[]';category text;ref text;
begin
 if auth.role() is distinct from 'authenticated' or p_consent is distinct from 'qbo_journal_revenue_cost_subtotals_v2'
 or p_enabled is null or p_effective_from is null or not isfinite(p_effective_from) or p_effective_from>current_date then
 raise exception 'qbo_journal_authority_denied' using errcode='42501';end if;
 select * into c from private.integration_connections where id=p_connection_id and provider_key='quickbooks_online'
 and provider_environment='production' and status in ('initializing','active','degraded') for share;
 if not found then raise exception 'qbo_journal_connection_denied' using errcode='42501';end if;
 perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,c.workspace_id,c.business_entity_id,true);
 perform id from public.business_entities where id=c.business_entity_id and workspace_id=c.workspace_id for update;
 select * into prior from private.qbo_journal_authorities_v2 where connection_id=c.id order by created_at desc,id desc limit 1;
 if prior.id is distinct from p_expected_authority_id then raise exception 'qbo_journal_authority_stale' using errcode='40001';end if;
 select * into m from private.provider_entity_mappings where connection_id=c.id and workspace_id=c.workspace_id
 and business_entity_id=c.business_entity_id and provider_key=c.provider_key and provider_environment=c.provider_environment and status='active' for share;
 if not found or (select count(*) from private.provider_entity_mappings where connection_id=c.id and status='active')<>1 then
 raise exception 'qbo_journal_mapping_denied' using errcode='42501';end if;
 if p_enabled then
  if jsonb_typeof(p_account_classes) is distinct from 'array' or jsonb_array_length(p_account_classes) not between 1 and 2000 then
  raise exception 'qbo_journal_classes_invalid' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_account_classes) loop
   if not private.jsonb_has_exact_keys_v1(item,array['sourceVersionId','category']) then raise exception 'qbo_journal_classes_invalid';end if;
   category:=item->>'category';
   select ver.* into v from private.external_source_record_versions ver join private.external_source_records s on s.current_version_id=ver.id
   where ver.id=(item->>'sourceVersionId')::uuid and s.connection_id=c.id and s.workspace_id=c.workspace_id
   and s.business_entity_id=c.business_entity_id and s.mapping_id=m.id and s.provider_record_type='Account';
   if not found or not private.qbo_journal_category_matches_v2(category,v.normalized_projection#>>'{relationships,AccountType,value}') then
   raise exception 'qbo_journal_account_classification_denied' using errcode='42501';end if;
   perform private.assert_qbo_production_source_promotable_v1(c.workspace_id,c.business_entity_id,v.id);
   ref:=v.normalized_projection->>'id';
   if exists(select 1 from jsonb_array_elements(classes) x where x->>'accountRef'=ref) then raise exception 'qbo_journal_duplicate_account';end if;
   classes:=classes||jsonb_build_array(jsonb_build_object('sourceVersionId',v.id,'sourceRecordId',v.source_record_id,
    'sourceFingerprint','sha256:'||encode(v.source_fingerprint,'hex'),'accountRef',ref,'category',category));
  end loop;
 else classes:=coalesce(prior.account_classes,'[]');end if;
 insert into private.qbo_journal_authorities_v2(workspace_id,business_entity_id,connection_id,connection_generation,mapping_id,
 mapping_row_version,realm_fingerprint,currency,effective_from,enabled,actor_id,account_classes,prior_id)
 values(c.workspace_id,c.business_entity_id,c.id,c.connection_generation,m.id,m.row_version,m.provider_entity_reference_fingerprint,
 (select coalesce(reporting_currency,base_currency) from public.business_entities where id=c.business_entity_id),
 p_effective_from,p_enabled,auth.uid(),classes,prior.id) returning * into a;
 return jsonb_build_object('authorityId',a.id,'enabled',a.enabled,'coverage','admitted_subtotal');
end $$;

create function private.qbo_journal_current_authority_v2(p_connection_id uuid) returns private.qbo_journal_authorities_v2
language plpgsql security definer set search_path='' as $$
declare a private.qbo_journal_authorities_v2;c private.integration_connections;item jsonb;
begin
 select * into c from private.integration_connections where id=p_connection_id and provider_key='quickbooks_online'
 and provider_environment='production' and status in ('initializing','active','degraded') for share;
 if not found then raise exception 'qbo_journal_connection_denied' using errcode='42501';end if;
 perform id from public.business_entities where id=c.business_entity_id and workspace_id=c.workspace_id for share;
 select * into a from private.qbo_journal_authorities_v2 where connection_id=c.id order by created_at desc,id desc limit 1;
 if not found or not a.enabled or a.connection_generation<>c.connection_generation or a.effective_from>current_date
 or (select count(*) from private.provider_entity_mappings where connection_id=c.id and status='active')<>1
 or not exists(select 1 from public.business_entities where id=a.business_entity_id and workspace_id=a.workspace_id
 and status='active' and coalesce(reporting_currency,base_currency)=a.currency)
 or not exists(select 1 from private.provider_entity_mappings where id=a.mapping_id and connection_id=c.id and workspace_id=a.workspace_id
 and business_entity_id=a.business_entity_id and status='active' and row_version=a.mapping_row_version
 and provider_entity_reference_fingerprint=a.realm_fingerprint) then raise exception 'qbo_journal_authority_required' using errcode='42501';end if;
 for item in select value from jsonb_array_elements(a.account_classes) loop
  if not exists(select 1 from private.external_source_records where id=(item->>'sourceRecordId')::uuid
  and current_version_id=(item->>'sourceVersionId')::uuid and workspace_id=a.workspace_id and business_entity_id=a.business_entity_id
  and connection_id=c.id and mapping_id=a.mapping_id) then raise exception 'qbo_journal_accounts_stale' using errcode='40001';end if;
  perform private.assert_qbo_production_source_promotable_v1(a.workspace_id,a.business_entity_id,(item->>'sourceVersionId')::uuid);
 end loop;
 return a;
end $$;

-- RPC amounts are derived here from validated journal lines. Callers cannot
-- submit precomputed amounts, facts, coverage flags or a replacement receipt.
create function private.admit_qbo_journal_sources_internal_v2(p_connection_id uuid,p_authority_id uuid,p_source_version_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.qbo_journal_authorities_v2; v private.external_source_record_versions; s private.external_source_records;
 source_id uuid; doc jsonb;e jsonb;line jsonb;le jsonb;account jsonb;category text;credit numeric;balance numeric;
 ids text[];facts uuid[];fact_id uuid;v_fact_key text;kind text;amount text;payload jsonb;identity_hash text;result jsonb;
 prior private.canonical_business_fact_versions; stamp text;posted date;admitted integer:=0;seen integer;head uuid;
begin
 if p_source_version_ids is null or array_position(p_source_version_ids,null) is not null or cardinality(p_source_version_ids) not between 1 and 25 or cardinality(p_source_version_ids)<>(select count(distinct x) from unnest(p_source_version_ids) x)
 then raise exception 'qbo_journal_batch_invalid' using errcode='22023';end if;
 a:=private.qbo_journal_current_authority_v2(p_connection_id);
 if a.id is distinct from p_authority_id then raise exception 'qbo_journal_authority_stale' using errcode='40001';end if;
 -- Lock referenced account/source heads before deriving any financial facts.
 perform id from private.external_source_records where connection_id=a.connection_id and workspace_id=a.workspace_id
 and (current_version_id=any(p_source_version_ids) or provider_record_type='Account') order by id for update;
 for source_id in select x from unnest(p_source_version_ids) x order by x loop
  select * into v from private.external_source_record_versions where id=source_id;
  select * into s from private.external_source_records where id=v.source_record_id and current_version_id=v.id
  and workspace_id=a.workspace_id and business_entity_id=a.business_entity_id and connection_id=a.connection_id and mapping_id=a.mapping_id
  and provider_record_type='JournalEntry';
  if not found then raise exception 'qbo_journal_source_denied' using errcode='42501';end if;
  perform private.assert_qbo_production_source_promotable_v1(a.workspace_id,a.business_entity_id,v.id);
  if exists(select 1 from private.qbo_journal_admissions_v2 where authority_id=a.id and source_version_id=v.id) then continue;end if;
  doc:=v.normalized_projection;e:=doc->'accountingEvidence';posted:=v.posting_date;
  if posted is null or posted<a.effective_from or posted>current_date or doc->>'recordType'<>'JournalEntry'
  or doc->>'minimizationVersion' is distinct from 'qbo_minimizer_v2' or doc->>'status' is distinct from 'active'
  or doc#>>'{provider,sourceEnvironment}' is distinct from 'production' or doc#>>'{accounting,sourceCurrency}' is distinct from a.currency
  or (doc#>>'{accounting,homeCurrency}' is not null and doc#>>'{accounting,homeCurrency}'<>a.currency)
  or (doc#>>'{accounting,exchangeRate}' is not null and doc#>>'{accounting,exchangeRate}'<>'1')
  or e->'sparse' is distinct from 'false'::jsonb or e->'hasDiscountDetail' is distinct from 'false'::jsonb
  or e->'hasTaxLines' is distinct from 'false'::jsonb or e->'hasTaxDetail' is distinct from 'false'::jsonb
  or (e#>>'{totalTax,amount}' is not null and e#>>'{totalTax,amount}'<>'0')
  or (e->>'globalTaxCalculation' is not null and e->>'globalTaxCalculation' not in ('TaxExcluded','NotApplicable'))
  then raise exception 'qbo_journal_semantics_unproven' using errcode='42501';end if;
  balance:=0;ids:='{}';facts:='{}';seen:=0;
  stamp:=to_char(date_trunc('milliseconds',clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  for line in select value from jsonb_array_elements(doc->'lines') loop
   seen:=seen+1;le:=line->'accountingEvidence';
   if line->>'lineId' is null or line->>'lineId'=any(ids) or line->>'detailType' is distinct from 'JournalEntryLineDetail'
   or line#>>'{amount,currency}' is distinct from a.currency or line#>>'{amount,amount}' is null or (line#>>'{amount,amount}')::numeric<0
   or line->>'postingType' is null or line->>'postingType' not in ('credit','debit')
   or le->>'accountReferenceKind' is distinct from 'account_ref' or le->'hasDiscountDetail' is distinct from 'false'::jsonb
   or le->'hasGroupDetail' is distinct from 'false'::jsonb or le->'hasTaxDetail' is distinct from 'false'::jsonb
   or le->'taxInclusiveAmount' is distinct from 'null'::jsonb or le->'taxCodeRef' is distinct from 'null'::jsonb
   then raise exception 'qbo_journal_line_unproven' using errcode='42501';end if;
   ids:=array_append(ids,line->>'lineId');
   select value into account from jsonb_array_elements(a.account_classes) where value->>'accountRef'=line#>>'{accountRef,value}';
   if not found then raise exception 'qbo_journal_account_unclassified' using errcode='42501';end if;
   credit:=(line#>>'{amount,amount}')::numeric*case when line->>'postingType'='credit' then 1 else -1 end;
   balance:=balance+credit;category:=account->>'category';
   if category='balance_sheet' then continue;end if;
   amount:=trim_scale(case when category='revenue' then credit else -credit end)::text;
   kind:='qbo_journal_'||category;
   v_fact_key:='qbo_journal_v2/'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object('authority',a.id,
    'source',s.id,'line',line->>'lineId','category',category)),'hex');
   select ver.* into prior from private.canonical_business_facts f join private.canonical_business_fact_versions ver on ver.id=f.current_version_id
   where f.workspace_id=a.workspace_id and f.business_entity_id=a.business_entity_id and f.fact_kind=kind and f.fact_key=v_fact_key;
   fact_id:=gen_random_uuid();
   payload:=jsonb_build_object('contractVersion','canonical_business_fact_version_v2','id',fact_id,'workspaceId',a.workspace_id,
   'businessEntityId',a.business_entity_id,'immutableVersion',coalesce(prior.immutable_version,0)+1,
   'factKind',kind,'factKey',v_fact_key,'dimensions',jsonb_build_array(jsonb_build_object('key','account_ref','value',line#>>'{accountRef,value}')),
   'temporal',jsonb_build_object('effectiveAt',posted::text||'T00:00:00.000Z','postingDate',posted,'periodStart',null,'periodEnd',null,
    'fiscalYear',null,'fiscalPeriod',null,'sourceTimeZone',null,'closedPeriod',false),
   'accounting',jsonb_build_object('basis','accrual','sourceCurrency',a.currency,'reportingCurrency',a.currency,'exchangeRate',null,'exchangeRateSource',null),
   'value',jsonb_build_object('kind','money','amount',amount,'currency',a.currency),'reconciliationState','accepted','validationState','valid',
   'sources',jsonb_build_array(jsonb_build_object('sourceRecordVersionId',v.id,'sourceFingerprint','sha256:'||encode(v.source_fingerprint,'hex'),
    'sourceRole','primary','contributionWeight','1'),jsonb_build_object('sourceRecordVersionId',account->>'sourceVersionId',
    'sourceFingerprint',account->>'sourceFingerprint','sourceRole','corroborating','contributionWeight','0')),
   'decision',jsonb_build_object('authority','deterministic_policy','policyVersion','qbo_journal_accounting_v2','actorId',null,
    'decidedAt',stamp,'reasonCodes',jsonb_build_array('explicit_classified_journal_posting')),
   'normalizationVersion','qbo_journal_accounting_v2','transformationVersion','qbo_journal_accounting_v2',
   'sourceObservedAt',to_char(v.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdAt',stamp);
   payload:=payload||jsonb_build_object('factFingerprint','sha256:'||encode(private.qbo_accounting_fact_fingerprint_v1(payload),'hex'));
   identity_hash:='sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object('identityVersion','canonical_fact_identity_v1',
    'workspaceId',a.workspace_id,'businessEntityId',a.business_entity_id,'factKind',kind,'factKey',v_fact_key)),'hex');
   result:=private.commit_qbo_accounting_fact_internal_v1(identity_hash,payload,'qbo_journal_admit_v2','integration_provider_source_authority');
   facts:=array_append(facts,(result->>'currentVersionId')::uuid);
  end loop;
  if seen<2 or balance<>0 then raise exception 'qbo_journal_not_balanced' using errcode='42501';end if;
  insert into private.qbo_journal_admissions_v2(authority_id,workspace_id,business_entity_id,source_record_id,source_version_id,
   fact_version_ids,posting_date,receipt_hash) values(a.id,a.workspace_id,a.business_entity_id,s.id,v.id,facts,posted,
   private.phase_3_contract_fingerprint_v1(jsonb_build_object('contract','qbo_journal_admission_v2','authority',a.id,
   'sourceVersionId',v.id,'sourceFingerprint',encode(v.source_fingerprint,'hex'),'facts',to_jsonb(facts),'accounts',a.account_classes)));
  admitted:=admitted+1;
 end loop;
 return jsonb_build_object('admitted',admitted);
end $$;

create function public.admit_qbo_journal_sources_v2(p_connection_id uuid,p_authority_id uuid,p_source_version_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_integration_provider_source_authority_v1();
 return private.admit_qbo_journal_sources_internal_v2(p_connection_id,p_authority_id,p_source_version_ids);
end $$;
revoke all on function private.admit_qbo_journal_sources_internal_v2(uuid,uuid,uuid[])
 from public,anon,authenticated,service_role,integration_provider_source_authority;

create function private.read_qbo_journal_period_for_actor_v2(p_actor_id uuid,p_session_id uuid,p_connection_id uuid,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.qbo_journal_authorities_v2;c private.integration_connections;facts uuid[];sources uuid[];n integer;
 revenue numeric;cogs numeric;labor numeric;other_cost numeric;result jsonb;receipts jsonb;count_categories integer;matched_count integer;source_refs jsonb;source_id uuid;
begin
 select * into c from private.integration_connections where id=p_connection_id;
 if not found then raise exception 'qbo_journal_connection_denied' using errcode='42501';end if;
 perform private.qbo_customer_require_owner_v1(p_actor_id,p_session_id,c.workspace_id,c.business_entity_id,true);
 perform s.id from private.external_source_records s join private.external_source_record_versions v on v.id=s.current_version_id
 where s.connection_id=c.id and s.workspace_id=c.workspace_id and s.business_entity_id=c.business_entity_id
 and (s.provider_record_type='Account' or (s.provider_record_type='JournalEntry' and v.posting_date between p_period_start and p_period_end))
 order by s.id for share of s;
 a:=private.qbo_journal_current_authority_v2(p_connection_id);
 if p_period_start is null or p_period_end is null or not isfinite(p_period_start) or not isfinite(p_period_end) or p_period_start>p_period_end or p_period_end>current_date
 or p_period_start<a.effective_from or p_period_end-p_period_start>365 then raise exception 'qbo_journal_period_invalid';end if;
 -- Any current journal in scope that has not passed admission with this policy
 -- withholds the whole period. Missing imported records still cannot be detected
 -- as live ledger completeness, so the returned coverage remains partial.
 if exists(select 1 from private.external_source_records s join private.external_source_record_versions v on v.id=s.current_version_id
 where s.connection_id=a.connection_id and s.workspace_id=a.workspace_id and s.business_entity_id=a.business_entity_id
 and s.mapping_id=a.mapping_id and s.provider_record_type='JournalEntry' and v.posting_date between p_period_start and p_period_end
 and not exists(select 1 from private.qbo_journal_admissions_v2 ad where ad.authority_id=a.id and ad.source_version_id=v.id)) then
 return null;end if;
 select count(*),array_agg(distinct ad.source_version_id order by ad.source_version_id),jsonb_agg(encode(ad.receipt_hash,'hex') order by ad.source_version_id)
 into n,sources,receipts from private.qbo_journal_admissions_v2 ad join private.external_source_records s
 on s.id=ad.source_record_id and s.current_version_id=ad.source_version_id where ad.authority_id=a.id
 and ad.posting_date between p_period_start and p_period_end;
 if n=0 or n>5000 then return null;end if;
 foreach source_id in array sources loop
  perform private.assert_qbo_production_source_promotable_v1(a.workspace_id,a.business_entity_id,source_id);
 end loop;
 select array_agg(distinct f order by f) into facts from private.qbo_journal_admissions_v2 ad
 join private.external_source_records s on s.id=ad.source_record_id and s.current_version_id=ad.source_version_id,
 unnest(ad.fact_version_ids) f where ad.authority_id=a.id and ad.posting_date between p_period_start and p_period_end;
 if facts is null or cardinality(facts)>10000 then return null;end if;
 perform id from private.canonical_business_facts where current_version_id=any(facts) order by id for share;
 select count(*),count(distinct f.fact_kind),sum(v.numeric_value) filter(where f.fact_kind='qbo_journal_revenue'),
 sum(v.numeric_value) filter(where f.fact_kind='qbo_journal_cost_of_goods_sold'),sum(v.numeric_value) filter(where f.fact_kind='qbo_journal_labor'),
 sum(v.numeric_value) filter(where f.fact_kind='qbo_journal_other_operating_costs') into matched_count,count_categories,revenue,cogs,labor,other_cost
 from private.canonical_business_fact_versions v join private.canonical_business_facts f on f.current_version_id=v.id
 where v.id=any(facts) and v.workspace_id=a.workspace_id and v.business_entity_id=a.business_entity_id
 and v.reconciliation_state='accepted' and v.validation_state='valid';
 if matched_count<>cardinality(facts) or count_categories<>4 or revenue is null or cogs is null or labor is null or other_cost is null then return null;end if;
 select array_agg(distinct id order by id) into sources from (select unnest(sources) id union all
 select (x->>'sourceVersionId')::uuid from jsonb_array_elements(a.account_classes) x) all_sources;
 select jsonb_agg(jsonb_build_object('recordId',v.source_record_id,'versionId',v.id,'recordType',v.provider_record_type) order by v.id)
 into source_refs from private.external_source_record_versions v where v.id=any(sources);
 result:=jsonb_build_object('contractVersion','qbo_journal_period_v2','workspaceId',a.workspace_id,'connectionId',a.connection_id,
 'entityId',a.business_entity_id,'authorityId',a.id,'currency',a.currency,'basis','accrual','periodStart',p_period_start,'periodEnd',p_period_end,
 'recognizedRevenue',trim_scale(revenue)::text,'costOfGoodsSold',trim_scale(cogs)::text,'labor',trim_scale(labor)::text,
 'otherOperatingCosts',trim_scale(other_cost)::text,'operatingProfit',trim_scale(revenue-cogs-labor-other_cost)::text,
 'coverage',jsonb_build_object('kind','admitted_subtotal','liveLedgerComplete',false,'journalCount',n,
 'limitation','Classified imported journal postings only; other transaction types and live-ledger completeness are not established.'),
 'sourceVersionIds',to_jsonb(sources),'factVersionIds',to_jsonb(facts),'sources',source_refs);
 return result||jsonb_build_object('receiptHash','sha256:'||encode(private.phase_3_contract_fingerprint_v1(
 jsonb_build_object('contract','qbo_journal_period_receipt_v2','period',result,'admissionReceipts',receipts)),'hex'));
end $$;

create function public.read_qbo_customer_journal_period_v2(p_connection_id uuid,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'authenticated' then raise exception 'qbo_journal_owner_required' using errcode='42501';end if;
 return private.read_qbo_journal_period_for_actor_v2(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_connection_id,p_period_start,p_period_end);
end $$;
revoke all on function private.read_qbo_journal_period_for_actor_v2(uuid,uuid,uuid,date,date)
 from public,anon,authenticated,service_role,integration_provider_source_authority;

revoke all on function private.qbo_journal_category_matches_v2(text,text),private.qbo_journal_current_authority_v2(uuid)
 from public,anon,authenticated,service_role,integration_provider_source_authority;
revoke all on function public.set_qbo_customer_journal_authority_v2(uuid,uuid,boolean,date,jsonb,text),
 public.read_qbo_customer_journal_period_v2(uuid,date,date) from public,anon,service_role,integration_provider_source_authority;
grant execute on function public.set_qbo_customer_journal_authority_v2(uuid,uuid,boolean,date,jsonb,text),
 public.read_qbo_customer_journal_period_v2(uuid,date,date) to authenticated;
revoke all on function public.admit_qbo_journal_sources_v2(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admit_qbo_journal_sources_v2(uuid,uuid,uuid[]) to integration_provider_source_authority;

-- Ordinary owner application path. Original worker admission stays available;
-- neither path accepts caller-supplied monetary values or coverage assertions.
create function public.read_qbo_customer_journal_settings_v2(p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.integration_connections; a private.qbo_journal_authorities_v2; accounts jsonb;
begin
 if auth.role() is distinct from 'authenticated' then raise exception 'qbo_journal_owner_required' using errcode='42501';end if;
 select * into c from private.integration_connections where id=p_connection_id and provider_key='quickbooks_online'
 and provider_environment='production' and status in ('initializing','active','degraded');
 if not found then raise exception 'qbo_journal_connection_denied' using errcode='42501';end if;
 perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,c.workspace_id,c.business_entity_id,true);
 select * into a from private.qbo_journal_authorities_v2 where connection_id=c.id order by created_at desc,id desc limit 1;
 select coalesce(jsonb_agg(jsonb_build_object('sourceVersionId',v.id,'recordId',s.id,'name',coalesce(v.normalized_projection->>'displayName',s.provider_record_id),
 'accountType',v.normalized_projection#>>'{relationships,AccountType,value}',
 'category',(select x->>'category' from jsonb_array_elements(coalesce(a.account_classes,'[]')) x where x->>'sourceVersionId'=v.id::text)) order by s.provider_record_id),'[]')
 into accounts from private.external_source_records s join private.external_source_record_versions v on v.id=s.current_version_id
 where s.connection_id=c.id and s.workspace_id=c.workspace_id and s.business_entity_id=c.business_entity_id
 and s.provider_record_type='Account' and v.validation_state='valid' and v.normalized_projection->>'status'='active';
 if jsonb_array_length(accounts)>2000 then raise exception 'qbo_journal_account_limit';end if;
 return jsonb_build_object('workspaceId',c.workspace_id,'connectionId',c.id,'authorityId',a.id,'enabled',coalesce(a.enabled,false),
 'effectiveFrom',a.effective_from,'accounts',accounts);
end $$;

create function public.process_qbo_customer_journal_page_v2(p_connection_id uuid,p_authority_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.integration_connections; a private.qbo_journal_authorities_v2; ids uuid[]; result jsonb;
begin
 if auth.role() is distinct from 'authenticated' then raise exception 'qbo_journal_owner_required' using errcode='42501';end if;
 select * into c from private.integration_connections where id=p_connection_id;
 if not found then raise exception 'qbo_journal_connection_denied' using errcode='42501';end if;
 perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,c.workspace_id,c.business_entity_id,true);
 a:=private.qbo_journal_current_authority_v2(c.id);
 if a.id is distinct from p_authority_id then raise exception 'qbo_journal_authority_stale' using errcode='40001';end if;
 select array_agg(id order by id) into ids from (select v.id from private.external_source_records s
 join private.external_source_record_versions v on v.id=s.current_version_id
 where s.connection_id=c.id and s.workspace_id=c.workspace_id and s.business_entity_id=c.business_entity_id and s.mapping_id=a.mapping_id
 and s.provider_record_type='JournalEntry' and v.posting_date>=a.effective_from and v.posting_date<=current_date
 and v.validation_state='valid' and not exists(select 1 from private.qbo_journal_admissions_v2 ad where ad.authority_id=a.id and ad.source_version_id=v.id)
 order by v.id limit 25) batch;
 if ids is null then return jsonb_build_object('admitted',0,'fullPage',false);end if;
 result:=private.admit_qbo_journal_sources_internal_v2(c.id,a.id,ids);
 return result||jsonb_build_object('fullPage',cardinality(ids)=25);
end $$;
revoke all on function public.read_qbo_customer_journal_settings_v2(uuid),public.process_qbo_customer_journal_page_v2(uuid,uuid)
 from public,anon,service_role,integration_provider_source_authority;
grant execute on function public.read_qbo_customer_journal_settings_v2(uuid),public.process_qbo_customer_journal_page_v2(uuid,uuid) to authenticated;

create function public.read_qbo_customer_journal_evidence_v2(p_connection_id uuid,p_period_start date,p_period_end date,p_source_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb;a private.qbo_journal_authorities_v2;v private.external_source_record_versions;
 account jsonb;lines jsonb;doc jsonb;
begin
 if auth.role() is distinct from 'authenticated' then raise exception 'qbo_journal_owner_required' using errcode='42501';end if;
 receipt:=private.read_qbo_journal_period_for_actor_v2(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_connection_id,p_period_start,p_period_end);
 if receipt is null or not (receipt->'sourceVersionIds' ? p_source_version_id::text) then
 raise exception 'qbo_journal_evidence_unavailable' using errcode='42501';end if;
 select * into a from private.qbo_journal_authorities_v2 where id=(receipt->>'authorityId')::uuid;
 select * into v from private.external_source_record_versions where id=p_source_version_id and workspace_id=a.workspace_id
 and business_entity_id=a.business_entity_id and connection_id=a.connection_id;
 if not found then raise exception 'qbo_journal_evidence_unavailable' using errcode='42501';end if;
 doc:=v.normalized_projection;
 if v.provider_record_type='Account' then
  select value into account from jsonb_array_elements(a.account_classes) where value->>'sourceVersionId'=v.id::text;
  if not found then raise exception 'qbo_journal_evidence_unavailable' using errcode='42501';end if;
  return jsonb_build_object('kind','account','workspaceId',a.workspace_id,'connectionId',a.connection_id,'recordId',v.source_record_id,
   'versionId',v.id,'receiptHash',receipt->>'receiptHash','periodStart',p_period_start,'periodEnd',p_period_end,
   'accountRef',doc->>'id','name',doc->>'displayName','accountType',doc#>>'{relationships,AccountType,value}',
   'category',account->>'category','policyVersion','qbo_journal_accounting_v2');
 end if;
 if v.provider_record_type<>'JournalEntry' or jsonb_array_length(doc->'lines') not between 2 and 500 then
 raise exception 'qbo_journal_evidence_unavailable' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('lineId',l->>'lineId','accountRef',l#>>'{accountRef,value}',
 'postingType',l->>'postingType','amount',l#>>'{amount,amount}','currency',l#>>'{amount,currency}',
 'category',(select x->>'category' from jsonb_array_elements(a.account_classes) x where x->>'accountRef'=l#>>'{accountRef,value}')) order by n)
 into lines from jsonb_array_elements(doc->'lines') with ordinality entry(l,n);
 return jsonb_build_object('kind','journal','workspaceId',a.workspace_id,'connectionId',a.connection_id,'recordId',v.source_record_id,
 'versionId',v.id,'receiptHash',receipt->>'receiptHash','periodStart',p_period_start,'periodEnd',p_period_end,
 'providerRecordId',v.provider_record_id,'postingDate',v.posting_date,'currency',a.currency,'lines',lines);
end $$;
revoke all on function public.read_qbo_customer_journal_evidence_v2(uuid,date,date,uuid) from public,anon,service_role,integration_provider_source_authority;
grant execute on function public.read_qbo_customer_journal_evidence_v2(uuid,date,date,uuid) to authenticated;

commit;
