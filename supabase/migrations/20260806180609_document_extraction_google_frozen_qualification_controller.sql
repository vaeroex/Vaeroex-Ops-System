-- Google frozen-corpus qualification controller v1
--
-- This migration is additive, synthetic-only, Preview-bound, and inert by
-- default. It wraps the existing Google Enterprise OCR job primitives with a
-- corpus-level execution claim. It does not enable document extraction, create
-- customer jobs, call a provider, or grant extracted output any authority.

create table if not exists public.document_extraction_google_qualification_state (
  singleton_key text primary key check (singleton_key = 'google_frozen_corpus_v1'),
  enabled boolean not null default false check (enabled = false or singleton_key = 'google_frozen_corpus_v1'),
  controller_version text not null default 'google_frozen_corpus_qualification_controller_v1'
    check (controller_version = 'google_frozen_corpus_qualification_controller_v1'),
  updated_at timestamptz not null default now()
);

insert into public.document_extraction_google_qualification_state (
  singleton_key, enabled, controller_version
) values (
  'google_frozen_corpus_v1', false,
  'google_frozen_corpus_qualification_controller_v1'
) on conflict (singleton_key) do nothing;

create table if not exists public.document_extraction_google_qualification_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  workspace_binding_fingerprint text not null
    check (workspace_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  controller_version text not null
    check (controller_version = 'google_frozen_corpus_qualification_controller_v1'),
  benchmark_contract_version text not null
    check (benchmark_contract_version = 'document_extraction_phase_c1_google_enterprise_ocr_v1'),
  benchmark_profile_fingerprint text not null
    check (benchmark_profile_fingerprint ~ '^[0-9a-f]{64}$'),
  fixture_source_commit text not null
    check (fixture_source_commit = 'cc3c125b01ac41513b3b92213b6daa39fa5ba91f'),
  corpus_sha256 text not null
    check (corpus_sha256 = 'c0e6b1aa615e3674e5aa418436a84555889d8766d4d8a1e3401685dbe2495dec'),
  provider_profile text not null
    check (provider_profile = 'google_document_ai_enterprise_ocr_v1'),
  processor_id text not null check (processor_id ~ '^[a-f0-9]{8,64}$'),
  processor_resource text not null check (
    processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
  ),
  processor_version text not null
    check (processor_version = 'pretrained-ocr-v2.1-2024-08-07'),
  status text not null default 'active'
    check (status in ('active', 'stopped', 'completed', 'cleaned')),
  eligible_document_limit integer not null default 8 check (eligible_document_limit = 8),
  eligible_page_limit integer not null default 9 check (eligible_page_limit = 9),
  provider_reservation_limit integer not null default 9 check (provider_reservation_limit = 9),
  provider_call_limit integer not null default 9 check (provider_call_limit = 9),
  retry_limit integer not null default 0 check (retry_limit = 0),
  concurrency_limit integer not null default 1 check (concurrency_limit = 1),
  provider_reservation_count integer not null default 0
    check (provider_reservation_count between 0 and 9),
  provider_call_count integer not null default 0
    check (provider_call_count between 0 and provider_reservation_count),
  retry_count integer not null default 0 check (retry_count = 0),
  active_fixture_index integer check (active_fixture_index between 1 and 12),
  stop_reason text check (stop_reason is null or stop_reason ~ '^[a-z][a-z0-9_]{0,119}$'),
  stopped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extraction_google_qualification_run_state_check check (
    (status = 'active' and stop_reason is null and stopped_at is null and completed_at is null)
    or (status = 'stopped' and stop_reason is not null and stopped_at is not null and completed_at is null)
    or (status = 'completed' and stop_reason is null and stopped_at is null and completed_at is not null)
    or (status = 'cleaned' and active_fixture_index is null)
  ),
  constraint document_extraction_google_qualification_processor_binding_check check (
    processor_resource like '%/processors/' || processor_id || '/processorVersions/%'
  )
);

create unique index if not exists document_extraction_google_qualification_one_active_workspace_idx
  on public.document_extraction_google_qualification_runs(workspace_binding_fingerprint)
  where status = 'active';

create table if not exists public.document_extraction_google_qualification_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.document_extraction_google_qualification_runs(id) on delete cascade,
  fixture_index integer not null check (fixture_index between 1 and 12),
  fixture_identity_fingerprint text not null
    check (fixture_identity_fingerprint ~ '^[0-9a-f]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  page_identity_fingerprints text[] not null
    check (cardinality(page_identity_fingerprints) between 1 and 2),
  page_count integer not null check (page_count between 1 and 2),
  provider_eligible boolean not null,
  local_rejection_reason text check (
    local_rejection_reason is null
    or local_rejection_reason in (
      'google_fixture_unsupported_screenshot',
      'google_fixture_unsupported_handwriting',
      'synthetic_fixture_locally_invalid'
    )
  ),
  intake_request_id uuid references public.document_extraction_intake_requests(id) on delete restrict,
  route text check (route is null or route = 'google_primary'),
  document_class text check (document_class is null or document_class in (
    'digital_pdf', 'scanned_pdf', 'image_only_pdf', 'printed_document_photo'
  )),
  assessment_fingerprint text check (
    assessment_fingerprint is null or assessment_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  content_hmac text check (content_hmac is null or content_hmac ~ '^[0-9a-f]{64}$'),
  cache_key text check (cache_key is null or cache_key ~ '^[0-9a-f]{64}$'),
  job_id uuid unique references public.document_extraction_jobs(id) on delete restrict,
  status text not null check (
    status in ('locally_rejected', 'planned', 'queued', 'processing', 'succeeded', 'failed')
  ),
  provider_reservation_count integer not null default 0
    check (provider_reservation_count between 0 and page_count),
  provider_call_count integer not null default 0
    check (provider_call_count between 0 and provider_reservation_count),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, fixture_index),
  constraint document_extraction_google_qualification_item_shape_check check (
    cardinality(page_identity_fingerprints) = page_count
    and (
      (
        provider_eligible
        and local_rejection_reason is null
        and intake_request_id is not null
        and route = 'google_primary'
        and document_class is not null
        and assessment_fingerprint is not null
        and content_hmac is not null
        and cache_key is not null
        and status in ('planned', 'queued', 'processing', 'succeeded', 'failed')
      )
      or (
        not provider_eligible
        and local_rejection_reason is not null
        and intake_request_id is null
        and route is null
        and document_class is null
        and assessment_fingerprint is null
        and content_hmac is null
        and cache_key is null
        and job_id is null
        and status = 'locally_rejected'
        and provider_reservation_count = 0
        and provider_call_count = 0
      )
    )
  )
);

