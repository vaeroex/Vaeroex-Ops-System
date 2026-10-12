begin;

-- Scoped to the authenticated New Issue workflow. Historical issues remain
-- untouched. No issue FK: a retained receipt prevents a deleted issue from
-- being silently recreated by a delayed browser retry.
create table private.issue_submission_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null,
  request_id uuid not null,
  payload_hash bytea not null check(octet_length(payload_hash)=32),
  issue_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,actor_id,request_id)
);
alter table private.issue_submission_receipts enable row level security;
revoke all on private.issue_submission_receipts from public,anon,authenticated,service_role;

create function public.submit_issue_v1(p_workspace_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid()); fingerprint bytea; prior private.issue_submission_receipts;
  issue uuid; person uuid; due date; field text;
begin
  if (select auth.role()) is distinct from 'authenticated' or actor is null
    or p_workspace_id is null or p_request_id is null
    or not exists(select 1 from auth.users u where u.id=actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())) then
    raise exception 'issue_access_denied' using errcode='42501';
  end if;
  -- Match the existing issues INSERT policy. Staff/viewer membership must not
  -- become write permission merely because this function is SECURITY DEFINER.
  perform 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=actor
    and m.status='active' and m.role in ('owner','admin','manager') for share;
  if not found or not public.can_edit_operations(p_workspace_id)
    or not private.workspace_entitlement_active_v1(p_workspace_id) then
    raise exception 'issue_access_denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'issue_payload_invalid' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_payload))<>11 then raise exception 'issue_payload_invalid' using errcode='22023'; end if;
  foreach field in array array['title','description','issue_type','severity','status','root_cause','recommended_fix'] loop
    if jsonb_typeof(p_payload->field) is distinct from 'string' then raise exception 'issue_payload_invalid' using errcode='22023'; end if;
  end loop;
  foreach field in array array['assigned_person_id','assigned_role','assigned_department','due_date'] loop
    if not(p_payload ? field) or jsonb_typeof(p_payload->field) not in ('string','null') then raise exception 'issue_payload_invalid' using errcode='22023'; end if;
  end loop;
  if btrim(p_payload->>'title',E' \t\n\r\f\v')=''
    or private.internal_form_utf16_length_v1(p_payload->>'title')>160
    or private.internal_form_utf16_length_v1(p_payload->>'description')>2000
    or p_payload->>'severity' not in ('Low','Medium','High','Urgent')
    or p_payload->>'status' not in ('Open','Investigating','Waiting','Closed') then
    raise exception 'issue_payload_invalid' using errcode='22023';
  end if;
  begin
    person:=(p_payload->>'assigned_person_id')::uuid;
    due:=(p_payload->>'due_date')::date;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'issue_payload_invalid' using errcode='22023';
  end;
  if due is not null and (not isfinite(due) or to_char(due,'YYYY-MM-DD') is distinct from p_payload->>'due_date') then
    raise exception 'issue_payload_invalid' using errcode='22023';
  end if;
  if person is not null then
    perform 1 from public.people p where p.id=person and p.workspace_id=p_workspace_id and p.archived_at is null and p.deleted_at is null for share;
    if not found then raise exception 'issue_assignee_unavailable' using errcode='42501'; end if;
  end if;
  fingerprint:=sha256(convert_to(p_payload::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('issue_submission:'||p_workspace_id::text||':'||actor::text||':'||p_request_id::text,0));
  select * into prior from private.issue_submission_receipts r where r.workspace_id=p_workspace_id and r.actor_id=actor and r.request_id=p_request_id;
  if found then
    if prior.payload_hash is distinct from fingerprint then raise exception 'issue_request_conflict' using errcode='22023'; end if;
    if not exists(select 1 from public.issues i where i.id=prior.issue_id and i.workspace_id=p_workspace_id) then
      raise exception 'issue_unavailable' using errcode='42501';
    end if;
    return jsonb_build_object('issueId',prior.issue_id,'replayed',true);
  end if;
  insert into public.issues(workspace_id,title,description,issue_type,severity,status,root_cause,recommended_fix,
    assigned_person_id,assigned_role,assigned_department,due_date,created_by)
    values(p_workspace_id,p_payload->>'title',p_payload->>'description',p_payload->>'issue_type',p_payload->>'severity',p_payload->>'status',
      p_payload->>'root_cause',p_payload->>'recommended_fix',person,p_payload->>'assigned_role',p_payload->>'assigned_department',due,actor)
    returning id into issue;
  insert into private.issue_submission_receipts(workspace_id,actor_id,request_id,payload_hash,issue_id)
    values(p_workspace_id,actor,p_request_id,fingerprint,issue);
  return jsonb_build_object('issueId',issue,'replayed',false);
end;
$$;
revoke all on function public.submit_issue_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.submit_issue_v1(uuid,uuid,jsonb) to authenticated;
comment on function public.submit_issue_v1(uuid,uuid,jsonb) is
  'Authenticated manager issue submission with current authorization and entitlement, scoped immutable replay receipt, and atomic issue creation.';
commit;
