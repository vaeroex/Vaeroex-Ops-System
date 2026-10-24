-- LOCAL INACTIVE DRAFT. Implements legacy-reference admission/terminal fencing.
-- Other typed source resolvers deliberately fail closed, pending their contracts.
-- Provider policy and actual multi-session writer-lock qualification remain gates.
begin;
alter table public.vsi_requests add column shared_evidence_required boolean not null default false;
alter table private.shared_evidence_commit_claims add column output_hash text;
alter table private.shared_evidence_commit_claims add column context_hash text;
alter table private.shared_evidence_commit_claims add column conversation_id uuid;

create function private.require_shared_evidence_actor_v1(w uuid,a uuid,s uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role()='service_role' then perform private.require_live_actor_session_v1(w,a,s,array['owner']);
 elsif auth.role()='authenticated' and auth.uid()=a and (auth.jwt()->>'session_id')::uuid=s then perform private.require_evidence_owner_v1(w);
 else raise exception 'shared_evidence_actor_denied' using errcode='42501';end if;
end $$;

create function private.shared_evidence_ticket_v1(w uuid,a uuid,ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.google_sheets_read_tickets;context jsonb;
begin
 t:=private.google_sheets_checked_ticket_v1(ticket,w);
 if t.actor_id is distinct from a or not t.bound then raise exception 'shared_evidence_ticket_denied' using errcode='42501';end if;
 context:=public.get_google_sheets_read_context_v1(ticket);
 if (context->>'hasUnattributedDerivedSources')::boolean is distinct from false then raise exception 'shared_evidence_unattributed_source' using errcode='42501';end if;
 return jsonb_build_object('sources',t.sources,'context',context);
end $$;

-- Lock order matches the audited VSI path: privacy, actor, workspace, conversation,
-- request. Briefing completion uses privacy then the exact run row.
create function private.shared_evidence_target_v1(w uuid,a uuid,k text,i uuid,attempt integer,ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.vsi_requests;b public.ai_agent_runs;c public.vsi_conversations;
begin
 perform private.google_sheets_privacy_open_v1(w);
 if k='vsi_request' then
  perform pg_advisory_xact_lock(hashtextextended('vsi-actor:'||a::text,0));
  perform pg_advisory_xact_lock(hashtextextended('vsi-workspace:'||w::text,0));
  select * into r from public.vsi_requests where id=i and workspace_id=w and actor_user_id=a;
  select * into c from public.vsi_conversations where id=r.conversation_id and workspace_id=w and actor_user_id=a for update;
  if not found then raise exception 'shared_evidence_target_denied' using errcode='42501';end if;
  select * into r from public.vsi_requests where id=i and workspace_id=w and actor_user_id=a for update;
  if r.status is distinct from 'pending' or r.attempt is distinct from attempt or r.lease_until is null or r.lease_until<=clock_timestamp() then
   raise exception 'shared_evidence_stale_attempt' using errcode='40001';end if;
  return jsonb_build_object('question_hash',r.question_hash,'conversation_id',c.id,'context_hash',private.evidence_digest_v1(to_jsonb(c.context_summary)));
 elsif k='briefing_run' then
  select * into b from public.ai_agent_runs where id=i and workspace_id=w and created_by=a and agent_type='intelligence_briefing_v1'
   and trusted_source and archived_at is null and deleted_at is null for update;
  if not found or b.status<>'processing' or attempt<>1 or b.input_json->>'google_sheets_read_ticket_id' is distinct from ticket::text
   or b.input_json->>'shared_evidence_contract' is distinct from 'shared_evidence_v1' then raise exception 'shared_evidence_target_denied' using errcode='42501';end if;
  return b.input_json;
 end if;
 raise exception 'shared_evidence_target_kind_invalid' using errcode='22023';
end $$;

-- Exact artifact existence, revision, audience and original privacy are rechecked.
create function private.shared_evidence_inherited_v1(w uuid,a uuid,j jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare am private.shared_evidence_artifact_manifests;pm private.shared_evidence_manifests;revision text;table_name text;ancestor uuid;visited uuid[];pa private.derived_evidence_audiences;link private.shared_evidence_artifact_manifests;
begin
 if j-array['kind','parent_manifest_id','artifact_kind','artifact_id','artifact_revision']<>'{}'::jsonb then raise exception 'shared_evidence_inherited_identity_invalid' using errcode='22023';end if;
 select * into am from private.shared_evidence_artifact_manifests where workspace_id=w and manifest_id=private.safe_evidence_uuid_v1(j->>'parent_manifest_id')
  and artifact_kind=j->>'artifact_kind' and artifact_id=private.safe_evidence_uuid_v1(j->>'artifact_id') and artifact_revision=j->>'artifact_revision';
 if not found then raise exception 'shared_evidence_inherited_artifact_denied' using errcode='42501';end if;
 select * into pm from private.shared_evidence_manifests where id=am.manifest_id and workspace_id=w;
 if pm.target_kind='vsi_request' and pm.actor_id<>a then raise exception 'shared_evidence_inherited_actor_denied' using errcode='42501';end if;
 if am.artifact_kind='briefing_run' then
  table_name:='ai_agent_runs';select private.evidence_digest_v1(b.output_json) into revision from public.ai_agent_runs b
   where b.id=am.artifact_id and b.workspace_id=w and b.status='completed' and b.archived_at is null and b.deleted_at is null;
 elsif am.artifact_kind='report' then
  table_name:='reports';select private.evidence_digest_v1(jsonb_build_array(r.body_markdown,r.source_data_json)) into revision from public.reports r
   join private.derived_evidence_audiences da on da.artifact_kind='reports' and da.artifact_id=r.id and da.workspace_id=w
   where r.id=am.artifact_id and r.workspace_id=w and r.archived_at is null and r.deleted_at is null and (not da.actor_private or da.actor_id=a);
  ancestor:=am.artifact_id;visited:=array[]::uuid[];
  loop
   if ancestor=any(visited) or cardinality(visited)>=24 then raise exception 'shared_evidence_copy_ancestry_invalid' using errcode='42501';end if;
   visited:=array_append(visited,ancestor);
   select * into pa from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=ancestor and workspace_id=w;
   if not found or (pa.actor_private and pa.actor_id is distinct from a) then raise exception 'shared_evidence_inherited_actor_denied' using errcode='42501';end if;
   exit when pa.source_kind is distinct from 'saved_report';
   ancestor:=pa.source_id;
   select * into link from private.shared_evidence_artifact_manifests where workspace_id=w and artifact_kind='report' and artifact_id=ancestor and manifest_id=am.manifest_id;
   if not found or not exists(select 1 from public.reports r where r.id=ancestor and r.workspace_id=w and r.deleted_at is null and r.archived_at is null
    and private.evidence_digest_v1(jsonb_build_array(r.body_markdown,r.source_data_json))=link.artifact_revision)
    or not public.google_sheets_record_readable_v1(w,'reports',ancestor) then raise exception 'shared_evidence_inherited_artifact_changed' using errcode='42501';end if;
  end loop;
  -- Copying does not outlive the original generated output's eligibility.
  select * into link from private.shared_evidence_artifact_manifests where workspace_id=w and manifest_id=am.manifest_id and artifact_id=pm.target_id
   and artifact_kind=case pm.target_kind when 'vsi_request' then 'vsi_exchange' else 'briefing_run' end;
  if not found then raise exception 'shared_evidence_inherited_artifact_denied' using errcode='42501';end if;
  perform private.shared_evidence_inherited_v1(w,a,jsonb_build_object('kind','inherited_artifact','parent_manifest_id',am.manifest_id,
   'artifact_kind',link.artifact_kind,'artifact_id',link.artifact_id,'artifact_revision',link.artifact_revision));
 elsif am.artifact_kind='vsi_exchange' then
  table_name:='vsi_exchanges';select private.evidence_digest_v1(jsonb_build_array(e.user_message,e.answer,coalesce(e.citations,'[]'::jsonb))) into revision
   from public.vsi_exchanges e join public.vsi_conversations c on c.id=e.conversation_id and c.workspace_id=e.workspace_id
   where e.id=am.artifact_id and e.workspace_id=w and e.actor_user_id=a and c.actor_user_id=a and c.actor_role='owner';
 else raise exception 'shared_evidence_inherited_kind_unsupported' using errcode='42501';end if;
 if revision is distinct from am.artifact_revision or not public.google_sheets_record_readable_v1(w,table_name,am.artifact_id) then
  raise exception 'shared_evidence_inherited_artifact_changed' using errcode='42501';end if;
 return jsonb_build_object('identity',j,'hash',private.evidence_digest_v1(j),'data',jsonb_build_object('artifact_kind',am.artifact_kind,'artifact_id',am.artifact_id,'revision',revision));
end $$;

create function private.shared_evidence_original_v1(w uuid,source jsonb,a uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.legacy_evidence_references;data jsonb;
begin
 if source->>'kind'='inherited_artifact' then return private.shared_evidence_inherited_v1(w,a,source);end if;
 if source->>'kind' is distinct from 'legacy_reference' or source-array['kind','reference_id']<>'{}'::jsonb then
  raise exception 'shared_evidence_source_kind_unimplemented' using errcode='22023';end if;
 select * into r from private.legacy_evidence_references where id=private.safe_evidence_uuid_v1(source->>'reference_id') and workspace_id=w;
 if not found then raise exception 'shared_evidence_reference_denied' using errcode='42501';end if;
 data:=private.resolve_legacy_evidence_v1(w,r.binding_id,r.period_start,r.period_end);
 if private.evidence_digest_v1(data)<>r.source_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
 return jsonb_build_object('identity',jsonb_build_object('kind','legacy_reference','reference_id',r.id),'hash',r.source_hash,'data',data);
end $$;

create function public.seal_shared_evidence_manifest_v1(p_workspace_id uuid,p_target_kind text,p_target_id uuid,p_attempt integer,p_read_ticket_id uuid,p_sources jsonb,p_inherited_manifest_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid;s uuid;target jsonb;ticket jsonb;source jsonb;resolved jsonb;projections jsonb:='[]';identities jsonb:='[]';m uuid;ordinal integer:=0;parent uuid;required uuid;src record;dependency jsonb;
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);s:=(auth.jwt()->>'session_id')::uuid;
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
  if source->>'kind' is null or source->>'kind' not in ('legacy_reference','qbo_version','square_payment','sheets_ticket_source','approved_file_fact','approved_note') then
   raise exception 'shared_evidence_direct_source_kind_denied' using errcode='42501';end if;
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
 insert into private.shared_evidence_manifests(workspace_id,actor_id,session_id,target_kind,target_id,attempt,google_sheets_read_ticket_id,input_hash,manifest_hash,parser_contract)
 values(p_workspace_id,a,s,p_target_kind,p_target_id,p_attempt,p_read_ticket_id,private.evidence_digest_v1(jsonb_build_array(target,ticket)),private.evidence_digest_v1(projections),'shared_evidence_v1') returning id into m;
 for resolved in select value from jsonb_array_elements(projections) loop
  insert into private.shared_evidence_manifest_sources values(p_workspace_id,m,ordinal,resolved#>>'{identity,kind}',resolved->'identity',resolved->>'hash');ordinal:=ordinal+1;
 end loop;
 if p_target_kind='vsi_request' then update public.vsi_requests set shared_evidence_required=true where id=p_target_id and workspace_id=p_workspace_id;end if;
 return jsonb_build_object('stage','database_bound','manifest_id',m,'projections',projections,'provider_policy_required',true);
end $$;

create function private.validate_shared_evidence_manifest_v1(w uuid,m uuid,k text,i uuid,attempt integer,a uuid,s uuid) returns void
language plpgsql security definer set search_path='' as $$
declare manifest private.shared_evidence_manifests;target jsonb;ticket jsonb;src record;resolved jsonb;projections jsonb:='[]';
begin
 perform private.require_shared_evidence_actor_v1(w,a,s);
 select * into manifest from private.shared_evidence_manifests where id=m and workspace_id=w;
 if not found or manifest.actor_id<>a or manifest.session_id<>s or manifest.target_kind<>k or manifest.target_id<>i or manifest.attempt<>attempt then raise exception 'shared_evidence_manifest_denied' using errcode='42501';end if;
 target:=private.shared_evidence_target_v1(w,a,k,i,attempt,manifest.google_sheets_read_ticket_id);
 ticket:=private.shared_evidence_ticket_v1(w,a,manifest.google_sheets_read_ticket_id);
 if private.evidence_digest_v1(jsonb_build_array(target,ticket))<>manifest.input_hash then raise exception 'shared_evidence_input_changed' using errcode='40001';end if;
 for src in select * from private.shared_evidence_manifest_sources where workspace_id=w and manifest_id=m order by ordinal loop
  resolved:=private.shared_evidence_original_v1(w,src.original_identity,a);
  if resolved->>'hash'<>src.authority_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
  projections:=projections||jsonb_build_array(resolved);
 end loop;
 if private.evidence_digest_v1(projections)<>manifest.manifest_hash then raise exception 'shared_evidence_manifest_changed' using errcode='40001';end if;
end $$;
create function public.validate_shared_evidence_manifest_v1(p_workspace_id uuid,p_manifest_id uuid,p_target_kind text,p_target_id uuid,p_attempt integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_evidence_owner_v1(p_workspace_id);
 perform private.validate_shared_evidence_manifest_v1(p_workspace_id,p_manifest_id,p_target_kind,p_target_id,p_attempt,auth.uid(),(auth.jwt()->>'session_id')::uuid);return true;
end $$;

create function private.shared_evidence_exchange_hash_v1(q text,a text,c jsonb) returns text language sql immutable set search_path='' as $$
 select private.evidence_digest_v1(jsonb_build_array(q,a,coalesce(c,'[]'::jsonb)))
$$;
-- Derive the gate from server-issued ticket dependencies, not caller opt-in.
create function private.shared_evidence_ticket_requires_manifest_v1(w uuid,t uuid) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from private.google_sheets_read_tickets ticket
 cross join lateral jsonb_array_elements(ticket.sources) src
 where ticket.id=t and ticket.workspace_id=w and
 (exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=w and am.artifact_id=private.safe_evidence_uuid_v1(src->>'id')
  and am.artifact_kind=case src->>'table' when 'reports' then 'report' when 'ai_agent_runs' then 'briefing_run' when 'vsi_exchanges' then 'vsi_exchange' when 'vsi_conversations' then 'vsi_conversation_context' end)
 or (src->>'table'='reports' and exists(select 1 from private.derived_evidence_audiences da where da.workspace_id=w and da.artifact_kind='reports'
  and da.artifact_id=private.safe_evidence_uuid_v1(src->>'id') and da.actor_private))))
$$;
create function private.guard_shared_evidence_terminal_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare required boolean;claim private.shared_evidence_commit_claims;r public.vsi_requests;
begin
 if tg_table_name='vsi_requests' then
  if tg_op='INSERT' then
   new.shared_evidence_required:=new.shared_evidence_required or exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=new.workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=new.conversation_id);return new;
  end if;
  -- Existing conversation deletion uses FK SET NULL, retaining billed requests.
  if old.conversation_id is not null and new.conversation_id is null
   and to_jsonb(new)-'conversation_id'=to_jsonb(old)-'conversation_id'
   and not exists(select 1 from public.vsi_conversations c where c.id=old.conversation_id and c.workspace_id=old.workspace_id) then return new;end if;
  if old.shared_evidence_required and not new.shared_evidence_required then raise exception 'shared_evidence_downgrade_denied' using errcode='42501';end if;
  required:=old.shared_evidence_required or private.shared_evidence_ticket_requires_manifest_v1(new.workspace_id,private.safe_evidence_uuid_v1(current_setting('vaeroex.google_sheets_read_ticket_id',true))) or exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=new.workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=new.conversation_id);
  if not required or new.status<>'completed' then return new;end if;
  if new.workspace_id<>old.workspace_id or new.actor_user_id<>old.actor_user_id or new.conversation_id is distinct from old.conversation_id or new.attempt<>old.attempt then raise exception 'shared_evidence_target_changed' using errcode='42501';end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=old.workspace_id and target_kind='vsi_request' and target_id=old.id and attempt=old.attempt;
 elsif tg_table_name='ai_agent_runs' then
  required:=old.input_json->>'shared_evidence_contract'='shared_evidence_v1' or private.shared_evidence_ticket_requires_manifest_v1(old.workspace_id,private.safe_evidence_uuid_v1(old.input_json->>'google_sheets_read_ticket_id')) or exists(select 1 from private.shared_evidence_manifests where target_kind='briefing_run' and target_id=old.id);
  if not coalesce(required,false) or new.status<>'completed' then return new;end if;
  if old.status='completed' and new.id=old.id and new.workspace_id=old.workspace_id and new.created_by=old.created_by
   and new.agent_type=old.agent_type and new.input_json is not distinct from old.input_json and new.output_json is not distinct from old.output_json then return new;end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=old.workspace_id and target_kind='briefing_run' and target_id=old.id and attempt=1;
  if claim.output_hash is distinct from private.evidence_digest_v1(new.output_json) then raise exception 'shared_evidence_output_changed' using errcode='42501';end if;
 elsif tg_table_name='vsi_exchanges' then
  if tg_op='UPDATE' and exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=old.workspace_id and am.artifact_kind='vsi_exchange' and am.artifact_id=old.id) then
   raise exception 'shared_evidence_exchange_immutable' using errcode='42501';end if;
  select * into r from public.vsi_requests where id=new.id and workspace_id=new.workspace_id;
  if not coalesce(r.shared_evidence_required,false) then return new;end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=new.workspace_id and target_kind='vsi_request' and target_id=new.id and attempt=r.attempt;
  if claim.output_hash is distinct from private.shared_evidence_exchange_hash_v1(new.user_message,new.answer,new.citations) then raise exception 'shared_evidence_output_changed' using errcode='42501';end if;
 else
  if tg_op='INSERT' then
   if new.parent_conversation_id is not null and exists(select 1 from private.shared_evidence_artifact_manifests where artifact_kind='vsi_conversation_context' and artifact_id=new.parent_conversation_id) then raise exception 'shared_evidence_continuation_unimplemented' using errcode='42501';end if;
   return new;
  end if;
  if exists(select 1 from private.shared_evidence_artifact_manifests am where am.workspace_id=old.workspace_id and am.artifact_kind='vsi_conversation_context' and am.artifact_id=old.id)
   and (new.id<>old.id or new.workspace_id<>old.workspace_id or new.actor_user_id<>old.actor_user_id or new.actor_role<>old.actor_role) then raise exception 'shared_evidence_context_identity_changed' using errcode='42501';end if;
  if new.context_summary is not distinct from old.context_summary then return new;end if;
  if not exists(select 1 from private.shared_evidence_artifact_manifests where artifact_kind='vsi_conversation_context' and artifact_id=old.id)
   and not exists(select 1 from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and conversation_id=old.id) then return new;end if;
  select * into claim from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and workspace_id=new.workspace_id and conversation_id=new.id;
  if claim.context_hash is distinct from private.evidence_digest_v1(to_jsonb(new.context_summary)) then raise exception 'shared_evidence_context_changed' using errcode='42501';end if;
 end if;
 if claim.manifest_id is null then raise exception 'shared_evidence_commit_required' using errcode='42501';end if;
 return new;
end $$;
create trigger shared_evidence_terminal before insert or update on public.vsi_requests for each row execute function private.guard_shared_evidence_terminal_v1();
create trigger shared_evidence_terminal before update on public.ai_agent_runs for each row execute function private.guard_shared_evidence_terminal_v1();
create trigger shared_evidence_terminal before insert or update on public.vsi_exchanges for each row execute function private.guard_shared_evidence_terminal_v1();
create trigger shared_evidence_terminal before insert or update on public.vsi_conversations for each row execute function private.guard_shared_evidence_terminal_v1();

create function public.complete_trusted_derived_run_v2(p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,p_session_id uuid,p_read_ticket_id uuid,p_agent_type text,p_output_json jsonb,p_manifest_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;m private.shared_evidence_manifests;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'shared_evidence_server_only' using errcode='42501';end if;
 perform private.validate_shared_evidence_manifest_v1(p_workspace_id,p_manifest_id,'briefing_run',p_run_id,1,p_actor_id,p_session_id);
 select * into m from private.shared_evidence_manifests where id=p_manifest_id;
 if m.google_sheets_read_ticket_id is distinct from p_read_ticket_id or p_agent_type<>'intelligence_briefing_v1' then raise exception 'shared_evidence_ticket_denied' using errcode='42501';end if;
 insert into private.shared_evidence_commit_claims(transaction_id,workspace_id,manifest_id,target_kind,target_id,attempt,output_hash)
 values(pg_current_xact_id(),p_workspace_id,p_manifest_id,'briefing_run',p_run_id,1,private.evidence_digest_v1(p_output_json));
 result:=public.complete_trusted_derived_run_v1(p_workspace_id,p_run_id,p_actor_id,p_session_id,p_read_ticket_id,p_agent_type,p_output_json);
 insert into private.shared_evidence_artifact_manifests values(p_workspace_id,'briefing_run',p_run_id,private.evidence_digest_v1(p_output_json),p_manifest_id);
 delete from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and manifest_id=p_manifest_id;
 return result;
end $$;
create function public.vsi_mutate_v3(p_workspace_id uuid,p_actor_user_id uuid,p_action text,p_input jsonb,p_session_id uuid,p_manifest_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;m private.shared_evidence_manifests;output_hash text;context_hash text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'shared_evidence_server_only' using errcode='42501';end if;
 if p_action<>'settle' or coalesce(p_input->>'answer','')='' then
  -- Failure settlement keeps the original cost/accounting/session/privacy path.
  return public.vsi_mutate_v2(p_workspace_id,p_actor_user_id,p_action,p_input,p_session_id);
 end if;
 perform private.validate_shared_evidence_manifest_v1(p_workspace_id,p_manifest_id,'vsi_request',(p_input->>'id')::uuid,(p_input->>'attempt')::integer,p_actor_user_id,p_session_id);
 select * into m from private.shared_evidence_manifests where id=p_manifest_id;
 if p_input->>'readTicketId' is distinct from m.google_sheets_read_ticket_id::text then raise exception 'shared_evidence_ticket_denied' using errcode='42501';end if;
 if not exists(select 1 from public.vsi_requests where id=m.target_id and workspace_id=p_workspace_id
  and conversation_id=(p_input->>'conversationId')::uuid and question_hash=encode(sha256(convert_to(p_input->>'question','UTF8')),'hex')) then
  raise exception 'shared_evidence_question_changed' using errcode='42501';end if;
 output_hash:=private.shared_evidence_exchange_hash_v1(p_input->>'question',p_input->>'answer',p_input->'citations');
 context_hash:=private.evidence_digest_v1(to_jsonb(left(p_input->>'summary',8000)));
 if p_input->>'summary' is null then raise exception 'shared_evidence_summary_required' using errcode='22023';end if;
 insert into private.shared_evidence_commit_claims values(pg_current_xact_id(),p_workspace_id,p_manifest_id,'vsi_request',m.target_id,m.attempt,output_hash,context_hash,(p_input->>'conversationId')::uuid);
 result:=public.vsi_mutate_v2(p_workspace_id,p_actor_user_id,p_action,p_input,p_session_id);
 if result->>'state' is distinct from 'settled' then raise exception 'shared_evidence_settlement_changed' using errcode='40001';end if;
 insert into private.shared_evidence_artifact_manifests values(p_workspace_id,'vsi_exchange',m.target_id,output_hash,p_manifest_id),
  (p_workspace_id,'vsi_conversation_context',(p_input->>'conversationId')::uuid,context_hash,p_manifest_id);
 delete from private.shared_evidence_commit_claims where transaction_id=pg_current_xact_id() and manifest_id=p_manifest_id;
 return result;
end $$;

-- Save-copy lineage is attached in the same transaction as the checked payload.
create function private.attach_shared_evidence_copy_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare audience private.derived_evidence_audiences;am record;src record;identity jsonb;revision text;k text;
begin
 select * into audience from private.derived_evidence_audiences where artifact_kind='reports' and artifact_id=new.id and workspace_id=new.workspace_id;
 if not found then return new;end if;
 k:=case audience.source_kind when 'vsi' then 'vsi_exchange' when 'intelligence_briefing_v1' then 'briefing_run' when 'saved_report' then 'report' end;
 revision:=private.evidence_digest_v1(jsonb_build_array(new.body_markdown,new.source_data_json));
 for am in select * from private.shared_evidence_artifact_manifests where workspace_id=new.workspace_id and artifact_kind=k and artifact_id=audience.source_id loop
  identity:=jsonb_build_object('kind','inherited_artifact','parent_manifest_id',am.manifest_id,'artifact_kind',am.artifact_kind,'artifact_id',am.artifact_id,'artifact_revision',am.artifact_revision);
  perform private.shared_evidence_inherited_v1(new.workspace_id,auth.uid(),identity);
  for src in select * from private.shared_evidence_manifest_sources where workspace_id=new.workspace_id and manifest_id=am.manifest_id loop
   perform private.shared_evidence_original_v1(new.workspace_id,src.original_identity,auth.uid());
  end loop;
  insert into private.shared_evidence_artifact_manifests values(new.workspace_id,'report',new.id,revision,am.manifest_id);
 end loop;
 return new;
end $$;
create trigger shared_evidence_copy after insert on public.reports for each row execute function private.attach_shared_evidence_copy_v1();
revoke all on function private.attach_shared_evidence_copy_v1() from public,anon,authenticated,service_role;

revoke all on function private.require_shared_evidence_actor_v1(uuid,uuid,uuid),private.shared_evidence_ticket_v1(uuid,uuid,uuid),private.shared_evidence_target_v1(uuid,uuid,text,uuid,integer,uuid),
 private.shared_evidence_inherited_v1(uuid,uuid,jsonb),private.shared_evidence_original_v1(uuid,jsonb,uuid),private.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer,uuid,uuid),private.shared_evidence_exchange_hash_v1(text,text,jsonb),private.guard_shared_evidence_terminal_v1(),private.shared_evidence_ticket_requires_manifest_v1(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[]),public.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer),
 public.complete_trusted_derived_run_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid),public.vsi_mutate_v3(uuid,uuid,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.seal_shared_evidence_manifest_v1(uuid,text,uuid,integer,uuid,jsonb,uuid[]),public.validate_shared_evidence_manifest_v1(uuid,uuid,text,uuid,integer) to authenticated;
grant execute on function public.complete_trusted_derived_run_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid),public.vsi_mutate_v3(uuid,uuid,text,jsonb,uuid,uuid) to service_role;
commit;
