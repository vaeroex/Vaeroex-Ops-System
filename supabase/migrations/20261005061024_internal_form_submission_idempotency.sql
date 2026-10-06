begin;

-- VXA-028: only the authenticated internal-form workflow uses these receipts.
-- Historical submissions are unchanged. Keep receipts after a submission is
-- edited/hidden/removed so replay cannot overwrite or recreate reviewed data.
create table private.internal_form_submission_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  payload_hash bytea not null check (octet_length(payload_hash)=32),
  submission_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id,form_id,actor_id,request_id)
);
alter table private.internal_form_submission_receipts enable row level security;
revoke all on private.internal_form_submission_receipts from public,anon,authenticated,service_role;

-- Match JavaScript string length, including supplementary Unicode characters.
create function private.internal_form_utf16_length_v1(p_value text)
returns integer language sql immutable strict set search_path='' as $$
  select char_length(p_value)+char_length(regexp_replace(p_value,U&'[^\+010000-\+10FFFF]','','g'));
$$;
revoke all on function private.internal_form_utf16_length_v1(text) from public,anon,authenticated,service_role;

create function public.submit_internal_form_v1(
  p_workspace_id uuid,p_form_id uuid,p_request_id uuid,
  p_submitter_name text,p_submitter_email text,p_data_json jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  form_schema jsonb; normalized_schema jsonb := '[]'::jsonb;
  field jsonb; field_key text; field_value text; field_keys text[] := '{}';
  total_length integer := 0; year_part integer; month_part integer; day_part integer;
  max_day integer; fingerprint bytea; prior private.internal_form_submission_receipts;
  submission uuid; followups jsonb;
begin
  if (select auth.role()) is distinct from 'authenticated' or actor is null
    or p_workspace_id is null or p_form_id is null or p_request_id is null
    or not exists(select 1 from auth.users u where u.id=actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())) then
    raise exception 'internal_form_access_denied' using errcode='42501';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id=p_workspace_id and m.user_id=actor
    and m.status='active' and m.role in ('owner','admin','manager','staff') for share;
  if not found or not private.workspace_entitlement_active_v1(p_workspace_id) then
    raise exception 'internal_form_access_denied' using errcode='42501';
  end if;
  select f.schema_json into form_schema from public.forms f where f.workspace_id=p_workspace_id and f.id=p_form_id
    and f.archived_at is null and f.deleted_at is null for share;
  if not found then raise exception 'internal_form_unavailable' using errcode='42501'; end if;

  if p_submitter_name is null or btrim(p_submitter_name,E' \t\n\r\f\v')=''
    or private.internal_form_utf16_length_v1(p_submitter_name)>160
    or p_submitter_email is null or private.internal_form_utf16_length_v1(p_submitter_email)>220
    or (p_submitter_email<>'' and p_submitter_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or jsonb_typeof(p_data_json) is distinct from 'object'
    or p_data_json->'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_data_json->'fields') is distinct from 'object'
    or jsonb_typeof(p_data_json->'summary') is distinct from 'string'
    or btrim(p_data_json->>'summary',E' \t\n\r\f\v')=''
    or private.internal_form_utf16_length_v1(p_data_json->>'summary')>3000
    or jsonb_typeof(p_data_json->'priority') is distinct from 'string'
    or p_data_json->>'priority' not in ('Low','Medium','High','Urgent')
    or jsonb_typeof(p_data_json->'follow_up') is distinct from 'string'
    or private.internal_form_utf16_length_v1(p_data_json->>'follow_up')>5000 then
    raise exception 'internal_form_response_invalid' using errcode='22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_data_json))<>6
    or jsonb_typeof(form_schema) is distinct from 'array' then
    raise exception 'internal_form_schema_invalid' using errcode='22023';
  end if;
  if jsonb_array_length(form_schema)>50 then raise exception 'internal_form_schema_invalid' using errcode='22023'; end if;
  for field in select value from jsonb_array_elements(form_schema) loop
    field_key:=field->>'key';
    if jsonb_typeof(field) is distinct from 'object'
      or jsonb_typeof(field->'key') is distinct from 'string'
      or field_key !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$'
      or field_key in ('__proto__','constructor','prototype') or field_key=any(field_keys)
      or jsonb_typeof(field->'label') is distinct from 'string'
      or btrim(field->>'label',E' \t\n\r\f\v')='' or private.internal_form_utf16_length_v1(field->>'label')>120
      or jsonb_typeof(field->'type') is distinct from 'string' or field->>'type' not in ('text','date','priority')
      or jsonb_typeof(field->'required') is distinct from 'boolean' then
      raise exception 'internal_form_schema_invalid' using errcode='22023';
    end if;
    field_keys:=array_append(field_keys,field_key);
    normalized_schema:=normalized_schema||jsonb_build_array(jsonb_build_object('key',field_key,'label',field->>'label','type',field->>'type','required',field->'required'));
    if jsonb_typeof(p_data_json->'fields'->field_key) is distinct from 'string' then
      raise exception 'internal_form_response_invalid' using errcode='22023';
    end if;
    field_value:=p_data_json->'fields'->>field_key;
    if ((field->>'required')::boolean and btrim(field_value,E' \t\n\r\f\v')='')
      or private.internal_form_utf16_length_v1(field_value)>2000
      or (field_value<>'' and field->>'type'='priority' and field_value not in ('Low','Medium','High','Urgent')) then
      raise exception 'internal_form_response_invalid' using errcode='22023';
    end if;
    if field_value<>'' and field->>'type'='date' then
      if field_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'internal_form_response_invalid' using errcode='22023'; end if;
      year_part:=substring(field_value,1,4)::integer; month_part:=substring(field_value,6,2)::integer; day_part:=substring(field_value,9,2)::integer;
      max_day:=case when month_part=2 then case when year_part%400=0 or (year_part%4=0 and year_part%100<>0) then 29 else 28 end
        when month_part in (4,6,9,11) then 30 else 31 end;
      if month_part<1 or month_part>12 or day_part<1 or day_part>max_day then raise exception 'internal_form_response_invalid' using errcode='22023'; end if;
    end if;
    total_length:=total_length+private.internal_form_utf16_length_v1(field_value);
  end loop;
  if p_data_json->'schema_snapshot' is distinct from normalized_schema or total_length>50000
    or (select count(*) from jsonb_object_keys(p_data_json->'fields'))<>cardinality(field_keys) then
    raise exception 'internal_form_response_invalid' using errcode='22023';
  end if;

  fingerprint:=sha256(convert_to(jsonb_build_object('name',p_submitter_name,'email',p_submitter_email,'data',p_data_json)::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended('internal_form:'||p_workspace_id::text||':'||p_form_id::text||':'||actor::text||':'||p_request_id::text,0));
  select * into prior from private.internal_form_submission_receipts r where r.workspace_id=p_workspace_id
    and r.form_id=p_form_id and r.actor_id=actor and r.request_id=p_request_id;
  if found then
    if prior.payload_hash is distinct from fingerprint then raise exception 'internal_form_request_conflict' using errcode='22023'; end if;
    if not exists(select 1 from public.form_submissions s where s.id=prior.submission_id and s.workspace_id=p_workspace_id and s.form_id=p_form_id) then
      raise exception 'internal_form_submission_unavailable' using errcode='42501';
    end if;
    return jsonb_build_object('submissionId',prior.submission_id,'replayed',true);
  end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into followups from
    (select btrim(value,E' \t\n\r\f\v') value from regexp_split_to_table(p_data_json->>'follow_up',E'\n') value) parts where value<>'';
  insert into public.form_submissions(workspace_id,form_id,submitted_by,submitter_name,submitter_email,data_json,ai_summary,ai_detected_priority,ai_detected_followups_json)
    values(p_workspace_id,p_form_id,actor,p_submitter_name,p_submitter_email,p_data_json,'Vaeroex summary draft: '||(p_data_json->>'summary'),p_data_json->>'priority',followups)
    returning id into submission;
  insert into private.internal_form_submission_receipts(workspace_id,form_id,actor_id,request_id,payload_hash,submission_id)
    values(p_workspace_id,p_form_id,actor,p_request_id,fingerprint,submission);
  return jsonb_build_object('submissionId',submission,'replayed',false);
end;
$$;
revoke all on function public.submit_internal_form_v1(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.submit_internal_form_v1(uuid,uuid,uuid,text,text,jsonb) to authenticated;
comment on function public.submit_internal_form_v1(uuid,uuid,uuid,text,text,jsonb) is
  'Authenticated internal submission with current tenant/role/parent/schema authority and an immutable scoped replay receipt; no public form publishing.';
commit;
