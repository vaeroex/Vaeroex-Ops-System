-- Preserve the exact owner-verified processing binding across the brief FK
-- reconciliation step. The finalizer removes the binding first, then the
-- file_processing_jobs trigger revalidates the transaction-signed identity.

do $migration$
declare
  v_definition text;
  v_declaration_anchor text := E'  v_processing_binding\n    public.document_extraction_google_qualification_processing_job_bindings%rowtype;\n';
  v_select_anchor text := E'  select binding.* into v_processing_binding\n  from public.document_extraction_google_qualification_processing_job_bindings binding\n  where binding.id = nullif(v_context ->> ''processing_binding_id'', '''')::uuid\n  for update;\n';
  v_null_anchor text := E'    or v_processing_binding.id is null or v_processing_job.id is null';
  v_null_replacement text := E'    or nullif(v_context ->> ''processing_binding_id'', '''') is null\n    or v_processing_job.id is null';
  v_binding_anchor text := E'    or v_processing_binding.run_id <> v_run.id\n    or v_processing_binding.item_id <> v_item.id\n    or v_processing_binding.source_binding_id <> v_source.id\n    or v_processing_binding.workspace_id <> v_run.workspace_id\n    or v_processing_binding.file_id <> v_item.file_id\n    or v_processing_binding.fixture_index <> v_item.fixture_index\n    or v_processing_binding.file_processing_job_id <> v_processing_job.id';
  v_binding_replacement text := E'    or exists (\n      select 1\n      from public.document_extraction_google_qualification_processing_job_bindings binding\n      where (\n        binding.id = (v_context ->> ''processing_binding_id'')::uuid\n        or binding.file_processing_job_id = v_processing_job.id\n      )\n      and not (\n        binding.id = (v_context ->> ''processing_binding_id'')::uuid\n        and binding.run_id = v_run.id\n        and binding.item_id = v_item.id\n        and binding.source_binding_id = v_source.id\n        and binding.workspace_id = v_run.workspace_id\n        and binding.file_id = v_item.file_id\n        and binding.fixture_index = v_item.fixture_index\n        and binding.file_processing_job_id = v_processing_job.id\n      )\n    )';
begin
  select pg_get_functiondef(
    'public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or position(v_declaration_anchor in v_definition) = 0
    or position(v_select_anchor in v_definition) = 0
    or position(v_null_anchor in v_definition) = 0
    or position(v_binding_anchor in v_definition) = 0
    or position('planned_cleanup_signed_binding_lifecycle_v1' in v_definition) > 0 then
    raise exception 'Canonical planned cleanup binding predecessor is invalid.';
  end if;
  v_definition := replace(v_definition, v_declaration_anchor, '');
  v_definition := replace(v_definition, v_select_anchor, '');
  v_definition := replace(v_definition, v_null_anchor, v_null_replacement);
  v_definition := replace(v_definition, v_binding_anchor, v_binding_replacement);
  v_definition := replace(
    v_definition,
    E'begin\n  -- planned_cleanup_multifixture_binding_v1',
    E'begin\n  -- planned_cleanup_signed_binding_lifecycle_v1\n  -- planned_cleanup_multifixture_binding_v1'
  );
  if position(v_declaration_anchor in v_definition) > 0
    or position(v_select_anchor in v_definition) > 0
    or position(v_null_anchor in v_definition) > 0
    or position(v_binding_anchor in v_definition) > 0
    or position('planned_cleanup_signed_binding_lifecycle_v1' in v_definition) = 0 then
    raise exception 'Planned cleanup signed-binding replacement failed.';
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
  'Owner-only transaction-signed planned cleanup verifier across FK reconciliation. Grants no document authority.';