create table if not exists public.document_extraction_google_qualification_page_reservations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.document_extraction_google_qualification_runs(id) on delete cascade,
  item_id uuid not null references public.document_extraction_google_qualification_items(id) on delete cascade,
  job_id uuid not null references public.document_extraction_jobs(id) on delete restrict,
  fixture_index integer not null check (fixture_index between 1 and 12),
  page_index integer not null check (page_index between 1 and 2),
  reservation_request_id uuid not null unique,
  status text not null default 'reserved' check (status in ('reserved', 'succeeded', 'failed')),
  result_class text check (
    result_class is null or result_class in (
      'success', 'transport', 'timeout', 'rate_limit', 'provider',
      'malformed_output', 'validation', 'authorization', 'ambiguous_dispatch',
      'privacy', 'provenance', 'authority', 'internal'
    )
  ),
  provider_request_started boolean,
  reserved_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, item_id, page_index),
  constraint document_extraction_google_qualification_page_state_check check (
    (status = 'reserved' and result_class is null and provider_request_started is null and finished_at is null)
    or (
      status in ('succeeded', 'failed')
      and result_class is not null
      and provider_request_started is not null
      and finished_at is not null
    )
  )
);

create unique index if not exists document_extraction_google_qualification_one_active_page_idx
  on public.document_extraction_google_qualification_page_reservations(run_id)
  where status = 'reserved';

create or replace function public.document_extraction_google_expected_fixture_v1(
  p_fixture_index integer
)
returns table (
  fixture_index integer,
  source_sha256 text,
  fixture_identity_fingerprint text,
  page_identity_fingerprints text[],
  page_count integer,
  provider_eligible boolean,
  local_rejection_reason text,
  document_class text
)
language sql
immutable
security invoker
set search_path = ''
as $$
  select expected.*
  from (values
    (1, 'e99132d7be25bc71b3fdc43faf765072b6c5c837d6d693728fc614905d9e66ec', '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1', array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[], 1, true, null::text, 'digital_pdf'::text),
    (2, 'd8bcb7a1d1e5c77d66591f621beaf33227e9f8c7779744423f4f498a338b9bad', '6dd82f859b9e0a9542614e472ef7acfe9474370cf2d62268aad3a2dbb318e0a8', array['742f58e6e58296f46a1e83543ba4bc1c1287772bc228559f92d639513398df3d']::text[], 1, true, null::text, 'image_only_pdf'::text),
    (3, 'b10eb13b980b2b2ffd2054228da05d1db0b1137f53c59524520fa7e40927a1b7', 'e4113ea7fa9de5db6d21eeb3c535d4b7462772e0d8f5c70bef57d1adc2aa77de', array['a016fc2d7e179012d591afa3ce22e55f76b61706911dc17b29e95320bce247e8']::text[], 1, true, null::text, 'scanned_pdf'::text),
    (4, '4b419b26a7993dca6c76bbd975d159ee0e7e8fa534949d95e571c7ca13aac177', '9725f7ee765f81e2b43a391915252a1aec14ac9c258668e15427d250fbf8de30', array['511c914926bd9c274f9cd8276d06a16ea0b9f0683f2d602cccb357a3cd75dada']::text[], 1, true, null::text, 'printed_document_photo'::text),
    (5, '980efc1e4e341c565452dddc4036bf05d60c592429d2a544436cfe4187e7231a', '26bfcff51a23c25f5f5335f4ebbe6ffc4deb9c6990cd7a7a91468ea6f65ad3a6', array['1f41b23c364367ba6280e58a662a5ca14bdc181d0b192d9f8d94a73cea525594']::text[], 1, false, 'google_fixture_unsupported_screenshot'::text, null::text),
    (6, 'a41424e599348924f4e54432f8535a184da3242f71e4161959c540d294c101fc', '44c1a2033e85beed6b7ab04b9a13d0a867584839b4a830522b947e35bb3ca4e0', array['d979753b942d99c9e7a4d724ca654a1f0af3cec191a88494fdbfe562fa2e7aff']::text[], 1, true, null::text, 'digital_pdf'::text),
    (7, '567fac1a7f7577965d5ed1473901ab080702b60cf0e5da932555226740708500', '7a7a9497d82433179a78a34ac928ee32eeeb0ddabea44e243e59f2dad2b5250e', array['2fc5257b958a0765e41a3e8f89db42f3f7668c985ec4f29ab2833b5ac7b0cbf7','f010b0de3acf1d892a2687e429719a66d21580271c4eefece065b0a6963c50e3']::text[], 2, true, null::text, 'digital_pdf'::text),
    (8, 'f92d4264e31bacde1da8f76f6dd4284565ba4482115193b79d6bf33ca50766d3', '5d5be2814741f0d42617572f43d13a3532e76c7f781b7a58626fa3463a225641', array['ce3dc1303a0068906e39bb3c43b481bf6a534c7a8aeeb4e9887287c9081340f4']::text[], 1, false, 'google_fixture_unsupported_screenshot'::text, null::text),
    (9, '57751b1631b3814316ec36e353e8021be559ee17a47651a526a1e693b1bad16d', 'b7cec43e78aa4ba2008f5afb2e1c6a3bd9e7d153d3f9f460c440dc1424c5d33c', array['64c5092b65f27d5b5f8bf8d8378f5ecd0b797fcf00ed7f862aa596f0638ad565']::text[], 1, false, 'google_fixture_unsupported_handwriting'::text, null::text),
    (10, '8648efaa51a68022523d85075d6d0b616fb5bcdaf4f36e5c1314062b4f6c3505', 'cd39d696adda218c76f7ff2584fd41c047ffa5549cb7e14ffcb673286ce26520', array['2cfdebb27167293a80b35ff7a44d4303caef19e7f1ea0f5a5c6e62bec17fae18']::text[], 1, true, null::text, 'digital_pdf'::text),
    (11, '83f62ad5a6683b8440d1063c1e938dbba923a82b800520c577608e504a772253', 'a638f31e799e9cea62616eedd951269f58e87cc953a0a0121e9fe6fa204ede83', array['cd9c75ac3df9789238e1491539bb18ea639f09710b93d82e5898a1646989fe5c']::text[], 1, true, null::text, 'image_only_pdf'::text),
    (12, '0322afcc2a8469d01370865916057caf6208a4eae98f4a327f2263f7977fdb32', '0fa508981f86dc612df1d99f43659524e2d09dd6fd9baf26f452989c04bd6fde', array['3368a669e953da1887f999f9f9d1ea9f62aefbfabcfb5bb17f45a09fecf7cdb7']::text[], 1, false, 'synthetic_fixture_locally_invalid'::text, null::text)
  ) as expected(
    fixture_index, source_sha256, fixture_identity_fingerprint,
    page_identity_fingerprints, page_count, provider_eligible,
    local_rejection_reason, document_class
  )
  where expected.fixture_index = p_fixture_index;
