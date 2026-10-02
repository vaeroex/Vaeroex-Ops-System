begin;

-- Google Sheets uses the reviewed workbook KPI ingestion path. Immutable source
-- versions remain untrusted; an explicit owner mapping approval and deterministic
-- validation/overlap policy admit the current KPI projection atomically.
create table public.google_sheets_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending_authorization'
    check (status in ('pending_authorization', 'connected', 'reauthorization_required', 'disconnected')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  spreadsheet_id text check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,200}$'),
  spreadsheet_title text check (char_length(spreadsheet_title) <= 200),
  tabs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tabs) = 'array' and octet_length(tabs::text) <= 32768),
  sheet_id bigint check (sheet_id >= 0),
  sheet_title text check (char_length(sheet_title) <= 200),
  header_row integer not null default 1 check (header_row between 1 and 25),
  headers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(headers) = 'array' and octet_length(headers::text) <= 16384),
  field_mapping jsonb not null default '{}'::jsonb
    check (jsonb_typeof(field_mapping) = 'object' and octet_length(field_mapping::text) <= 8192),
  active_approval_id uuid,
  automatic_refresh_enabled boolean not null default false,
  next_sync_at timestamptz,
  last_error_code text,
  last_sync_fact_count integer not null default 0,
  last_sync_rejected_count integer not null default 0,
  last_sync_conflict_count integer not null default 0,
  last_sync_at timestamptz,
  last_sync_row_count integer check (last_sync_row_count between 0 and 10000),
  sync_lease_run_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  constraint google_sheets_connections_workspace_id_id_key unique (workspace_id, id),
  constraint google_sheets_connections_sync_lease_pair_check check (
    (sync_lease_run_id is null) = (sync_lease_expires_at is null)
  ),
  constraint google_sheets_connections_entity_fkey foreign key (workspace_id, business_entity_id)
    references public.business_entities(workspace_id, id) on delete cascade,
  constraint google_sheets_connections_configuration_check check (
    (spreadsheet_id is null and sheet_id is null and sheet_title is null)
    or spreadsheet_id is not null
  )
);

create index google_sheets_connections_workspace_status_idx
  on public.google_sheets_connections(workspace_id, status, created_at desc);

create table public.google_sheets_oauth_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  state_hash text not null unique check (state_hash ~ '^sha256:[a-f0-9]{64}$'),
  redirect_uri text not null check (char_length(redirect_uri) between 12 and 2048),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_sheets_oauth_states_connection_fkey foreign key (workspace_id, connection_id)
    references public.google_sheets_connections(workspace_id, id) on delete cascade,
  constraint google_sheets_oauth_states_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '10 minutes'
  )
);

create index google_sheets_oauth_states_pending_idx
  on public.google_sheets_oauth_states(expires_at) where consumed_at is null;

create table public.google_sheets_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null,
  token_ciphertext text not null check (char_length(token_ciphertext) between 32 and 32768),
  access_expires_at timestamptz not null,
  granted_scope text not null
    check (granted_scope = 'https://www.googleapis.com/auth/spreadsheets.readonly'),
  updated_at timestamptz not null default now(),
  constraint google_sheets_credentials_connection_fkey foreign key (workspace_id, connection_id)
    references public.google_sheets_connections(workspace_id, id) on delete cascade
);

create table public.google_sheets_mapping_approvals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, connection_id uuid not null,
  approved_by uuid not null references public.profiles(id), approved_at timestamptz not null default now(),
  policy_version text not null default 'google_sheets_owner_approved_metrics_v1',
  spreadsheet_id text not null, sheet_id bigint not null, header_row integer not null,
  headers jsonb not null, field_mapping jsonb not null,
  unique(workspace_id,connection_id,id),
  foreign key(workspace_id,connection_id) references public.google_sheets_connections(workspace_id,id)
);
alter table public.google_sheets_connections add constraint google_sheets_approval_scope
  foreign key(workspace_id,id,active_approval_id) references public.google_sheets_mapping_approvals(workspace_id,connection_id,id);

create table public.google_sheets_sync_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, connection_id uuid not null,
  initiated_by uuid references public.profiles(id), trigger_kind text not null check(trigger_kind in ('manual','scheduled')),
  approval_id uuid not null, status text not null default 'running' check(status in ('running','succeeded','failed')),
  row_count integer not null default 0 check(row_count between 0 and 10000),
  fact_count integer not null default 0 check(fact_count between 0 and 15000),
  rejected_count integer not null default 0, conflict_count integer not null default 0,
  review_issues jsonb not null default '[]'::jsonb check(jsonb_typeof(review_issues)='array' and jsonb_array_length(review_issues)<=25),
  error_code text check(error_code ~ '^[a-z_]{1,64}$'),
  started_at timestamptz not null default now(), completed_at timestamptz,
  unique(workspace_id,connection_id,id),
  foreign key(workspace_id,connection_id) references public.google_sheets_connections(workspace_id,id),
  foreign key(workspace_id,connection_id,approval_id) references public.google_sheets_mapping_approvals(workspace_id,connection_id,id)
);
create index google_sheets_sync_runs_connection_idx on public.google_sheets_sync_runs(workspace_id,connection_id,started_at desc);

