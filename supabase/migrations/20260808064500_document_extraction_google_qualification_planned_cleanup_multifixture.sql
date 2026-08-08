-- Scope planned-never-enqueued cleanup evidence to the current fixture graph.
-- A prior serial fixture may legitimately have a job binding in the same run;
-- a binding for the current item/source/intake/file must still fail closed.

do $migration$
declare
  v_definition text;
  v_anchor text := E'    or exists (\n      select 1\n      from public.document_extraction_google_qualification_job_bindings binding\n      where binding.run_id = v_run.id\n        or binding.item_id = v_item.id\n        or binding.source_binding_id = v_source.id\n        or binding.intake_request_id = v_item.intake_request_id\n        or binding.file_id = v_item.file_id\n    )';
  v_replacement text := E'    or exists (\n      select 1\n      from public.document_extraction_google_qualification_job_bindings binding\n      where binding.run_id = v_run.id\n        and (\n          binding.item_id = v_item.id\n          or binding.source_binding_id = v_source.id\n          or binding.intake_request_id = v_item.intake_request_id\n          or binding.file_id = v_item.file_id\n        )\n    )';
begin
  select pg_get_functiondef(
    'public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or position(v_anchor in v_definition) = 0
    or position('planned_cleanup_multifixture_binding_v1' in v_definition) > 0 then
    raise exception 'Canonical planned cleanup predecessor is invalid.';
  end if;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  v_definition := replace(
    v_definition,
    E'begin\n  begin',
    E'begin\n  -- planned_cleanup_multifixture_binding_v1\n  begin'
  );
  if position(v_anchor in v_definition) > 0
    or position('planned_cleanup_multifixture_binding_v1' in v_definition) = 0 then
    raise exception 'Planned cleanup multi-fixture replacement failed.';
  end if;
  execute v_definition;
end;
$migration$;

alter function public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid)
  owner to postgres;

revoke execute on function
  public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid)
from public, anon, authenticated, service_role;

comment on function public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid) is
  'Owner-only exact planned-never-enqueued cleanup proof scoped to one fixture graph. Grants no document authority.';