$$;

create or replace function public.set_google_frozen_qualification_enabled_v1(
  p_enabled boolean,
  p_preview_project_ref text,
  p_confirmation text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_preview_project_ref <> 'zfpnhvcmuuvtswttmnjd'
    or p_confirmation <> case when p_enabled
      then 'enable-google-frozen-corpus-controller-v1'
      else 'disable-google-frozen-corpus-controller-v1'
    end then
    raise exception 'Google qualification controller confirmation is invalid.' using errcode = '42501';
  end if;
  update public.document_extraction_google_qualification_state
  set enabled = p_enabled, updated_at = now()
  where singleton_key = 'google_frozen_corpus_v1';
  return found;
end;
$$;

create or replace function public.prepare_google_frozen_qualification_v1(
  p_request_id uuid,
  p_preview_project_ref text,
  p_confirmation text,
  p_benchmark_profile_fingerprint text,
  p_processor_id text,
  p_processor_resource text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item jsonb;
  v_expected record;
  v_intake public.document_extraction_intake_requests%rowtype;
  v_workspace_id uuid;
  v_observed_workspace_id uuid;
  v_page_identities text[];
  v_eligible_documents integer := 0;
  v_eligible_pages integer := 0;
begin
  if p_preview_project_ref <> 'zfpnhvcmuuvtswttmnjd'
    or p_confirmation <> 'prepare-google-frozen-corpus-controller-v1'
    or p_request_id is null
    or p_benchmark_profile_fingerprint !~ '^[0-9a-f]{64}$'
    or p_processor_id !~ '^[a-f0-9]{8,64}$'
    or p_processor_resource !~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
    or p_processor_resource not like '%/processors/' || p_processor_id || '/processorVersions/%'
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) <> 12 then
    raise exception 'Google qualification plan envelope is invalid.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.document_extraction_google_qualification_state
    where singleton_key = 'google_frozen_corpus_v1' and enabled
  ) then
    raise exception 'Google qualification controller is disabled.' using errcode = '42501';
  end if;

  select * into v_run
  from public.document_extraction_google_qualification_runs
  where request_id = p_request_id
  for update;
  if v_run.id is not null then
    return jsonb_build_object(
      'run_id', v_run.id, 'status', v_run.status, 'idempotent', true,
      'eligible_documents', v_run.eligible_document_limit,
      'eligible_pages', v_run.eligible_page_limit
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items) value loop
    if jsonb_typeof(v_item) <> 'object'
      or (v_item ->> 'fixture_index') !~ '^(?:[1-9]|1[0-2])$' then
      raise exception 'Google qualification item is malformed.' using errcode = '22023';
    end if;
    select * into v_expected
    from public.document_extraction_google_expected_fixture_v1(
      (v_item ->> 'fixture_index')::integer
    );
    select coalesce(array_agg(value order by ordinal), '{}'::text[])
      into v_page_identities
    from jsonb_array_elements_text(v_item -> 'page_identity_fingerprints')
      with ordinality page(value, ordinal);
    if v_expected.fixture_index is null
      or v_item ->> 'source_sha256' is distinct from v_expected.source_sha256
      or v_item ->> 'fixture_identity_fingerprint'
        is distinct from v_expected.fixture_identity_fingerprint
      or v_page_identities is distinct from v_expected.page_identity_fingerprints
      or (v_item ->> 'provider_eligible')::boolean
        is distinct from v_expected.provider_eligible
      or v_item ->> 'local_rejection_reason'
        is distinct from v_expected.local_rejection_reason
      or v_item ->> 'document_class' is distinct from v_expected.document_class then
      raise exception 'Google qualification fixture identity is not approved.' using errcode = '22023';
    end if;

    if v_expected.provider_eligible then
      if (select count(*) from jsonb_object_keys(v_item)) <> 11
        or exists (
          select 1 from jsonb_object_keys(v_item) key
          where key not in (
            'fixture_index', 'source_sha256', 'fixture_identity_fingerprint',
            'page_identity_fingerprints', 'provider_eligible',
            'local_rejection_reason', 'document_class', 'intake_request_id',
            'assessment_fingerprint', 'content_hmac', 'cache_key'
          )
        )
        or v_item ->> 'assessment_fingerprint' !~ '^[0-9a-f]{64}$'
        or v_item ->> 'content_hmac' !~ '^[0-9a-f]{64}$'
        or v_item ->> 'cache_key' !~ '^[0-9a-f]{64}$' then
        raise exception 'Eligible Google qualification fixture binding is invalid.' using errcode = '22023';
      end if;
      select * into v_intake
      from public.document_extraction_intake_requests
      where id = (v_item ->> 'intake_request_id')::uuid
        and status = 'requested'
      for update;
      if v_intake.id is null then
        raise exception 'Eligible Google qualification intake is unavailable.' using errcode = '42501';
      end if;
      v_observed_workspace_id := v_intake.workspace_id;
      if v_workspace_id is null then v_workspace_id := v_observed_workspace_id; end if;
      if v_workspace_id <> v_observed_workspace_id
        or public.document_extraction_runtime_reason_v2(
          v_workspace_id, v_expected.document_class, 0
        ) <> 'eligible' then
        raise exception 'Google qualification workspace is not eligible.' using errcode = '42501';
      end if;
      v_eligible_documents := v_eligible_documents + 1;
      v_eligible_pages := v_eligible_pages + v_expected.page_count;
    else
      if (select count(*) from jsonb_object_keys(v_item)) <> 7
        or exists (
          select 1 from jsonb_object_keys(v_item) key
          where key not in (
            'fixture_index', 'source_sha256', 'fixture_identity_fingerprint',
            'page_identity_fingerprints', 'provider_eligible',
            'local_rejection_reason', 'document_class'
          )
        ) then
        raise exception 'Locally rejected Google qualification fixture carries execution state.' using errcode = '22023';
      end if;
    end if;
  end loop;

  if v_workspace_id is null or v_eligible_documents <> 8 or v_eligible_pages <> 9 then
    raise exception 'Google qualification plan bounds are invalid.' using errcode = '22023';
  end if;
  perform 1 from public.document_extraction_workspace_settings
  where workspace_id = v_workspace_id
    and monthly_page_limit - pages_reserved - pages_consumed >= 9
  for update;
  if not found then
    raise exception 'Google qualification page quota is unavailable.' using errcode = '42501';
  end if;

  insert into public.document_extraction_google_qualification_runs (
    request_id, workspace_binding_fingerprint, controller_version,
    benchmark_contract_version, benchmark_profile_fingerprint,
    fixture_source_commit, corpus_sha256, provider_profile,
    processor_id, processor_resource, processor_version
  ) values (
    p_request_id,
    public.document_extraction_workspace_binding_fingerprint_v1(v_workspace_id),
    'google_frozen_corpus_qualification_controller_v1',
    'document_extraction_phase_c1_google_enterprise_ocr_v1',
    p_benchmark_profile_fingerprint,
    'cc3c125b01ac41513b3b92213b6daa39fa5ba91f',
    'c0e6b1aa615e3674e5aa418436a84555889d8766d4d8a1e3401685dbe2495dec',
    'google_document_ai_enterprise_ocr_v1', p_processor_id,
    p_processor_resource, 'pretrained-ocr-v2.1-2024-08-07'
  ) returning * into v_run;

  for v_item in select value from jsonb_array_elements(p_items) value loop
    select * into v_expected
    from public.document_extraction_google_expected_fixture_v1(
      (v_item ->> 'fixture_index')::integer
    );
    select array_agg(value order by ordinal) into v_page_identities
    from jsonb_array_elements_text(v_item -> 'page_identity_fingerprints')
      with ordinality page(value, ordinal);
    insert into public.document_extraction_google_qualification_items (
      run_id, fixture_index, fixture_identity_fingerprint, source_sha256,
      page_identity_fingerprints, page_count, provider_eligible,
      local_rejection_reason, intake_request_id, route, document_class,
      assessment_fingerprint, content_hmac, cache_key, status
    ) values (
      v_run.id, v_expected.fixture_index, v_expected.fixture_identity_fingerprint,
      v_expected.source_sha256, v_page_identities, v_expected.page_count,
      v_expected.provider_eligible, v_expected.local_rejection_reason,
      case when v_expected.provider_eligible
        then (v_item ->> 'intake_request_id')::uuid else null end,
      case when v_expected.provider_eligible then 'google_primary' else null end,
      v_expected.document_class,
      case when v_expected.provider_eligible
        then v_item ->> 'assessment_fingerprint' else null end,
      case when v_expected.provider_eligible
        then v_item ->> 'content_hmac' else null end,
      case when v_expected.provider_eligible
        then v_item ->> 'cache_key' else null end,
      case when v_expected.provider_eligible then 'planned' else 'locally_rejected' end
    );
  end loop;
  return jsonb_build_object(
    'run_id', v_run.id, 'status', v_run.status, 'idempotent', false,
    'eligible_documents', 8, 'eligible_pages', 9,
    'local_rejections', 4, 'provider_call_limit', 9,
    'retry_limit', 0, 'concurrency_limit', 1
  );
