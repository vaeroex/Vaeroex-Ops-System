-- Profile-bound document-extraction review identity
--
-- This forward-only migration leaves historical content fingerprints and v1
-- review manifests unchanged. New hosted tool-call v2 completions bind a
-- separate provenance fingerprint to the workspace, job, pages, parser,
-- client, provider contract, model, normalization, and review contract.
-- It creates no data, performs no backfill, enables no feature gate, and
-- grants no document-extraction authority.

alter table public.document_extraction_jobs
  add column if not exists review_provenance_fingerprint text
  check (
    review_provenance_fingerprint is null
    or review_provenance_fingerprint ~ '^[0-9a-f]{64}$'
  );

alter table public.document_extraction_reviews
  add column if not exists review_provenance_fingerprint text
  check (
    review_provenance_fingerprint is null
    or review_provenance_fingerprint ~ '^[0-9a-f]{64}$'
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.document_extraction_jobs'::regclass
      and conname = 'document_extraction_jobs_review_provenance_v2_check'
  ) then
    alter table public.document_extraction_jobs
      add constraint document_extraction_jobs_review_provenance_v2_check
      check (
        (
          critical_field_manifest_json ->> 'manifest_version'
            is distinct from 'document_extraction_critical_fields_v2'
          and review_provenance_fingerprint is null
        )
        or (
          critical_field_manifest_json ->> 'manifest_version'
            = 'document_extraction_critical_fields_v2'
          and review_provenance_fingerprint is not null
          and critical_field_manifest_json ->> 'review_provenance_fingerprint'
            = review_provenance_fingerprint
        )
      ) not valid;
  end if;
end;
$$;