create table public.google_sheets_source_rows (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, business_entity_id uuid not null,
  connection_id uuid not null, source_identity_fingerprint text not null check(source_identity_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  current_version_id uuid, current boolean not null default true, last_sync_run_id uuid not null,
  unique(workspace_id,connection_id,source_identity_fingerprint), unique(workspace_id,connection_id,id),
  foreign key(workspace_id,connection_id) references public.google_sheets_connections(workspace_id,id),
  foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id),
  foreign key(workspace_id,connection_id,last_sync_run_id) references public.google_sheets_sync_runs(workspace_id,connection_id,id)
);
create table public.google_sheets_source_versions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, connection_id uuid not null, source_row_id uuid not null,
  immutable_version integer not null check(immutable_version > 0), prior_version_id uuid,
  source_fingerprint text not null check(source_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  normalized_projection jsonb not null check(jsonb_typeof(normalized_projection)='object' and octet_length(normalized_projection::text)<=16384),
  trust text not null default 'untrusted_external_input' check(trust='untrusted_external_input'),
  validation_state text not null check(validation_state in ('valid','invalid')),
  observed_row_number integer not null check(observed_row_number between 2 and 10025),
  sync_run_id uuid not null, created_at timestamptz not null default now(),
  unique(workspace_id,connection_id,source_row_id,id), unique(source_row_id,immutable_version),
  foreign key(workspace_id,connection_id,source_row_id) references public.google_sheets_source_rows(workspace_id,connection_id,id),
  foreign key(workspace_id,connection_id,sync_run_id) references public.google_sheets_sync_runs(workspace_id,connection_id,id),
  foreign key(workspace_id,connection_id,source_row_id,prior_version_id) references public.google_sheets_source_versions(workspace_id,connection_id,source_row_id,id)
);
alter table public.google_sheets_source_rows add constraint google_sheets_source_head_scope
  foreign key(workspace_id,connection_id,id,current_version_id) references public.google_sheets_source_versions(workspace_id,connection_id,source_row_id,id);
create table public.google_sheets_fact_links (
  workspace_id uuid not null, connection_id uuid not null, source_row_id uuid not null,
  metric_column integer not null check(metric_column between 0 and 99), source_version_id uuid not null,
  approval_id uuid not null, kpi_id uuid not null unique references public.kpis(id),
  admission_state text not null check(admission_state in ('accepted','review_required','retired')),
  primary key(workspace_id,connection_id,source_row_id,metric_column),
  foreign key(workspace_id,connection_id,source_row_id,source_version_id) references public.google_sheets_source_versions(workspace_id,connection_id,source_row_id,id),
  foreign key(workspace_id,connection_id,approval_id) references public.google_sheets_mapping_approvals(workspace_id,connection_id,id)
);

create function private.require_google_sheets_owner_v1(p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_business_entity_id uuid default null)
returns void language plpgsql security definer set search_path='' as $function$
declare expires_at timestamptz; member_role text; member_status text; entity_status text;
begin
  if p_actor_id is null or p_session_id is null or p_workspace_id is null then raise exception 'google_sheets_owner_denied' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=p_workspace_id for share;
  if not found then raise exception 'google_sheets_owner_denied' using errcode='42501'; end if;
  select s.not_after into expires_at from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session_id and s.user_id=p_actor_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of s,u;
  if not found then raise exception 'google_sheets_owner_denied' using errcode='42501'; end if;
  select m.role,m.status into member_role,member_status from public.workspace_members m
    where m.user_id=p_actor_id and m.workspace_id=p_workspace_id for share;
  if not found or member_role<>'owner' or member_status<>'active' or (expires_at is not null and expires_at<=clock_timestamp()) then raise exception 'google_sheets_owner_denied' using errcode='42501'; end if;
  if p_business_entity_id is not null then
    select status into entity_status from public.business_entities where workspace_id=p_workspace_id and id=p_business_entity_id for share;
    if not found or entity_status<>'active' then raise exception 'google_sheets_owner_denied' using errcode='42501'; end if;
  end if;
end;
$function$;

create function private.google_sheets_immutable_v1() returns trigger language plpgsql set search_path='' as $function$
begin raise exception 'google_sheets_immutable_record' using errcode='42501'; end;
$function$;
create trigger google_sheets_source_versions_immutable before update or delete on public.google_sheets_source_versions
  for each row execute function private.google_sheets_immutable_v1();
create trigger google_sheets_mapping_approvals_immutable before update or delete on public.google_sheets_mapping_approvals
  for each row execute function private.google_sheets_immutable_v1();

