-- Dormant Square atomic-page qualification. No registration, live provider,
-- credential, scheduler or production enrollment is introduced.
begin;

-- One serialized, non-evicting retained-state budget per connection (including
-- older generations). Logical compact JSON bytes are not a claim about heap,
-- TOAST or index size; independent row counts bound that metadata separately.
create table private.square_ingestion_capacity (
  connection_id uuid primary key,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  scans integer not null default 0 check (scans between 0 and 32),
  resources integer not null default 0 check (resources between 0 and 10000),
  versions integer not null default 0 check (versions between 0 and 10000),
  receipts integer not null default 0 check (receipts between 0 and 3200),
  retained_bytes bigint not null default 0 check (retained_bytes between 0 and 67108864),
  retained_containers bigint not null default 0 check (retained_containers between 0 and 500000),
  foreign key (workspace_id,business_entity_id,connection_id)
    references private.square_connections(workspace_id,business_entity_id,connection_id) on delete restrict
);

create table private.square_ingestion_scans (
  scan_key text primary key check (private.is_sha256_fingerprint_v1(scan_key)),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  initial_task_id uuid not null,
  binding jsonb not null,
  stream text not null,
  status text not null check (status in ('ready','leased','finished','blocked','expired')),
  checkpoint_version integer not null default 0 check (checkpoint_version between 0 and 100),
  attempt integer not null default 0 check (attempt between 0 and 3),
  lease_serial bigint not null default 0 check (lease_serial >= 0),
  lease jsonb,
  lease_task_id uuid references private.square_ingestion_tasks(task_id) on delete restrict,
  cursor jsonb,
  completeness jsonb,
  not_before timestamptz not null,
  retention_policy_version text not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (workspace_id,business_entity_id,connection_id,connection_generation,initial_task_id)
    references private.square_ingestion_tasks(workspace_id,business_entity_id,connection_id,connection_generation,task_id) on delete restrict,
  unique (workspace_id,business_entity_id,connection_id,scan_key)
);
create index square_ingestion_scans_task_idx on private.square_ingestion_scans(initial_task_id);
create index square_ingestion_scans_lease_task_idx on private.square_ingestion_scans(lease_task_id);

