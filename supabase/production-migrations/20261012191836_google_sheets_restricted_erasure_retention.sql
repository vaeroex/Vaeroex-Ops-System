begin;

create role google_sheets_erasure_restore nologin noinherit;
grant usage on schema private to google_sheets_erasure_restore;

-- No operational login is provisioned. Only the separately provisioned support
-- principal can call exact-row preparation/execution/replay. Application roles
-- receive read-ticket functions, never destructive capabilities.
create table private.google_sheets_privacy_epochs (
 workspace_id uuid primary key, epoch bigint not null default 1,
 blocked boolean not null default false, request_id uuid, updated_at timestamptz not null default clock_timestamp()
);
create table private.google_sheets_read_tickets (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, actor_id uuid not null,
 epoch bigint not null, bound boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 sources jsonb not null default '[]', check(jsonb_array_length(sources)<=20000)
);
create table private.google_sheets_retention_roots (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, identity_hash text not null,
 first_imported_at timestamptz not null, expires_at timestamptz not null,
 automatic_expiry_authorized boolean not null default false, erased_at timestamptz,
 kind text not null default 'source_row' check(kind in ('source_row','connection_metadata')),
 unique(workspace_id,identity_hash), check(identity_hash ~ '^[a-f0-9]{64}$')
);
create table private.google_sheets_source_root_links (
 workspace_id uuid not null, connection_id uuid not null, source_row_id uuid primary key,
 root_id uuid not null references private.google_sheets_retention_roots(id)
);
create table private.google_sheets_connection_root_links (
 workspace_id uuid not null, connection_id uuid primary key, root_id uuid not null references private.google_sheets_retention_roots(id)
);
create table private.google_sheets_derivation_roots (
 workspace_id uuid not null, table_name text not null, record_id uuid not null,
 root_id uuid not null references private.google_sheets_retention_roots(id),
 primary key(workspace_id,table_name,record_id,root_id)
);
create table private.google_sheets_retention_consents (
 approval_id uuid primary key, workspace_id uuid not null, connection_id uuid not null,
 policy_version text not null check(policy_version='google_sheets_retention_v1_13_calendar_months_disconnect_30_days'),
 consented_by uuid not null, consented_at timestamptz not null default clock_timestamp()
);
create table private.google_sheets_erasure_capabilities (
 transaction_id bigint not null, backend_id integer not null, request_id uuid not null,
 workspace_id uuid not null, table_name text not null, record_id uuid not null, old_hash text not null,
 primary key(transaction_id,backend_id,table_name,record_id)
);
do $$ declare t text; begin
 foreach t in array array['google_sheets_privacy_epochs','google_sheets_read_tickets','google_sheets_retention_roots',
 'google_sheets_source_root_links','google_sheets_connection_root_links','google_sheets_derivation_roots','google_sheets_retention_consents','google_sheets_erasure_capabilities'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role,google_sheets_erasure_support,google_sheets_erasure_restore',t);
 end loop;
end $$;
create index google_sheets_retention_due on private.google_sheets_retention_roots(expires_at,id) where erased_at is null;
create index google_sheets_derivation_by_root on private.google_sheets_derivation_roots(root_id,table_name,record_id);
create index google_sheets_ticket_expiry on private.google_sheets_read_tickets(expires_at);

-- A stable surrogate lets a capability name one composite fact-link row.
alter table public.google_sheets_fact_links add column id uuid not null default gen_random_uuid() unique;
do $$ declare t text; begin
 foreach t in array array['ai_agent_runs','reports','business_health_snapshots','vsi_exchanges','vsi_conversations','intelligence_card_lifecycle','intelligence_card_lifecycle_events','business_notes','business_memory_chunks','file_processing_jobs','file_uploads','kpi_settings'] loop
  execute format('alter table public.%I add column google_sheets_read_ticket_id uuid',t);
 end loop;
end $$;

create function private.google_sheets_privacy_lock_v1(p_workspace_id uuid) returns void
language sql security definer set search_path='' as $$
 select pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
$$;
create function private.google_sheets_privacy_open_v1(p_workspace_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.google_sheets_privacy_lock_v1(p_workspace_id);
 if exists(select 1 from private.google_sheets_privacy_epochs where workspace_id=p_workspace_id and blocked) then
  raise exception 'google_sheets_privacy_paused' using errcode='55000';
 end if;
end $$;
create function private.google_sheets_ticket_actor_v1(p_workspace_id uuid,p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_actor_id is null or (auth.role()<>'service_role' and (auth.role()<>'authenticated' or auth.uid() is distinct from p_actor_id)) then
  raise exception 'google_sheets_read_denied' using errcode='42501'; end if;
 if not exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
  where m.workspace_id=p_workspace_id and m.user_id=p_actor_id and m.status='active' and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
  raise exception 'google_sheets_read_denied' using errcode='42501'; end if;
end $$;
create function public.begin_google_sheets_read_v1(p_workspace_id uuid,p_actor_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets; e bigint;
begin
 p_actor_id:=coalesce(p_actor_id,auth.uid());
 perform private.google_sheets_ticket_actor_v1(p_workspace_id,p_actor_id);
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 insert into private.google_sheets_privacy_epochs(workspace_id) values(p_workspace_id) on conflict do nothing;
 select epoch into e from private.google_sheets_privacy_epochs where workspace_id=p_workspace_id;
 insert into private.google_sheets_read_tickets(workspace_id,actor_id,epoch) values(p_workspace_id,p_actor_id,e) returning * into t;
 return jsonb_build_object('ticketId',t.id,'epoch',t.epoch,'expiresAt',t.expires_at);
end $$;

create function private.google_sheets_allowed_source_v1(p_table text) returns boolean language sql immutable set search_path='' as $$
 select p_table=any(array['kpis','kpi_settings','ai_agent_runs','reports','business_health_snapshots','business_memory_chunks','business_notes',
 'vsi_exchanges','vsi_conversations','intelligence_card_lifecycle','intelligence_card_lifecycle_events','file_uploads','file_imports','operational_metrics','business_decisions','issues','sops','assets',
 'crm_leads','crm_lead_history','forms','form_submissions','people','google_sheets_connections']);
$$;
create function private.google_sheets_checked_ticket_v1(p_ticket_id uuid,p_workspace_id uuid) returns private.google_sheets_read_tickets
language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets;
begin
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 select * into t from private.google_sheets_read_tickets where id=p_ticket_id and workspace_id=p_workspace_id;
 if t.id is null or t.expires_at<=clock_timestamp() or t.epoch<>(select epoch from private.google_sheets_privacy_epochs where workspace_id=p_workspace_id) then
  raise exception 'google_sheets_read_ticket_stale' using errcode='40001'; end if;
 perform private.google_sheets_ticket_actor_v1(p_workspace_id,t.actor_id);
 return t;
end $$;
create function public.bind_google_sheets_read_v1(p_ticket_id uuid,p_sources jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets; source_ref jsonb; row_data jsonb; combined jsonb; deadline timestamptz; connections jsonb;
begin
 select * into t from private.google_sheets_read_tickets where id=p_ticket_id;
 if t.id is null then raise exception 'google_sheets_read_ticket_stale' using errcode='40001'; end if;
 t:=private.google_sheets_checked_ticket_v1(t.id,t.workspace_id);
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)>20000 or octet_length(p_sources::text)>2000000 then
  raise exception 'google_sheets_read_sources_invalid'; end if;
 for source_ref in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(source_ref) is distinct from 'object' or (source_ref-'table'-'id')<>'{}' or not private.google_sheets_allowed_source_v1(source_ref->>'table') then
   raise exception 'google_sheets_read_sources_invalid'; end if;
  execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2',source_ref->>'table') into row_data using (source_ref->>'id')::uuid,t.workspace_id;
  if row_data is null then raise exception 'google_sheets_read_source_changed' using errcode='40001'; end if;
  if source_ref->>'table' in ('vsi_conversations','vsi_exchanges') and row_data->>'actor_user_id' is distinct from t.actor_id::text then raise exception 'google_sheets_read_denied' using errcode='42501'; end if;
 end loop;
 select coalesce(jsonb_agg(src order by src->>'table',src->>'id'),'[]') into combined from
  (select distinct value src from jsonb_array_elements(t.sources||p_sources)) q;
 if jsonb_array_length(combined)>20000 then raise exception 'google_sheets_read_sources_invalid'; end if;
 if exists(select 1 from jsonb_array_elements(combined) s join private.google_sheets_derivation_roots d
  on d.workspace_id=t.workspace_id and (d.table_name=s->>'table' or s->>'table'='file_uploads' and d.table_name='file_upload_analysis') and d.record_id=(s->>'id')::uuid
  join private.google_sheets_retention_roots r on r.id=d.root_id where r.erased_at is not null or r.expires_at<=clock_timestamp()) then
  raise exception 'google_sheets_source_expired' using errcode='55000'; end if;
 update private.google_sheets_read_tickets set sources=combined,bound=true where id=t.id;
 select min(r.expires_at) into deadline from jsonb_array_elements(combined) s join private.google_sheets_derivation_roots d
  on d.workspace_id=t.workspace_id and (d.table_name=s->>'table' or s->>'table'='file_uploads' and d.table_name='file_upload_analysis') and d.record_id=(s->>'id')::uuid join private.google_sheets_retention_roots r on r.id=d.root_id;
 select coalesce(jsonb_agg(distinct l.connection_id),'[]') into connections from jsonb_array_elements(combined) s
  join private.google_sheets_derivation_roots d on d.workspace_id=t.workspace_id and (d.table_name=s->>'table' or s->>'table'='file_uploads' and d.table_name='file_upload_analysis') and d.record_id=(s->>'id')::uuid
  join (select root_id,connection_id from private.google_sheets_source_root_links union select root_id,connection_id from private.google_sheets_connection_root_links) l on l.root_id=d.root_id;
 return jsonb_build_object('ticketId',t.id,'epoch',t.epoch,'expiresAt',t.expires_at,'connectionIds',connections,'expiresAtSource',deadline);
end $$;

-- A file analysis is a derived component of an otherwise unrelated upload.
-- Its fixed redaction projection preserves the original object and import data.
create function private.google_sheets_file_metadata_without_analysis_v1(p_metadata jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(coalesce(p_metadata,'{}'))
 where key not like 'latest\_analysis\_%' escape '\' and key not like 'analysis\_%' escape '\'
 and key not in ('business_memory_trust_level','evidence_classification','extraction_outcome','source_grounding',
 'invalidated_at','invalidation_reason','excluded_analysis_run_ids','business_memory');
$$;
create function private.google_sheets_derivative_write_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets; tid uuid; w uuid; n jsonb:=to_jsonb(new); old_data jsonb; sink_table text:=tg_table_name;
begin
 w:=(n->>'workspace_id')::uuid;
 if tg_table_name='file_uploads' then
  sink_table:='file_upload_analysis';
  if tg_op='UPDATE' and private.google_sheets_exact_delete_allowed_v1(w,sink_table,old.id,to_jsonb(old))
   and new.analysis_prompt is null and new.analysis_summary is null
   and new.metadata_json=private.google_sheets_file_metadata_without_analysis_v1(old.metadata_json)
   and (n-'analysis_prompt'-'analysis_summary'-'metadata_json'-'google_sheets_read_ticket_id'-'updated_at')=
    (to_jsonb(old)-'analysis_prompt'-'analysis_summary'-'metadata_json'-'google_sheets_read_ticket_id'-'updated_at') then return new; end if;
 end if;
 -- Fresh uploads and ordinary settings are user-supplied records. Their model
 -- generated fields use this same fence without blocking storage bookkeeping.
 if tg_table_name='file_uploads' and nullif(n->>'google_sheets_read_ticket_id','') is null
  and (tg_op='INSERT' and coalesce(n->>'analysis_summary','')='' or tg_op='UPDATE'
   and n->>'analysis_summary' is not distinct from to_jsonb(old)->>'analysis_summary'
   and not exists(select 1 from private.google_sheets_derivation_roots where workspace_id=w and table_name=sink_table and record_id=(n->>'id')::uuid)) then return new; end if;
 if tg_table_name='file_processing_jobs' and coalesce(n->>'job_type','') not in ('analyze','index')
  and nullif(n->>'google_sheets_read_ticket_id','') is null
  and nullif(current_setting('vaeroex.google_sheets_read_ticket_id',true),'') is null then return new; end if;
 if tg_table_name='file_uploads' and tg_op='UPDATE' and
  (n-'processing_status'-'processing_error'-'processed_at'-'index_status'-'index_error'-'indexed_at'-'indexed_chunk_count'-'import_status'-'imported_rows'-'updated_at')=
  (to_jsonb(old)-'processing_status'-'processing_error'-'processed_at'-'index_status'-'index_error'-'indexed_at'-'indexed_chunk_count'-'import_status'-'imported_rows'-'updated_at') then return new; end if;
 if tg_table_name='kpi_settings' and coalesce(n->>'classification_source','unknown')<>'luna'
  and nullif(n->>'google_sheets_read_ticket_id','') is null then return new; end if;
 if tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  -- Lifecycle-only changes do not produce new Google-derived content.
  if (n-'archived_at'-'deleted_at'-'updated_at'-'status'-'error_message'-'google_sheets_read_ticket_id')=
     (old_data-'archived_at'-'deleted_at'-'updated_at'-'status'-'error_message'-'google_sheets_read_ticket_id') then return new; end if;
 end if;
 if not exists(select 1 from private.google_sheets_source_root_links where workspace_id=w) and not exists(select 1 from private.google_sheets_connection_root_links where workspace_id=w) then return new; end if;
 tid:=coalesce(nullif(current_setting('vaeroex.google_sheets_read_ticket_id',true),'')::uuid,
  nullif(n#>>'{card_snapshot_json,google_sheets_read_ticket_id}','')::uuid,
  nullif(n#>>'{source_metadata,google_sheets_read_ticket_id}','')::uuid,
  nullif(n->>'google_sheets_read_ticket_id','')::uuid,
  nullif(n#>>'{input_json,google_sheets_read_ticket_id}','')::uuid);
 t:=private.google_sheets_checked_ticket_v1(tid,w);
 if not t.bound then raise exception 'google_sheets_read_ticket_unbound' using errcode='40001'; end if;
 if exists(select 1 from jsonb_array_elements(t.sources) s join private.google_sheets_derivation_roots d
  on d.workspace_id=w and (d.table_name=s->>'table' or s->>'table'='file_uploads' and d.table_name='file_upload_analysis') and d.record_id=(s->>'id')::uuid
  join private.google_sheets_retention_roots r on r.id=d.root_id where r.erased_at is not null or r.expires_at<=clock_timestamp()) then
  raise exception 'google_sheets_source_expired' using errcode='55000'; end if;
 new.google_sheets_read_ticket_id:=tid;
 -- Union, never replacement: editing/copying an artifact cannot wash its lineage.
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id)
 select distinct w,sink_table,(n->>'id')::uuid,d.root_id from jsonb_array_elements(t.sources) s
 join private.google_sheets_derivation_roots d on d.workspace_id=w and (d.table_name=s->>'table' or s->>'table'='file_uploads' and d.table_name='file_upload_analysis') and d.record_id=(s->>'id')::uuid
 on conflict do nothing;
 return new;
end $$;
create function public.get_google_sheets_read_context_v1(p_ticket_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets; result jsonb; s jsonb; row_data jsonb; unattributed boolean:=false;
begin
 select * into t from private.google_sheets_read_tickets where id=p_ticket_id;
 if t.id is null then raise exception 'google_sheets_read_ticket_stale' using errcode='40001'; end if;
 t:=private.google_sheets_checked_ticket_v1(t.id,t.workspace_id);
 if not t.bound then raise exception 'google_sheets_read_ticket_unbound' using errcode='40001'; end if;
 result:=public.bind_google_sheets_read_v1(t.id,'[]');
 for s in select value from jsonb_array_elements(t.sources) where (exists(select 1 from private.google_sheets_source_root_links where workspace_id=t.workspace_id) or exists(select 1 from private.google_sheets_connection_root_links where workspace_id=t.workspace_id))
 and value->>'table'=any(array[
  'ai_agent_runs','reports','business_health_snapshots','vsi_exchanges','vsi_conversations','intelligence_card_lifecycle','intelligence_card_lifecycle_events','business_notes','business_memory_chunks','file_processing_jobs','file_uploads','kpi_settings']) loop
  execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2',s->>'table') into row_data using (s->>'id')::uuid,t.workspace_id;
  if row_data is null then raise exception 'google_sheets_read_source_changed' using errcode='40001'; end if;
  if s->>'table'='file_uploads' and coalesce(row_data->>'analysis_summary','')='' and coalesce(row_data->>'analysis_prompt','')=''
   and coalesce(row_data->'metadata_json','{}')=private.google_sheets_file_metadata_without_analysis_v1(row_data->'metadata_json') then continue; end if;
  if s->>'table'='kpi_settings' and coalesce(row_data->>'classification_source','unknown')<>'luna' then continue; end if;
  if nullif(row_data->>'google_sheets_read_ticket_id','') is null and not exists(select 1 from private.google_sheets_derivation_roots
   where workspace_id=t.workspace_id and (table_name=s->>'table' or s->>'table'='file_uploads' and table_name='file_upload_analysis') and record_id=(s->>'id')::uuid) then unattributed:=true; end if;
 end loop;
 return result||jsonb_build_object('workspaceId',t.workspace_id,'containsGoogleSheets',jsonb_array_length(result->'connectionIds')>0,
  'hasUnattributedDerivedSources',unattributed);
end $$;
do $$ declare t text; begin
 foreach t in array array['ai_agent_runs','reports','business_health_snapshots','vsi_exchanges','vsi_conversations','intelligence_card_lifecycle','intelligence_card_lifecycle_events','business_notes','business_memory_chunks','file_processing_jobs','file_uploads','kpi_settings'] loop
  execute format('create trigger zz_google_sheets_derivative_fence before insert or update on public.%I for each row execute function private.google_sheets_derivative_write_v1()',t);
 end loop;
end $$;

-- Keep the existing publication RPC SECURITY INVOKER and its unchanged RLS
-- checks. This narrow validator carries one original ticket through the same
-- transaction, including the canonical file completion and processing-job write.
create function public.authorize_google_sheets_publication_v1(p_workspace_id uuid,p_chunks jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare tid uuid; t private.google_sheets_read_tickets;
begin
 if auth.role() is distinct from 'authenticated' then raise exception 'google_sheets_read_denied' using errcode='42501'; end if;
 if not exists(select 1 from private.google_sheets_source_root_links where workspace_id=p_workspace_id) and not exists(select 1 from private.google_sheets_connection_root_links where workspace_id=p_workspace_id) then return; end if;
 if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) not between 1 and 80
  or exists(select 1 from jsonb_array_elements(p_chunks) x where coalesce(x#>>'{source_metadata,google_sheets_read_ticket_id}','') !~ '^[a-f0-9-]{36}$')
  or (select count(distinct x#>>'{source_metadata,google_sheets_read_ticket_id}') from jsonb_array_elements(p_chunks) x)<>1 then
  raise exception 'google_sheets_read_ticket_unbound' using errcode='40001'; end if;
 tid:=(p_chunks#>>'{0,source_metadata,google_sheets_read_ticket_id}')::uuid;
 t:=private.google_sheets_checked_ticket_v1(tid,p_workspace_id);
 if not t.bound then raise exception 'google_sheets_read_ticket_unbound' using errcode='40001'; end if;
 perform public.bind_google_sheets_read_v1(tid,'[]');
 perform set_config('vaeroex.google_sheets_read_ticket_id',tid::text,true);
end $$;
revoke all on function public.authorize_google_sheets_publication_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.authorize_google_sheets_publication_v1(uuid,jsonb) to authenticated;
do $$ declare definition text; needle text:=E'begin\n  if auth.uid()'; begin
 definition:=pg_get_functiondef('public.publish_confirmed_file_memory_v1(uuid,uuid,uuid,uuid,jsonb,text,text)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'google_sheets_publication_baseline_changed'; end if;
 execute replace(definition,needle,E'begin\n  perform public.authorize_google_sheets_publication_v1(p_workspace_id,p_chunks);\n  if auth.uid()');
end $$;

-- Existing VSI authorization and quota logic stays canonical. One transaction
-- setting carries the read ticket through its nested note/conversation writes.
alter function public.vsi_mutate_v1(uuid,uuid,text,jsonb) rename to vsi_mutate_before_sheets_privacy_v1;
alter function public.vsi_mutate_before_sheets_privacy_v1(uuid,uuid,text,jsonb) set schema private;
revoke all on function private.vsi_mutate_before_sheets_privacy_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.vsi_mutate_v1(p_workspace_id uuid,p_actor_user_id uuid,p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'vsi_server_only' using errcode='42501'; end if;
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 if nullif(p_input->>'conversationId','') is not null and not public.google_sheets_record_readable_v1(p_workspace_id,'vsi_conversations',(p_input->>'conversationId')::uuid) then raise exception 'google_sheets_source_expired' using errcode='55000'; end if;
 perform set_config('vaeroex.google_sheets_read_ticket_id',coalesce(p_input->>'readTicketId',''),true);
 return private.vsi_mutate_before_sheets_privacy_v1(p_workspace_id,p_actor_user_id,p_action,p_input-'readTicketId');
end $$;
revoke all on function public.vsi_mutate_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.vsi_mutate_v1(uuid,uuid,text,jsonb) to service_role;

alter function public.google_sheets_lifecycle_v1(text,uuid,uuid,uuid,uuid,jsonb) rename to google_sheets_lifecycle_before_privacy_v1;
alter function public.google_sheets_lifecycle_before_privacy_v1(text,uuid,uuid,uuid,uuid,jsonb) set schema private;
revoke all on function private.google_sheets_lifecycle_before_privacy_v1(text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.google_sheets_lifecycle_v1(p_operation text,p_workspace_id uuid,p_connection_id uuid,p_actor_id uuid,p_session_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
 if p_operation not in ('disconnect','complete_disconnect','fail_refresh','decline') then perform private.google_sheets_privacy_open_v1(p_workspace_id); end if;
 return private.google_sheets_lifecycle_before_privacy_v1(p_operation,p_workspace_id,p_connection_id,p_actor_id,p_session_id,p_payload);
end $$;
revoke all on function public.google_sheets_lifecycle_v1(text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.google_sheets_lifecycle_v1(text,uuid,uuid,uuid,uuid,jsonb) to service_role;

alter function public.approve_google_sheets_mapping_v1(uuid,uuid,uuid,uuid,jsonb,boolean) rename to approve_google_sheets_mapping_before_retention_v1;
alter function public.approve_google_sheets_mapping_before_retention_v1(uuid,uuid,uuid,uuid,jsonb,boolean) set schema private;
revoke all on function private.approve_google_sheets_mapping_before_retention_v1(uuid,uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
create function public.approve_google_sheets_mapping_v1(p_workspace_id uuid,p_connection_id uuid,p_actor_id uuid,p_session_id uuid,p_mapping jsonb,p_automatic_enabled boolean,p_retention_consent boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
 if auth.role() is distinct from 'service_role' or p_retention_consent is distinct from true then raise exception 'google_sheets_retention_consent_required' using errcode='42501'; end if;
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 a:=private.approve_google_sheets_mapping_before_retention_v1(p_workspace_id,p_connection_id,p_actor_id,p_session_id,p_mapping,p_automatic_enabled);
 insert into private.google_sheets_retention_consents(approval_id,workspace_id,connection_id,policy_version,consented_by)
 values(a,p_workspace_id,p_connection_id,'google_sheets_retention_v1_13_calendar_months_disconnect_30_days',p_actor_id) on conflict do nothing;
 return a;
end $$;
revoke all on function public.approve_google_sheets_mapping_v1(uuid,uuid,uuid,uuid,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.approve_google_sheets_mapping_v1(uuid,uuid,uuid,uuid,jsonb,boolean,boolean) to service_role;

-- A previous mapping approval does not stand in for the customer's retention
-- consent. Existing connections must deliberately approve the disclosed policy.
alter function public.claim_google_sheets_sync_v1(uuid,uuid,uuid,uuid,text) rename to claim_google_sheets_sync_before_privacy_v1;
alter function public.claim_google_sheets_sync_before_privacy_v1(uuid,uuid,uuid,uuid,text) set schema private;
revoke all on function private.claim_google_sheets_sync_before_privacy_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.claim_google_sheets_sync_v1(p_workspace_id uuid,p_connection_id uuid,p_actor_id uuid,p_session_id uuid,p_trigger text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 if not exists(select 1 from public.google_sheets_connections c join private.google_sheets_retention_consents rc on rc.approval_id=c.active_approval_id
  where c.workspace_id=p_workspace_id and c.id=p_connection_id and rc.workspace_id=c.workspace_id and rc.connection_id=c.id) then
  raise exception 'google_sheets_retention_consent_required' using errcode='42501'; end if;
 return private.claim_google_sheets_sync_before_privacy_v1(p_workspace_id,p_connection_id,p_actor_id,p_session_id,p_trigger);
end $$;
revoke all on function public.claim_google_sheets_sync_v1(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_google_sheets_sync_v1(uuid,uuid,uuid,uuid,text) to service_role;

create function private.google_sheets_register_connection_metadata_v1(p_workspace_id uuid,p_connection_id uuid,p_legacy boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.google_sheets_connections; root_id uuid; identity text;
begin
 select * into strict c from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id;
 identity:=private.google_sheets_erasure_hash_v1(jsonb_build_array(p_workspace_id,'connection_metadata',p_connection_id));
 insert into private.google_sheets_retention_roots(workspace_id,identity_hash,first_imported_at,expires_at,automatic_expiry_authorized,kind)
 values(p_workspace_id,identity,c.created_at,least(c.created_at+interval '13 months',coalesce(c.disconnected_at+interval '30 days','infinity'::timestamptz)),not p_legacy,'connection_metadata')
 on conflict(workspace_id,identity_hash) do nothing;
 select id into root_id from private.google_sheets_retention_roots where workspace_id=p_workspace_id and identity_hash=identity;
 insert into private.google_sheets_connection_root_links(workspace_id,connection_id,root_id) values(p_workspace_id,p_connection_id,root_id) on conflict do nothing;
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id) values(p_workspace_id,'google_sheets_connections',p_connection_id,root_id) on conflict do nothing;
 return root_id;
end $$;
create function private.google_sheets_connection_metadata_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.google_sheets_register_connection_metadata_v1(new.workspace_id,new.id,false);
 return new;
end $$;
create trigger google_sheets_connection_metadata after insert on public.google_sheets_connections for each row execute function private.google_sheets_connection_metadata_v1();

create function private.google_sheets_register_retention_v1(p_workspace_id uuid,p_connection_id uuid,p_source_row_id uuid,p_projection jsonb,p_first_at timestamptz,p_legacy boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.google_sheets_connections; fingerprint text; root private.google_sheets_retention_roots; consent boolean;
begin
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 select * into strict c from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id;
 if nullif(p_projection->>'rowKey','') is null then raise exception 'google_sheets_retention_identity_missing'; end if;
 -- Deliberately excludes connection/entity/mapping/version: reconnecting and
 -- importing the same provider row again cannot create a new retention clock.
 fingerprint:=private.google_sheets_erasure_hash_v1(jsonb_build_array(p_workspace_id,c.spreadsheet_id,c.sheet_id,p_projection->>'rowKey'));
 consent:=not p_legacy and exists(select 1 from private.google_sheets_retention_consents where approval_id=c.active_approval_id);
 if not p_legacy and not consent then raise exception 'google_sheets_retention_consent_required' using errcode='42501'; end if;
 insert into private.google_sheets_retention_roots(workspace_id,identity_hash,first_imported_at,expires_at,automatic_expiry_authorized)
 values(p_workspace_id,fingerprint,p_first_at,least(p_first_at+interval '13 months',coalesce(c.disconnected_at+interval '30 days','infinity'::timestamptz)),consent)
 on conflict(workspace_id,identity_hash) do update set first_imported_at=least(private.google_sheets_retention_roots.first_imported_at,excluded.first_imported_at),
  expires_at=least(private.google_sheets_retention_roots.expires_at,excluded.expires_at);
 select * into strict root from private.google_sheets_retention_roots where workspace_id=p_workspace_id and identity_hash=fingerprint;
 if not p_legacy and (root.erased_at is not null or root.expires_at<=clock_timestamp()) then raise exception 'google_sheets_source_expired' using errcode='55000'; end if;
 insert into private.google_sheets_source_root_links(workspace_id,connection_id,source_row_id,root_id)
 values(p_workspace_id,p_connection_id,p_source_row_id,root.id) on conflict do nothing;
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id)
 values(p_workspace_id,'google_sheets_connections',p_connection_id,root.id) on conflict do nothing;
 return root.id;
end $$;
create function private.google_sheets_version_retention_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 r:=private.google_sheets_register_retention_v1(new.workspace_id,new.connection_id,new.source_row_id,new.normalized_projection,new.created_at,false);
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id)
 values(new.workspace_id,'google_sheets_source_versions',new.id,r) on conflict do nothing;
 return new;
end $$;
create trigger google_sheets_version_retention before insert on public.google_sheets_source_versions
 for each row execute function private.google_sheets_version_retention_v1();
create function private.google_sheets_kpi_retention_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_retention_roots;
begin
 if not(new.raw_data_json ? 'googleSheets') then return new; end if;
 perform private.google_sheets_privacy_open_v1(new.workspace_id);
 select root.* into r from private.google_sheets_retention_roots root join private.google_sheets_source_root_links l on l.root_id=root.id
 where l.workspace_id=new.workspace_id and l.source_row_id=(new.raw_data_json#>>'{googleSheets,sourceRowId}')::uuid;
 if r.id is null or r.erased_at is not null or r.expires_at<=clock_timestamp() then
  -- Archiving is retirement, not re-admission of expired source values.
  if tg_op='UPDATE' and new.archived_at is not null and new.raw_data_json=old.raw_data_json then return new; end if;
  raise exception 'google_sheets_source_expired' using errcode='55000'; end if;
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id) values(new.workspace_id,'kpis',new.id,r.id) on conflict do nothing;
 return new;
end $$;
create trigger zz_google_sheets_kpi_retention before insert or update on public.kpis for each row execute function private.google_sheets_kpi_retention_v1();
create function private.google_sheets_disconnect_retention_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='disconnected' and (old.status is distinct from new.status or old.disconnected_at is distinct from new.disconnected_at) then
  update private.google_sheets_retention_roots r set expires_at=least(r.expires_at,new.disconnected_at+interval '30 days')
  where exists(select 1 from private.google_sheets_source_root_links l where l.connection_id=new.id and l.workspace_id=new.workspace_id and l.root_id=r.id)
   or exists(select 1 from private.google_sheets_connection_root_links l where l.connection_id=new.id and l.workspace_id=new.workspace_id and l.root_id=r.id);
 end if;
 return new;
end $$;
create trigger google_sheets_disconnect_retention after update on public.google_sheets_connections for each row execute function private.google_sheets_disconnect_retention_v1();

-- Backfill only relationally attributable sources. Never infer narrative lineage
-- from a workspace, date range, title or table name.
do $$ declare s record; root_id uuid; begin
 for s in select workspace_id,id from public.google_sheets_connections loop perform private.google_sheets_register_connection_metadata_v1(s.workspace_id,s.id,true); end loop;
 for s in select distinct on(v.source_row_id) v.* from public.google_sheets_source_versions v order by v.source_row_id,v.created_at,v.id loop
  root_id:=private.google_sheets_register_retention_v1(s.workspace_id,s.connection_id,s.source_row_id,s.normalized_projection,s.created_at,true);
 end loop;
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id)
 select v.workspace_id,'google_sheets_source_versions',v.id,l.root_id from public.google_sheets_source_versions v
 join private.google_sheets_source_root_links l on l.source_row_id=v.source_row_id on conflict do nothing;
 insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id)
 select f.workspace_id,'kpis',f.kpi_id,l.root_id from public.google_sheets_fact_links f
 join private.google_sheets_source_root_links l on l.source_row_id=f.source_row_id on conflict do nothing;
 insert into private.google_sheets_privacy_epochs(workspace_id)
 select distinct workspace_id from public.google_sheets_connections on conflict do nothing;
end $$;

revoke all on function public.begin_google_sheets_read_v1(uuid,uuid),public.bind_google_sheets_read_v1(uuid,jsonb),public.get_google_sheets_read_context_v1(uuid) from public,anon;
grant execute on function public.begin_google_sheets_read_v1(uuid,uuid),public.bind_google_sheets_read_v1(uuid,jsonb),public.get_google_sheets_read_context_v1(uuid) to authenticated,service_role;

-- Exact expiration affects ordinary direct readers at the database boundary,
-- independently of provider calls and physical-purge worker cadence. Existing
-- membership/actor SELECT policies remain required because this is RESTRICTIVE.
create function public.google_sheets_record_readable_v1(p_workspace_id uuid,p_table text,p_record_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from private.google_sheets_privacy_epochs where workspace_id=p_workspace_id and blocked)
 and not exists(select 1 from private.google_sheets_derivation_roots d join private.google_sheets_retention_roots r on r.id=d.root_id
  where p_table<>'google_sheets_connections' and d.workspace_id=p_workspace_id and (d.table_name=p_table or p_table='file_uploads' and d.table_name='file_upload_analysis') and d.record_id=p_record_id and (r.erased_at is not null or r.expires_at<=statement_timestamp()))
 and not exists(select 1 from private.google_sheets_source_root_links l join private.google_sheets_retention_roots r on r.id=l.root_id
  where p_table='google_sheets_source_rows' and l.workspace_id=p_workspace_id and l.source_row_id=p_record_id
   and (r.erased_at is not null or r.expires_at<=statement_timestamp()))
 and not exists(select 1 from public.google_sheets_connections c where c.workspace_id=p_workspace_id and c.status='disconnected'
  and c.disconnected_at+interval '30 days'<=statement_timestamp() and (
   p_table='google_sheets_connections' and c.id=p_record_id
   or p_table='google_sheets_sync_runs' and exists(select 1 from public.google_sheets_sync_runs r where r.id=p_record_id and r.workspace_id=p_workspace_id and r.connection_id=c.id)
   or p_table='google_sheets_mapping_approvals' and exists(select 1 from public.google_sheets_mapping_approvals a where a.id=p_record_id and a.workspace_id=p_workspace_id and a.connection_id=c.id)));

$$;
revoke all on function public.google_sheets_record_readable_v1(uuid,text,uuid) from public,anon;
grant execute on function public.google_sheets_record_readable_v1(uuid,text,uuid) to authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['kpis','ai_agent_runs','reports','business_health_snapshots','vsi_exchanges','vsi_conversations','business_notes',
 'business_memory_chunks','file_processing_jobs','intelligence_card_lifecycle','intelligence_card_lifecycle_events','file_uploads','kpi_settings','google_sheets_source_rows','google_sheets_source_versions','google_sheets_connections','google_sheets_sync_runs','google_sheets_mapping_approvals'] loop
  execute format('create policy google_sheets_expiry_read_boundary on public.%I as restrictive for select to authenticated using (public.google_sheets_record_readable_v1(workspace_id,%L,id))',t,t);
 end loop;
end $$;

-- Exact erasure capability and worker contracts follow in this same transaction.
alter table private.google_sheets_erasure_requests add column purpose text not null default 'support' check(purpose in ('support','retention'));
alter table private.google_sheets_erasure_requests add column journal_digest text;
alter table private.google_sheets_erasure_requests add column withdrawn_at timestamptz;
alter table private.google_sheets_erasure_requests add column withdrawal_reason text check(withdrawal_reason in ('scope_changed','approval_expired','owner_withdrawn'));
alter table private.google_sheets_erasure_requests add column withdrawal_inventory_digest text;
alter table private.google_sheets_erasure_requests add column withdrawal_receipt_digest text;
alter table private.google_sheets_erasure_requests add column withdrawal_finished_inventory_digest text;
alter table private.google_sheets_erasure_requests add column legacy_review_complete boolean not null default false;
alter table private.google_sheets_erasure_requests drop constraint google_sheets_erasure_requests_workspace_id_connection_id_key;
create unique index google_sheets_one_active_erasure on private.google_sheets_erasure_requests(workspace_id) where state in ('prepared','approved');

create function private.google_sheets_erasure_table_v1(p_table text) returns boolean language sql immutable set search_path='' as $$
 select p_table=any(array['google_sheets_retention_boundary','google_sheets_connections','google_sheets_oauth_states','google_sheets_mapping_approvals','google_sheets_sync_runs',
 'google_sheets_source_rows','google_sheets_source_versions','google_sheets_fact_links','kpis','kpi_settings','ai_agent_runs','reports',
 'business_health_snapshots','vsi_exchanges','vsi_conversations','vsi_request_content','intelligence_card_lifecycle','intelligence_card_lifecycle_events','business_notes','business_memory_chunks','file_processing_jobs','file_uploads','file_upload_analysis','file_imports',
 'operational_metrics','business_decisions']);
$$;
create function private.google_sheets_exact_row_v1(p_workspace_id uuid,p_table text,p_id uuid,p_lock boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; relation_name text:=case when p_table='file_upload_analysis' then 'file_uploads' when p_table='vsi_request_content' then 'vsi_requests' else p_table end;
begin
 if not private.google_sheets_erasure_table_v1(p_table) then raise exception 'sheets_erasure_table_denied' using errcode='42501'; end if;
 if p_table='google_sheets_retention_boundary' then
  if p_lock then select to_jsonb(r) into row_data from private.google_sheets_retention_roots r where r.id=p_id and r.workspace_id=p_workspace_id and r.erased_at is null for update;
  else select to_jsonb(r) into row_data from private.google_sheets_retention_roots r where r.id=p_id and r.workspace_id=p_workspace_id and r.erased_at is null; end if;
  return row_data;
 end if;
 execute format('select to_jsonb(x) from public.%I x where id=$1 and workspace_id=$2%s',relation_name,case when p_lock then ' for update' else '' end)
 into row_data using p_id,p_workspace_id;
 if p_table='file_upload_analysis' and row_data is not null
  and row_data->>'analysis_prompt' is null and row_data->>'analysis_summary' is null
  and coalesce(row_data->'metadata_json','{}')=private.google_sheets_file_metadata_without_analysis_v1(row_data->'metadata_json') then return null; end if;
 if p_table='vsi_request_content' and row_data->>'question_hash'='' and row_data->>'conversation_id' is null then return null; end if;
 return row_data;
end $$;
create function private.google_sheets_target_v1(p_workspace_id uuid,p_table text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row_data jsonb;
begin
 row_data:=private.google_sheets_exact_row_v1(p_workspace_id,p_table,p_id,true);
 if row_data is null then raise exception 'sheets_erasure_target_unavailable' using errcode='40001'; end if;
 return jsonb_build_object('table',p_table,'id',p_id,'hash',private.google_sheets_erasure_hash_v1(row_data));
end $$;
create function private.google_sheets_connection_targets_v1(p_workspace_id uuid,p_connection_id uuid,p_root_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare targets jsonb:='[]'; item record; t text; selected_roots uuid[];
begin
 select array_agg(distinct root_id) into selected_roots from (select workspace_id,connection_id,root_id from private.google_sheets_source_root_links union select workspace_id,connection_id,root_id from private.google_sheets_connection_root_links) links where workspace_id=p_workspace_id and connection_id=p_connection_id and (p_root_ids is null or root_id=any(p_root_ids));
 -- Enumerate foreign-key descendants of this source, never narrative tables by
 -- tenant alone. Every eventual mutation is separately authorized by row hash.
 for item in select distinct d.table_name,d.record_id from private.google_sheets_derivation_roots d
  join (select workspace_id,connection_id,root_id from private.google_sheets_source_root_links union select workspace_id,connection_id,root_id from private.google_sheets_connection_root_links) l on l.root_id=d.root_id
  where l.workspace_id=p_workspace_id and l.connection_id=p_connection_id and d.workspace_id=p_workspace_id
   and (p_root_ids is null or l.root_id=any(p_root_ids)) and d.table_name<>'google_sheets_connections'
 loop
  if private.google_sheets_exact_row_v1(p_workspace_id,item.table_name,item.record_id) is not null then
   targets:=targets||jsonb_build_array(private.google_sheets_target_v1(p_workspace_id,item.table_name,item.record_id));
  end if;
 end loop;
 foreach t in array array['google_sheets_fact_links','google_sheets_source_versions','google_sheets_source_rows'] loop
  for item in execute format('select x.id from public.%I x where x.workspace_id=$1 and (exists(select 1 from private.google_sheets_source_root_links l where l.source_row_id=%s and l.root_id=any($3)) or $4 and x.connection_id=$2)',t,
    case when t='google_sheets_source_rows' then 'x.id' else 'x.source_row_id' end) using p_workspace_id,p_connection_id,selected_roots,p_root_ids is null
  loop targets:=targets||jsonb_build_array(private.google_sheets_target_v1(p_workspace_id,t,item.id)); end loop;
 end loop;
 for item in select id from private.google_sheets_retention_roots where workspace_id=p_workspace_id and id=any(selected_roots) and erased_at is null loop
  targets:=targets||jsonb_build_array(private.google_sheets_target_v1(p_workspace_id,'google_sheets_retention_boundary',item.id));
 end loop;
 if p_root_ids is null then
  foreach t in array array['google_sheets_oauth_states','google_sheets_sync_runs','google_sheets_mapping_approvals'] loop
   for item in execute format('select id from public.%I where workspace_id=$1 and connection_id=$2',t) using p_workspace_id,p_connection_id loop
    targets:=targets||jsonb_build_array(private.google_sheets_target_v1(p_workspace_id,t,item.id));
   end loop;
  end loop;
  targets:=targets||jsonb_build_array(private.google_sheets_target_v1(p_workspace_id,'google_sheets_connections',p_connection_id));
 end if;
 -- Preserve VSI spend/quota accounting while removing the exact transcript
 -- linkage and question digest associated with identified chat artifacts.
 for item in select distinct r.id from public.vsi_requests r join jsonb_array_elements(targets) ct
  on (ct->>'table'='vsi_exchanges' and r.id=(ct->>'id')::uuid or ct->>'table'='vsi_conversations' and r.conversation_id=(ct->>'id')::uuid)
  where r.workspace_id=p_workspace_id and (r.question_hash<>'' or r.conversation_id is not null)
 loop targets:=targets||jsonb_build_array(private.google_sheets_target_v1(p_workspace_id,'vsi_request_content',item.id)); end loop;
 select coalesce(jsonb_agg(value order by value->>'table',value->>'id'),'[]') into targets from(select distinct value from jsonb_array_elements(targets)) q;
 if jsonb_array_length(targets)>50000 then raise exception 'sheets_erasure_inventory_limit'; end if;
 return targets;
end $$;

-- Only the existing owner-authorized product purge writes these protected
-- completion flags, after Storage remove succeeds. The signed external journal
-- carries this exact object identity across database restores.
create function private.google_sheets_storage_receipts_v1(p_workspace_id uuid,p_targets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target jsonb; row_data jsonb; receipts jsonb:='[]'; remaining integer;
begin
 for target in select value from jsonb_array_elements(p_targets) where value->>'table'='file_uploads' order by value->>'id' loop
  row_data:=private.google_sheets_exact_row_v1(p_workspace_id,'file_uploads',(target->>'id')::uuid,true);
  if row_data is null or private.google_sheets_erasure_hash_v1(row_data)<>target->>'hash' then raise exception 'sheets_erasure_scope_changed'; end if;
  if row_data->>'storage_bucket' is distinct from 'workspace-files' or row_data->>'storage_path' not like p_workspace_id::text||'/%'
   or row_data->>'storage_purged_at' is null or row_data->>'storage_missing_at' is null
   or row_data->>'storage_purge_requested_at' is null or row_data->>'storage_purge_attempted_at' is null
   or to_regclass('storage.objects') is null then raise exception 'sheets_erasure_storage_product_purge_required'; end if;
  execute 'select count(*) from storage.objects where bucket_id=$1 and name=$2' into remaining using 'workspace-files',row_data->>'storage_path';
  if remaining<>0 then raise exception 'sheets_erasure_storage_pending'; end if;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('fileId',target->>'id','bucket','workspace-files','path',row_data->>'storage_path',
   'purgedAt',to_char((row_data->>'storage_purged_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'rowHash',target->>'hash'));
 end loop;
 return receipts;
end $$;

create function private.prepare_google_sheets_erasure_v1(p_request_id uuid,p_workspace_id uuid,p_connection_id uuid,p_case_id uuid,p_artifacts jsonb,p_review_complete boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.google_sheets_connections; base jsonb; all_targets jsonb; decisions jsonb:='[]'; a jsonb; target jsonb; inventory jsonb; scope text;
begin
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 if exists(select 1 from private.google_sheets_erasure_requests where id=p_request_id) then
  raise exception 'sheets_erasure_request_exists'; end if;
 select * into c from public.google_sheets_connections where id=p_connection_id and workspace_id=p_workspace_id for update;
 if c.id is null or c.status<>'disconnected' or c.revocation_pending or c.authorization_uncertain
  or exists(select 1 from public.google_sheets_credentials where connection_id=c.id)
  or c.sync_lease_run_id is not null or c.oauth_lease_expires_at>clock_timestamp() or c.refresh_lease_expires_at>clock_timestamp() then
  raise exception 'sheets_erasure_disconnect_required' using errcode='55000'; end if;
 if jsonb_typeof(p_artifacts) is distinct from 'array' or jsonb_array_length(p_artifacts)>5000 then raise exception 'sheets_erasure_artifacts_invalid'; end if;
 -- The restricted operator supplies the exact reviewed candidate list; the
 -- authenticated owner subsequently approves that list and its old hashes.
 -- Unknown lineage cannot be silently treated as unrelated or auto-expired.
 if p_review_complete is distinct from true then raise exception 'sheets_erasure_legacy_review_required'; end if;
 all_targets:=private.google_sheets_connection_targets_v1(p_workspace_id,p_connection_id);
 select coalesce(jsonb_agg(value order by value->>'table',value->>'id'),'[]') into base from jsonb_array_elements(all_targets)
  where value->>'table' like 'google_sheets_%' or value->>'table'='kpis';
 select coalesce(jsonb_agg(value||jsonb_build_object('action','delete') order by value->>'table',value->>'id'),'[]') into decisions from jsonb_array_elements(all_targets)
  where value->>'table' not like 'google_sheets_%' and value->>'table'<>'kpis';
 for a in select value from jsonb_array_elements(p_artifacts) loop
  if jsonb_typeof(a)<>'object' or (a-'table'-'id'-'hash'-'action')<>'{}' or a->>'action' not in ('delete','keep_unrelated')
   or a->>'table' like 'google_sheets_%' then raise exception 'sheets_erasure_artifacts_invalid'; end if;
  target:=private.google_sheets_target_v1(p_workspace_id,a->>'table',(a->>'id')::uuid);
  if target->>'hash' is distinct from a->>'hash' then raise exception 'sheets_erasure_scope_changed' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements(all_targets) b where b->>'table'=a->>'table' and b->>'id'=a->>'id') then
   if a->>'action'='keep_unrelated' then raise exception 'sheets_erasure_known_derivative_cannot_keep'; end if;
  else decisions:=decisions||jsonb_build_array(target||jsonb_build_object('action',a->>'action')); end if;
 end loop;
 if (select count(distinct jsonb_build_array(value->>'table',value->>'id')) from jsonb_array_elements(p_artifacts))<>jsonb_array_length(p_artifacts) then
  raise exception 'sheets_erasure_artifacts_invalid'; end if;
 -- A full, separately reviewed upload delete supersedes its analysis-only
 -- redaction; applying both would invalidate the exact old-row hash mid-plan.
 select coalesce(jsonb_agg(d),'[]') into decisions from jsonb_array_elements(decisions) d
 where not(d->>'table'='file_upload_analysis' and exists(select 1 from jsonb_array_elements(decisions) f where f->>'table'='file_uploads' and f->>'id'=d->>'id' and f->>'action'='delete'));
 inventory:=jsonb_build_object('version',2,'workspaceId',p_workspace_id,'connectionId',p_connection_id,'base',base,'candidates',decisions,
  'storageReceipts',private.google_sheets_storage_receipts_v1(p_workspace_id,base||(select coalesce(jsonb_agg(value-'action'),'[]') from jsonb_array_elements(decisions) where value->>'action'='delete')));
 scope:=private.google_sheets_erasure_hash_v1(inventory);
 insert into private.google_sheets_erasure_requests(id,workspace_id,connection_id,case_id,inventory,decisions,scope_hash,legacy_review_complete)
 values(p_request_id,p_workspace_id,p_connection_id,p_case_id,inventory,decisions,scope,true);
 insert into private.google_sheets_privacy_epochs(workspace_id,epoch,blocked,request_id) values(p_workspace_id,2,true,p_request_id)
 on conflict(workspace_id) do update set epoch=private.google_sheets_privacy_epochs.epoch+1,blocked=true,request_id=p_request_id,updated_at=clock_timestamp();
 return jsonb_build_object('requestId',p_request_id,'scopeHash',scope,'state','prepared');
end $$;

create function private.get_google_sheets_erasure_execution_v1(p_request_id uuid,p_scope_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_erasure_requests; targets jsonb; counts jsonb;
begin
 select * into r from private.google_sheets_erasure_requests where id=p_request_id;
 if r.id is null or r.scope_hash is distinct from p_scope_hash then raise exception 'sheets_erasure_scope_changed'; end if;
 if r.state not in ('approved','completed') then raise exception 'sheets_erasure_owner_approval_required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(value order by value->>'table',value->>'id'),'[]') into targets from (
  select distinct value from jsonb_array_elements(r.inventory->'base')
  union select value-'action' from jsonb_array_elements(r.decisions) where value->>'action'='delete'
 ) all_targets;
 select coalesce(jsonb_object_agg(t,n),'{}') into counts from(select value->>'table' t,count(*) n from jsonb_array_elements(targets) group by 1) q;
 return jsonb_build_object('version',2,'requestId',r.id,'workspaceId',r.workspace_id,'connectionId',r.connection_id,'scopeHash',r.scope_hash,
  'targets',targets,'counts',counts,'completedAt',case when r.completed_at is null then null else to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
  ||case when jsonb_array_length(coalesce(r.inventory->'storageReceipts','[]'))>0 then jsonb_build_object('storageReceipts',r.inventory->'storageReceipts') else '{}'::jsonb end;
end $$;

-- Defer only source-internal NO ACTION foreign keys. The exact capability guard
-- also covers cascades: an unlisted child always aborts the transaction.
do $$ declare c record; begin
 for c in select conrelid::regclass relation,conname from pg_constraint where contype='f'
  and conrelid in ('public.google_sheets_connections'::regclass,'public.google_sheets_source_rows'::regclass,'public.google_sheets_source_versions'::regclass,
   'public.google_sheets_fact_links'::regclass,'public.google_sheets_sync_runs'::regclass,'public.google_sheets_mapping_approvals'::regclass)
  and confrelid in ('public.google_sheets_connections'::regclass,'public.google_sheets_source_rows'::regclass,'public.google_sheets_source_versions'::regclass,
   'public.google_sheets_sync_runs'::regclass,'public.google_sheets_mapping_approvals'::regclass,'public.kpis'::regclass)
 loop execute format('alter table %s alter constraint %I deferrable initially immediate',c.relation,c.conname); end loop;
end $$;
create function private.google_sheets_exact_delete_allowed_v1(p_workspace_id uuid,p_table text,p_id uuid,p_old jsonb) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from private.google_sheets_erasure_capabilities
  where transaction_id=txid_current() and backend_id=pg_backend_pid() and workspace_id=p_workspace_id
   and table_name=p_table and record_id=p_id and old_hash=private.google_sheets_erasure_hash_v1(p_old));
$$;
create or replace function private.google_sheets_immutable_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' and private.google_sheets_exact_delete_allowed_v1(old.workspace_id,tg_table_name,old.id,to_jsonb(old)) then return old; end if;
 raise exception 'google_sheets_immutable_record' using errcode='42501';
end $$;
create function private.google_sheets_erasure_cascade_guard_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if nullif(current_setting('vaeroex.google_sheets_erasure_request',true),'') is not null
  and not private.google_sheets_exact_delete_allowed_v1(old.workspace_id,tg_table_name,old.id,to_jsonb(old))
  and not(tg_op='UPDATE' and tg_table_name='file_uploads' and private.google_sheets_exact_delete_allowed_v1(old.workspace_id,'file_upload_analysis',old.id,to_jsonb(old)))
  and not(tg_op='UPDATE' and tg_table_name='vsi_requests' and private.google_sheets_exact_delete_allowed_v1(old.workspace_id,'vsi_request_content',old.id,to_jsonb(old))
   and to_jsonb(new)->>'question_hash'='' and to_jsonb(new)->>'conversation_id' is null
   and (to_jsonb(new)-'question_hash'-'conversation_id')=(to_jsonb(old)-'question_hash'-'conversation_id')) then
  raise exception 'sheets_erasure_unlisted_cascade' using errcode='42501'; end if;
 if tg_op='UPDATE' then return new; end if;
 return old;
end $$;
do $$ declare t text; child record; begin
 foreach t in array array['google_sheets_connections','google_sheets_oauth_states','google_sheets_mapping_approvals','google_sheets_sync_runs',
 'google_sheets_source_rows','google_sheets_source_versions','google_sheets_fact_links','kpis','kpi_settings','ai_agent_runs','reports',
 'business_health_snapshots','vsi_exchanges','vsi_conversations','intelligence_card_lifecycle','intelligence_card_lifecycle_events','business_notes','business_memory_chunks','file_processing_jobs','file_uploads','file_imports',
 'operational_metrics','business_decisions'] loop
  execute format('create trigger aa_google_sheets_erasure_cascade_guard before delete or update on public.%I for each row execute function private.google_sheets_erasure_cascade_guard_v1()',t);
 end loop;
 -- Unlisted immediate FK dependants must fail closed on SET NULL/cascade.
 for child in select distinct c.conrelid::regclass relation from pg_constraint c
  join pg_class cls on cls.oid=c.conrelid join pg_namespace ns on ns.oid=cls.relnamespace
  where c.contype='f' and ns.nspname='public' and exists(select 1 from pg_trigger tg where tg.tgrelid=c.confrelid and tg.tgname='aa_google_sheets_erasure_cascade_guard')
   and not exists(select 1 from pg_trigger tg where tg.tgrelid=c.conrelid and tg.tgname='aa_google_sheets_erasure_cascade_guard')
   and exists(select 1 from pg_attribute a where a.attrelid=c.conrelid and a.attname='workspace_id' and not a.attisdropped)
   and exists(select 1 from pg_attribute a where a.attrelid=c.conrelid and a.attname='id' and not a.attisdropped)
 loop execute format('create trigger aa_google_sheets_erasure_cascade_guard before delete or update on %s for each row execute function private.google_sheets_erasure_cascade_guard_v1()',child.relation); end loop;
end $$;

create function private.google_sheets_apply_exact_manifest_v1(p_manifest jsonb,p_allow_absent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid:=(p_manifest->>'workspaceId')::uuid; v_request_id uuid:=(p_manifest->>'requestId')::uuid;
 target jsonb; row_data jsonb; removed integer; total integer:=0; counts jsonb; root_ids uuid[];
begin
 if p_manifest->>'version'<>'2' or jsonb_typeof(p_manifest->'targets') is distinct from 'array'
  or jsonb_array_length(p_manifest->'targets') not between 1 and 50000 or octet_length(p_manifest::text)>16000000 then
  raise exception 'sheets_erasure_manifest_invalid'; end if;
 if (select count(distinct jsonb_build_array(value->>'table',value->>'id')) from jsonb_array_elements(p_manifest->'targets'))<>jsonb_array_length(p_manifest->'targets') then
  raise exception 'sheets_erasure_manifest_invalid'; end if;
 perform private.google_sheets_privacy_lock_v1(w);
 for target in select value from jsonb_array_elements(p_manifest->'targets') order by value->>'table',value->>'id' loop
  if jsonb_typeof(target)<>'object' or (target-'table'-'id'-'hash')<>'{}' or target->>'hash' !~ '^[a-f0-9]{64}$' then raise exception 'sheets_erasure_manifest_invalid'; end if;
  row_data:=private.google_sheets_exact_row_v1(w,target->>'table',(target->>'id')::uuid,true);
  if row_data is null then
   if not p_allow_absent then raise exception 'sheets_erasure_scope_changed' using errcode='40001'; end if;
  elsif private.google_sheets_erasure_hash_v1(row_data) is distinct from target->>'hash' then raise exception 'sheets_erasure_scope_changed' using errcode='40001'; end if;
  if target->>'table'='file_uploads' and row_data is not null then
   if not coalesce(p_manifest->'storageReceipts','[]') @> private.google_sheets_storage_receipts_v1(w,jsonb_build_array(target)) then
    raise exception 'sheets_erasure_storage_receipt_required'; end if;
  end if;
  insert into private.google_sheets_erasure_capabilities(transaction_id,backend_id,request_id,workspace_id,table_name,record_id,old_hash)
   values(txid_current(),pg_backend_pid(),v_request_id,w,target->>'table',(target->>'id')::uuid,target->>'hash');
 end loop;
 select array_agg(distinct l.root_id) into root_ids from private.google_sheets_source_root_links l join jsonb_array_elements(p_manifest->'targets') s
  on s->>'table'='google_sheets_source_rows' and l.source_row_id=(s->>'id')::uuid where l.workspace_id=w;
 perform set_config('vaeroex.google_sheets_erasure_request',v_request_id::text,true);
 set constraints all deferred;
 for target in select value from jsonb_array_elements(p_manifest->'targets') order by
  case value->>'table' when 'intelligence_card_lifecycle_events' then -1 when 'google_sheets_fact_links' then 0 when 'vsi_exchanges' then 1 when 'business_memory_chunks' then 2
  when 'vsi_request_content' then 2 when 'reports' then 3 when 'ai_agent_runs' then 4 when 'kpis' then 5 when 'google_sheets_source_versions' then 6
  when 'google_sheets_source_rows' then 7 when 'google_sheets_sync_runs' then 8 when 'google_sheets_mapping_approvals' then 9
  when 'google_sheets_oauth_states' then 10 when 'google_sheets_connections' then 20 else 11 end,value->>'id'
 loop
  -- Both PK and old-content hash are authority. There is deliberately no
  -- workspace-wide or table-wide deletion branch.
  if target->>'table'='google_sheets_retention_boundary' then
   update private.google_sheets_retention_roots r set erased_at=clock_timestamp()
    where r.id=(target->>'id')::uuid and r.workspace_id=w and r.erased_at is null and private.google_sheets_erasure_hash_v1(to_jsonb(r))=target->>'hash';
   get diagnostics removed=row_count;
  elsif target->>'table'='vsi_request_content' then
   update public.vsi_requests x set question_hash='',conversation_id=null
    where x.id=(target->>'id')::uuid and x.workspace_id=w and private.google_sheets_erasure_hash_v1(to_jsonb(x))=target->>'hash';
   get diagnostics removed=row_count;
  elsif target->>'table'='file_upload_analysis' then
   update public.file_uploads x set analysis_prompt=null,analysis_summary=null,
    metadata_json=private.google_sheets_file_metadata_without_analysis_v1(x.metadata_json),google_sheets_read_ticket_id=null
    where x.id=(target->>'id')::uuid and x.workspace_id=w and private.google_sheets_erasure_hash_v1(to_jsonb(x))=target->>'hash';
   get diagnostics removed=row_count;
   delete from private.google_sheets_derivation_roots d where d.workspace_id=w and d.table_name='file_upload_analysis' and d.record_id=(target->>'id')::uuid;
  else
   execute format('delete from public.%I x where id=$1 and workspace_id=$2 and private.google_sheets_erasure_hash_v1(to_jsonb(x))=$3',target->>'table')
    using (target->>'id')::uuid,w,target->>'hash';
   get diagnostics removed=row_count;
  end if;
  total:=total+removed;
 end loop;
 set constraints all immediate;
 for target in select value from jsonb_array_elements(p_manifest->'targets') loop
  if private.google_sheets_exact_row_v1(w,target->>'table',(target->>'id')::uuid) is not null then raise exception 'sheets_erasure_residual_row'; end if;
 end loop;
 -- Minimal non-value tombstones deliberately survive erasure and restore replay
 -- until the affected restoration horizon is gone; they prevent clock resets.
 update private.google_sheets_retention_roots set erased_at=coalesce(erased_at,clock_timestamp()) where workspace_id=w and id=any(coalesce(root_ids,'{}'));
 delete from private.google_sheets_erasure_capabilities cap where cap.transaction_id=txid_current() and cap.backend_id=pg_backend_pid() and cap.request_id=v_request_id;
 perform set_config('vaeroex.google_sheets_erasure_request','',true);
 select coalesce(jsonb_object_agg(t,n),'{}') into counts from(select value->>'table' t,count(*) n from jsonb_array_elements(p_manifest->'targets') group by 1) q;
 if counts is distinct from p_manifest->'counts' then raise exception 'sheets_erasure_manifest_counts_invalid'; end if;
 return jsonb_build_object('remaining',0,'deleted',total,'scopeHash',p_manifest->>'scopeHash','counts',counts);
end $$;

create function private.execute_google_sheets_erasure_v1(p_request_id uuid,p_scope_hash text,p_journal_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_erasure_requests; manifest jsonb; result jsonb;
begin
 select * into r from private.google_sheets_erasure_requests where id=p_request_id;
 if r.id is null then raise exception 'sheets_erasure_request_unavailable'; end if;
 perform private.google_sheets_privacy_lock_v1(r.workspace_id);
 select * into r from private.google_sheets_erasure_requests where id=p_request_id for update;
 manifest:=private.get_google_sheets_erasure_execution_v1(p_request_id,p_scope_hash);
 if r.state='completed' then return jsonb_build_object('state','completed','completedAt',r.completed_at,'counts',manifest->'counts','scopeHash',r.scope_hash); end if;
 if p_journal_digest !~ '^[a-f0-9]{64}$' or p_journal_digest is null then raise exception 'sheets_erasure_journal_required'; end if;
 if not exists(select 1 from private.google_sheets_privacy_epochs where workspace_id=r.workspace_id and blocked and request_id=r.id) then
  raise exception 'sheets_erasure_barrier_required'; end if;
 if r.purpose='support' and (r.approved_by is null or r.approved_at is null or not r.legacy_review_complete) then raise exception 'sheets_erasure_owner_approval_required'; end if;
 result:=private.google_sheets_apply_exact_manifest_v1(manifest,false);
 update private.google_sheets_erasure_requests set state='completed',completed_at=clock_timestamp(),journal_digest=p_journal_digest,
  receipt=jsonb_build_object('counts',result->'counts','remaining',0) where id=r.id returning * into r;
 update private.google_sheets_privacy_epochs set blocked=false,request_id=null,updated_at=clock_timestamp() where workspace_id=r.workspace_id and request_id=r.id;
 return jsonb_build_object('state','completed','completedAt',r.completed_at,'counts',result->'counts','scopeHash',r.scope_hash);
end $$;

create function private.replay_google_sheets_erasure_v1(p_request_id uuid,p_scope_hash text,p_manifest jsonb,p_journal_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid; result jsonb;
begin
 if p_manifest->>'requestId' is distinct from p_request_id::text or p_manifest->>'scopeHash' is distinct from p_scope_hash
  or p_scope_hash !~ '^[a-f0-9]{64}$' or p_journal_digest !~ '^[a-f0-9]{64}$' or p_journal_digest is null then raise exception 'sheets_erasure_manifest_invalid'; end if;
 w:=(p_manifest->>'workspaceId')::uuid;
 perform private.google_sheets_privacy_lock_v1(w);
 insert into private.google_sheets_privacy_epochs(workspace_id,epoch,blocked,request_id) values(w,2,true,p_request_id)
 on conflict(workspace_id) do update set epoch=private.google_sheets_privacy_epochs.epoch+1,blocked=true,request_id=p_request_id,updated_at=clock_timestamp();
 result:=private.google_sheets_apply_exact_manifest_v1(p_manifest,true);
 -- Restore stays blocked. Only the operator's independently witnessed complete
 -- restore checkpoint authorizes application activation outside the restored DB.
 return result;
end $$;

-- The isolated restore principal may reopen only exact replayed barriers after
-- its operator has independently reconciled the full external witness inventory.
create function private.finish_google_sheets_restore_v1(p_manifests jsonb,p_inventory_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m jsonb; target jsonb; w uuid; r private.google_sheets_erasure_requests; wd jsonb;
begin
 if jsonb_typeof(p_manifests) is distinct from 'array' or jsonb_array_length(p_manifests) not between 1 and 5000
  or p_inventory_digest is null or p_inventory_digest !~ '^[a-f0-9]{64}$' then raise exception 'sheets_erasure_manifest_invalid'; end if;
 for m in select value from jsonb_array_elements(p_manifests) order by value->>'workspaceId',value->>'requestId' loop
  w:=(m->>'workspaceId')::uuid;
  if m->>'version'<>'2' or jsonb_typeof(m->'targets') is distinct from 'array' or jsonb_array_length(m->'targets') not between 1 and 50000 then raise exception 'sheets_erasure_manifest_invalid'; end if;
  perform private.google_sheets_privacy_lock_v1(w);
  wd:=m->'withdrawal';
  if wd is not null then
   if jsonb_typeof(wd)<>'object' or (wd-'at'-'reason'-'intentDigest'-'inventoryDigest')<>'{}'
    or coalesce(wd->>'reason','') not in ('scope_changed','approval_expired','owner_withdrawn')
    or coalesce(wd->>'intentDigest','') !~ '^[a-f0-9]{64}$' or coalesce(wd->>'inventoryDigest','') !~ '^[a-f0-9]{64}$'
    or coalesce(wd->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then raise exception 'sheets_erasure_recovery_invalid'; end if;
   select * into r from private.google_sheets_erasure_requests where id=(m->>'requestId')::uuid for update;
   if r.id is not null then
    if r.scope_hash is distinct from m->>'scopeHash' or r.workspace_id<>w or r.state='completed' or r.completed_at is not null or r.receipt is not null or r.journal_digest is not null then raise exception 'sheets_erasure_recovery_conflict'; end if;
    if r.state='withdrawn' and (r.withdrawal_reason is distinct from wd->>'reason' or r.withdrawn_at is not null and to_char(r.withdrawn_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>wd->>'at') then raise exception 'sheets_erasure_recovery_conflict'; end if;
    update private.google_sheets_erasure_requests set state='withdrawn',withdrawn_at=(wd->>'at')::timestamptz,withdrawal_reason=wd->>'reason',withdrawal_inventory_digest=wd->>'inventoryDigest',withdrawal_finished_inventory_digest=p_inventory_digest where id=r.id;
   end if;
   -- An old backup may predate preparation. A verified cancellation never
   -- creates content authority or deletes records from that backup.
  else
   for target in select value from jsonb_array_elements(m->'targets') loop
    if private.google_sheets_exact_row_v1(w,target->>'table',(target->>'id')::uuid,true) is not null then raise exception 'sheets_erasure_residual_row'; end if;
   end loop;
  end if;
 end loop;
 for m in select value from jsonb_array_elements(p_manifests) loop
  update private.google_sheets_privacy_epochs set blocked=false,request_id=null,epoch=epoch+1,updated_at=clock_timestamp()
   where workspace_id=(m->>'workspaceId')::uuid and request_id=(m->>'requestId')::uuid and blocked;
 end loop;
 return jsonb_build_object('remaining',0,'inventoryDigest',p_inventory_digest);
end $$;

create function private.due_google_sheets_retention_v1(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_limit not between 1 and 500 then raise exception 'sheets_erasure_inventory_limit'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from(select r.id as "rootId",r.workspace_id as "workspaceId",min(l.connection_id::text)::uuid as "connectionId",
  r.expires_at as "expiresAt",r.automatic_expiry_authorized as "automaticExpiryAuthorized"
  from private.google_sheets_retention_roots r join (select workspace_id,connection_id,root_id from private.google_sheets_source_root_links union select workspace_id,connection_id,root_id from private.google_sheets_connection_root_links) l on l.root_id=r.id
  where r.erased_at is null and r.expires_at<=clock_timestamp() group by r.id order by r.expires_at,r.id limit p_limit) q);
end $$;
create function private.prepare_google_sheets_retention_v1(p_request_id uuid,p_workspace_id uuid,p_connection_id uuid,p_case_id uuid,p_root_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare targets jsonb; inventory jsonb; scope text;
begin
 if cardinality(p_root_ids) not between 1 and 500 then raise exception 'sheets_erasure_inventory_limit'; end if;
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 if (select count(*) from private.google_sheets_retention_roots r where r.id=any(p_root_ids) and r.workspace_id=p_workspace_id
  and r.erased_at is null and r.expires_at<=clock_timestamp() and r.automatic_expiry_authorized
  and exists(select 1 from (select connection_id,root_id from private.google_sheets_source_root_links union select connection_id,root_id from private.google_sheets_connection_root_links) l where l.root_id=r.id and l.connection_id=p_connection_id))<>cardinality(p_root_ids) then
  raise exception 'sheets_erasure_retention_not_authorized'; end if;
 targets:=private.google_sheets_connection_targets_v1(p_workspace_id,p_connection_id,p_root_ids);
 -- Legacy/unattributed items are not silently swept into a retention batch.
 inventory:=jsonb_build_object('version',2,'workspaceId',p_workspace_id,'connectionId',p_connection_id,'base',targets,'candidates','[]'::jsonb);
 scope:=private.google_sheets_erasure_hash_v1(inventory);
 insert into private.google_sheets_erasure_requests(id,workspace_id,connection_id,case_id,inventory,decisions,scope_hash,purpose,state,approved_at)
 values(p_request_id,p_workspace_id,p_connection_id,p_case_id,inventory,'[]',scope,'retention','approved',clock_timestamp());
 update private.google_sheets_privacy_epochs set epoch=epoch+1,blocked=true,request_id=p_request_id,updated_at=clock_timestamp() where workspace_id=p_workspace_id;
 return jsonb_build_object('requestId',p_request_id,'scopeHash',scope,'state','approved');
end $$;

create function private.google_sheets_request_manifest_v1(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_erasure_requests; targets jsonb; counts jsonb;
begin
 select * into r from private.google_sheets_erasure_requests where id=p_request_id;
 if r.id is null then raise exception 'sheets_erasure_request_unavailable'; end if;
 select coalesce(jsonb_agg(value order by value->>'table',value->>'id'),'[]') into targets from (
  select distinct value from jsonb_array_elements(r.inventory->'base')
  union select value-'action' from jsonb_array_elements(r.decisions) where value->>'action'='delete'
 ) all_targets;
 select coalesce(jsonb_object_agg(t,n),'{}') into counts from(select value->>'table' t,count(*) n from jsonb_array_elements(targets) group by 1) q;
 return jsonb_build_object('version',2,'requestId',r.id,'workspaceId',r.workspace_id,'connectionId',r.connection_id,'scopeHash',r.scope_hash,
  'targets',targets,'counts',counts,'completedAt',case when r.completed_at is null then null else to_char(r.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
  ||case when jsonb_array_length(coalesce(r.inventory->'storageReceipts','[]'))>0 then jsonb_build_object('storageReceipts',r.inventory->'storageReceipts') else '{}'::jsonb end;
end $$;
create function private.get_google_sheets_erasure_recovery_v1(p_request_id uuid,p_scope_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_erasure_requests;
begin
 select * into r from private.google_sheets_erasure_requests where id=p_request_id;
 if r.id is null or p_scope_hash is not null and r.scope_hash is distinct from p_scope_hash then raise exception 'sheets_erasure_scope_changed'; end if;
 return jsonb_build_object('manifest',private.google_sheets_request_manifest_v1(r.id),'state',r.state,
  'withdrawnAt',case when r.withdrawn_at is null then null else to_char(r.withdrawn_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
  'withdrawalReason',r.withdrawal_reason,'withdrawalInventoryDigest',r.withdrawal_inventory_digest,'withdrawalReceiptDigest',r.withdrawal_receipt_digest);
end $$;
create function private.withdraw_google_sheets_erasure_v1(p_request_id uuid,p_scope_hash text,p_inventory_digest text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_erasure_requests;
begin
 select * into r from private.google_sheets_erasure_requests where id=p_request_id;
 if r.id is null or r.scope_hash is distinct from p_scope_hash then raise exception 'sheets_erasure_scope_changed'; end if;
 perform private.google_sheets_privacy_lock_v1(r.workspace_id);
 select * into r from private.google_sheets_erasure_requests where id=p_request_id for update;
 if p_reason is null or p_reason not in ('scope_changed','approval_expired','owner_withdrawn')
  or p_inventory_digest is null or p_inventory_digest !~ '^[a-f0-9]{64}$' then raise exception 'sheets_erasure_recovery_invalid'; end if;
 if r.state='withdrawn' then
  if r.withdrawal_reason is distinct from p_reason then raise exception 'sheets_erasure_recovery_conflict'; end if;
  return private.get_google_sheets_erasure_recovery_v1(r.id,r.scope_hash);
 end if;
 if r.state not in ('prepared','approved') or r.completed_at is not null or r.receipt is not null or r.journal_digest is not null then
  raise exception 'sheets_erasure_completed_wins'; end if;
 if not exists(select 1 from private.google_sheets_privacy_epochs where workspace_id=r.workspace_id and blocked and request_id=r.id) then raise exception 'sheets_erasure_barrier_required'; end if;
 update private.google_sheets_erasure_requests set state='withdrawn',withdrawn_at=clock_timestamp(),withdrawal_reason=p_reason,withdrawal_inventory_digest=p_inventory_digest where id=r.id;
 return private.get_google_sheets_erasure_recovery_v1(r.id,r.scope_hash);
end $$;
create function private.finish_google_sheets_withdrawal_v1(p_request_id uuid,p_scope_hash text,p_receipt_digest text,p_inventory_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.google_sheets_erasure_requests;
begin
 select * into r from private.google_sheets_erasure_requests where id=p_request_id;
 if r.id is null or r.scope_hash is distinct from p_scope_hash then raise exception 'sheets_erasure_scope_changed'; end if;
 perform private.google_sheets_privacy_lock_v1(r.workspace_id);
 select * into r from private.google_sheets_erasure_requests where id=p_request_id for update;
 if r.state<>'withdrawn' or r.completed_at is not null or r.receipt is not null or r.journal_digest is not null then raise exception 'sheets_erasure_recovery_conflict'; end if;
 if p_receipt_digest is null or p_receipt_digest !~ '^[a-f0-9]{64}$' or p_inventory_digest is null or p_inventory_digest !~ '^[a-f0-9]{64}$' then raise exception 'sheets_erasure_recovery_invalid'; end if;
 if r.withdrawal_receipt_digest is not null and r.withdrawal_receipt_digest<>p_receipt_digest then raise exception 'sheets_erasure_recovery_conflict'; end if;
 update private.google_sheets_erasure_requests set withdrawal_receipt_digest=coalesce(withdrawal_receipt_digest,p_receipt_digest),
  withdrawal_finished_inventory_digest=coalesce(withdrawal_finished_inventory_digest,p_inventory_digest) where id=r.id;
 update private.google_sheets_privacy_epochs set blocked=false,request_id=null,epoch=epoch+1,updated_at=clock_timestamp() where workspace_id=r.workspace_id and request_id=r.id and blocked;
 return jsonb_build_object('state','withdrawn','released',true,'requestId',r.id,'scopeHash',r.scope_hash);
end $$;

-- Configuration and count history cannot outlive the disconnect cutoff merely
-- because there were no rows to import. The operator prepares an exact bounded
-- manifest and uses the same externally witnessed executor, never direct DML.
create function private.due_google_sheets_disconnected_expiry_v1(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_limit not between 1 and 500 then raise exception 'sheets_erasure_inventory_limit'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from(select c.workspace_id as "workspaceId",c.id as "connectionId",
  c.disconnected_at+interval '30 days' as "expiresAt",
  exists(select 1 from (select workspace_id,connection_id,root_id from private.google_sheets_source_root_links union select workspace_id,connection_id,root_id from private.google_sheets_connection_root_links) l join private.google_sheets_retention_roots r on r.id=l.root_id
   where l.connection_id=c.id and l.workspace_id=c.workspace_id and r.erased_at is null and not r.automatic_expiry_authorized) as "manualReviewRequired",
  case when exists(select 1 from (select workspace_id,connection_id,root_id from private.google_sheets_source_root_links union select workspace_id,connection_id,root_id from private.google_sheets_connection_root_links) l join private.google_sheets_retention_roots r on r.id=l.root_id
   where l.connection_id=c.id and l.workspace_id=c.workspace_id and r.erased_at is null and not r.automatic_expiry_authorized)
   then 'legacy_source_review' else null end as "reasonCode"
  from public.google_sheets_connections c where c.status='disconnected' and c.disconnected_at+interval '30 days'<=clock_timestamp()
  order by c.disconnected_at,c.id limit p_limit) q);
end $$;
create function private.prepare_google_sheets_disconnected_expiry_v1(p_request_id uuid,p_workspace_id uuid,p_connection_id uuid,p_case_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.google_sheets_connections; targets jsonb; inventory jsonb; scope text;
begin
 perform private.google_sheets_privacy_open_v1(p_workspace_id);
 select * into c from public.google_sheets_connections where id=p_connection_id and workspace_id=p_workspace_id for update;
 if c.id is null or c.status<>'disconnected' or c.disconnected_at is null or c.disconnected_at+interval '30 days'>clock_timestamp()
  or c.revocation_pending or c.authorization_uncertain or c.sync_lease_run_id is not null
  or c.oauth_lease_expires_at>clock_timestamp() or c.refresh_lease_expires_at>clock_timestamp()
  or exists(select 1 from public.google_sheets_credentials where connection_id=c.id) then raise exception 'sheets_erasure_disconnected_expiry_not_due'; end if;
 if exists(select 1 from (select workspace_id,connection_id,root_id from private.google_sheets_source_root_links union select workspace_id,connection_id,root_id from private.google_sheets_connection_root_links) l join private.google_sheets_retention_roots r on r.id=l.root_id
  where l.workspace_id=p_workspace_id and l.connection_id=p_connection_id and r.erased_at is null
   and (not r.automatic_expiry_authorized or r.expires_at>clock_timestamp())) then raise exception 'sheets_erasure_manual_review_required'; end if;
 targets:=private.google_sheets_connection_targets_v1(p_workspace_id,p_connection_id);
 inventory:=jsonb_build_object('version',2,'workspaceId',p_workspace_id,'connectionId',p_connection_id,'base',targets,'candidates','[]'::jsonb);
 scope:=private.google_sheets_erasure_hash_v1(inventory);
 insert into private.google_sheets_erasure_requests(id,workspace_id,connection_id,case_id,inventory,decisions,scope_hash,purpose,state,approved_at)
 values(p_request_id,p_workspace_id,p_connection_id,p_case_id,inventory,'[]',scope,'retention','approved',clock_timestamp());
 insert into private.google_sheets_privacy_epochs(workspace_id,epoch,blocked,request_id) values(p_workspace_id,2,true,p_request_id)
 on conflict(workspace_id) do update set epoch=private.google_sheets_privacy_epochs.epoch+1,blocked=true,request_id=p_request_id,updated_at=clock_timestamp();
 return jsonb_build_object('requestId',p_request_id,'scopeHash',scope,'state','approved');
end $$;

-- Helpers have no public or application execution grants, including newly
-- created SECURITY DEFINER functions. Only these bounded operator entry points
-- are available to the non-login restricted support role.
do $$ declare p record; begin
 for p in select oid::regprocedure as signature from pg_proc where pronamespace='private'::regnamespace
  and (proname like 'google_sheets_%' or proname in ('prepare_google_sheets_erasure_v1','get_google_sheets_erasure_execution_v1',
   'execute_google_sheets_erasure_v1','replay_google_sheets_erasure_v1','finish_google_sheets_restore_v1','due_google_sheets_retention_v1','prepare_google_sheets_retention_v1','get_google_sheets_erasure_recovery_v1','withdraw_google_sheets_erasure_v1','finish_google_sheets_withdrawal_v1','due_google_sheets_disconnected_expiry_v1','prepare_google_sheets_disconnected_expiry_v1')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role,google_sheets_erasure_support,google_sheets_erasure_restore',p.signature);
 end loop;
end $$;
grant execute on function private.prepare_google_sheets_erasure_v1(uuid,uuid,uuid,uuid,jsonb,boolean),
 private.get_google_sheets_erasure_execution_v1(uuid,text),private.execute_google_sheets_erasure_v1(uuid,text,text),
 private.due_google_sheets_retention_v1(integer),
 private.prepare_google_sheets_retention_v1(uuid,uuid,uuid,uuid,uuid[]),private.get_google_sheets_erasure_recovery_v1(uuid,text),
 private.withdraw_google_sheets_erasure_v1(uuid,text,text,text),private.finish_google_sheets_withdrawal_v1(uuid,text,text,text),
 private.due_google_sheets_disconnected_expiry_v1(integer),private.prepare_google_sheets_disconnected_expiry_v1(uuid,uuid,uuid,uuid) to google_sheets_erasure_support;
grant execute on function private.replay_google_sheets_erasure_v1(uuid,text,jsonb,text),private.finish_google_sheets_restore_v1(jsonb,text) to google_sheets_erasure_restore;
commit;