end;
$$;

create or replace function public.enqueue_next_google_frozen_qualification_item_v1(
  p_run_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_enqueue jsonb;
  v_job_id uuid;
begin
  select * into v_run
  from public.document_extraction_google_qualification_runs
  where id = p_run_id
  for update;
  if v_run.id is null or v_run.status <> 'active'
    or v_run.active_fixture_index is not null
    or not exists (
      select 1 from public.document_extraction_google_qualification_state
      where singleton_key = 'google_frozen_corpus_v1' and enabled
    ) then
    return jsonb_build_object('enqueued', false, 'reason', 'qualification_not_active');
  end if;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where run_id = v_run.id and provider_eligible and status = 'planned'
  order by fixture_index
  for update skip locked
  limit 1;
  if v_item.id is null then
    return jsonb_build_object('enqueued', false, 'reason', 'qualification_plan_exhausted');
  end if;
  select public.enqueue_google_document_extraction_job_v1(
    v_item.intake_request_id, 'google_primary', v_item.document_class,
    v_item.assessment_fingerprint, v_item.page_count, 'google_document_ai',
    'pretrained-ocr-v2.1-2024-08-07',
    'google_document_ai_enterprise_ocr_v1',
    'vaeroex_google_document_ai_rest_v1', v_item.content_hmac,
    v_item.cache_key, 'document_extraction_routing_v1',
    'document_extraction_artifact_v2', 'document_extraction_normalization_v2',
    'google_document_ai_enterprise_ocr_v1', 'OCR_PROCESSOR',
    v_run.processor_id, v_run.processor_resource, 'us',
    'pretrained-ocr-v2.1-2024-08-07',
    'google_document_ai_processor_version_process_v1',
    'google_document_ai_process_request_v1',
    'google_document_ai_process_response_v2',
    'google_document_ai_layout_normalization_v2',
    'google_document_ai_enterprise_ocr_strict_v1',
    'tables_if_present_strict_v1',
    'preserve_for_review_never_authority_v1', 'disabled_v1',
    'document_extraction_review_provenance_v2'
  ) into v_enqueue;
  v_job_id := (v_enqueue ->> 'job_id')::uuid;
  if v_job_id is null
    or v_enqueue ->> 'status' <> 'queued'
    or coalesce((v_enqueue ->> 'idempotent')::boolean, false)
    or coalesce((v_enqueue ->> 'cache_hit')::boolean, false) then
    update public.document_extraction_google_qualification_runs
    set status = 'stopped', stop_reason = 'eligible_job_enqueue_rejected',
        stopped_at = now(), updated_at = now()
    where id = v_run.id;
    return jsonb_build_object('enqueued', false, 'reason', 'eligible_job_enqueue_rejected');
  end if;
  update public.document_extraction_google_qualification_items
  set job_id = v_job_id, status = 'queued', updated_at = now()
  where id = v_item.id;
  update public.document_extraction_google_qualification_runs
  set active_fixture_index = v_item.fixture_index, updated_at = now()
  where id = v_run.id;
  return jsonb_build_object(
    'enqueued', true, 'run_id', v_run.id, 'job_id', v_job_id,
    'fixture_index', v_item.fixture_index, 'page_count', v_item.page_count,
    'request_id', p_request_id
  );
end;
$$;

create or replace function public.claim_google_frozen_qualification_job_v1(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.document_extraction_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid Google qualification worker lease request.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.document_extraction_google_qualification_state
    where singleton_key = 'google_frozen_corpus_v1' and enabled
  ) then return; end if;
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  where run.status = 'active' and run.active_fixture_index is not null
  order by run.created_at
  for update skip locked
  limit 1;
  if v_run.id is null then return; end if;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where run_id = v_run.id and fixture_index = v_run.active_fixture_index
    and provider_eligible and status = 'queued' and job_id is not null
  for update;
  select job.* into v_job
  from public.document_extraction_jobs job
  where job.id = v_item.job_id and job.status = 'queued' and job.attempts = 0
    and job.max_attempts = 1 and job.retry_count = 0
    and public.document_extraction_google_job_identity_is_exact_v1(job)
  for update of job skip locked;
  if v_job.id is null then return; end if;
  update public.document_extraction_jobs
  set status = 'processing', stage = 'leased', attempts = 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(started_at, now()),
      broker_protocol_version = 'document_extraction_broker_v2',
      worker_runtime_version = 'document_extraction_worker_v2',
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id
  returning * into v_job;
  update public.document_extraction_google_qualification_items
  set status = 'processing', updated_at = now() where id = v_item.id;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'google_qualification_job_claimed', 'worker',
    null, v_job.stage, v_job.status, null, null,
    jsonb_build_object('provider_profile', v_job.provider_profile), gen_random_uuid()
  );
  return next v_job;
