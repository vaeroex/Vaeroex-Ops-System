insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-agreements',
  'workspace-agreements',
  false,
  5242880,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.workspace_agreements (
  id uuid primary key,
  workspace_id uuid not null unique references public.workspaces(id),
  organization_name text not null,
  owner_legal_name text not null,
  owner_job_title text not null,
  owner_business_email text not null,
  business_type text not null,
  team_size text,
  number_of_locations text,
  agreement_version text not null,
  terms_version text not null,
  privacy_version text not null,
  agreement_text text not null,
  agreement_snapshot_json jsonb not null,
  typed_signature text not null,
  signed_at timestamptz not null,
  authenticated_user_id uuid not null references public.profiles(id),
  application_version text not null,
  immutable_hash text not null unique check (immutable_hash ~ '^[0-9a-f]{64}$'),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_size_bytes bigint not null check (pdf_size_bytes > 0),
  storage_bucket text not null check (storage_bucket = 'workspace-agreements'),
  storage_path text not null unique,
  record_class text not null default 'legal_agreement' check (record_class = 'legal_agreement'),
  business_memory_eligible boolean not null default false check (business_memory_eligible = false),
  evidence_eligible boolean not null default false check (evidence_eligible = false),
  embedding_eligible boolean not null default false check (embedding_eligible = false),
  executive_intelligence_eligible boolean not null default false check (executive_intelligence_eligible = false),
  retrieval_eligible boolean not null default false check (retrieval_eligible = false),
  created_at timestamptz not null
);

create index if not exists workspace_agreements_owner_email_idx
  on public.workspace_agreements(lower(owner_business_email), signed_at desc);

create index if not exists workspace_agreements_organization_idx
  on public.workspace_agreements(lower(organization_name), signed_at desc);

create index if not exists workspace_agreements_signed_at_idx
  on public.workspace_agreements(signed_at desc);

alter table public.workspace_agreements enable row level security;

drop policy if exists "workspace agreement members read" on public.workspace_agreements;
create policy "workspace agreement members read"
  on public.workspace_agreements for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.workspace_agreements from anon, authenticated;
grant select on public.workspace_agreements to authenticated;
grant select, insert on public.workspace_agreements to service_role;

create or replace function public.reject_workspace_agreement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'Workspace Agreements are immutable legal records.';
end;
$$;

drop trigger if exists workspace_agreements_immutable on public.workspace_agreements;
create trigger workspace_agreements_immutable
  before update or delete on public.workspace_agreements
  for each row execute function public.reject_workspace_agreement_mutation();

revoke all on function public.reject_workspace_agreement_mutation() from public, anon, authenticated;