create or replace function public.document_extraction_workspace_binding_fingerprint_v1(
  p_workspace_id uuid
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(E'\n', 'document_extraction_workspace_binding_v1', lower(p_workspace_id::text)),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.document_extraction_job_binding_fingerprint_v1(
  p_workspace_id uuid,
  p_job_id uuid,
  p_cache_key text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\n',
          'document_extraction_job_binding_v1',
          public.document_extraction_workspace_binding_fingerprint_v1(p_workspace_id),
          lower(p_job_id::text),
          p_cache_key
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.document_extraction_page_identity_fingerprint_v1(
  p_workspace_id uuid,
  p_job_id uuid,
  p_cache_key text,
  p_page_count integer
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\n',
          'document_extraction_page_identity_v1',
          public.document_extraction_job_binding_fingerprint_v1(
            p_workspace_id,
            p_job_id,
            p_cache_key
          ),
          p_cache_key,
          p_page_count::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.validate_document_extraction_review_provenance_v1(
  p_provenance jsonb,
  p_artifact_fingerprint text,
  p_workspace_id uuid,
  p_job_id uuid,
  p_cache_key text,
  p_page_count integer,
  p_parser_model text,
  p_parser_revision text,
  p_client_revision text,
  p_artifact_normalization_version text,
  p_review_version integer
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_workspace_binding text;
  v_job_binding text;
  v_page_identity text;
  v_fingerprint text;
begin
  v_workspace_binding := public.document_extraction_workspace_binding_fingerprint_v1(
    p_workspace_id
  );
  v_job_binding := public.document_extraction_job_binding_fingerprint_v1(
    p_workspace_id,
    p_job_id,
    p_cache_key
  );
  v_page_identity := public.document_extraction_page_identity_fingerprint_v1(
    p_workspace_id,
    p_job_id,
    p_cache_key,
    p_page_count
  );

  if p_provenance is null
    or jsonb_typeof(p_provenance) <> 'object'
    or octet_length(p_provenance::text) > 8192
    or (select count(*) from jsonb_object_keys(p_provenance)) <> 16
    or exists (
      select 1
      from jsonb_object_keys(p_provenance) key
      where key not in (
        'review_provenance_version', 'content_fingerprint', 'parser_revision',
        'client_revision', 'provider_profile', 'endpoint_contract_version',
        'request_serializer_version', 'response_validator_version',
        'provider_normalization_version', 'artifact_normalization_version',
        'compatibility_policy_version', 'model_alias',
        'page_identity_fingerprint', 'workspace_binding_fingerprint',
        'job_binding_fingerprint', 'review_version'
      )
    )
    or p_provenance ->> 'review_provenance_version'
      is distinct from 'document_extraction_review_provenance_v1'
    or p_provenance ->> 'content_fingerprint' is distinct from p_artifact_fingerprint
    or p_provenance ->> 'parser_revision' is distinct from p_parser_revision
    or p_provenance ->> 'client_revision' is distinct from p_client_revision
    or p_provenance ->> 'provider_profile' is distinct from 'hosted_tool_call_v2'
    or p_provenance ->> 'endpoint_contract_version'
      is distinct from 'nvidia_build_nemotron_parse_hosted_tool_call_v2'
    or p_provenance ->> 'request_serializer_version'
      is distinct from 'nemotron_parse_hosted_request_v1'
    or p_provenance ->> 'response_validator_version'
      is distinct from 'nemotron_parse_hosted_response_v2'
    or p_provenance ->> 'provider_normalization_version'
      is distinct from 'nemotron_parse_hosted_normalization_v1'
    or p_provenance ->> 'artifact_normalization_version'
      is distinct from p_artifact_normalization_version
    or p_provenance ->> 'compatibility_policy_version'
      is distinct from 'hosted_tool_call_v2'
    or p_provenance ->> 'model_alias' is distinct from p_parser_model
    or p_provenance ->> 'page_identity_fingerprint' is distinct from v_page_identity
    or p_provenance ->> 'workspace_binding_fingerprint' is distinct from v_workspace_binding
    or p_provenance ->> 'job_binding_fingerprint' is distinct from v_job_binding
    or p_provenance ->> 'review_version' is distinct from p_review_version::text then
    raise exception 'Invalid document-extraction review provenance.' using errcode = '22023';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\n',
          p_provenance ->> 'review_provenance_version',
          p_provenance ->> 'content_fingerprint',
          p_provenance ->> 'parser_revision',
          p_provenance ->> 'client_revision',
          p_provenance ->> 'provider_profile',
          p_provenance ->> 'endpoint_contract_version',
          p_provenance ->> 'request_serializer_version',
          p_provenance ->> 'response_validator_version',
          p_provenance ->> 'provider_normalization_version',
          p_provenance ->> 'artifact_normalization_version',
          p_provenance ->> 'compatibility_policy_version',
          p_provenance ->> 'model_alias',
          p_provenance ->> 'page_identity_fingerprint',
          p_provenance ->> 'workspace_binding_fingerprint',
          p_provenance ->> 'job_binding_fingerprint',
          p_provenance ->> 'review_version'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return v_fingerprint;
end;
$$;

create or replace function public.validate_document_extraction_critical_field_manifest_v2(
  p_manifest jsonb,
  p_artifact_fingerprint text,
  p_extraction_contract_version text,
  p_workspace_id uuid,
  p_job_id uuid,
  p_cache_key text,
  p_page_count integer,
  p_parser_model text,
  p_parser_revision text,
  p_client_revision text,
  p_normalization_version text,
  p_review_version integer
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_review_provenance_fingerprint text;
begin
  if p_manifest is null
    or jsonb_typeof(p_manifest) <> 'object'
    or octet_length(p_manifest::text) > 65536
    or p_manifest ->> 'manifest_version'
      is distinct from 'document_extraction_critical_fields_v2'
    or p_manifest ->> 'artifact_fingerprint' is distinct from p_artifact_fingerprint
    or p_manifest ->> 'extraction_contract_version'
      is distinct from p_extraction_contract_version
    or p_manifest ->> 'review_provenance_fingerprint' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_manifest -> 'review_provenance') <> 'object'
    or coalesce(jsonb_typeof(p_manifest -> 'fields') <> 'array', true)
    or jsonb_array_length(p_manifest -> 'fields') > 500
    or (select count(*) from jsonb_object_keys(p_manifest)) <> 6
    or exists (
      select 1
      from jsonb_object_keys(p_manifest) key
      where key not in (
        'manifest_version', 'artifact_fingerprint', 'extraction_contract_version',
        'review_provenance_fingerprint', 'review_provenance', 'fields'
      )
    ) then
    raise exception 'Invalid critical-field manifest v2 envelope.' using errcode = '22023';
  end if;

  perform public.validate_document_extraction_critical_field_manifest_v1(
    jsonb_build_object(
      'manifest_version', 'document_extraction_critical_fields_v1',
      'artifact_fingerprint', p_artifact_fingerprint,
      'extraction_contract_version', p_extraction_contract_version,
      'fields', p_manifest -> 'fields'
    ),
    p_artifact_fingerprint,
    p_extraction_contract_version
  );

  v_review_provenance_fingerprint :=
    public.validate_document_extraction_review_provenance_v1(
      p_manifest -> 'review_provenance',
      p_artifact_fingerprint,
      p_workspace_id,
      p_job_id,
      p_cache_key,
      p_page_count,
      p_parser_model,
      p_parser_revision,
      p_client_revision,
      p_normalization_version,
      p_review_version
    );
  if p_manifest ->> 'review_provenance_fingerprint'
    is distinct from v_review_provenance_fingerprint then
    raise exception 'Critical-field review provenance fingerprint mismatch.' using errcode = '22023';
  end if;

  return encode(
    extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
end;
$$;

-- Preserve the historical v1 validator result exactly while allowing the
-- existing review mutation to verify a stored v2 manifest intrinsically. The
-- job trigger and completion v3 perform the stronger job-bound validation.
create or replace function public.validate_document_extraction_critical_field_manifest_v1(
  p_manifest jsonb,
  p_artifact_fingerprint text,
  p_extraction_contract_version text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_field jsonb;
  v_field_ids text[] := '{}'::text[];
  v_field_id text;
  v_kind text;
  v_value_type text;
  v_provenance jsonb;
  v_provenance_fingerprint text;
begin
  if p_manifest ->> 'manifest_version' = 'document_extraction_critical_fields_v2' then
    if p_manifest is null
      or jsonb_typeof(p_manifest) <> 'object'
      or octet_length(p_manifest::text) > 65536
      or p_manifest ->> 'artifact_fingerprint' is distinct from p_artifact_fingerprint
      or p_manifest ->> 'extraction_contract_version'
        is distinct from p_extraction_contract_version
      or p_manifest ->> 'review_provenance_fingerprint' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_manifest -> 'review_provenance') <> 'object'
      or coalesce(jsonb_typeof(p_manifest -> 'fields') <> 'array', true)
      or jsonb_array_length(p_manifest -> 'fields') > 500
      or (select count(*) from jsonb_object_keys(p_manifest)) <> 6
      or exists (
        select 1
        from jsonb_object_keys(p_manifest) key
        where key not in (
          'manifest_version', 'artifact_fingerprint', 'extraction_contract_version',
          'review_provenance_fingerprint', 'review_provenance', 'fields'
        )
      ) then
      raise exception 'Invalid critical-field manifest v2 envelope.' using errcode = '22023';
    end if;

    v_provenance := p_manifest -> 'review_provenance';
    if octet_length(v_provenance::text) > 8192
      or (select count(*) from jsonb_object_keys(v_provenance)) <> 16
      or exists (
        select 1
        from jsonb_object_keys(v_provenance) key
        where key not in (
          'review_provenance_version', 'content_fingerprint', 'parser_revision',
          'client_revision', 'provider_profile', 'endpoint_contract_version',
          'request_serializer_version', 'response_validator_version',
          'provider_normalization_version', 'artifact_normalization_version',
          'compatibility_policy_version', 'model_alias',
          'page_identity_fingerprint', 'workspace_binding_fingerprint',
          'job_binding_fingerprint', 'review_version'
        )
      )
      or v_provenance ->> 'review_provenance_version'
        is distinct from 'document_extraction_review_provenance_v1'
      or v_provenance ->> 'content_fingerprint' is distinct from p_artifact_fingerprint
      or v_provenance ->> 'parser_revision'
        is distinct from 'nemotron_parse_hosted_tool_call_rest_v2'
      or v_provenance ->> 'client_revision'
        is distinct from 'vaeroex_nemotron_parse_rest_v2'
      or v_provenance ->> 'provider_profile' is distinct from 'hosted_tool_call_v2'
      or v_provenance ->> 'endpoint_contract_version'
        is distinct from 'nvidia_build_nemotron_parse_hosted_tool_call_v2'
      or v_provenance ->> 'request_serializer_version'
        is distinct from 'nemotron_parse_hosted_request_v1'
      or v_provenance ->> 'response_validator_version'
        is distinct from 'nemotron_parse_hosted_response_v2'
      or v_provenance ->> 'provider_normalization_version'
        is distinct from 'nemotron_parse_hosted_normalization_v1'
      or v_provenance ->> 'artifact_normalization_version'
        is distinct from 'document_extraction_normalization_v1'
      or v_provenance ->> 'compatibility_policy_version'
        is distinct from 'hosted_tool_call_v2'
      or v_provenance ->> 'model_alias' is distinct from 'nvidia/nemotron-parse'
      or v_provenance ->> 'page_identity_fingerprint' !~ '^[0-9a-f]{64}$'
      or v_provenance ->> 'workspace_binding_fingerprint' !~ '^[0-9a-f]{64}$'
      or v_provenance ->> 'job_binding_fingerprint' !~ '^[0-9a-f]{64}$'
      or v_provenance ->> 'review_version' !~ '^[1-9][0-9]*$' then
      raise exception 'Invalid intrinsic review provenance.' using errcode = '22023';
    end if;

    v_provenance_fingerprint := encode(
      extensions.digest(
        convert_to(
          concat_ws(
            E'\n',
            v_provenance ->> 'review_provenance_version',
            v_provenance ->> 'content_fingerprint',
            v_provenance ->> 'parser_revision',
            v_provenance ->> 'client_revision',
            v_provenance ->> 'provider_profile',
            v_provenance ->> 'endpoint_contract_version',
            v_provenance ->> 'request_serializer_version',
            v_provenance ->> 'response_validator_version',
            v_provenance ->> 'provider_normalization_version',
            v_provenance ->> 'artifact_normalization_version',
            v_provenance ->> 'compatibility_policy_version',
            v_provenance ->> 'model_alias',
            v_provenance ->> 'page_identity_fingerprint',
            v_provenance ->> 'workspace_binding_fingerprint',
            v_provenance ->> 'job_binding_fingerprint',
            v_provenance ->> 'review_version'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    if p_manifest ->> 'review_provenance_fingerprint'
      is distinct from v_provenance_fingerprint then
      raise exception 'Intrinsic review provenance fingerprint mismatch.' using errcode = '22023';
    end if;

    perform public.validate_document_extraction_critical_field_manifest_v1(
      jsonb_build_object(
        'manifest_version', 'document_extraction_critical_fields_v1',
        'artifact_fingerprint', p_artifact_fingerprint,
        'extraction_contract_version', p_extraction_contract_version,
        'fields', p_manifest -> 'fields'
      ),
      p_artifact_fingerprint,
      p_extraction_contract_version
    );
    return encode(
      extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'),
      'hex'
    );
  end if;

  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
    or octet_length(p_manifest::text) > 65536
    or p_manifest ->> 'manifest_version' is distinct from 'document_extraction_critical_fields_v1'
    or p_manifest ->> 'artifact_fingerprint' is distinct from p_artifact_fingerprint
    or p_manifest ->> 'extraction_contract_version' is distinct from p_extraction_contract_version
    or coalesce(jsonb_typeof(p_manifest -> 'fields') <> 'array', true)
    or jsonb_array_length(p_manifest -> 'fields') > 500
    or exists (
      select 1 from jsonb_object_keys(p_manifest) key
      where key not in ('manifest_version', 'artifact_fingerprint', 'extraction_contract_version', 'fields')
    ) then
    raise exception 'Invalid critical-field manifest envelope.' using errcode = '22023';
  end if;
  for v_field in select value from jsonb_array_elements(p_manifest -> 'fields') loop
    if jsonb_typeof(v_field) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_field) key
        where key not in ('id', 'kind', 'value_type')
      )
      or (select count(*) from jsonb_object_keys(v_field)) <> 3 then
      raise exception 'Invalid critical-field manifest entry.' using errcode = '22023';
    end if;
    v_field_id := v_field ->> 'id';
    v_kind := v_field ->> 'kind';
    v_value_type := v_field ->> 'value_type';
    if v_field_id is null or v_field_id !~ '^[A-Za-z0-9._:-]{1,128}$'
      or v_field_id = any(v_field_ids)
      or v_kind not in (
        'kpi_name', 'current_value', 'target', 'sign', 'decimal', 'currency',
        'percentage', 'unit', 'reporting_period', 'page', 'source_coordinates'
      )
      or v_value_type not in ('string', 'number', 'boolean', 'coordinates')
      or (v_kind = 'source_coordinates' and v_value_type <> 'coordinates')
      or (v_kind = 'page' and v_value_type <> 'number')
      or (v_kind in ('sign', 'currency', 'unit', 'reporting_period', 'kpi_name')
        and v_value_type <> 'string') then
      raise exception 'Invalid or duplicate critical-field manifest identity.' using errcode = '22023';
    end if;
    v_field_ids := array_append(v_field_ids, v_field_id);
  end loop;
  return encode(extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'), 'hex');
end;
$$;

create or replace function public.enforce_document_extraction_job_review_provenance_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_manifest_fingerprint text;
begin
  if new.critical_field_manifest_json is null then
    if new.critical_field_manifest_fingerprint is not null
      or new.review_provenance_fingerprint is not null then
      raise exception 'Incomplete document-extraction manifest identity.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.critical_field_manifest_json ->> 'manifest_version'
    = 'document_extraction_critical_fields_v1' then
    if new.parser_revision = 'nemotron_parse_hosted_tool_call_rest_v2'
      or new.client_revision = 'vaeroex_nemotron_parse_rest_v2' then
      raise exception 'Hosted tool-call v2 requires a provenance-bound manifest.' using errcode = '23514';
    end if;
    if new.review_provenance_fingerprint is not null then
      raise exception 'Historical v1 manifests cannot be reclassified.' using errcode = '23514';
    end if;
    v_manifest_fingerprint := public.validate_document_extraction_critical_field_manifest_v1(
      new.critical_field_manifest_json,
      new.artifact_fingerprint,
      new.extraction_contract_version
    );
  elsif new.critical_field_manifest_json ->> 'manifest_version'
    = 'document_extraction_critical_fields_v2' then
    v_manifest_fingerprint := public.validate_document_extraction_critical_field_manifest_v2(
      new.critical_field_manifest_json,
      new.artifact_fingerprint,
      new.extraction_contract_version,
      new.workspace_id,
      new.id,
      new.cache_key,
      new.page_count,
      new.parser_model,
      new.parser_revision,
      new.client_revision,
      new.normalization_version,
      new.required_review_version
    );
    if new.review_provenance_fingerprint is distinct from
      new.critical_field_manifest_json ->> 'review_provenance_fingerprint' then
      raise exception 'Stored review provenance does not match the v2 manifest.' using errcode = '23514';
    end if;
  else
    raise exception 'Unsupported document-extraction manifest identity.' using errcode = '23514';
  end if;

  if new.critical_field_manifest_fingerprint is distinct from v_manifest_fingerprint then
    raise exception 'Stored critical-field manifest fingerprint is invalid.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_document_extraction_job_review_provenance_v2
  on public.document_extraction_jobs;
create trigger enforce_document_extraction_job_review_provenance_v2
  before insert or update of
    workspace_id, id, cache_key, page_count, parser_model, parser_revision,
    client_revision, normalization_version, required_review_version,
    artifact_fingerprint, critical_field_manifest_json,
    critical_field_manifest_fingerprint, review_provenance_fingerprint
  on public.document_extraction_jobs
  for each row execute function public.enforce_document_extraction_job_review_provenance_v2();

create or replace function public.enforce_document_extraction_review_provenance_binding_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_request_provenance text;
  v_decision_mutation boolean;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = new.job_id and workspace_id = new.workspace_id;
  if v_job.id is null then
    raise exception 'Review job binding not found.' using errcode = '23503';
  end if;

  if v_job.review_provenance_fingerprint is null then
    if new.review_provenance_fingerprint is not null then
      raise exception 'Historical review provenance cannot be reclassified.' using errcode = '23514';
    end if;
    return new;
  end if;

  if v_job.critical_field_manifest_json ->> 'manifest_version'
      is distinct from 'document_extraction_critical_fields_v2'
    or (
      new.review_provenance_fingerprint is not null
      and new.review_provenance_fingerprint is distinct from v_job.review_provenance_fingerprint
    ) then
    raise exception 'Review provenance does not match the extraction job.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    v_decision_mutation := true;
  else
    v_decision_mutation :=
      new.decision_summary_json is distinct from old.decision_summary_json
      or new.reviewer_id is distinct from old.reviewer_id
      or new.reviewed_at is distinct from old.reviewed_at;
  end if;
  if v_decision_mutation then
    v_request_provenance := nullif(
      current_setting('vaeroex.document_extraction_review_provenance', true),
      ''
    );
    if v_request_provenance is distinct from v_job.review_provenance_fingerprint then
      raise exception 'The review request is not bound to current extraction provenance.' using errcode = '22023';
    end if;
  end if;

  new.review_provenance_fingerprint := v_job.review_provenance_fingerprint;
  return new;
end;
$$;

drop trigger if exists enforce_document_extraction_review_provenance_binding_v2
  on public.document_extraction_reviews;
create trigger enforce_document_extraction_review_provenance_binding_v2
  before insert or update on public.document_extraction_reviews
  for each row execute function public.enforce_document_extraction_review_provenance_binding_v2();

create or replace function public.resolve_document_extraction_job_lease_v1(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() then
    raise exception 'Active job lease not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'job_id', v_job.id,
    'workspace_id', v_job.workspace_id,
    'route', v_job.route,
    'document_class', v_job.document_class,
    'page_count', v_job.page_count,
    'cache_key', v_job.cache_key,
    'parser_model', v_job.parser_model,
    'parser_revision', v_job.parser_revision,
    'client_revision', v_job.client_revision,
    'extraction_contract_version', v_job.extraction_contract_version,
    'normalization_version', v_job.normalization_version,
    'stage', v_job.stage,
    'status', v_job.status,
    'lease_expires_at', v_job.lease_expires_at
  );
end;
$$;

-- The historical completion RPC remains available for older profiles, but it
-- cannot complete a hosted tool-call v2 job without the provenance-aware RPC.
create or replace function public.complete_document_extraction_job_v2(
  p_job_id uuid,
  p_worker_id text,
  p_artifact_fingerprint text,
  p_critical_field_manifest_json jsonb,
  p_payload_ciphertext bytea,
  p_encryption_key_version text,
  p_encryption_nonce bytea,
  p_authentication_tag bytea,
  p_aad_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_result jsonb;
  v_constraint text;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage <> 'encrypting'
    or v_job.provider_result_class <> 'success' or v_job.provider_outcome_recorded_at is null then
    raise exception 'The job is not ready for encrypted completion.' using errcode = '42501';
  end if;
  if v_job.parser_revision = 'nemotron_parse_hosted_tool_call_rest_v2'
    or v_job.client_revision = 'vaeroex_nemotron_parse_rest_v2' then
    raise exception 'Hosted tool-call v2 requires review-provenance completion.' using errcode = '22023';
  end if;

  begin
    select public.complete_document_extraction_job_v1(
      p_job_id, p_worker_id, p_artifact_fingerprint, null,
      p_critical_field_manifest_json, p_payload_ciphertext, p_encryption_key_version,
      p_encryption_nonce, p_authentication_tag, p_aad_digest
    ) into v_result;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = CONSTRAINT_NAME;
      if v_constraint = 'document_extraction_cache_key_version_nonce_unique_idx' then
        return jsonb_build_object('completed', false, 'reason', 'nonce_collision');
      end if;
      raise;
  end;

  update public.document_extraction_jobs
  set validation_result = 'passed', encryption_result = 'encrypted',
      cache_result = 'stored', updated_at = now()
  where id = p_job_id;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('completed', true);
end;
$$;

create or replace function public.complete_document_extraction_job_v3(
  p_job_id uuid,
  p_worker_id text,
  p_artifact_fingerprint text,
  p_critical_field_manifest_json jsonb,
  p_payload_ciphertext bytea,
  p_encryption_key_version text,
  p_encryption_nonce bytea,
  p_authentication_tag bytea,
  p_aad_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_existing public.document_extraction_cache%rowtype;
  v_reason text;
  v_manifest_fingerprint text;
  v_review_provenance_fingerprint text;
  v_constraint text;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or v_job.stage <> 'encrypting'
    or v_job.provider_result_class <> 'success'
    or v_job.provider_outcome_recorded_at is null
    or v_job.parser_provider <> 'nvidia'
    or v_job.parser_model <> 'nvidia/nemotron-parse'
    or v_job.parser_revision <> 'nemotron_parse_hosted_tool_call_rest_v2'
    or v_job.client_revision <> 'vaeroex_nemotron_parse_rest_v2'
    or not v_job.review_required then
    raise exception 'The job is not ready for provenance-bound completion.' using errcode = '42501';
  end if;

  v_reason := public.document_extraction_runtime_reason_v1(
    v_job.workspace_id,
    v_job.document_class,
    0
  );
  if v_reason <> 'eligible' then
    raise exception 'Pre-promotion gate denied: %', v_reason using errcode = '42501';
  end if;
  if p_artifact_fingerprint !~ '^[0-9a-f]{64}$'
    or p_payload_ciphertext is null
    or octet_length(p_payload_ciphertext) = 0
    or octet_length(p_encryption_nonce) <> 12
    or octet_length(p_authentication_tag) <> 16
    or p_aad_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid encrypted extraction completion.' using errcode = '22023';
  end if;

  v_manifest_fingerprint := public.validate_document_extraction_critical_field_manifest_v2(
    p_critical_field_manifest_json,
    p_artifact_fingerprint,
    v_job.extraction_contract_version,
    v_job.workspace_id,
    v_job.id,
    v_job.cache_key,
    v_job.page_count,
    v_job.parser_model,
    v_job.parser_revision,
    v_job.client_revision,
    v_job.normalization_version,
    v_job.required_review_version
  );
  v_review_provenance_fingerprint :=
    p_critical_field_manifest_json ->> 'review_provenance_fingerprint';

  select * into v_existing
  from public.document_extraction_cache
  where workspace_id = v_job.workspace_id and cache_key = v_job.cache_key
  for update;
  if v_existing.id is not null
    and v_existing.artifact_fingerprint <> p_artifact_fingerprint then
    raise exception 'Cache identity collision detected.' using errcode = '23505';
  end if;
  if v_existing.id is null then
    begin
      insert into public.document_extraction_cache (
        workspace_id, source_job_id, cache_key, content_hmac, provider, model,
        model_revision, client_revision, routing_policy_version,
        extraction_contract_version, normalization_version, payload_ciphertext,
        encryption_algorithm, encryption_key_version, encryption_nonce,
        authentication_tag, aad_digest, artifact_fingerprint, page_count
      ) values (
        v_job.workspace_id, v_job.id, v_job.cache_key, v_job.content_hmac,
        v_job.parser_provider, v_job.parser_model, v_job.parser_revision,
        v_job.client_revision, v_job.routing_policy_version,
        v_job.extraction_contract_version, v_job.normalization_version,
        p_payload_ciphertext, 'aes-256-gcm', p_encryption_key_version,
        p_encryption_nonce, p_authentication_tag, p_aad_digest,
        p_artifact_fingerprint, v_job.page_count
      );
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = CONSTRAINT_NAME;
        if v_constraint = 'document_extraction_cache_key_version_nonce_unique_idx' then
          return jsonb_build_object('completed', false, 'reason', 'nonce_collision');
        end if;
        raise;
    end;
  end if;

  update public.document_extraction_jobs
  set stage = 'awaiting_review',
      status = 'needs_review',
      approval_status = 'pending',
      artifact_fingerprint = p_artifact_fingerprint,
      classification_fingerprint = null,
      critical_field_manifest_json = p_critical_field_manifest_json,
      critical_field_manifest_fingerprint = v_manifest_fingerprint,
      review_provenance_fingerprint = v_review_provenance_fingerprint,
      validation_result = 'passed',
      encryption_result = 'encrypted',
      cache_result = 'stored',
      completed_at = now(),
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      last_stage_transition_at = now(),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  perform public.record_document_extraction_event_v1(
    v_job.workspace_id,
    v_job.id,
    'extraction_completed',
    'worker',
    null,
    v_job.stage,
    v_job.status,
    'review_required',
    v_job.artifact_fingerprint,
    jsonb_build_object(
      'page_count', v_job.page_count,
      'critical_field_count', jsonb_array_length(p_critical_field_manifest_json -> 'fields'),
      'manifest_fingerprint', v_manifest_fingerprint,
      'review_provenance_fingerprint', v_review_provenance_fingerprint
    ),
    gen_random_uuid()
  );
  return jsonb_build_object(
    'completed', true,
    'job_id', v_job.id,
    'status', v_job.status,
    'approval_status', v_job.approval_status
  );
end;
$$;

create or replace function public.mutate_document_extraction_review_v2(
  p_workspace_id uuid,
  p_job_id uuid,
  p_file_id uuid,
  p_action text,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_extraction_contract_version text,
  p_review_provenance_fingerprint text,
  p_review_version integer,
  p_decision_summary_json jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null
    or not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager']) then
    raise exception 'Only workspace leadership may review extracted fields.' using errcode = '42501';
  end if;
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id and workspace_id = p_workspace_id;
  if v_job.id is null
    or v_job.critical_field_manifest_json ->> 'manifest_version'
      is distinct from 'document_extraction_critical_fields_v2'
    or p_review_provenance_fingerprint !~ '^[0-9a-f]{64}$'
    or p_review_provenance_fingerprint is distinct from v_job.review_provenance_fingerprint then
    raise exception 'Review provenance is stale or invalid.' using errcode = '22023';
  end if;

  perform set_config(
    'vaeroex.document_extraction_review_provenance',
    p_review_provenance_fingerprint,
    true
  );
  select public.mutate_document_extraction_review_v1(
    p_workspace_id,
    p_job_id,
    p_file_id,
    p_action,
    p_artifact_fingerprint,
    p_classification_fingerprint,
    p_extraction_contract_version,
    p_review_version,
    p_decision_summary_json,
    p_request_id
  ) into v_result;
  perform set_config('vaeroex.document_extraction_review_provenance', '', true);
  return v_result;
end;
$$;

create or replace function public.document_extraction_authority_is_approved_v1(
  p_workspace_id uuid,
  p_file_id uuid,
  p_job_id uuid,
  p_review_id uuid,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_review_version integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_extraction_jobs job
    join public.document_extraction_file_bindings binding
      on binding.workspace_id = job.workspace_id and binding.job_id = job.id
      and binding.file_id = p_file_id and binding.is_current
    join public.document_extraction_reviews review
      on review.workspace_id = job.workspace_id and review.job_id = job.id and review.id = p_review_id
    join public.document_extraction_cache cache
      on cache.workspace_id = job.workspace_id and cache.source_job_id = job.id and cache.cache_key = job.cache_key
    join public.document_extraction_workspace_settings settings
      on settings.workspace_id = job.workspace_id
    where job.workspace_id = p_workspace_id
      and job.id = p_job_id
      and job.status = 'completed'
      and job.approval_status in ('approved', 'approved_with_corrections')
      and job.artifact_fingerprint = p_artifact_fingerprint
      and job.classification_fingerprint = p_classification_fingerprint
      and review.file_id = job.file_id
      and review.status in ('approved', 'approved_with_corrections')
      and review.review_version = p_review_version
      and review.review_version = job.required_review_version
      and review.extraction_contract_version = job.extraction_contract_version
      and review.critical_field_manifest_fingerprint = job.critical_field_manifest_fingerprint
      and (
        (
          job.review_provenance_fingerprint is null
          and review.review_provenance_fingerprint is null
          and job.critical_field_manifest_json ->> 'manifest_version'
            = 'document_extraction_critical_fields_v1'
        )
        or (
          job.review_provenance_fingerprint is not null
          and review.review_provenance_fingerprint = job.review_provenance_fingerprint
          and job.critical_field_manifest_json ->> 'review_provenance_fingerprint'
            = job.review_provenance_fingerprint
          and job.critical_field_manifest_json ->> 'manifest_version'
            = 'document_extraction_critical_fields_v2'
        )
      )
      and review.artifact_fingerprint = p_artifact_fingerprint
      and review.classification_fingerprint = p_classification_fingerprint
      and review.unresolved_field_count = 0
      and review.rejected_field_count = 0
      and review.critical_field_count = jsonb_array_length(job.critical_field_manifest_json -> 'fields')
      and cache.invalidated_at is null
      and cache.artifact_fingerprint = p_artifact_fingerprint
      and job.document_class = any(settings.allowed_document_classes)
  );
$$;

revoke execute on function public.document_extraction_workspace_binding_fingerprint_v1(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.document_extraction_job_binding_fingerprint_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.document_extraction_page_identity_fingerprint_v1(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_document_extraction_review_provenance_v1(
  jsonb, text, uuid, uuid, text, integer, text, text, text, text, integer
) from public, anon, authenticated, service_role;
revoke execute on function public.validate_document_extraction_critical_field_manifest_v2(
  jsonb, text, text, uuid, uuid, text, integer, text, text, text, text, integer
) from public, anon, authenticated, service_role;
revoke execute on function public.enforce_document_extraction_job_review_provenance_v2()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_document_extraction_review_provenance_binding_v2()
  from public, anon, authenticated, service_role;
revoke execute on function public.complete_document_extraction_job_v3(
  uuid, text, text, jsonb, bytea, text, bytea, bytea, text
) from public, anon, authenticated, service_role;
revoke execute on function public.mutate_document_extraction_review_v2(
  uuid, uuid, uuid, text, text, text, text, text, integer, jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.complete_document_extraction_job_v3(
  uuid, text, text, jsonb, bytea, text, bytea, bytea, text
) to service_role;
grant execute on function public.mutate_document_extraction_review_v2(
  uuid, uuid, uuid, text, text, text, text, text, integer, jsonb, uuid
) to authenticated;

comment on column public.document_extraction_jobs.review_provenance_fingerprint is
  'Profile-bound review identity for new v2 manifests; null preserves historical v1 records.';
comment on column public.document_extraction_reviews.review_provenance_fingerprint is
  'Review binding copied from the exact provenance-qualified extraction job.';
comment on function public.complete_document_extraction_job_v3(
  uuid, text, text, jsonb, bytea, text, bytea, bytea, text
) is 'Completes hosted tool-call v2 jobs only after strict review-provenance validation.';
comment on function public.mutate_document_extraction_review_v2(
  uuid, uuid, uuid, text, text, text, text, text, integer, jsonb, uuid
) is 'Workspace-leadership review mutation bound to the current v2 review provenance fingerprint.';