end;
$$;

create or replace function public.assert_google_frozen_qualification_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_operation text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_operation not in (
    'heartbeat', 'file_access', 'advance', 'dispatch', 'provider_boundary',
    'provider_outcome', 'complete', 'fail'
  ) then
    raise exception 'Unknown Google qualification operation.' using errcode = '22023';
  end if;
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  join public.document_extraction_google_qualification_items item
    on item.run_id = run.id and item.job_id = p_job_id
  where run.active_fixture_index = item.fixture_index;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where run_id = v_run.id and job_id = p_job_id;
  select * into v_job from public.document_extraction_jobs where id = p_job_id;
  if v_run.id is null or v_item.id is null or v_job.id is null
    or not v_item.provider_eligible or v_item.status <> 'processing'
    or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or v_run.provider_profile <> v_job.provider_profile
    or v_run.processor_id <> v_job.processor_id
    or v_run.processor_resource <> v_job.processor_resource
    or (
      v_run.status <> 'active'
      and p_operation not in ('provider_outcome', 'fail')
    )
    or (
      p_operation not in ('provider_outcome', 'fail')
      and not exists (
        select 1 from public.document_extraction_google_qualification_state
        where singleton_key = 'google_frozen_corpus_v1' and enabled
      )
    ) then
    raise exception 'Google qualification job operation is not authorized.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'authorized', true, 'run_id', v_run.id,
    'item_id', v_item.id, 'fixture_index', v_item.fixture_index,
    'page_count', v_item.page_count
  );