create function private.retire_google_sheets_facts_v1(p_workspace_id uuid,p_connection_id uuid)
returns void language plpgsql security invoker set search_path='' as $function$
begin
  update public.kpis k set archived_at=coalesce(k.archived_at,now()),updated_at=now()
    from public.google_sheets_fact_links f where f.workspace_id=p_workspace_id and f.connection_id=p_connection_id
      and k.workspace_id=f.workspace_id and k.id=f.kpi_id;
  update public.google_sheets_fact_links set admission_state='retired' where workspace_id=p_workspace_id and connection_id=p_connection_id;
  update public.google_sheets_source_rows set current=false where workspace_id=p_workspace_id and connection_id=p_connection_id;
end;
$function$;
create function private.google_sheets_connection_retirement_v1() returns trigger language plpgsql set search_path='' as $function$
begin
  if new.status<>'connected' or new.spreadsheet_id is distinct from old.spreadsheet_id or new.sheet_id is distinct from old.sheet_id
    or new.header_row is distinct from old.header_row or new.headers is distinct from old.headers or new.field_mapping is distinct from old.field_mapping
    or new.active_approval_id is distinct from old.active_approval_id then
    perform private.retire_google_sheets_facts_v1(old.workspace_id,old.id);
  end if;
  if new.spreadsheet_id is distinct from old.spreadsheet_id or new.sheet_id is distinct from old.sheet_id
    or new.header_row is distinct from old.header_row or new.headers is distinct from old.headers
    or (new.field_mapping is distinct from old.field_mapping and new.active_approval_id is not distinct from old.active_approval_id) then
    new.active_approval_id:=null; new.automatic_refresh_enabled:=false; new.next_sync_at:=null;
  end if;
  return new;
end;
$function$;
create trigger google_sheets_connection_retirement before update on public.google_sheets_connections
  for each row execute function private.google_sheets_connection_retirement_v1();

create function public.approve_google_sheets_mapping_v1(p_workspace_id uuid,p_connection_id uuid,p_actor_id uuid,p_session_id uuid,p_mapping jsonb,p_automatic_enabled boolean)
returns uuid language plpgsql security definer set search_path='' as $function$
declare c public.google_sheets_connections; a uuid; m jsonb; cols integer[]; col integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
  perform private.require_google_sheets_eligible_v1(p_workspace_id);
  select * into c from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id for update;
  if not found then raise exception 'google_sheets_connection_unavailable'; end if;
  perform private.require_google_sheets_owner_v1(p_actor_id,p_session_id,p_workspace_id,c.business_entity_id);
  if c.status<>'connected' or c.spreadsheet_id is null or c.sheet_id is null or (c.sync_lease_expires_at is not null and c.sync_lease_expires_at>now()) then raise exception 'google_sheets_configuration_busy'; end if;
  if jsonb_typeof(p_mapping)<>'object' or jsonb_typeof(p_mapping->'metrics')<>'array' or jsonb_array_length(p_mapping->'metrics') not between 1 and 12
    or p_mapping->>'dateFormat' not in ('iso','serial') or not (p_mapping ?& array['rowKeyColumn','dateColumn','locationColumn']) then raise exception 'google_sheets_mapping_invalid'; end if;
  cols:=array[(p_mapping->>'rowKeyColumn')::integer,(p_mapping->>'dateColumn')::integer];
  if p_mapping->>'locationColumn' is not null then cols:=array_append(cols,(p_mapping->>'locationColumn')::integer); end if;
  for m in select value from jsonb_array_elements(p_mapping->'metrics') loop
    if char_length(m->>'name') not between 1 and 80 or char_length(m->>'category') not between 1 and 80 or m->>'unit' not in ('number','percent','percent_fraction','currency','count')
      or (m->>'target' is not null and abs((m->>'target')::numeric)>1e15) then raise exception 'google_sheets_mapping_invalid'; end if;
    cols:=array_append(cols,(m->>'column')::integer);
  end loop;
  if (select count(distinct value) from unnest(cols) value)<>cardinality(cols)
    or (select count(distinct lower(value->>'name')) from jsonb_array_elements(p_mapping->'metrics'))<>jsonb_array_length(p_mapping->'metrics') then raise exception 'google_sheets_mapping_invalid'; end if;
  foreach col in array cols loop
    if col is null or col not between 0 and 99 or coalesce(c.headers->>col,'') in ('','[restricted column]') then raise exception 'google_sheets_mapping_invalid'; end if;
  end loop;
  if c.active_approval_id is not null and c.field_mapping=p_mapping and exists(select 1 from public.google_sheets_mapping_approvals a where a.id=c.active_approval_id and a.approved_by=p_actor_id
    and a.spreadsheet_id=c.spreadsheet_id and a.sheet_id=c.sheet_id and a.header_row=c.header_row and a.headers=c.headers and a.field_mapping=p_mapping) then
    update public.google_sheets_connections set automatic_refresh_enabled=p_automatic_enabled,
      next_sync_at=case when p_automatic_enabled then coalesce(next_sync_at,now()) else null end,updated_at=now() where id=c.id;
    return c.active_approval_id;
  end if;
  insert into public.google_sheets_mapping_approvals(workspace_id,connection_id,approved_by,spreadsheet_id,sheet_id,header_row,headers,field_mapping)
    values(p_workspace_id,p_connection_id,p_actor_id,c.spreadsheet_id,c.sheet_id,c.header_row,c.headers,p_mapping) returning id into a;
  update public.google_sheets_connections set field_mapping=p_mapping,active_approval_id=a,automatic_refresh_enabled=p_automatic_enabled,
    next_sync_at=case when p_automatic_enabled then now() else null end,last_error_code=null,updated_at=now() where id=c.id;
  return a;
