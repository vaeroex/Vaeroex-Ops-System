-- INACTIVE LOCAL DRAFT. Exact saved-output/citation reopening only.
begin;
create function public.reopen_shared_evidence_artifact_v1(p_workspace_id uuid,p_artifact_kind text,p_artifact_id uuid,p_expected_revision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid;am record;src record;resolved jsonb;projections jsonb:='[]';identities jsonb:='[]';parents jsonb:='[]';
begin
 a:=private.require_evidence_owner_v1(p_workspace_id);
 if p_artifact_kind not in ('report','briefing_run','vsi_exchange') or p_expected_revision is null or p_expected_revision!~'^[a-f0-9]{64}$' then
  raise exception 'shared_reopen_identity_invalid' using errcode='22023';end if;
 for am in select * from private.shared_evidence_artifact_manifests where workspace_id=p_workspace_id and artifact_kind=p_artifact_kind
  and artifact_id=p_artifact_id and artifact_revision=p_expected_revision order by manifest_id
 loop
  perform private.shared_evidence_inherited_v1(p_workspace_id,a,jsonb_build_object('kind','inherited_artifact','parent_manifest_id',am.manifest_id,
   'artifact_kind',am.artifact_kind,'artifact_id',am.artifact_id,'artifact_revision',am.artifact_revision));
  parents:=parents||jsonb_build_array(am.manifest_id);
  for src in select * from private.shared_evidence_manifest_sources where workspace_id=p_workspace_id and manifest_id=am.manifest_id order by ordinal loop
   resolved:=private.shared_evidence_original_v1(p_workspace_id,src.original_identity,a);
   if resolved->>'hash' is distinct from src.authority_hash then raise exception 'shared_evidence_source_changed' using errcode='40001';end if;
   if not identities @> jsonb_build_array(resolved->'identity') then
    identities:=identities||jsonb_build_array(resolved->'identity');projections:=projections||jsonb_build_array(resolved);
   end if;
  end loop;
 end loop;
 if parents='[]'::jsonb then raise exception 'shared_reopen_unavailable' using errcode='42501';end if;
 if jsonb_array_length(projections)>24 or octet_length(projections::text)>2000000 then raise exception 'shared_reopen_budget_exceeded' using errcode='54000';end if;
 return jsonb_build_object('stage','revalidated_saved_evidence','artifact_kind',p_artifact_kind,'artifact_id',p_artifact_id,
  'artifact_revision',p_expected_revision,'manifest_ids',parents,'projections',projections);
end $$;
revoke all on function public.reopen_shared_evidence_artifact_v1(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reopen_shared_evidence_artifact_v1(uuid,text,uuid,text) to authenticated;
commit;