create table private.square_ingestion_resources (
  resource_key text primary key check (private.is_sha256_fingerprint_v1(resource_key)),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  stream text not null,
  provider_record_type text not null,
  provider_record_id text not null,
  observed_version_key text,
  current_version_key text,
  version_count bigint not null default 0 check (version_count between 0 and 9007199254740991),
  unique (workspace_id,business_entity_id,connection_id,resource_key),
  foreign key (workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on delete restrict
);
create table private.square_ingestion_versions (
  version_key text primary key check (private.is_sha256_fingerprint_v1(version_key)),
  resource_key text not null,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  ordinal bigint not null check (ordinal between 1 and 9007199254740991),
  version_id uuid not null unique,
  prior_version_id uuid references private.square_ingestion_versions(version_id) on delete restrict,
  pending jsonb not null,
  version jsonb not null,
  ordering text not null check (ordering in ('newer','older','conflict','unordered')),
  retention_policy_version text not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null,
  unique (resource_key,ordinal),
  unique (resource_key,version_key),
  foreign key (workspace_id,business_entity_id,connection_id,resource_key)
    references private.square_ingestion_resources(workspace_id,business_entity_id,connection_id,resource_key) on delete restrict,
  check (version ->> 'trust' = 'untrusted_external_input' and version #>> '{validation,state}' = 'pending')
);
create index square_ingestion_versions_prior_idx on private.square_ingestion_versions(prior_version_id);
alter table private.square_ingestion_resources
  add foreign key (resource_key,observed_version_key) references private.square_ingestion_versions(resource_key,version_key) on delete restrict,
  add foreign key (resource_key,current_version_key) references private.square_ingestion_versions(resource_key,version_key) on delete restrict;
create index square_ingestion_resources_observed_idx on private.square_ingestion_resources(observed_version_key);
create index square_ingestion_resources_current_idx on private.square_ingestion_resources(current_version_key);

create table private.square_ingestion_page_receipts (
  scan_key text not null references private.square_ingestion_scans(scan_key) on delete restrict,
  page_id text not null check (private.is_sha256_fingerprint_v1(page_id)),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  task_id uuid not null references private.square_ingestion_tasks(task_id) on delete restrict,
  command_fingerprint text not null check (private.is_sha256_fingerprint_v1(command_fingerprint)),
  checkpoint_version integer not null check (checkpoint_version between 1 and 100),
  retention_policy_version text not null,
  retention_expires_at timestamptz not null,
  created_at timestamptz not null,
  primary key (scan_key,page_id),
  unique (scan_key,checkpoint_version),
  foreign key (workspace_id,business_entity_id,connection_id,scan_key)
    references private.square_ingestion_scans(workspace_id,business_entity_id,connection_id,scan_key) on delete restrict
);
create index square_ingestion_page_receipts_task_idx on private.square_ingestion_page_receipts(task_id);
create trigger square_ingestion_version_immutable
  before update or delete on private.square_ingestion_versions
  for each row execute function private.reject_external_integration_immutable_mutation_v1();
create trigger square_ingestion_receipt_immutable
  before update or delete on private.square_ingestion_page_receipts
  for each row execute function private.reject_external_integration_immutable_mutation_v1();

do $private_tables$
declare v_table text;
begin
  foreach v_table in array array['square_ingestion_capacity','square_ingestion_scans','square_ingestion_resources','square_ingestion_versions','square_ingestion_page_receipts'] loop
    execute pg_catalog.format('alter table private.%I enable row level security',v_table);
    execute pg_catalog.format('alter table private.%I force row level security',v_table);
    execute pg_catalog.format('revoke all on table private.%I from public,anon,authenticated,service_role,square_ingestion_runtime_authority,square_ingestion_qualification_admin',v_table);
  end loop;
end;
$private_tables$;

-- Nonrecursive container-only depth-first visitor. Never materialize an
-- expanded recursive CTE or retain ancestor subtrees. One invocation holds a
-- root reference and path; separate expanded arrays retain <=64 metadata frames
-- of <=3,000 immediate container-key names and traversal indexes, not payloads.
-- Scalar children are charged in one shallow aggregate. Release the extracted
-- container before descending. Thus <=66,000 container iterations and <=7.2m
-- shallow values are consumed, with one current subtree and no history spool.
-- Invalid depth/cardinality/remaining budget rejects BEFORE descending children.
-- Keep SPI planning generic so a caller's custom-plan preference cannot copy
-- root parameters into plans. Iteration also avoids recursive PL/pgSQL calls
-- and reentrant expression execution for every container in a large command.
create function private.square_utf16_length_v1(p_value text)
returns integer language sql immutable strict security invoker set search_path = '' as $function$
  -- UTF-8 supplementary characters use four bytes and two JavaScript UTF-16
  -- code units. The bounded scalar/key strings never require a character spool.
  select case when pg_catalog.octet_length(p_value)=pg_catalog.char_length(p_value) then pg_catalog.char_length(p_value)
    else pg_catalog.char_length(p_value)+pg_catalog.char_length(pg_catalog.regexp_replace(p_value,'[^\U00010000-\U0010ffff]','','g')) end;
$function$;
create function private.square_walk_page_json_v1(p_root jsonb,p_path text[],p_remaining bigint[],p_scope jsonb default null,p_order_id text default null,p_order_location text default null)
returns bigint[] language plpgsql stable security invoker set search_path = '' set plan_cache_mode = 'force_generic_plan' as $function$
declare
  v_node jsonb;v_kind text;v_count bigint;v_keys text[];v_bytes bigint;v_invalid boolean;v_budget bigint[]:=p_remaining;v_flat text;
  v_frames jsonb[]:=array[]::jsonb[];v_indices integer[]:=array[]::integer[];
  v_path text[]:=p_path;v_depth integer:=0;
begin
  loop
  if pg_catalog.cardinality(v_path)>64 or v_budget[1]<0 or v_budget[2]<1 or v_budget[3]<0 then raise exception using errcode='22023',message='square_page_input_invalid';end if;
  v_node:=p_root#>v_path;v_kind:=pg_catalog.jsonb_typeof(v_node);
  if v_kind not in ('array','object') then
    if (case v_kind when 'string' then (case when pg_catalog.octet_length(v_node#>>'{}')=pg_catalog.char_length(v_node#>>'{}') then pg_catalog.char_length(v_node#>>'{}') else private.square_utf16_length_v1(v_node#>>'{}') end)>4096 when 'number' then (v_node::text)::numeric<>pg_catalog.trunc((v_node::text)::numeric) or pg_catalog.abs((v_node::text)::numeric)>9007199254740991 else false end) then raise exception using errcode='22023',message='square_page_input_invalid';end if;
    v_budget[3]:=v_budget[3]-pg_catalog.octet_length(v_node::text);
    if v_budget[3]<0 then raise exception using errcode='22023',message='square_page_input_invalid';end if;
    return v_budget;
  end if;
  v_budget[2]:=v_budget[2]-1;
  if v_kind='object' then select count(*) into v_count from pg_catalog.jsonb_object_keys(v_node);
  else v_count:=pg_catalog.jsonb_array_length(v_node);end if;
  if v_count>(case when v_kind='object' then 64 else 3000 end) or v_count>v_budget[1] or pg_catalog.cardinality(v_path)=64 and v_count>0 then raise exception using errcode='22023',message='square_page_input_invalid';end if;
  v_budget[1]:=v_budget[1]-v_count;
  if p_scope is not null and v_kind='object' and (
    v_node?'providerKey' and v_node->>'providerKey' is distinct from 'square'
    or v_node?'providerEnvironment' and v_node->>'providerEnvironment' is distinct from p_scope->>'environment'
    or v_node?'workspaceId' and v_node->>'workspaceId' is distinct from p_scope->>'workspaceId'
    or v_node?'businessEntityId' and v_node->>'businessEntityId' is distinct from p_scope->>'businessEntityId'
    or v_node?'connectionId' and v_node->>'connectionId' is distinct from p_scope->>'connectionId'
    or v_node?'providerEntityId' and v_node->>'providerEntityId' is distinct from p_scope->>'sellerId'
    or v_node?'providerEntityType' and v_node->>'providerEntityType' is distinct from 'merchant'
    or p_order_id is not null and v_node?'orderId' and v_node->>'orderId' is distinct from p_order_id
    or p_order_location is not null and v_node?'locationId' and v_node->>'locationId' is not null and v_node->>'locationId' is distinct from p_order_location
  ) then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  -- A bounded classification shortcut, NEVER a new acceptance limit. First a
  -- strict immediate-child type check proves ALL elements are strings; without
  -- it compact Numeric exponents could expand enormously during ::text. #>
  -- yields a flat JSONB datum; <=32KiB of string data bounds even hostile JSON
  -- escaping during ::text to <=192KiB. The anchored pattern proves every child is an
  -- unescaped ASCII string of <=255 UTF-16 units, with no child containers.
  -- All n values and this container were already charged above. JSONB emits
  -- exactly one extra space after each array comma, so remove precisely n-1.
  -- Anything outside this safe subset uses the unchanged general visitor.
  v_flat:=null;
  if v_kind='array' and pg_catalog.pg_column_size(v_node)<=32768
    and not pg_catalog.jsonb_path_exists(v_node,'strict $[*] ? (@.type() != "string")') then v_flat:=v_node::text;end if;
  if v_flat is not null and v_flat collate "C" ~ '^\[("[A-Za-z0-9._:-]{0,255}"(, "[A-Za-z0-9._:-]{0,255}")*)?\]$' then
    v_keys:=array[]::text[];v_bytes:=pg_catalog.octet_length(v_flat)-greatest(v_count-1,0);v_invalid:=false;
  else
  select coalesce(pg_catalog.array_agg(key) filter(where pg_catalog.jsonb_typeof(value) in ('array','object')),array[]::text[]),
    2+greatest(v_count-1,0)+coalesce(sum(case when v_kind='object' then pg_catalog.octet_length(pg_catalog.to_jsonb(key)::text)+1 else 0 end
      +case when pg_catalog.jsonb_typeof(value) in ('array','object') then 0 else pg_catalog.octet_length(value::text) end),0),
    coalesce(bool_or(v_kind='object' and ((case when pg_catalog.octet_length(key)=pg_catalog.char_length(key) then pg_catalog.char_length(key) else private.square_utf16_length_v1(key) end)>128 or key in ('__proto__','constructor','prototype')) or case pg_catalog.jsonb_typeof(value)
      when 'string' then (case when pg_catalog.octet_length(value#>>'{}')=pg_catalog.char_length(value#>>'{}') then pg_catalog.char_length(value#>>'{}') else private.square_utf16_length_v1(value#>>'{}') end)>4096
      when 'number' then (value::text)::numeric<>pg_catalog.trunc((value::text)::numeric) or pg_catalog.abs((value::text)::numeric)>9007199254740991 else false end),false)
    into v_keys,v_bytes,v_invalid
    from (select key,value from pg_catalog.jsonb_each(case when v_kind='object' then v_node else '{}'::jsonb end)
      union all select (ordinality-1)::text,value from pg_catalog.jsonb_array_elements(case when v_kind='array' then v_node else '[]'::jsonb end) with ordinality) as children;
  end if;
  v_flat:=null;
  v_budget[3]:=v_budget[3]-v_bytes;
  if v_invalid or v_budget[3]<0 or pg_catalog.cardinality(v_keys)>v_budget[2] then raise exception using errcode='22023',message='square_page_input_invalid';end if;
  v_node:=null;
  if pg_catalog.cardinality(v_keys)>0 then
    v_depth:=v_depth+1;v_frames[v_depth]:=pg_catalog.to_jsonb(v_keys);v_indices[v_depth]:=0;
  else
    loop
      exit when v_depth=0;
      v_indices[v_depth]:=v_indices[v_depth]+1;
      v_path:=v_path[1:pg_catalog.cardinality(v_path)-1];
      exit when v_indices[v_depth]<pg_catalog.jsonb_array_length(v_frames[v_depth]);
      v_frames[v_depth]:=null;v_depth:=v_depth-1;
    end loop;
    exit when v_depth=0;
  end if;
  v_path:=v_path||(v_frames[v_depth]->>v_indices[v_depth]);
  end loop;
  return v_budget;
end;
$function$;
create function private.square_assert_page_json_v1(p_value jsonb)
returns void language plpgsql immutable security invoker set search_path = '' as $function$
begin
  -- Physical JSONB overhead is checked independently before the exact compact
  -- JSON budget; no graph traversal or fingerprint occurs on an oversized root.
  if p_value is null or pg_catalog.pg_column_size(p_value)>134217728 then raise exception using errcode='22023',message='square_page_input_invalid';end if;
  perform private.square_walk_page_json_v1(p_value,array[]::text[],array[7199999,66000,67108864]::bigint[]);
end;
$function$;

create function private.lock_square_page_capacity_v1(p_task private.square_ingestion_tasks)
returns void language plpgsql security invoker set search_path = '' as $function$
declare v_capacity private.square_ingestion_capacity;v_now timestamptz;
begin
  insert into private.square_ingestion_capacity(connection_id,workspace_id,business_entity_id)
    values(p_task.connection_id,p_task.workspace_id,p_task.business_entity_id) on conflict(connection_id) do nothing;
  select * into strict v_capacity from private.square_ingestion_capacity where connection_id=p_task.connection_id for update;
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_qualification_gate_v1();
  if v_capacity.workspace_id<>p_task.workspace_id or v_capacity.business_entity_id<>p_task.business_entity_id
    or p_task.expires_at<=v_now or p_task.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
end;
$function$;

-- Every retained row is charged, including pending + final generic projection,
-- cursor/lease copies, source keys, receipt metadata and retention metadata.
-- Measuring a staged row permits bounded projection duplication: at most twice
-- the validated 7.2m-value/64MiB command plus <10k wrapper values. It is then
-- rejected atomically if the complete retained state exceeds 64MiB/500k.
-- No source, receipt, cursor or checkpoint is evicted to make a page fit.
create function private.account_square_page_row_v1()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare v_capacity private.square_ingestion_capacity;v_new bigint[];v_old bigint[]:=array[14410000,500000,201326592]::bigint[];v_insert integer:=case when tg_op='INSERT' then 1 else 0 end;
begin
  select * into strict v_capacity from private.square_ingestion_capacity where connection_id=new.connection_id for update;
  if v_capacity.workspace_id<>new.workspace_id or v_capacity.business_entity_id<>new.business_entity_id then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  v_new:=private.square_walk_page_json_v1(pg_catalog.to_jsonb(new),array[]::text[],array[14410000,500000,201326592]::bigint[]);
  if tg_op='UPDATE' then
    if old.connection_id<>new.connection_id or old.workspace_id<>new.workspace_id or old.business_entity_id<>new.business_entity_id then raise exception using errcode='42501',message='square_page_scope_denied';end if;
    v_old:=private.square_walk_page_json_v1(pg_catalog.to_jsonb(old),array[]::text[],array[14410000,500000,201326592]::bigint[]);
  end if;
  v_capacity.scans:=v_capacity.scans+case when tg_table_name='square_ingestion_scans' then v_insert else 0 end;
  v_capacity.resources:=v_capacity.resources+case when tg_table_name='square_ingestion_resources' then v_insert else 0 end;
  v_capacity.versions:=v_capacity.versions+case when tg_table_name='square_ingestion_versions' then v_insert else 0 end;
  v_capacity.receipts:=v_capacity.receipts+case when tg_table_name='square_ingestion_page_receipts' then v_insert else 0 end;
  v_capacity.retained_bytes:=v_capacity.retained_bytes+v_old[3]-v_new[3];
  v_capacity.retained_containers:=v_capacity.retained_containers+v_old[2]-v_new[2];
  if v_capacity.scans>32 or v_capacity.resources>10000 or v_capacity.versions>10000 or v_capacity.receipts>3200
    or v_capacity.retained_bytes>67108864 or v_capacity.retained_containers>500000 then raise exception using errcode='54000',message='square_page_capacity_exceeded';end if;
  update private.square_ingestion_capacity set scans=v_capacity.scans,resources=v_capacity.resources,versions=v_capacity.versions,receipts=v_capacity.receipts,
    retained_bytes=v_capacity.retained_bytes,retained_containers=v_capacity.retained_containers where connection_id=new.connection_id;
  return new;
end;
$function$;
create trigger square_scan_capacity after insert or update on private.square_ingestion_scans for each row execute function private.account_square_page_row_v1();
create trigger square_resource_capacity after insert or update on private.square_ingestion_resources for each row execute function private.account_square_page_row_v1();
create trigger square_version_capacity after insert on private.square_ingestion_versions for each row execute function private.account_square_page_row_v1();
create trigger square_receipt_capacity after insert on private.square_ingestion_page_receipts for each row execute function private.account_square_page_row_v1();

-- Nonrecursive canonical token emission. The generic/QBO canonical helper is
-- deliberately unchanged: its recursive child-datum materialization is not
-- used for Square's larger accepted page projections. A frame retains ONLY
-- child keys/ordinals and traversal indexes, never a child JSONB or scalar text.
-- Emit shallow scalar runs immediately, clear the node, then visit child paths.
-- Numeric order paths restore C-key/array order in ONE final aggregation.
-- At most one open/close, one prefix per child container, and one scalar run
-- between adjacent child containers: <=5*C+1 token rows, whose text bytes sum
-- to the single canonical JSON representation. No ancestor token aggregation.
create function private.square_page_canonical_tokens_v1(p_root jsonb)
returns table(sort_path integer[],token text)
language plpgsql stable security invoker set search_path = '' set plan_cache_mode = 'force_generic_plan' as $function$
declare
  v_node jsonb;v_kind text;v_count integer;v_event record;v_children jsonb;
  v_frames jsonb[]:=array[]::jsonb[];v_indices integer[]:=array[]::integer[];
  v_path text[]:=array[]::text[];v_order integer[]:=array[]::integer[];v_depth integer:=0;
  v_next jsonb;v_nodes integer:=0;v_tokens integer:=0;v_bytes bigint:=0;
begin
  -- A fingerprint wrapper can add <=64 containers, <=1,000 values and <=16KiB
  -- to an already validated command subtree; it never deepens that subtree
  -- past command depth64. These are derived wrapper allowances, not new public
  -- acceptance limits. The SQL-only hash boundary checks them independently.
  if p_root is null or pg_catalog.pg_column_size(p_root)>201326592 then raise exception using errcode='22023',message='square_page_input_invalid';end if;
  perform private.square_walk_page_json_v1(p_root,array[]::text[],array[7200999,66064,67125248]::bigint[]);
  loop
    v_node:=p_root#>v_path;v_kind:=pg_catalog.jsonb_typeof(v_node);v_children:='[]'::jsonb;
    if v_kind not in ('object','array') then
      sort_path:=v_order||0;token:=v_node::text;v_tokens:=v_tokens+1;v_bytes:=v_bytes+pg_catalog.octet_length(token);return next;
    else
      v_nodes:=v_nodes+1;
      sort_path:=v_order||0;token:=case when v_kind='object' then '{' else '[' end;
      v_tokens:=v_tokens+1;v_bytes:=v_bytes+1;return next;
      -- The shallow materialized rows live only until this query completes;
      -- no descendant is processed while it or v_node remains retained.
      for v_event in
        with children as materialized (
          select key,value,pg_catalog.row_number() over(order by key collate "C")::integer as position
          from pg_catalog.jsonb_each(case when v_kind='object' then v_node else '{}'::jsonb end)
          union all select (ordinality-1)::text,value,ordinality::integer
          from pg_catalog.jsonb_array_elements(case when v_kind='array' then v_node else '[]'::jsonb end) with ordinality
        ), marked as materialized (
          select *,pg_catalog.jsonb_typeof(value) in ('object','array') as container,
            case when position>1 then ',' else '' end||case when v_kind='object' then pg_catalog.to_jsonb(key)::text||':' else '' end as prefix
          from children
        ), grouped as (
          select *,pg_catalog.count(*) filter(where container) over(order by position) as segment from marked
        )
        select 0 as kind,0 as position,null::text as chunk,
          coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(key,position) order by position) filter(where container),'[]'::jsonb) as descendants,
          count(*)::integer as child_count from marked
        union all select 1,min(position),pg_catalog.string_agg(prefix||value::text,'' order by position),null::jsonb,null::integer
          from grouped where not container group by segment
        union all select 1,position,prefix,null::jsonb,null::integer from marked where container
        order by kind,position
      loop
        if v_event.kind=0 then v_children:=v_event.descendants;v_count:=v_event.child_count;
        elsif v_event.chunk<>'' then
          sort_path:=v_order||array[v_event.position,0];token:=v_event.chunk;
          v_tokens:=v_tokens+1;v_bytes:=v_bytes+pg_catalog.octet_length(token);return next;
        end if;
      end loop;
      sort_path:=v_order||(v_count+1);token:=case when v_kind='object' then '}' else ']' end;
      v_tokens:=v_tokens+1;v_bytes:=v_bytes+1;return next;
    end if;
    v_node:=null;v_event:=null;
    if v_tokens>330321 or v_bytes>67125248 or v_nodes>66064 then raise exception using errcode='22023',message='square_page_input_invalid';end if;
    if pg_catalog.jsonb_array_length(v_children)>0 then
      v_depth:=v_depth+1;v_frames[v_depth]:=v_children;v_indices[v_depth]:=0;
    else
      loop
        exit when v_depth=0;
        v_indices[v_depth]:=v_indices[v_depth]+1;
        v_path:=v_path[1:pg_catalog.cardinality(v_path)-1];v_order:=v_order[1:pg_catalog.cardinality(v_order)-2];
        exit when v_indices[v_depth]<pg_catalog.jsonb_array_length(v_frames[v_depth]);
        v_frames[v_depth]:=null;v_depth:=v_depth-1;
      end loop;
      exit when v_depth=0;
    end if;
    v_next:=v_frames[v_depth]->v_indices[v_depth];
    v_path:=v_path||(v_next->>0);v_order:=v_order||array[(v_next->>1)::integer,1];
  end loop;
end;
$function$;
create function private.square_page_hash_v1(p_value jsonb)
returns text language sql stable strict security invoker set search_path = '' set plan_cache_mode = 'force_generic_plan' as $function$
  select 'sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.string_agg(token,'' order by sort_path),'UTF8'),'sha256'),'hex')
  from private.square_page_canonical_tokens_v1(p_value);
$function$;
create function private.square_page_ms_v1(p_time timestamptz)
returns bigint language sql immutable strict security invoker set search_path = '' as $function$
  select pg_catalog.floor(extract(epoch from p_time)*1000)::bigint;
$function$;
create function private.square_page_completeness_v1(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $function$
  select coalesce(private.jsonb_has_exact_keys_v1(p_value,array['pageSequence','historical','economic','reasons'])
    and p_value->>'pageSequence' in ('partial','finished','blocked') and p_value->>'historical'='unknown' and p_value->>'economic'='blocked'
    and pg_catalog.jsonb_typeof(p_value->'reasons')='array'
    and not exists(select 1 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_value->'reasons')='array' then p_value->'reasons' else '[]'::jsonb end) as reason(value)
      where pg_catalog.jsonb_typeof(reason.value)<>'string' or reason.value #>> '{}' not in ('partial_page_sequence','history_unknown','economic_fields_omitted','references_unresolved','returns_unknown','eventual_consistency','overlapping_representations','inventory_optional','unsupported_page','interrupted_scan','unordered_provider_revision'))
    and (select count(*)=count(distinct value) and count(*)<=11 from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_value->'reasons')='array' then p_value->'reasons' else '[]'::jsonb end)),false);
$function$;
create function private.square_page_cursor_v1(p_value jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $function$
  select coalesce(p_value='null'::jsonb or private.jsonb_has_exact_keys_v1(p_value,array['value','responseFingerprint','expiresAt'])
    and pg_catalog.jsonb_typeof(p_value->'value')='string' and pg_catalog.char_length(p_value->>'value') between 1 and 4096
    and p_value->>'value' ~ '^[A-Za-z0-9._~:+-]+={0,2}$' and private.is_sha256_fingerprint_v1(p_value->>'responseFingerprint')
    and pg_catalog.jsonb_typeof(p_value->'expiresAt')='number' and p_value->>'expiresAt' ~ '^[0-9]{1,16}$'
    and (p_value->>'expiresAt')::numeric<=9007199254740991,false);
$function$;
create function private.square_page_limitations_v1(p_prior jsonb,p_page jsonb,p_blocked boolean,p_unordered boolean default false)
returns jsonb language sql immutable security invoker set search_path = '' as $function$
  select pg_catalog.jsonb_build_object('pageSequence',case when p_blocked then 'blocked' else coalesce(p_page->>'pageSequence','partial') end,'historical','unknown','economic','blocked',
    'reasons',(select coalesce(pg_catalog.jsonb_agg(reason order by reason),'[]'::jsonb) from (
      select distinct reason from (
        select value #>> '{}' as reason from pg_catalog.jsonb_array_elements(coalesce(p_prior->'reasons','[]'::jsonb)) where value<>'"partial_page_sequence"'::jsonb
        union all select value #>> '{}' from pg_catalog.jsonb_array_elements(coalesce(p_page->'reasons','[]'::jsonb))
        union all select 'history_unknown'
        union all select 'partial_page_sequence' where p_blocked or p_page is null
        union all select 'interrupted_scan' where p_blocked or p_page is null
        union all select 'unordered_provider_revision' where p_unordered
      ) as all_reasons
    ) as reasons));
$function$;
create function private.square_page_result_v1(p_outcome text,p_scan private.square_ingestion_scans,p_now timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select case when p_outcome in ('committed','replayed','conflict_commit') then
    pg_catalog.jsonb_build_object('outcome',case when p_outcome='conflict_commit' then 'conflict' else p_outcome end,
      'completeness',p_scan.completeness,'continuation',coalesce(p_outcome<>'conflict_commit' and p_scan.status='ready' and p_scan.cursor is not null and (p_scan.cursor->>'expiresAt')::bigint>private.square_page_ms_v1(p_now),false))
  else pg_catalog.jsonb_build_object('outcome',p_outcome,'completeness',p_scan.completeness,'retryAfterMs',case when p_outcome='deferred' then greatest(0,least(60000,private.square_page_ms_v1(p_scan.not_before)-private.square_page_ms_v1(p_now))) else null end) end;
$function$;

create function private.square_pending_source_v1(p_pending jsonb,p_scope jsonb,p_stream text)
returns void language plpgsql immutable security invoker set search_path = '' as $function$
declare v_resource text; v_revision jsonb; v_projection jsonb;
begin
  if not coalesce(private.jsonb_has_exact_keys_v1(p_pending,array['resourceKey','versionKey','scope','stream','providerRecordId','providerRecordType','providerRevision','observedAt','deleted','projection'])
    and p_pending->'scope'=p_scope and p_pending->>'stream'=p_stream
    and p_pending->>'providerRecordId' ~ '^[A-Za-z0-9._:-]{1,255}$'
    and pg_catalog.jsonb_typeof(p_pending->'deleted')='boolean'
    and pg_catalog.jsonb_typeof(p_pending->'observedAt')='string' and pg_catalog.char_length(p_pending->>'observedAt')<=35
    and p_pending->>'observedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
    and private.jsonb_has_exact_keys_v1(p_pending->'providerRevision',array['version','updatedAt']),false) then
    raise exception using errcode='22023',message='square_pending_source_invalid';
  end if;
  perform (p_pending->>'observedAt')::timestamptz;
  v_revision:=p_pending->'providerRevision';v_projection:=p_pending->'projection';
  if not coalesce((v_revision->'version'='null'::jsonb or pg_catalog.jsonb_typeof(v_revision->'version')='string' and v_revision->>'version' ~ '^-?(0|[1-9][0-9]{0,15})$' and v_revision->>'version'<>'-0')
    and (v_revision->'updatedAt'='null'::jsonb or pg_catalog.jsonb_typeof(v_revision->'updatedAt')='string' and pg_catalog.char_length(v_revision->>'updatedAt')<=35
      and v_revision->>'updatedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$')
    and ((p_pending->>'deleted')::boolean=(v_projection='null'::jsonb))
    and (not (p_pending->>'deleted')::boolean or p_stream='catalog')
    and case p_stream
      when 'order_core' then p_pending->>'providerRecordType'='square_order_core'
      when 'order_line_items' then p_pending->>'providerRecordType'='square_order_line_items'
      when 'order_adjustments' then p_pending->>'providerRecordType'='square_order_adjustments'
      when 'order_tenders' then p_pending->>'providerRecordType'='square_order_tenders'
      when 'payments' then p_pending->>'providerRecordType'='square_payment'
      when 'refunds' then p_pending->>'providerRecordType'='square_refund'
      when 'inventory' then p_pending->>'providerRecordType' in ('square_inventory_count_snapshot','square_inventory_adjustment','square_inventory_physical_count')
      when 'catalog' then p_pending->>'providerRecordType' ~ '^square_catalog_(primary|related|included)_(item|item_variation|category|tax|discount|modifier|modifier_list)$'
      else false end,false) then raise exception using errcode='22023',message='square_pending_source_invalid';end if;
  if v_revision->>'updatedAt' is not null then perform (v_revision->>'updatedAt')::timestamptz;end if;
  if v_projection<>'null'::jsonb and not coalesce(private.jsonb_has_exact_keys_v1(v_projection,array['mappingVersion','stream','role','authority','data'])
    and v_projection->>'mappingVersion'='square_pending_source_mapping_v1' and v_projection->>'stream'=p_stream
    and v_projection->>'authority'='pending_provider_observation_not_economic_authority'
    and v_projection->>'role' in ('primary','related','included') and pg_catalog.jsonb_typeof(v_projection->'data')='object'
    and (p_stream='catalog' or v_projection->>'role'='primary')
    and (p_stream<>'catalog' or p_pending->>'providerRecordType'='square_catalog_'||(v_projection->>'role')||'_'||pg_catalog.lower(v_projection#>>'{data,catalogObjectType}')
      and v_projection#>>'{data,id}'=p_pending->>'providerRecordId' and v_projection#>'{data,isDeleted}'='false'::jsonb),false) then
    raise exception using errcode='22023',message='square_pending_source_invalid';
  end if;
  v_resource:=private.square_page_hash_v1(pg_catalog.jsonb_build_object('purpose','square_source_resource_identity_v1','scope',p_scope-array['authorizedLocationIds','generation'],'stream',p_stream,'providerRecordType',p_pending->'providerRecordType','providerRecordId',p_pending->'providerRecordId'));
  if v_resource is distinct from p_pending->>'resourceKey' or private.square_page_hash_v1(pg_catalog.jsonb_build_object('purpose','square_source_observed_version_v1','mappingVersion','square_pending_source_mapping_v1','resourceKey',v_resource,'providerRevision',v_revision,'deleted',p_pending->'deleted','projection',v_projection)) is distinct from p_pending->>'versionKey' then
    raise exception using errcode='22023',message='square_pending_source_invalid';
  end if;
  if v_projection<>'null'::jsonb then perform private.square_pending_authority_v1(p_pending,p_scope,p_stream);end if;
end;
$function$;

-- Integrity hashes are NOT authorization. Check primary identities/locations
-- and every claimed tenant/connection/provider scope independently. Catalog
-- applicability lists and unresolved related IDs deliberately grant no scope.
create function private.square_pending_authority_v1(p_pending jsonb,p_scope jsonb,p_stream text)
returns void language plpgsql immutable security invoker set search_path = '' as $function$
declare v_data jsonb:=p_pending#>'{projection,data}';v_core jsonb;v_authority jsonb;v_location text;
begin
  v_core:=case p_stream when 'order_line_items' then v_data->'core' when 'order_adjustments' then v_data#>'{lineItemDetail,core}'
    when 'order_tenders' then v_data#>'{adjustmentDetail,lineItemDetail,core}' else v_data end;
  v_authority:=v_core->'authority';
  if pg_catalog.jsonb_typeof(v_core) is distinct from 'object' or pg_catalog.jsonb_typeof(v_authority) is distinct from 'object'
    or v_authority->>'providerKey' is distinct from 'square' or v_authority->>'providerEnvironment' is distinct from p_scope->>'environment'
    or v_core#>>'{provider,providerKey}' is distinct from 'square' or v_core#>>'{provider,providerEnvironment}' is distinct from p_scope->>'environment'
    or v_core#>>'{provider,apiVersion}' is distinct from '2026-08-19' then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  if p_stream<>'catalog' and (v_authority->>'connectionId' is distinct from p_scope->>'connectionId' or v_authority->>'providerEntityId' is distinct from p_scope->>'sellerId'
    or v_authority->>'providerEntityType' is distinct from 'merchant'
    or (p_stream in ('payments','refunds','inventory') and v_authority->>'workspaceId' is distinct from p_scope->>'workspaceId')) then
    raise exception using errcode='42501',message='square_page_scope_denied';end if;
  if p_stream='inventory' and v_core->>'entityType'='inventory_count_snapshot' then
    if v_authority->>'snapshotIdentityFingerprint' is distinct from p_pending->>'providerRecordId' then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  elsif v_core->>'id' is distinct from p_pending->>'providerRecordId' or v_authority->>'providerId' is distinct from v_core->>'id' then
    raise exception using errcode='42501',message='square_page_scope_denied';
  end if;
  if p_stream<>'catalog' then
    foreach v_location in array array['locationId','fromLocationId','toLocationId'] loop
      if v_core ? v_location and v_core->>v_location is not null and not (p_scope->'authorizedLocationIds') ? (v_core->>v_location) then raise exception using errcode='42501',message='square_page_scope_denied';end if;
      if v_authority ? v_location and v_authority->v_location is distinct from v_core->v_location then raise exception using errcode='42501',message='square_page_scope_denied';end if;
    end loop;
  end if;
  if p_stream like 'order_%' and (v_core->>'entityType' is distinct from 'order_core' or v_core->>'locationId' is null
    or v_core->'providerVersion' is distinct from p_pending#>'{providerRevision,version}' or v_core->'updatedAt' is distinct from p_pending#>'{providerRevision,updatedAt}') then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  if p_stream='catalog' and (v_core->'catalogVersion' is distinct from p_pending#>'{providerRevision,version}' or v_core->'updatedAt' is distinct from p_pending#>'{providerRevision,updatedAt}') then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  if p_stream in ('payments','refunds') and (p_pending#>'{providerRevision,version}' is distinct from 'null'::jsonb or v_core->'updatedAt' is distinct from p_pending#>'{providerRevision,updatedAt}') then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  if p_stream='inventory' and (p_pending#>'{providerRevision,version}' is distinct from 'null'::jsonb or
    case when v_core->>'entityType'='inventory_count_snapshot' then v_core->'calculatedAt' else 'null'::jsonb end is distinct from p_pending#>'{providerRevision,updatedAt}'
    or exists(select 1 from pg_catalog.jsonb_array_elements(pg_catalog.jsonb_build_array(v_core->'state',v_core->'fromState',v_core->'toState',v_core#>'{adjustmentGroup,fromState}',v_core#>'{adjustmentGroup,toState}')) as state(value) where value='"SUPPORTED_BY_NEWER_VERSION"'::jsonb)) then raise exception using errcode='42501',message='square_page_scope_denied';end if;
  perform private.square_walk_page_json_v1(v_data,array[]::text[],array[7199999,66000,67108864]::bigint[],p_scope,
    case when p_stream like 'order_%' then v_core->>'id' else null end,case when p_stream like 'order_%' then v_core->>'locationId' else null end);
end;
$function$;

-- Compare whole UTC seconds and the ORIGINAL fractional digits separately.
-- Casting an entire nanosecond timestamp to timestamptz would lose ordering.
create function private.square_revision_order_v1(p_prior jsonb,p_next jsonb)
returns text language plpgsql immutable security invoker set search_path = '' as $function$
declare a text[]; b text[]; seconds_a timestamptz; seconds_b timestamptz; fraction_a text; fraction_b text; width integer;
begin
  if p_prior->>'version' is not null and p_next->>'version' is not null then
    return case when (p_next->>'version')::numeric=(p_prior->>'version')::numeric then 'conflict' when (p_next->>'version')::numeric>(p_prior->>'version')::numeric then 'newer' else 'older' end;
  end if;
  if p_prior->>'version' is not null or p_next->>'version' is not null or p_prior->>'updatedAt' is null or p_next->>'updatedAt' is null then return 'unordered';end if;
  a:=pg_catalog.regexp_match(p_prior->>'updatedAt','^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$');
  b:=pg_catalog.regexp_match(p_next->>'updatedAt','^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$');
  if a is null or b is null then raise exception using errcode='22023',message='square_revision_invalid';end if;
  seconds_a:=(a[1]||a[3])::timestamptz;seconds_b:=(b[1]||b[3])::timestamptz;
  if seconds_a<>seconds_b then return case when seconds_b>seconds_a then 'newer' else 'older' end;end if;
  width:=greatest(pg_catalog.length(coalesce(a[2],'')),pg_catalog.length(coalesce(b[2],'')));
  fraction_a:=pg_catalog.rpad(coalesce(a[2],''),width,'0');fraction_b:=pg_catalog.rpad(coalesce(b[2],''),width,'0');
  return case when fraction_a=fraction_b then 'conflict' when fraction_b collate "C">fraction_a collate "C" then 'newer' else 'older' end;
end;
$function$;

create function private.square_materialize_source_v1(p_pending jsonb,p_ordinal bigint,p_prior_id uuid)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $function$
declare v_hex text:=pg_catalog.substr(p_pending->>'versionKey',8);v_version jsonb;v_payload jsonb;
begin
  v_version:=pg_catalog.jsonb_build_object('contractVersion','external_source_record_version_v1',
    'id',(pg_catalog.substr(v_hex,1,8)||'-'||pg_catalog.substr(v_hex,9,4)||'-5'||pg_catalog.substr(v_hex,14,3)||'-8'||pg_catalog.substr(v_hex,18,3)||'-'||pg_catalog.substr(v_hex,21,12))::uuid,
    'workspaceId',p_pending#>'{scope,workspaceId}','businessEntityId',p_pending#>'{scope,businessEntityId}','connectionId',p_pending#>'{scope,connectionId}',
    'immutableVersion',p_ordinal,'priorVersionId',p_prior_id,'recordKind',p_pending->'providerRecordType',
    'source',pg_catalog.jsonb_build_object('kind','provider','providerKey','square','providerRecordType',p_pending->'providerRecordType','providerRecordId',p_pending->'resourceKey','providerVersionReference',case when p_pending#>>'{providerRevision,version}' is null then null else 'square_version/'||(p_pending#>>'{providerRevision,version}') end),
    'temporal',pg_catalog.jsonb_build_object('basis','point_in_time','providerCreatedAt',null,'providerUpdatedAt',p_pending#>'{providerRevision,updatedAt}',
      'observedAt',p_pending->'observedAt','synchronizedAt',p_pending->'observedAt','ingestedAt',p_pending->'observedAt','effectiveAt',null,'postingDate',null,'periodStart',null,'periodEnd',null,'sourceTimeZone',null),
    'accounting',pg_catalog.jsonb_build_object('basis','unknown','currency',null),'normalizedSchemaVersion','square_pending_source_mapping_v1',
    'changeKind',case when (p_pending->>'deleted')::boolean then 'deleted' when p_ordinal=1 then 'created' else 'updated' end,
    'normalizedProjection',p_pending->'projection','trust','untrusted_external_input',
    'validation',pg_catalog.jsonb_build_object('state','pending','validatorVersion','square_pending_source_mapping_v1','issues','[]'::jsonb),'receivedAt',p_pending->'observedAt');
  v_payload:=v_version-array['id','immutableVersion','priorVersionId','validation','receivedAt'];
  v_payload:=pg_catalog.jsonb_set(v_payload,'{temporal}',(v_payload->'temporal')-array['synchronizedAt','ingestedAt']);
  v_version:=v_version||pg_catalog.jsonb_build_object('sourceFingerprint',private.square_page_hash_v1(pg_catalog.jsonb_build_object('fingerprintPurpose','external_source_record','fingerprintVersion','external_integration_fingerprint_v1','payload',v_payload)));
  perform private.validate_source_version_payload_v1(v_version);
  return v_version;
end;
$function$;

create function public.acquire_square_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_binding jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;v_now timestamptz;v_lease jsonb;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  v_now:=pg_catalog.clock_timestamp();
  perform private.square_assert_page_json_v1(p_binding);
  if p_binding is distinct from v_task.binding then return private.square_page_result_v1('conflict',v_scan,v_now);end if;
  perform private.lock_square_page_capacity_v1(v_task);
  insert into private.square_ingestion_scans(scan_key,workspace_id,business_entity_id,connection_id,connection_generation,initial_task_id,binding,stream,status,not_before,retention_policy_version,retention_expires_at,created_at,updated_at)
    values(p_binding->>'scanKey',v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,v_task.connection_generation,v_task.task_id,p_binding,v_task.grant->>'stream','ready',v_now,v_task.retention_policy_version,v_task.retention_expires_at,v_now,v_now)
    on conflict(scan_key) do nothing;
  select * into strict v_scan from private.square_ingestion_scans where scan_key=p_binding->>'scanKey' for update;
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_qualification_gate_v1();
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  if v_scan.binding<>p_binding or v_scan.workspace_id<>v_task.workspace_id or v_scan.business_entity_id<>v_task.business_entity_id or v_scan.connection_id<>v_task.connection_id or v_scan.stream<>v_task.grant->>'stream' then return private.square_page_result_v1('conflict',v_scan,v_now);end if;
  if v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_retention_expired';end if;
  if v_scan.status in ('finished','blocked','expired') then return private.square_page_result_v1(v_scan.status,v_scan,v_now);end if;
  if v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) then
    update private.square_ingestion_scans set status='expired',lease=null,lease_task_id=null,updated_at=v_now,completeness=private.square_page_limitations_v1(completeness,null,true) where scan_key=v_scan.scan_key returning * into v_scan;
    return private.square_page_result_v1('expired',v_scan,v_now);
  end if;
  if v_scan.lease is not null and (v_scan.lease->>'expiresAt')::bigint>private.square_page_ms_v1(v_now) then return private.square_page_result_v1('conflict',v_scan,v_now);end if;
  if v_scan.not_before>v_now then return private.square_page_result_v1('deferred',v_scan,v_now);end if;
  if v_scan.attempt>=3 or v_scan.checkpoint_version>=100 then
    update private.square_ingestion_scans set status='blocked',lease=null,lease_task_id=null,updated_at=v_now,completeness=private.square_page_limitations_v1(completeness,null,true) where scan_key=v_scan.scan_key returning * into v_scan;
    return private.square_page_result_v1('blocked',v_scan,v_now);
  end if;
  v_lease:=pg_catalog.jsonb_build_object('binding',p_binding,'leaseId',private.square_page_hash_v1(pg_catalog.jsonb_build_object('purpose','square_durable_page_lease_v1','taskId',p_task_id,'owner',p_lease_owner_fingerprint,'binding',p_binding,'checkpoint',v_scan.checkpoint_version,'serial',v_scan.lease_serial+1)),
    'expiresAt',least(private.square_page_ms_v1(v_now)+30000,private.square_page_ms_v1(v_task.expires_at),private.square_page_ms_v1(v_task.retention_expires_at)),
    'checkpointVersion',v_scan.checkpoint_version,'cursor',v_scan.cursor,'attempt',v_scan.attempt+1,'pageNumber',v_scan.checkpoint_version+1);
  update private.square_ingestion_scans set status='leased',lease=v_lease,lease_task_id=p_task_id,lease_serial=lease_serial+1,attempt=attempt+1,updated_at=v_now where scan_key=v_scan.scan_key;
  return pg_catalog.jsonb_build_object('outcome','leased','lease',v_lease);
exception when sqlstate '54000' then
  return pg_catalog.jsonb_build_object('outcome','blocked','completeness',null,'retryAfterMs',null);
end;
$function$;

create function public.commit_square_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;v_resource private.square_ingestion_resources;
  v_prior private.square_ingestion_versions;v_existing private.square_ingestion_versions;v_receipt private.square_ingestion_page_receipts;
  v_now timestamptz;v_command_hash text;v_pending jsonb;v_version jsonb;v_ordering text;v_unordered boolean:=false;v_limited boolean;v_next jsonb;v_sources jsonb;v_completion jsonb;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  v_now:=pg_catalog.clock_timestamp();
  perform private.square_assert_page_json_v1(p_command);
  if not coalesce(private.jsonb_has_exact_keys_v1(p_command,array['lease','pageId','sources','completeness','nextCursor','now'])
    and private.is_sha256_fingerprint_v1(p_command->>'pageId') and pg_catalog.jsonb_typeof(p_command->'sources')='array'
    and p_command#>'{lease,binding}'=v_task.binding and private.square_page_completeness_v1(p_command->'completeness') and private.square_page_cursor_v1(p_command->'nextCursor'),false) then
    return private.square_page_result_v1('conflict_commit',v_scan,v_now);
  end if;
  v_sources:=p_command->'sources';v_next:=nullif(p_command->'nextCursor','null'::jsonb);v_completion:=p_command->'completeness';
  if pg_catalog.jsonb_array_length(v_sources)>(case when v_task.grant->>'stream' in ('payments','refunds') then 100 when v_task.grant->>'stream'='catalog' then 3000 else 1000 end) then
    return private.square_page_result_v1('conflict_commit',v_scan,v_now);
  end if;
  perform private.lock_square_page_capacity_v1(v_task);
  select * into v_scan from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;
  perform private.assert_square_qualification_gate_v1();
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  if v_scan.binding<>v_task.binding or v_scan.stream<>v_task.grant->>'stream' then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;
  for v_pending in select value from pg_catalog.jsonb_array_elements(v_sources) loop
    perform private.square_pending_source_v1(v_pending,v_task.grant->'scope',v_scan.stream);
  end loop;
  v_command_hash:=private.square_page_hash_v1(pg_catalog.jsonb_build_object('purpose','square_durable_atomic_page_v1','lease',p_command->'lease','pageId',p_command->'pageId',
    'versionKeys',(select coalesce(pg_catalog.jsonb_agg(key order by key),'[]'::jsonb) from (select distinct value->>'versionKey' as key from pg_catalog.jsonb_array_elements(v_sources)) as keys),
    'completeness',v_completion,'nextCursor',v_next));
  -- Validation/hash work is bounded but still consumes time. Receipt recovery
  -- remains permitted after an old lease expires, never after task/retention
  -- authority expires; it observes the current durable checkpoint only.
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_qualification_gate_v1();
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  select * into v_receipt from private.square_ingestion_page_receipts where scan_key=v_scan.scan_key and page_id=p_command->>'pageId';
  if found then return private.square_page_result_v1(case when v_receipt.command_fingerprint=v_command_hash then 'replayed' else 'conflict_commit' end,v_scan,v_now);end if;
  if v_scan.status<>'leased' or v_scan.lease is distinct from p_command->'lease' or v_scan.lease_task_id is distinct from p_task_id
    or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
    or (v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now))
    or v_scan.checkpoint_version>=100 or v_completion->>'pageSequence'='blocked'
    or ((v_next is null)<>(v_completion->>'pageSequence'='finished')) then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;
  if v_next is not null and ((v_next->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
    or (v_next->>'expiresAt')::bigint>least(private.square_page_ms_v1(v_now)+3600000,private.square_page_ms_v1(v_task.expires_at),private.square_page_ms_v1(v_task.retention_expires_at))
    or v_next->>'value'=v_scan.cursor->>'value') then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;

  -- Stable lock order: connection, task, capacity, scan, sorted resources.
  -- The database assigns ordinals and final fingerprints; caller observations
  -- cannot choose a prior version or overwrite a current provider candidate.
  begin
  for v_pending in select value from pg_catalog.jsonb_array_elements(v_sources) order by value->>'resourceKey',value->>'versionKey' loop
    insert into private.square_ingestion_resources(resource_key,workspace_id,business_entity_id,connection_id,stream,provider_record_type,provider_record_id)
      values(v_pending->>'resourceKey',v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,v_scan.stream,v_pending->>'providerRecordType',v_pending->>'providerRecordId') on conflict(resource_key) do nothing;
    select * into strict v_resource from private.square_ingestion_resources where resource_key=v_pending->>'resourceKey' for update;
    if v_resource.workspace_id<>v_task.workspace_id or v_resource.business_entity_id<>v_task.business_entity_id or v_resource.connection_id<>v_task.connection_id or v_resource.stream<>v_scan.stream
      or v_resource.provider_record_type<>v_pending->>'providerRecordType' or v_resource.provider_record_id<>v_pending->>'providerRecordId' then raise exception using errcode='42501',message='square_page_scope_denied';end if;
    select * into v_existing from private.square_ingestion_versions where version_key=v_pending->>'versionKey';
    if found then
      if v_existing.resource_key<>v_resource.resource_key then raise exception using errcode='23505',message='square_page_identity_conflict';end if;
      continue;
    end if;
    select * into v_prior from private.square_ingestion_versions where version_key=v_resource.current_version_key;
    v_ordering:=case when v_resource.current_version_key is null then 'newer' else private.square_revision_order_v1(v_prior.pending->'providerRevision',v_pending->'providerRevision') end;
    v_unordered:=v_unordered or v_ordering in ('conflict','unordered');
    select * into v_prior from private.square_ingestion_versions where version_key=v_resource.observed_version_key;
    v_version:=private.square_materialize_source_v1(v_pending,v_resource.version_count+1,v_prior.version_id);
    insert into private.square_ingestion_versions(version_key,resource_key,workspace_id,business_entity_id,connection_id,ordinal,version_id,prior_version_id,pending,version,ordering,retention_policy_version,retention_expires_at,created_at)
      values(v_pending->>'versionKey',v_resource.resource_key,v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,v_resource.version_count+1,(v_version->>'id')::uuid,v_prior.version_id,v_pending,v_version,v_ordering,v_task.retention_policy_version,v_task.retention_expires_at,v_now);
    update private.square_ingestion_resources set observed_version_key=v_pending->>'versionKey',current_version_key=case when v_ordering='newer' then v_pending->>'versionKey' else current_version_key end,version_count=version_count+1 where resource_key=v_resource.resource_key;
  end loop;
  -- A task/lease expiring while waiting on another resource cannot publish.
  -- Any earlier per-source INSERT is rolled back by this exception as well.
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_qualification_gate_v1();
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
    or (v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now))
    or (v_next is not null and (v_next->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)) then raise exception using errcode='40001',message='square_page_lease_expired';end if;
  v_limited:=v_next is not null and v_scan.checkpoint_version+1>=100;
  insert into private.square_ingestion_page_receipts(scan_key,page_id,workspace_id,business_entity_id,connection_id,task_id,command_fingerprint,checkpoint_version,retention_policy_version,retention_expires_at,created_at)
    values(v_scan.scan_key,p_command->>'pageId',v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,p_task_id,v_command_hash,v_scan.checkpoint_version+1,v_task.retention_policy_version,v_task.retention_expires_at,v_now);
  update private.square_ingestion_scans set checkpoint_version=checkpoint_version+1,cursor=v_next,lease=null,lease_task_id=null,attempt=0,not_before=v_now,updated_at=v_now,
    completeness=private.square_page_limitations_v1(completeness,v_completion,v_limited,v_unordered),status=case when v_next is null then 'finished' when v_limited then 'blocked' else 'ready' end
    where scan_key=v_scan.scan_key returning * into v_scan;
  return private.square_page_result_v1('committed',v_scan,v_now);
  exception when sqlstate '54000' then
    -- The subtransaction rolls back ALL staged source/resource/receipt/counter
    -- changes. Only an incomplete blocked scan is published, never a checkpoint.
    -- Clearing the lease removes >=2 containers and more bytes than the bounded
    -- two-container limitation object can add, so this transition still fits.
    v_now:=pg_catalog.clock_timestamp();
    perform private.assert_square_qualification_gate_v1();
    if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
      or v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) then raise exception using errcode='40001',message='square_page_lease_expired';end if;
    update private.square_ingestion_scans set status='blocked',lease=null,lease_task_id=null,updated_at=v_now,
      completeness=private.square_page_limitations_v1(completeness,null,true) where scan_key=v_scan.scan_key returning * into v_scan;
    return private.square_page_result_v1('conflict_commit',v_scan,v_now);
  end;
end;
$function$;

create function public.release_square_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_lease jsonb,p_release jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;v_now timestamptz;v_blocked boolean;v_delay bigint;v_completion jsonb;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  perform private.square_assert_page_json_v1(p_lease);perform private.square_assert_page_json_v1(p_release);
  if not coalesce(private.jsonb_has_exact_keys_v1(p_release-array['completeness'],array['now','retryAfterMs','blocked'])
    and pg_catalog.jsonb_typeof(p_release->'blocked')='boolean'
    and (p_release->'retryAfterMs'='null'::jsonb or p_release->>'retryAfterMs' ~ '^[0-9]{1,16}$')
    and (not p_release?'completeness' or private.square_page_completeness_v1(p_release->'completeness')) and p_lease->'binding'=v_task.binding,false) then return 'null'::jsonb;end if;
  perform private.lock_square_page_capacity_v1(v_task);
  select * into v_scan from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return 'null'::jsonb;end if;
  perform private.assert_square_qualification_gate_v1();
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  if v_scan.status<>'leased' or v_scan.binding<>v_task.binding or v_scan.lease is distinct from p_lease or v_scan.lease_task_id is distinct from p_task_id
    or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) or v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) then return 'null'::jsonb;end if;
  v_blocked:=(p_release->>'blocked')::boolean or v_scan.attempt>=3;
  v_delay:=least(60000,coalesce((p_release->>'retryAfterMs')::bigint,1000*(2^(v_scan.attempt-1))::bigint));
  v_completion:=private.square_page_limitations_v1(v_scan.completeness,p_release->'completeness',v_blocked);
  v_completion:=private.square_page_limitations_v1(v_completion,null,v_blocked);
  update private.square_ingestion_scans set status=case when v_blocked then 'blocked' else 'ready' end,lease=null,lease_task_id=null,not_before=v_now+v_delay*interval '1 millisecond',updated_at=v_now,completeness=v_completion where scan_key=v_scan.scan_key;
  return 'null'::jsonb;
end;
$function$;

-- No direct reads, status views, registration changes, public enrollment, purge
-- functions or automatic retention duration. Cursor plaintext remains private
-- exactly as in existing checkpoint conventions; this is not encryption.
do $function_grants$
declare v_function record;
begin
  for v_function in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('square_utf16_length_v1','square_walk_page_json_v1','square_assert_page_json_v1','lock_square_page_capacity_v1','account_square_page_row_v1','square_page_canonical_tokens_v1','square_page_hash_v1','square_page_ms_v1','square_page_completeness_v1','square_page_cursor_v1','square_page_limitations_v1','square_page_result_v1','square_pending_source_v1','square_pending_authority_v1','square_revision_order_v1','square_materialize_source_v1') loop
    execute pg_catalog.format('revoke all on function %s from public,anon,authenticated,service_role,square_ingestion_runtime_authority,square_ingestion_qualification_admin',v_function.signature);
  end loop;
end;
$function_grants$;
revoke all on function public.acquire_square_ingestion_page_v1(uuid,text,jsonb),public.commit_square_ingestion_page_v1(uuid,text,jsonb),public.release_square_ingestion_page_v1(uuid,text,jsonb,jsonb)
  from public,anon,authenticated,service_role,square_ingestion_qualification_admin;
grant execute on function public.acquire_square_ingestion_page_v1(uuid,text,jsonb),public.commit_square_ingestion_page_v1(uuid,text,jsonb),public.release_square_ingestion_page_v1(uuid,text,jsonb,jsonb)
  to square_ingestion_runtime_authority;

commit;