end;
$function$;

create function public.claim_google_sheets_sync_v1(p_workspace_id uuid,p_connection_id uuid,p_actor_id uuid,p_session_id uuid,p_trigger text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c public.google_sheets_connections; r uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
  perform private.require_google_sheets_eligible_v1(p_workspace_id);
  select * into c from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id for update;
  if not found then raise exception 'google_sheets_connection_unavailable'; end if;
  if p_trigger='manual' then perform private.require_google_sheets_owner_v1(p_actor_id,p_session_id,p_workspace_id,c.business_entity_id);
  elsif p_trigger<>'scheduled' or p_actor_id is not null or p_session_id is not null or not c.automatic_refresh_enabled or c.next_sync_at is null or c.next_sync_at>now() then raise exception 'google_sheets_schedule_denied'; end if;
  if c.status<>'connected' or c.active_approval_id is null then raise exception 'google_sheets_mapping_required'; end if;
  if c.sync_lease_expires_at>now() then raise exception 'google_sheets_sync_busy'; end if;
  if not exists(select 1 from public.workspace_members member join auth.users account on account.id=member.user_id where account.deleted_at is null and (account.banned_until is null or account.banned_until<=clock_timestamp()) and member.workspace_id=c.workspace_id and member.user_id=(select approved_by from public.google_sheets_mapping_approvals where id=c.active_approval_id) and member.status='active' and member.role='owner')
    or not exists(select 1 from public.business_entities where workspace_id=c.workspace_id and id=c.business_entity_id and status='active') then raise exception 'google_sheets_authority_expired'; end if;
  update public.google_sheets_sync_runs set status='failed',error_code='lease_expired',completed_at=now() where workspace_id=p_workspace_id and connection_id=p_connection_id and status='running';
  insert into public.google_sheets_sync_runs(workspace_id,connection_id,initiated_by,trigger_kind,approval_id)
    values(p_workspace_id,p_connection_id,p_actor_id,p_trigger,c.active_approval_id) returning id into r;
  update public.google_sheets_connections set sync_lease_run_id=r,sync_lease_expires_at=now()+interval '8 minutes',
    next_sync_at=case when automatic_refresh_enabled then now()+interval '1 hour' else null end,updated_at=now() where id=c.id;
  return jsonb_build_object('runId',r);
end;
$function$;

-- Match the existing source-parent eligibility rule used by Executive Intelligence.
create function private.google_sheets_operational_source_current_v1(p_workspace_id uuid,p_source_file_id uuid,p_import_id uuid)
returns boolean language sql stable security invoker set search_path='' as $function$
  select case when p_source_file_id is not null then exists(
    select 1 from public.file_uploads where workspace_id=p_workspace_id and id=p_source_file_id and archived_at is null and deleted_at is null)
  when p_import_id is not null then exists(
    select 1 from public.file_imports i join public.file_uploads f on f.workspace_id=i.workspace_id and f.id=i.file_upload_id
      where i.workspace_id=p_workspace_id and i.id=p_import_id and f.archived_at is null and f.deleted_at is null)
  else true end;
$function$;
revoke all on function private.google_sheets_operational_source_current_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.commit_google_sheets_sync_v1(p_workspace_id uuid,p_connection_id uuid,p_run_id uuid,p_rows jsonb,p_complete boolean)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c public.google_sheets_connections; run public.google_sheets_sync_runs; a public.google_sheets_mapping_approvals;
  r jsonb; m jsonb; approved_metric jsonb; projection jsonb; hashed_projection jsonb;
  source public.google_sheets_source_rows; prior public.google_sheets_source_versions;
  version_id uuid; kpi_id uuid; identity_expected text; fingerprint_expected text; v_name text;
  v_rows_count integer:=0; v_facts_count integer:=0; v_rejected_count integer:=0; v_conflict_count integer:=0; v_overlap boolean; duplicate_keys jsonb; v_review_issues jsonb:='[]'::jsonb; v_entity_label text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  select display_name into v_entity_label from public.business_entities where workspace_id=p_workspace_id and id=(select business_entity_id from public.google_sheets_connections where id=p_connection_id and workspace_id=p_workspace_id);
  -- Serialize overlapping Sheets sources in a workspace before any KPI authority check.
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
  select * into c from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id for update;
  select * into run from public.google_sheets_sync_runs where workspace_id=p_workspace_id and connection_id=p_connection_id and id=p_run_id for update;
  if c.id is null or run.id is null or run.status<>'running' or c.status<>'connected' or c.sync_lease_run_id is distinct from p_run_id
    or c.sync_lease_expires_at<=now() or c.active_approval_id is distinct from run.approval_id then raise exception 'google_sheets_sync_fence_denied'; end if;
  select * into strict a from public.google_sheets_mapping_approvals where id=run.approval_id;
  if a.field_mapping<>c.field_mapping or a.headers<>c.headers or a.spreadsheet_id<>c.spreadsheet_id or a.sheet_id<>c.sheet_id or a.header_row<>c.header_row
    or not exists(select 1 from public.workspace_members member join auth.users account on account.id=member.user_id where member.workspace_id=c.workspace_id and member.user_id=a.approved_by and member.role='owner' and member.status='active' and account.deleted_at is null and (account.banned_until is null or account.banned_until<=clock_timestamp()))
    or not exists(select 1 from public.business_entities where workspace_id=c.workspace_id and id=c.business_entity_id and status='active') then raise exception 'google_sheets_authority_expired'; end if;
  if p_complete is distinct from true or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 or octet_length(p_rows::text)>16000000 then raise exception 'google_sheets_incomplete_read'; end if;
  if (select count(distinct value->>'identity') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'google_sheets_duplicate_row_key'; end if;
  if (select coalesce(sum(jsonb_array_length(value->'metrics')),0) from jsonb_array_elements(p_rows))>15000 then raise exception 'google_sheets_observation_limit'; end if;
  select coalesce(jsonb_object_agg(duplicate_key,true),'{}'::jsonb) into duplicate_keys from (
    select jsonb_build_array(row->>'date',coalesce(row->>'location',''),lower(metric->>'name'))::text duplicate_key
    from jsonb_array_elements(p_rows) row,lateral jsonb_array_elements(row->'metrics') metric
    where row->>'validationState'='valid' group by 1 having count(*)>1
  ) duplicates;
  -- Retire the previous projection within this transaction; rollback preserves it on any error.
  perform private.retire_google_sheets_facts_v1(c.workspace_id,c.id);
  for r in select value from jsonb_array_elements(p_rows) loop
    v_rows_count:=v_rows_count+1;
    if r->>'rowKey' !~ '^sha256:[a-f0-9]{64}$' or r->>'validationState' not in ('valid','invalid')
      or (r->>'rowNumber')::integer not between c.header_row+1 and 10025 or jsonb_typeof(r->'metrics')<>'array'
      or jsonb_array_length(r->'metrics')>12 or jsonb_typeof(r->'issues')<>'array' then raise exception 'google_sheets_source_invalid'; end if;
    identity_expected:='sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
      'identityVersion','external_source_identity_v1','workspaceId',c.workspace_id,'businessEntityId',c.business_entity_id,'connectionId',c.id,
      'source',jsonb_build_object('kind','provider','providerKey','google_sheets','providerRecordType','worksheet_row',
        'providerRecordId',c.spreadsheet_id||':'||c.sheet_id::text||':'||substring(r->>'rowKey' from 8)))),'hex');
    projection:=r-'identity'-'fingerprint'-'rowNumber';
    hashed_projection:=projection||jsonb_build_object('policy','google_sheets_normalization_v1','metrics',
      (select coalesce(jsonb_agg(value||jsonb_build_object('target',case when value->>'target' is null then null else value->>'target' end)),'[]'::jsonb) from jsonb_array_elements(r->'metrics')));
    fingerprint_expected:='sha256:'||encode(private.phase_3_contract_fingerprint_v1(hashed_projection),'hex');
    if r->>'identity' is distinct from identity_expected or r->>'fingerprint' is distinct from fingerprint_expected then raise exception 'google_sheets_source_fingerprint_invalid'; end if;
    insert into public.google_sheets_source_rows(workspace_id,business_entity_id,connection_id,source_identity_fingerprint,last_sync_run_id)
      values(c.workspace_id,c.business_entity_id,c.id,identity_expected,run.id) on conflict(workspace_id,connection_id,source_identity_fingerprint) do nothing;
    select * into strict source from public.google_sheets_source_rows where workspace_id=c.workspace_id and connection_id=c.id and source_identity_fingerprint=identity_expected for update;
    select * into prior from public.google_sheets_source_versions where id=source.current_version_id;
    if prior.id is not null and prior.source_fingerprint=fingerprint_expected then version_id:=prior.id;
    else
      insert into public.google_sheets_source_versions(workspace_id,connection_id,source_row_id,immutable_version,prior_version_id,source_fingerprint,normalized_projection,validation_state,observed_row_number,sync_run_id)
        values(c.workspace_id,c.id,source.id,coalesce(prior.immutable_version,0)+1,prior.id,fingerprint_expected,projection,r->>'validationState',(r->>'rowNumber')::integer,run.id) returning id into version_id;
    end if;
    update public.google_sheets_source_rows set current=true,current_version_id=version_id,last_sync_run_id=run.id where id=source.id;
    if r->>'validationState'='invalid' then
      v_rejected_count:=v_rejected_count+1;
      if jsonb_array_length(v_review_issues)<25 then v_review_issues:=v_review_issues||jsonb_build_array(jsonb_build_object('rowNumber',(r->>'rowNumber')::integer,'metricName',null,'reason',coalesce(r#>>'{issues,0}','invalid_row'))); end if;
      continue;
    end if;
    if r->>'date' is null or r->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or to_char((r->>'date')::date,'YYYY-MM-DD')<>r->>'date'
      or jsonb_array_length(r->'issues')<>0 or jsonb_array_length(r->'metrics')=0 then raise exception 'google_sheets_source_invalid'; end if;
    if (select count(distinct value->>'column') from jsonb_array_elements(r->'metrics'))<>jsonb_array_length(r->'metrics') then raise exception 'google_sheets_source_invalid'; end if;
    for m in select value from jsonb_array_elements(r->'metrics') loop
      select value into approved_metric from jsonb_array_elements(a.field_mapping->'metrics') where value->>'column'=m->>'column';
      if approved_metric is null or m-'value'<>approved_metric or m->>'value' !~ '^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,9})?$'
        or (m->>'unit'='count' and m->>'value' !~ '^-?[0-9]+$') then raise exception 'google_sheets_metric_invalid'; end if;
      v_name:=m->>'name'||' · '||left(v_entity_label,80)||' ['||left(c.business_entity_id::text,8)||']'||case when r->>'location' is null then '' else ' — '||(r->>'location') end;
      -- Matching metric/period from another source is held for review, never summed.
      v_overlap:=exists(select 1 from public.kpis k where k.workspace_id=c.workspace_id and k.metric_date=(r->>'date')::date
        and k.deleted_at is null and k.archived_at is null
        and (lower(regexp_replace(k.name,'[^[:alnum:]]','','g')) in (
          lower(regexp_replace(m->>'name','[^[:alnum:]]','','g')),lower(regexp_replace(v_name,'[^[:alnum:]]','','g')))
          or (k.raw_data_json#>>'{googleSheets,businessEntityId}'=c.business_entity_id::text
            and lower(regexp_replace(k.raw_data_json#>>'{googleSheets,metricName}','[^[:alnum:]]','','g'))=lower(regexp_replace(m->>'name','[^[:alnum:]]','','g'))
            and (k.raw_data_json#>>'{googleSheets,location}' is null or r->>'location' is null or k.raw_data_json#>>'{googleSheets,location}'=r->>'location')))
        and not exists(select 1 from public.google_sheets_fact_links f where f.workspace_id=c.workspace_id and f.connection_id=c.id and f.kpi_id=k.id));
      -- CSV/XLSX operational imports use their explicitly mapped metric_name/value.
      v_overlap:=v_overlap or exists(select 1 from public.operational_metrics o
        where o.workspace_id=c.workspace_id and o.metric_date=(r->>'date')::date and o.value is not null
          and o.archived_at is null and o.deleted_at is null
          and private.google_sheets_operational_source_current_v1(o.workspace_id,o.source_file_id,o.import_id)
          and lower(regexp_replace(o.metric_name,'[^[:alnum:]]','','g')) in (
            lower(regexp_replace(m->>'name','[^[:alnum:]]','','g')),lower(regexp_replace(v_name,'[^[:alnum:]]','','g'))));
      v_overlap:=v_overlap or coalesce((duplicate_keys->>jsonb_build_array(r->>'date',coalesce(r->>'location',''),lower(m->>'name'))::text)::boolean,false);
      -- Accounting facts have their own authority. A currency observation cannot compete
      -- with accepted provider money in the same entity/period, even under another label.
      if m->>'unit'='currency' then
        v_overlap:=v_overlap or exists(select 1 from private.canonical_business_facts f join private.canonical_business_fact_versions v on v.id=f.current_version_id
          where f.workspace_id=c.workspace_id and f.business_entity_id=c.business_entity_id and v.reconciliation_state='accepted' and v.validation_state='valid'
            and v.value_kind='money' and ((v.posting_date=(r->>'date')::date) or ((r->>'date')::date between v.period_start and v.period_end)));
      end if;
      if v_overlap then
        v_conflict_count:=v_conflict_count+1;
        if jsonb_array_length(v_review_issues)<25 then v_review_issues:=v_review_issues||jsonb_build_array(jsonb_build_object('rowNumber',(r->>'rowNumber')::integer,'metricName',m->>'name','reason','overlapping_metric_period')); end if;
        continue;
      end if;
      select f.kpi_id into kpi_id from public.google_sheets_fact_links f where f.workspace_id=c.workspace_id and f.connection_id=c.id and f.source_row_id=source.id and f.metric_column=(m->>'column')::integer;
      if kpi_id is null then kpi_id:=gen_random_uuid(); end if;
      insert into public.kpis(id,workspace_id,name,category,target,actual_value,metric_date,owner,source,raw_data_json,created_by)
        values(kpi_id,c.workspace_id,v_name,m->>'category',(m->>'target')::numeric,(m->>'value')::numeric,(r->>'date')::date,
          coalesce(r->>'location',''),'Google Sheets: '||c.display_name,
          jsonb_build_object('googleSheets',jsonb_build_object('connectionId',c.id,'spreadsheetId',c.spreadsheet_id,'sheetId',c.sheet_id,
            'businessEntityId',c.business_entity_id,'metricName',m->>'name','location',r->>'location','sourceRowId',source.id,'sourceVersionId',version_id,
            'sourceFingerprint',fingerprint_expected,'approvalId',a.id,'rowNumber',(r->>'rowNumber')::integer,'metricColumn',(m->>'column')::integer,
            'unit',case when m->>'unit'='percent_fraction' then 'percent' else m->>'unit' end,'validation','valid','admission','owner_approved_mapping','policyVersion',a.policy_version)),a.approved_by)
        on conflict(id) do update set name=excluded.name,category=excluded.category,target=excluded.target,actual_value=excluded.actual_value,
          metric_date=excluded.metric_date,owner=excluded.owner,source=excluded.source,raw_data_json=excluded.raw_data_json,archived_at=null,deleted_at=null,updated_at=now();
      insert into public.google_sheets_fact_links(workspace_id,connection_id,source_row_id,metric_column,source_version_id,approval_id,kpi_id,admission_state)
        values(c.workspace_id,c.id,source.id,(m->>'column')::integer,version_id,a.id,kpi_id,'accepted')
        on conflict(workspace_id,connection_id,source_row_id,metric_column) do update set source_version_id=excluded.source_version_id,approval_id=excluded.approval_id,admission_state='accepted';
      v_facts_count:=v_facts_count+1;
    end loop;
  end loop;
  if (select count(*) from public.kpis where workspace_id=c.workspace_id and archived_at is null and deleted_at is null)>20000 then raise exception 'google_sheets_workspace_capacity'; end if;
  update public.google_sheets_sync_runs set status='succeeded',row_count=v_rows_count,fact_count=v_facts_count,rejected_count=v_rejected_count,
    conflict_count=v_conflict_count,review_issues=v_review_issues,completed_at=now() where id=run.id;
  update public.google_sheets_connections set last_sync_at=now(),last_sync_row_count=v_rows_count,last_sync_fact_count=v_facts_count,
    last_sync_rejected_count=v_rejected_count,last_sync_conflict_count=v_conflict_count,last_error_code=null,sync_lease_run_id=null,sync_lease_expires_at=null,
    next_sync_at=case when automatic_refresh_enabled then to_timestamp((floor(extract(epoch from clock_timestamp())/900)+1)*900) else null end,updated_at=now() where id=c.id;
  return jsonb_build_object('runId',run.id,'rowCount',v_rows_count,'factCount',v_facts_count,'rejectedCount',v_rejected_count,'conflictCount',v_conflict_count);
end;
$function$;

create function public.fail_google_sheets_sync_v1(p_workspace_id uuid,p_connection_id uuid,p_run_id uuid,p_error_code text)
returns void language plpgsql security invoker set search_path='' as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
  perform 1 from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id for update;
  update public.google_sheets_sync_runs set status='failed',error_code=case when p_error_code ~ '^[a-z_]{1,64}$' then p_error_code else 'sync_failed' end,completed_at=now()
    where workspace_id=p_workspace_id and connection_id=p_connection_id and id=p_run_id and status='running';
  update public.google_sheets_connections set sync_lease_run_id=null,sync_lease_expires_at=null,last_error_code=case when p_error_code ~ '^[a-z_]{1,64}$' then p_error_code else 'sync_failed' end,
    next_sync_at=case when automatic_refresh_enabled then now()+interval '1 hour' else null end,updated_at=now()
    where workspace_id=p_workspace_id and id=p_connection_id and sync_lease_run_id=p_run_id;
end;
$function$;

-- Only connection summaries and sanitized run outcomes are exposed to members.
do $rls$
declare t text;
begin
  foreach t in array array['google_sheets_connections','google_sheets_oauth_states','google_sheets_credentials','google_sheets_mapping_approvals','google_sheets_sync_runs','google_sheets_source_rows','google_sheets_source_versions','google_sheets_fact_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end;
$rls$;
create policy "workspace members read Sheets connections" on public.google_sheets_connections for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "workspace members read Sheets outcomes" on public.google_sheets_sync_runs for select to authenticated using(public.is_workspace_member(workspace_id));
grant select on public.google_sheets_connections,public.google_sheets_sync_runs to authenticated;
revoke all on function private.require_google_sheets_owner_v1(uuid,uuid,uuid,uuid),private.google_sheets_immutable_v1(),
  private.retire_google_sheets_facts_v1(uuid,uuid),private.google_sheets_connection_retirement_v1() from public,anon,authenticated,service_role;
-- Only the guarded public SECURITY DEFINER RPCs can invoke these private helpers.
revoke all on function public.approve_google_sheets_mapping_v1(uuid,uuid,uuid,uuid,jsonb,boolean),
  public.claim_google_sheets_sync_v1(uuid,uuid,uuid,uuid,text),public.commit_google_sheets_sync_v1(uuid,uuid,uuid,jsonb,boolean),
  public.fail_google_sheets_sync_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.approve_google_sheets_mapping_v1(uuid,uuid,uuid,uuid,jsonb,boolean),
  public.claim_google_sheets_sync_v1(uuid,uuid,uuid,uuid,text),public.commit_google_sheets_sync_v1(uuid,uuid,uuid,jsonb,boolean),
  public.fail_google_sheets_sync_v1(uuid,uuid,uuid,text) to service_role;
-- Spreadsheet projections are owned by their approved source. Direct customer edits
-- cannot forge provenance or silently replace an imported observation.
create function private.guard_google_sheets_kpi_authority_v1() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if pg_trigger_depth()>1 then return new; end if;
  if auth.role() is distinct from 'service_role' and (new.raw_data_json ? 'googleSheets' or (tg_op='UPDATE' and old.raw_data_json ? 'googleSheets')) then
    raise exception 'google_sheets_source_managed_metric' using errcode='42501';
  end if;
  if not exists(select 1 from public.google_sheets_connections where workspace_id=new.workspace_id) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||new.workspace_id::text,0));
  if new.archived_at is null and new.deleted_at is null and not (new.raw_data_json ? 'googleSheets') then
    update public.google_sheets_fact_links f set admission_state='review_required' from public.kpis k
      where f.workspace_id=new.workspace_id and f.kpi_id=k.id and f.admission_state='accepted' and k.metric_date=new.metric_date
        and lower(regexp_replace(new.name,'[^[:alnum:]]','','g')) in (lower(regexp_replace(k.name,'[^[:alnum:]]','','g')),lower(regexp_replace(k.raw_data_json#>>'{googleSheets,metricName}','[^[:alnum:]]','','g')));
    update public.kpis k set archived_at=now(),updated_at=now() from public.google_sheets_fact_links f
      where f.workspace_id=new.workspace_id and f.kpi_id=k.id and f.admission_state='review_required' and k.archived_at is null;
  end if;
  return new;
end;
$function$;
create trigger guard_google_sheets_kpi_authority before insert or update on public.kpis
  for each row execute function private.guard_google_sheets_kpi_authority_v1();
revoke all on function private.guard_google_sheets_kpi_authority_v1() from public,anon,authenticated,service_role;
create function private.retire_google_sheets_accounting_overlap_v1() returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.reconciliation_state='accepted' and new.validation_state='valid' and new.value_kind='money' then
    perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||new.workspace_id::text,0));
    update public.google_sheets_fact_links f set admission_state='review_required' from public.kpis k
      where f.workspace_id=new.workspace_id and f.kpi_id=k.id and f.admission_state='accepted'
        and k.raw_data_json#>>'{googleSheets,businessEntityId}'=new.business_entity_id::text
        and k.raw_data_json#>>'{googleSheets,unit}'='currency'
        and (k.metric_date=new.posting_date or k.metric_date between new.period_start and new.period_end);
    update public.kpis k set archived_at=now(),updated_at=now() from public.google_sheets_fact_links f
      where f.workspace_id=new.workspace_id and f.kpi_id=k.id and f.admission_state='review_required' and k.archived_at is null;
  end if;
  return new;
end;
$function$;
create trigger retire_google_sheets_accounting_overlap after insert on private.canonical_business_fact_versions
  for each row execute function private.retire_google_sheets_accounting_overlap_v1();
revoke all on function private.retire_google_sheets_accounting_overlap_v1() from public,anon,authenticated,service_role;
-- Later operational imports are evaluated at read time. This function does not
-- alter either source's values, lifecycle, or admission records.
create function public.read_google_sheets_operational_conflicts_v1(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'google_sheets_workspace_denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kpi_id',conflict.id)),'[]'::jsonb) into result from (
    select distinct k.id from public.kpis k join public.google_sheets_fact_links f on f.workspace_id=k.workspace_id and f.kpi_id=k.id
    where k.workspace_id=p_workspace_id and k.archived_at is null and k.deleted_at is null and f.admission_state='accepted'
      and exists(select 1 from public.operational_metrics o where o.workspace_id=k.workspace_id and o.metric_date=k.metric_date
        and o.value is not null and o.archived_at is null and o.deleted_at is null
        and private.google_sheets_operational_source_current_v1(o.workspace_id,o.source_file_id,o.import_id)
        and lower(regexp_replace(o.metric_name,'[^[:alnum:]]','','g')) in (
          lower(regexp_replace(k.name,'[^[:alnum:]]','','g')),lower(regexp_replace(k.raw_data_json#>>'{googleSheets,metricName}','[^[:alnum:]]','','g'))))
    limit 20001) conflict;
  if jsonb_array_length(result)>20000 then raise exception 'google_sheets_kpi_history_bound'; end if;
  return result;
end;
$function$;
revoke all on function public.read_google_sheets_operational_conflicts_v1(uuid) from public,anon,service_role;
grant execute on function public.read_google_sheets_operational_conflicts_v1(uuid) to authenticated;
commit;