create or replace function public.create_workspace_with_signed_agreement(
  p_workspace_id uuid,
  p_agreement_id uuid,
  p_user_id uuid,
  p_organization_name text,
  p_owner_legal_name text,
  p_owner_job_title text,
  p_owner_business_email text,
  p_business_type text,
  p_team_size text,
  p_number_of_locations text,
  p_subscription_status text,
  p_plan_slug text,
  p_subscription_required boolean,
  p_manually_unlocked boolean,
  p_agreement_version text,
  p_terms_version text,
  p_privacy_version text,
  p_agreement_text text,
  p_agreement_snapshot_json jsonb,
  p_typed_signature text,
  p_signed_at timestamptz,
  p_application_version text,
  p_immutable_hash text,
  p_pdf_sha256 text,
  p_pdf_size_bytes bigint,
  p_storage_bucket text,
  p_storage_path text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_workspace_id is null or p_agreement_id is null or p_user_id is null then
    raise exception 'Workspace, agreement, and authenticated user identifiers are required.';
  end if;

  if nullif(btrim(p_organization_name), '') is null
    or nullif(btrim(p_owner_legal_name), '') is null
    or nullif(btrim(p_owner_job_title), '') is null
    or nullif(btrim(p_owner_business_email), '') is null
    or nullif(btrim(p_business_type), '') is null then
    raise exception 'Required workspace and owner fields are missing.';
  end if;

  if nullif(btrim(p_agreement_version), '') is null
    or nullif(btrim(p_terms_version), '') is null
    or nullif(btrim(p_privacy_version), '') is null
    or nullif(btrim(p_agreement_text), '') is null
    or nullif(btrim(p_typed_signature), '') is null
    or nullif(btrim(p_application_version), '') is null then
    raise exception 'Agreement generation or policy versions are unavailable.';
  end if;

  if p_immutable_hash !~ '^[0-9a-f]{64}$'
    or p_pdf_sha256 !~ '^[0-9a-f]{64}$'
    or p_pdf_size_bytes <= 0 then
    raise exception 'Agreement integrity metadata is invalid.';
  end if;

  if p_storage_bucket <> 'workspace-agreements'
    or p_storage_path <> concat(p_workspace_id::text, '/', p_agreement_id::text, '.pdf') then
    raise exception 'Agreement storage attribution is invalid.';
  end if;

  if p_agreement_snapshot_json->>'agreementId' is distinct from p_agreement_id::text
    or p_agreement_snapshot_json->>'workspaceId' is distinct from p_workspace_id::text
    or p_agreement_snapshot_json->>'agreementVersion' is distinct from p_agreement_version
    or p_agreement_snapshot_json->>'termsVersion' is distinct from p_terms_version
    or p_agreement_snapshot_json->>'privacyVersion' is distinct from p_privacy_version
    or p_agreement_snapshot_json->>'organizationName' is distinct from btrim(p_organization_name)
    or p_agreement_snapshot_json#>>'{owner,legalName}' is distinct from btrim(p_owner_legal_name)
    or p_agreement_snapshot_json#>>'{owner,jobTitle}' is distinct from btrim(p_owner_job_title)
    or lower(p_agreement_snapshot_json#>>'{owner,businessEmail}') is distinct from lower(btrim(p_owner_business_email))
    or p_agreement_snapshot_json->>'businessType' is distinct from btrim(p_business_type)
    or p_agreement_snapshot_json->>'teamSize' is distinct from nullif(btrim(p_team_size), '')
    or p_agreement_snapshot_json->>'numberOfLocations' is distinct from nullif(btrim(p_number_of_locations), '')
    or p_agreement_snapshot_json->>'agreementText' is distinct from p_agreement_text
    or p_agreement_snapshot_json->>'typedSignature' is distinct from btrim(p_typed_signature)
    or (p_agreement_snapshot_json->>'signedAt')::timestamptz is distinct from p_signed_at
    or p_agreement_snapshot_json->>'authenticatedUserId' is distinct from p_user_id::text
    or p_agreement_snapshot_json->>'applicationVersion' is distinct from p_application_version
    or p_agreement_snapshot_json->>'recordClass' is distinct from 'legal_agreement'
    or coalesce(jsonb_array_length(p_agreement_snapshot_json->'sections'), -1) <> 5
    or coalesce((p_agreement_snapshot_json#>>'{eligibility,business_memory_eligible}')::boolean, true)
    or coalesce((p_agreement_snapshot_json#>>'{eligibility,evidence_eligible}')::boolean, true)
    or coalesce((p_agreement_snapshot_json#>>'{eligibility,embedding_eligible}')::boolean, true)
    or coalesce((p_agreement_snapshot_json#>>'{eligibility,executive_intelligence_eligible}')::boolean, true)
    or coalesce((p_agreement_snapshot_json#>>'{eligibility,retrieval_eligible}')::boolean, true) then
    raise exception 'Agreement snapshot attribution or eligibility is invalid.';
  end if;

  insert into public.workspaces (
    id,
    name,
    industry,
    size,
    primary_contact_name,
    primary_contact_email,
    created_by,
    subscription_status,
    plan_slug,
    subscription_required,
    manually_unlocked,
    created_at,
    updated_at
  ) values (
    p_workspace_id,
    btrim(p_organization_name),
    btrim(p_business_type),
    nullif(btrim(p_team_size), ''),
    btrim(p_owner_legal_name),
    lower(btrim(p_owner_business_email)),
    p_user_id,
    p_subscription_status,
    p_plan_slug,
    p_subscription_required,
    p_manually_unlocked,
    p_signed_at,
    p_signed_at
  );

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    created_at
  ) values (
    p_workspace_id,
    p_user_id,
    'owner',
    'active',
    p_signed_at
  );

  insert into public.workspace_agreements (
    id,
    workspace_id,
    organization_name,
    owner_legal_name,
    owner_job_title,
    owner_business_email,
    business_type,
    team_size,
    number_of_locations,
    agreement_version,
    terms_version,
    privacy_version,
    agreement_text,
    agreement_snapshot_json,
    typed_signature,
    signed_at,
    authenticated_user_id,
    application_version,
    immutable_hash,
    pdf_sha256,
    pdf_size_bytes,
    storage_bucket,
    storage_path,
    record_class,
    business_memory_eligible,
    evidence_eligible,
    embedding_eligible,
    executive_intelligence_eligible,
    retrieval_eligible,
    created_at
  ) values (
    p_agreement_id,
    p_workspace_id,
    btrim(p_organization_name),
    btrim(p_owner_legal_name),
    btrim(p_owner_job_title),
    lower(btrim(p_owner_business_email)),
    btrim(p_business_type),
    nullif(btrim(p_team_size), ''),
    nullif(btrim(p_number_of_locations), ''),
    p_agreement_version,
    p_terms_version,
    p_privacy_version,
    p_agreement_text,
    p_agreement_snapshot_json,
    btrim(p_typed_signature),
    p_signed_at,
    p_user_id,
    p_application_version,
    p_immutable_hash,
    p_pdf_sha256,
    p_pdf_size_bytes,
    p_storage_bucket,
    p_storage_path,
    'legal_agreement',
    false,
    false,
    false,
    false,
    false,
    p_signed_at
  );

  insert into public.audit_logs (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata_json,
    created_at
  ) values (
    p_workspace_id,
    p_user_id,
    'workspace_agreement_signed',
    'workspace_agreement',
    p_agreement_id,
    jsonb_build_object(
      'agreement_version', p_agreement_version,
      'terms_version', p_terms_version,
      'privacy_version', p_privacy_version,
      'immutable_hash', p_immutable_hash,
      'record_class', 'legal_agreement'
    ),
    p_signed_at
  );

  insert into public.security_audit_events (
    workspace_id,
    user_id,
    action_name,
    operation_type,
    target_table,
    target_record_id,
    initiated_by,
    required_confirmation,
    confirmation_received,
    allowed,
    request_id,
    metadata_json,
    created_at
  ) values (
    p_workspace_id,
    p_user_id,
    'create_workspace_with_signed_agreement',
    'CREATE_RECORD',
    'workspace_agreements',
    p_agreement_id::text,
    'user',
    true,
    true,
    true,
    p_agreement_id::text,
    jsonb_build_object('agreement_version', p_agreement_version, 'record_class', 'legal_agreement'),
    p_signed_at
  );

  return p_workspace_id;
end;
$$;

revoke all on function public.create_workspace_with_signed_agreement(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, boolean, boolean,
  text, text, text, text, jsonb, text, timestamptz, text, text, text, bigint, text, text
) from public, anon, authenticated;

grant execute on function public.create_workspace_with_signed_agreement(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, boolean, boolean,
  text, text, text, text, jsonb, text, timestamptz, text, text, text, bigint, text, text
) to service_role;

drop policy if exists "workspace agreement members read pdf" on storage.objects;
create policy "workspace agreement members read pdf"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspace-agreements'
    and public.is_workspace_member(
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    )
  );
