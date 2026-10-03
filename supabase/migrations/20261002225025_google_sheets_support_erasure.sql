-- No application principal receives support authority. No live erasure is run.
create role google_sheets_erasure_support nologin noinherit;
grant usage on schema private to google_sheets_erasure_support;

create table private.google_sheets_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  connection_id uuid not null,
  case_id uuid not null unique,
  inventory jsonb not null,
  decisions jsonb not null,
  scope_hash text not null check (scope_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'prepared' check (state in ('prepared','approved','completed','withdrawn')),
  requested_at timestamptz not null default clock_timestamp(),
  approved_by uuid,
  approved_session_id uuid,
  approved_at timestamptz,
  completed_at timestamptz,
  receipt jsonb,
  unique (workspace_id,connection_id)
);
alter table private.google_sheets_erasure_requests enable row level security;
alter table private.google_sheets_erasure_requests force row level security;
revoke all on private.google_sheets_erasure_requests from public,anon,authenticated,service_role,google_sheets_erasure_support;

create function private.google_sheets_erasure_hash_v1(p_value jsonb)
returns text language sql immutable set search_path='' as $function$
  select encode(private.phase_3_contract_fingerprint_v1(p_value),'hex');
$function$;
revoke all on function private.google_sheets_erasure_hash_v1(jsonb) from public,anon,authenticated,service_role,google_sheets_erasure_support;

-- Requester approval is verified with the live signed session, not a support
-- caller's assertion about an email address or caller-supplied tenant identity.
create function public.read_google_sheets_erasure_request_v1(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare r private.google_sheets_erasure_requests; counts jsonb;
begin
  select * into r from private.google_sheets_erasure_requests where id=p_request_id;
  if r.id is null then raise exception 'sheets_erasure_request_denied' using errcode='42501'; end if;
  perform private.require_google_sheets_owner_v1(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid,r.workspace_id,null);
  select coalesce(jsonb_object_agg(t,n),'{}') into counts from (
    select value->>'table' t,count(*) n from jsonb_array_elements(r.inventory->'base') group by 1
  ) totals;
  return jsonb_build_object('requestId',r.id,'workspaceId',r.workspace_id,'connectionId',r.connection_id,
    'state',r.state,'scopeHash',r.scope_hash,'counts',counts,'artifacts',r.decisions);
end;
$function$;

create function public.confirm_google_sheets_erasure_request_v1(p_request_id uuid,p_scope_hash text,p_delete_artifacts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare r private.google_sheets_erasure_requests; expected jsonb; actual jsonb;
begin
  perform public.read_google_sheets_erasure_request_v1(p_request_id);
  select * into r from private.google_sheets_erasure_requests where id=p_request_id for update;
  if r.scope_hash is distinct from p_scope_hash then raise exception 'sheets_erasure_scope_changed'; end if;
  select coalesce(jsonb_agg(value-'action' order by value->>'table',value->>'id'),'[]') into expected
    from jsonb_array_elements(r.decisions) where value->>'action'='delete';
  if jsonb_typeof(p_delete_artifacts) is distinct from 'array' then raise exception 'sheets_erasure_artifact_confirmation_required'; end if;
  select coalesce(jsonb_agg(value order by value->>'table',value->>'id'),'[]') into actual from jsonb_array_elements(p_delete_artifacts);
  if expected is distinct from actual then raise exception 'sheets_erasure_artifact_confirmation_required'; end if;
  if r.state in ('approved','completed') then return jsonb_build_object('state',r.state); end if;
  if r.state<>'prepared' or r.requested_at<clock_timestamp()-interval '7 days' then raise exception 'sheets_erasure_request_expired'; end if;
  update private.google_sheets_erasure_requests set state='approved',approved_by=auth.uid(),
    approved_session_id=(auth.jwt()->>'session_id')::uuid,approved_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('state','approved');
end;
$function$;
revoke all on function public.read_google_sheets_erasure_request_v1(uuid),
  public.confirm_google_sheets_erasure_request_v1(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.read_google_sheets_erasure_request_v1(uuid),
  public.confirm_google_sheets_erasure_request_v1(uuid,text,jsonb) to authenticated;