end;
$$;

create or replace function public.reserve_google_frozen_qualification_page_v1(
  p_job_id uuid,
  p_worker_id text,
  p_page_index integer,
  p_reservation_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_reservation public.document_extraction_google_qualification_page_reservations%rowtype;
  v_reason text;
  v_runtime_reason text;
begin
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  join public.document_extraction_google_qualification_items item on item.run_id = run.id
  where item.job_id = p_job_id
  for update of run;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where run_id = v_run.id and job_id = p_job_id
  for update;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  v_reason := null;
  if v_run.id is null or v_item.id is null or v_job.id is null then
    raise exception 'Google qualification page binding is unavailable.' using errcode = '42501';
  elsif v_run.status <> 'active'
    or not exists (
      select 1 from public.document_extraction_google_qualification_state
      where singleton_key = 'google_frozen_corpus_v1' and enabled
    ) then v_reason := 'qualification_not_active';
  elsif v_run.active_fixture_index <> v_item.fixture_index
    or not v_item.provider_eligible or v_item.status <> 'processing' then
    v_reason := 'qualification_fixture_mismatch';
  elsif v_job.status <> 'processing' or v_job.stage <> 'provider_dispatched'
    or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at <= now()
    or v_job.provider_dispatched_at is null or v_job.provider_call_count <> 1 then
    v_reason := 'qualification_lease_mismatch';
  elsif not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or v_run.provider_profile <> v_job.provider_profile
    or v_run.processor_id <> v_job.processor_id
    or v_run.processor_resource <> v_job.processor_resource then
    v_reason := 'qualification_identity_mismatch';
  elsif v_job.retry_count <> 0 or v_run.retry_count <> 0 then
    v_reason := 'qualification_retry_detected';
  elsif p_page_index <> v_item.provider_reservation_count + 1
    or p_page_index not between 1 and v_item.page_count then
    v_reason := 'qualification_page_sequence_invalid';
  elsif p_reservation_request_id is null
    or exists (
      select 1 from public.document_extraction_google_qualification_page_reservations
      where reservation_request_id = p_reservation_request_id
        or (run_id = v_run.id and item_id = v_item.id and page_index = p_page_index)
        or (run_id = v_run.id and status = 'reserved')
    ) then v_reason := 'qualification_duplicate_provider_reservation';
  elsif v_run.provider_reservation_count >= v_run.provider_reservation_limit
    or v_run.provider_call_count >= v_run.provider_call_limit then
    v_reason := 'qualification_call_budget_exceeded';
  end if;
  if v_reason is null then
    v_runtime_reason := public.document_extraction_runtime_reason_v2(
      v_job.workspace_id, v_job.document_class, 0
    );
    if v_runtime_reason <> 'eligible' then
      v_reason := 'qualification_runtime_gate_denied';
    end if;
  end if;
  if v_reason is not null then
    update public.document_extraction_google_qualification_runs
    set status = 'stopped', stop_reason = coalesce(stop_reason, v_reason),
        stopped_at = coalesce(stopped_at, now()), updated_at = now()
    where id = v_run.id and status = 'active';
    return jsonb_build_object('authorized', false, 'reason', v_reason);
  end if;
  insert into public.document_extraction_google_qualification_page_reservations (
    run_id, item_id, job_id, fixture_index, page_index,
    reservation_request_id
  ) values (
    v_run.id, v_item.id, v_job.id, v_item.fixture_index,
    p_page_index, p_reservation_request_id
  ) returning * into v_reservation;
  update public.document_extraction_google_qualification_runs
  set provider_reservation_count = provider_reservation_count + 1,
      updated_at = now()
  where id = v_run.id;
  update public.document_extraction_google_qualification_items
  set provider_reservation_count = provider_reservation_count + 1,
      updated_at = now()
  where id = v_item.id;
  update public.document_extraction_jobs
  set heartbeat_at = now(), lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
  where id = v_job.id
  returning * into v_job;
  return jsonb_build_object(
    'authorized', true, 'reservation_id', v_reservation.id,
    'page_index', p_page_index,
    'lease_expires_at', v_job.lease_expires_at,
    'remaining_reservations', v_run.provider_reservation_limit
      - v_run.provider_reservation_count - 1
  );
end;
$$;

create or replace function public.record_google_frozen_qualification_page_outcome_v1(
  p_reservation_id uuid,
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_result_class text,
  p_provider_request_started boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.document_extraction_google_qualification_page_reservations%rowtype;
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_job public.document_extraction_jobs%rowtype;
begin
  select * into v_reservation
  from public.document_extraction_google_qualification_page_reservations
  where id = p_reservation_id and job_id = p_job_id
  for update;
  select * into v_run
  from public.document_extraction_google_qualification_runs
  where id = v_reservation.run_id for update;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where id = v_reservation.item_id for update;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_reservation.id is null or v_reservation.status <> 'reserved'
    or v_run.id is null or v_item.id is null
    or v_item.run_id <> v_run.id or v_item.job_id <> p_job_id
    or not v_item.provider_eligible or v_item.status <> 'processing'
    or v_job.id is null or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at <= now()
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or v_run.provider_profile <> v_job.provider_profile
    or v_run.processor_id <> v_job.processor_id
    or v_run.processor_resource <> v_job.processor_resource
    or p_result_class not in (
      'success', 'transport', 'timeout', 'rate_limit', 'provider',
      'malformed_output', 'validation', 'authorization',
      'ambiguous_dispatch', 'privacy', 'provenance', 'authority', 'internal'
    )
    or (p_succeeded and (p_result_class <> 'success' or not p_provider_request_started))
    or (not p_succeeded and p_result_class = 'success') then
    raise exception 'Google qualification page outcome is invalid.' using errcode = '42501';
  end if;
  update public.document_extraction_google_qualification_page_reservations
  set status = case when p_succeeded then 'succeeded' else 'failed' end,
      result_class = p_result_class,
      provider_request_started = p_provider_request_started,
      finished_at = now()
  where id = v_reservation.id;
  if p_provider_request_started then
    update public.document_extraction_google_qualification_runs
    set provider_call_count = provider_call_count + 1, updated_at = now()
    where id = v_run.id and provider_call_count < provider_call_limit;
    if not found then
      raise exception 'Google qualification provider call ceiling was exceeded.' using errcode = '42501';
    end if;
    update public.document_extraction_google_qualification_items
    set provider_call_count = provider_call_count + 1, updated_at = now()
    where id = v_item.id and provider_call_count < provider_reservation_count;
    if not found then
      raise exception 'Google qualification item call accounting was rejected.' using errcode = '42501';
    end if;
  end if;
  if not p_succeeded then
    update public.document_extraction_google_qualification_runs
    set status = 'stopped', stop_reason = coalesce(stop_reason,
          case when p_result_class = 'ambiguous_dispatch'
            then 'qualification_ambiguous_dispatch' else 'qualification_provider_failure' end),
        stopped_at = coalesce(stopped_at, now()), updated_at = now()
    where id = v_run.id and status = 'active';
    update public.document_extraction_google_qualification_items
    set status = 'failed', updated_at = now() where id = v_item.id;
  end if;
  return jsonb_build_object(
    'recorded', true, 'run_active', p_succeeded and v_run.status = 'active',
    'provider_request_started', p_provider_request_started
  );
end;
$$;

create or replace function public.finish_google_frozen_qualification_item_v1(
  p_run_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_job public.document_extraction_jobs%rowtype;
begin
  select * into v_run
  from public.document_extraction_google_qualification_runs
  where id = p_run_id for update;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where run_id = p_run_id and job_id = p_job_id for update;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_run.id is null or v_run.status <> 'active'
    or v_run.active_fixture_index <> v_item.fixture_index
    or v_item.status <> 'processing' or not v_item.provider_eligible
    or v_job.id is null or v_job.status <> 'needs_review'
    or v_job.stage <> 'awaiting_review' or v_job.approval_status <> 'pending'
    or v_job.validation_result <> 'passed' or v_job.encryption_result <> 'encrypted'
    or v_job.retry_count <> 0
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or v_item.provider_reservation_count <> v_item.page_count
    or v_item.provider_call_count <> v_item.page_count
    or (
      select count(*) from public.document_extraction_google_qualification_page_reservations
      where item_id = v_item.id and status = 'succeeded'
        and result_class = 'success' and provider_request_started
    ) <> v_item.page_count then
    update public.document_extraction_google_qualification_runs
    set status = 'stopped', stop_reason = coalesce(stop_reason,
          'qualification_review_boundary_mismatch'),
        stopped_at = coalesce(stopped_at, now()), updated_at = now()
    where id = p_run_id and status = 'active';
    return jsonb_build_object(
      'finished', false, 'reason', 'qualification_review_boundary_mismatch'
    );
  end if;
  update public.document_extraction_google_qualification_items
  set status = 'succeeded', updated_at = now() where id = v_item.id;
  update public.document_extraction_google_qualification_runs
  set active_fixture_index = null, updated_at = now() where id = v_run.id;
  return jsonb_build_object(
    'finished', true, 'fixture_index', v_item.fixture_index,
    'provider_calls', v_item.provider_call_count
  );
end;
$$;

create or replace function public.stop_google_frozen_qualification_v1(
  p_run_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
begin
  if p_reason !~ '^[a-z][a-z0-9_]{0,119}$' then
    raise exception 'Google qualification stop reason is invalid.' using errcode = '22023';
  end if;
  select * into v_run
  from public.document_extraction_google_qualification_runs
  where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Google qualification run was not found.' using errcode = 'P0002';
  end if;
  if v_run.status = 'active' then
    update public.document_extraction_google_qualification_runs
    set status = 'stopped', stop_reason = p_reason,
        stopped_at = now(), updated_at = now()
    where id = v_run.id returning * into v_run;
  end if;
  return jsonb_build_object(
    'stopped', v_run.status = 'stopped', 'status', v_run.status,
    'reason', v_run.stop_reason
  );
end;
$$;

create or replace function public.complete_google_frozen_qualification_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_eligible_succeeded integer;
  v_local_rejected integer;
begin
  select * into v_run
  from public.document_extraction_google_qualification_runs
  where id = p_run_id for update;
  select count(*) filter (where provider_eligible and status = 'succeeded'),
         count(*) filter (where not provider_eligible and status = 'locally_rejected')
    into v_eligible_succeeded, v_local_rejected
  from public.document_extraction_google_qualification_items
  where run_id = p_run_id;
  if v_run.id is null or v_run.status <> 'active'
    or v_run.active_fixture_index is not null
    or v_eligible_succeeded <> 8 or v_local_rejected <> 4
    or v_run.provider_reservation_count <> 9
    or v_run.provider_call_count <> 9 or v_run.retry_count <> 0
    or exists (
      select 1 from public.document_extraction_google_qualification_page_reservations
      where run_id = p_run_id and status <> 'succeeded'
    ) then
    return jsonb_build_object(
      'completed', false, 'reason', 'qualification_completion_incomplete'
    );
  end if;
  update public.document_extraction_google_qualification_runs
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_run.id;
  return jsonb_build_object(
    'completed', true, 'eligible_documents', 8, 'eligible_pages', 9,
    'provider_reservations', 9, 'provider_calls', 9,
    'retries', 0, 'concurrency', 1
  );
end;
$$;

create or replace function public.get_google_frozen_qualification_status_v1(
  p_run_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'run_id', run.id, 'status', run.status,
    'active_fixture_index', run.active_fixture_index,
    'stop_reason', run.stop_reason,
    'eligible_documents', count(*) filter (where item.provider_eligible),
    'eligible_pages', coalesce(sum(item.page_count) filter (where item.provider_eligible), 0),
    'local_rejections', count(*) filter (where not item.provider_eligible),
    'succeeded_documents', count(*) filter (where item.status = 'succeeded'),
    'provider_reservations', run.provider_reservation_count,
    'provider_calls', run.provider_call_count,
    'retries', run.retry_count,
    'concurrency', run.concurrency_limit
  )
  from public.document_extraction_google_qualification_runs run
  join public.document_extraction_google_qualification_items item on item.run_id = run.id
  where run.id = p_run_id
  group by run.id;
$$;

create or replace function public.cleanup_google_frozen_qualification_v1(
  p_run_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
begin
  if p_confirmation <> 'cleanup-google-frozen-corpus-controller-v1' then
    raise exception 'Google qualification cleanup confirmation is invalid.' using errcode = '42501';
  end if;
  select * into v_run
  from public.document_extraction_google_qualification_runs
  where id = p_run_id for update;
  if v_run.id is null or v_run.status not in ('stopped', 'completed')
    or exists (
      select 1 from public.document_extraction_google_qualification_state
      where singleton_key = 'google_frozen_corpus_v1' and enabled
    )
    or exists (
      select 1 from public.document_extraction_google_qualification_page_reservations
      where run_id = p_run_id and status = 'reserved'
    )
    or exists (
      select 1 from public.document_extraction_google_qualification_items item
      join public.document_extraction_jobs job on job.id = item.job_id
      where item.run_id = p_run_id and job.status in ('queued', 'processing')
    ) then
    raise exception 'Google qualification controller state is not cleanup-safe.' using errcode = '42501';
  end if;
  delete from public.document_extraction_google_qualification_runs where id = p_run_id;
  return jsonb_build_object('cleaned', true);
end;
$$;

alter table public.document_extraction_google_qualification_state enable row level security;
alter table public.document_extraction_google_qualification_runs enable row level security;
alter table public.document_extraction_google_qualification_items enable row level security;
alter table public.document_extraction_google_qualification_page_reservations enable row level security;

revoke all on table public.document_extraction_google_qualification_state
  from public, anon, authenticated, service_role;
revoke all on table public.document_extraction_google_qualification_runs
  from public, anon, authenticated, service_role;
revoke all on table public.document_extraction_google_qualification_items
  from public, anon, authenticated, service_role;
revoke all on table public.document_extraction_google_qualification_page_reservations
  from public, anon, authenticated, service_role;

revoke execute on function public.document_extraction_google_expected_fixture_v1(integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_google_frozen_qualification_enabled_v1(boolean, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.prepare_google_frozen_qualification_v1(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_next_google_frozen_qualification_item_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.claim_google_frozen_qualification_job_v1(text, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.assert_google_frozen_qualification_job_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reserve_google_frozen_qualification_page_v1(uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.record_google_frozen_qualification_page_outcome_v1(uuid, uuid, text, boolean, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.finish_google_frozen_qualification_item_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.stop_google_frozen_qualification_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.complete_google_frozen_qualification_v1(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_google_frozen_qualification_status_v1(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.cleanup_google_frozen_qualification_v1(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.set_google_frozen_qualification_enabled_v1(boolean, text, text)
  to service_role;
grant execute on function public.prepare_google_frozen_qualification_v1(uuid, text, text, text, text, text, jsonb)
  to service_role;
grant execute on function public.enqueue_next_google_frozen_qualification_item_v1(uuid, uuid)
  to service_role;
grant execute on function public.claim_google_frozen_qualification_job_v1(text, integer)
  to service_role;
grant execute on function public.assert_google_frozen_qualification_job_v1(uuid, text, text)
  to service_role;
grant execute on function public.reserve_google_frozen_qualification_page_v1(uuid, text, integer, uuid)
  to service_role;
grant execute on function public.record_google_frozen_qualification_page_outcome_v1(uuid, uuid, text, boolean, text, boolean)
  to service_role;
grant execute on function public.finish_google_frozen_qualification_item_v1(uuid, uuid)
  to service_role;
grant execute on function public.stop_google_frozen_qualification_v1(uuid, text)
  to service_role;
grant execute on function public.complete_google_frozen_qualification_v1(uuid)
  to service_role;
grant execute on function public.get_google_frozen_qualification_status_v1(uuid)
  to service_role;
grant execute on function public.cleanup_google_frozen_qualification_v1(uuid, text)
  to service_role;

comment on table public.document_extraction_google_qualification_runs is
  'Content-free, synthetic-only Preview qualification state. It grants no document authority.';
comment on function public.reserve_google_frozen_qualification_page_v1(uuid, text, integer, uuid) is
  'Atomic pre-network page reservation for the exact 8-document/9-page Google frozen corpus.';
