create table public.intelligence_card_lifecycle (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  finding_key_hash text not null,
  finding_fingerprint text not null,
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'acknowledged', 'dismissed')),
  state_material_signature text,
  last_material_signature text not null,
  last_finding_id text not null,
  reason_code text
    check (reason_code is null or reason_code in ('irrelevant', 'duplicate', 'temporary', 'not_material', 'other')),
  reason_text text
    check (reason_text is null or char_length(reason_text) <= 500),
  recheck_after timestamptz,
  pinned boolean not null default false,
  pinned_by uuid,
  pinned_at timestamptz,
  card_snapshot_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(card_snapshot_json) = 'object')
    check (octet_length(card_snapshot_json::text) <= 4096),
  last_mutated_by uuid not null,
  last_mutated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint intelligence_card_lifecycle_workspace_finding_key_unique
    unique (workspace_id, finding_key_hash),
  constraint intelligence_card_lifecycle_finding_key_hash_format
    check (finding_key_hash ~ '^[0-9a-f]{64}$'),
  constraint intelligence_card_lifecycle_material_signature_format
    check (last_material_signature ~ '^[0-9a-f]{64}$'),
  constraint intelligence_card_lifecycle_state_signature_consistency
    check (
      (lifecycle_state = 'active' and state_material_signature is null)
      or
      (lifecycle_state in ('acknowledged', 'dismissed') and state_material_signature ~ '^[0-9a-f]{64}$')
    ),
  constraint intelligence_card_lifecycle_pin_consistency
    check (
      (pinned and pinned_by is not null and pinned_at is not null)
      or
      (not pinned and pinned_by is null and pinned_at is null)
    ),
  constraint intelligence_card_lifecycle_dismiss_consistency
    check (
      lifecycle_state <> 'dismissed'
      or (not pinned and recheck_after is not null)
    )
);

create index intelligence_card_lifecycle_workspace_state_idx
  on public.intelligence_card_lifecycle(workspace_id, lifecycle_state, pinned, updated_at desc);

create table public.intelligence_card_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lifecycle_id uuid not null references public.intelligence_card_lifecycle(id) on delete restrict,
  finding_key_hash text not null,
  event_type text not null
    check (event_type in ('acknowledged', 'dismissed', 'pinned', 'unpinned', 'reopened_by_material_change', 'reopened_by_recheck')),
  from_state text not null check (from_state in ('active', 'acknowledged', 'dismissed')),
  to_state text not null check (to_state in ('active', 'acknowledged', 'dismissed')),
  material_signature text not null check (material_signature ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  reason_code text
    check (reason_code is null or reason_code in ('irrelevant', 'duplicate', 'temporary', 'not_material', 'other')),
  reason_text text
    check (reason_text is null or char_length(reason_text) <= 500),
  recheck_after timestamptz,
  card_snapshot_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(card_snapshot_json) = 'object')
    check (octet_length(card_snapshot_json::text) <= 4096),
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index intelligence_card_lifecycle_events_workspace_created_idx
  on public.intelligence_card_lifecycle_events(workspace_id, created_at desc);

alter table public.intelligence_card_lifecycle enable row level security;
alter table public.intelligence_card_lifecycle_events enable row level security;

create policy "workspace members can read intelligence card lifecycle"
  on public.intelligence_card_lifecycle for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members can read intelligence card lifecycle events"
  on public.intelligence_card_lifecycle_events for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all privileges on table public.intelligence_card_lifecycle from anon, authenticated, service_role;
grant select on table public.intelligence_card_lifecycle to authenticated;
grant select, insert, update on table public.intelligence_card_lifecycle to service_role;

revoke all privileges on table public.intelligence_card_lifecycle_events from anon, authenticated, service_role;
grant select on table public.intelligence_card_lifecycle_events to authenticated;
grant select, insert on table public.intelligence_card_lifecycle_events to service_role;

create or replace function public.mutate_intelligence_card_lifecycle_v1(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_action text,
  p_finding_key_hash text,
  p_finding_fingerprint text,
  p_material_signature text,
  p_finding_id text,
  p_card_snapshot_json jsonb,
  p_reason_code text default null,
  p_reason_text text default null,
  p_recheck_after timestamptz default null,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.intelligence_card_lifecycle%rowtype;
  v_from_state text;
  v_event_type text;
  v_changed boolean := false;
  v_existing_event_id uuid;
begin
  if p_action not in ('acknowledge', 'dismiss', 'pin', 'unpin') then
    raise exception 'Unsupported lifecycle action.' using errcode = '22023';
  end if;
  if p_finding_key_hash !~ '^[0-9a-f]{64}$' or p_material_signature !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid lifecycle identity.' using errcode = '22023';
  end if;
  if p_finding_fingerprint is null or char_length(p_finding_fingerprint) > 1000
    or p_finding_id is null or char_length(p_finding_id) > 500 then
    raise exception 'Invalid finding identity.' using errcode = '22023';
  end if;
  if p_card_snapshot_json is null
    or jsonb_typeof(p_card_snapshot_json) <> 'object'
    or octet_length(p_card_snapshot_json::text) > 4096 then
    raise exception 'Invalid lifecycle card snapshot.' using errcode = '22023';
  end if;
  if p_reason_text is not null and char_length(p_reason_text) > 500 then
    raise exception 'Lifecycle reason is too long.' using errcode = '22023';
  end if;
  if p_reason_code is not null and p_reason_code not in ('irrelevant', 'duplicate', 'temporary', 'not_material', 'other') then
    raise exception 'Unsupported lifecycle reason.' using errcode = '22023';
  end if;
  if p_action = 'dismiss' and (p_recheck_after is null or p_recheck_after <= now() or p_recheck_after > now() + interval '365 days') then
    raise exception 'Dismissed findings require a bounded future recheck.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_id
      and member.status = 'active'
      and member.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'The actor is not authorized to manage intelligence lifecycle.' using errcode = '42501';
  end if;

  select event.id into v_existing_event_id
  from public.intelligence_card_lifecycle_events event
  where event.request_id = p_request_id;
  if v_existing_event_id is not null then
    select lifecycle.* into v_row
    from public.intelligence_card_lifecycle lifecycle
    where lifecycle.workspace_id = p_workspace_id
      and lifecycle.finding_key_hash = p_finding_key_hash;
    return to_jsonb(v_row) || jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_finding_key_hash, 0));

  insert into public.intelligence_card_lifecycle (
    workspace_id,
    finding_key_hash,
    finding_fingerprint,
    lifecycle_state,
    state_material_signature,
    last_material_signature,
    last_finding_id,
    card_snapshot_json,
    last_mutated_by
  ) values (
    p_workspace_id,
    p_finding_key_hash,
    p_finding_fingerprint,
    'active',
    null,
    p_material_signature,
    p_finding_id,
    p_card_snapshot_json,
    p_actor_id
  ) on conflict (workspace_id, finding_key_hash) do nothing;

  select lifecycle.* into v_row
  from public.intelligence_card_lifecycle lifecycle
  where lifecycle.workspace_id = p_workspace_id
    and lifecycle.finding_key_hash = p_finding_key_hash
  for update;

  if v_row.id is null then
    raise exception 'Lifecycle record could not be claimed.' using errcode = 'P0001';
  end if;

  if v_row.lifecycle_state in ('acknowledged', 'dismissed')
    and v_row.state_material_signature is distinct from p_material_signature then
    v_from_state := v_row.lifecycle_state;
    update public.intelligence_card_lifecycle
    set lifecycle_state = 'active',
        state_material_signature = null,
        reason_code = null,
        reason_text = null,
        recheck_after = null,
        last_material_signature = p_material_signature,
        last_finding_id = p_finding_id,
        finding_fingerprint = p_finding_fingerprint,
        card_snapshot_json = p_card_snapshot_json,
        last_mutated_by = p_actor_id,
        last_mutated_at = now(),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
    insert into public.intelligence_card_lifecycle_events (
      workspace_id, lifecycle_id, finding_key_hash, event_type, from_state, to_state,
      material_signature, actor_user_id, card_snapshot_json, request_id
    ) values (
      p_workspace_id, v_row.id, p_finding_key_hash, 'reopened_by_material_change', v_from_state, 'active',
      p_material_signature, p_actor_id, p_card_snapshot_json, gen_random_uuid()
    );
  elsif v_row.lifecycle_state = 'dismissed'
    and v_row.recheck_after is not null
    and v_row.recheck_after <= now() then
    update public.intelligence_card_lifecycle
    set lifecycle_state = 'active',
        state_material_signature = null,
        reason_code = null,
        reason_text = null,
        recheck_after = null,
        last_material_signature = p_material_signature,
        last_finding_id = p_finding_id,
        finding_fingerprint = p_finding_fingerprint,
        card_snapshot_json = p_card_snapshot_json,
        last_mutated_by = p_actor_id,
        last_mutated_at = now(),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
    insert into public.intelligence_card_lifecycle_events (
      workspace_id, lifecycle_id, finding_key_hash, event_type, from_state, to_state,
      material_signature, actor_user_id, card_snapshot_json, request_id
    ) values (
      p_workspace_id, v_row.id, p_finding_key_hash, 'reopened_by_recheck', 'dismissed', 'active',
      p_material_signature, p_actor_id, p_card_snapshot_json, gen_random_uuid()
    );
  end if;

  v_from_state := v_row.lifecycle_state;
  if p_action = 'acknowledge' then
    if v_row.lifecycle_state <> 'acknowledged' or v_row.state_material_signature is distinct from p_material_signature then
      v_event_type := 'acknowledged';
      update public.intelligence_card_lifecycle
      set lifecycle_state = 'acknowledged',
          state_material_signature = p_material_signature,
          reason_code = null,
          reason_text = null,
          recheck_after = null,
          finding_fingerprint = p_finding_fingerprint,
          last_material_signature = p_material_signature,
          last_finding_id = p_finding_id,
          card_snapshot_json = p_card_snapshot_json,
          last_mutated_by = p_actor_id,
          last_mutated_at = now(),
          updated_at = now()
      where id = v_row.id
      returning * into v_row;
      v_changed := true;
    end if;
  elsif p_action = 'dismiss' then
    if v_row.lifecycle_state <> 'dismissed' or v_row.state_material_signature is distinct from p_material_signature then
      v_event_type := 'dismissed';
      update public.intelligence_card_lifecycle
      set lifecycle_state = 'dismissed',
          state_material_signature = p_material_signature,
          reason_code = p_reason_code,
          reason_text = nullif(btrim(p_reason_text), ''),
          recheck_after = p_recheck_after,
          pinned = false,
          pinned_by = null,
          pinned_at = null,
          finding_fingerprint = p_finding_fingerprint,
          last_material_signature = p_material_signature,
          last_finding_id = p_finding_id,
          card_snapshot_json = p_card_snapshot_json,
          last_mutated_by = p_actor_id,
          last_mutated_at = now(),
          updated_at = now()
      where id = v_row.id
      returning * into v_row;
      v_changed := true;
    end if;
  elsif p_action = 'pin' then
    if not v_row.pinned then
      v_event_type := 'pinned';
      update public.intelligence_card_lifecycle
      set pinned = true,
          pinned_by = p_actor_id,
          pinned_at = now(),
          finding_fingerprint = p_finding_fingerprint,
          last_material_signature = p_material_signature,
          last_finding_id = p_finding_id,
          card_snapshot_json = p_card_snapshot_json,
          last_mutated_by = p_actor_id,
          last_mutated_at = now(),
          updated_at = now()
      where id = v_row.id
      returning * into v_row;
      v_changed := true;
    end if;
  elsif p_action = 'unpin' then
    if v_row.pinned then
      v_event_type := 'unpinned';
      update public.intelligence_card_lifecycle
      set pinned = false,
          pinned_by = null,
          pinned_at = null,
          finding_fingerprint = p_finding_fingerprint,
          last_material_signature = p_material_signature,
          last_finding_id = p_finding_id,
          card_snapshot_json = p_card_snapshot_json,
          last_mutated_by = p_actor_id,
          last_mutated_at = now(),
          updated_at = now()
      where id = v_row.id
      returning * into v_row;
      v_changed := true;
    end if;
  end if;

  if v_changed then
    insert into public.intelligence_card_lifecycle_events (
      workspace_id, lifecycle_id, finding_key_hash, event_type, from_state, to_state,
      material_signature, actor_user_id, reason_code, reason_text, recheck_after,
      card_snapshot_json, request_id
    ) values (
      p_workspace_id, v_row.id, p_finding_key_hash, v_event_type, v_from_state, v_row.lifecycle_state,
      p_material_signature, p_actor_id, v_row.reason_code, v_row.reason_text, v_row.recheck_after,
      p_card_snapshot_json, p_request_id
    );
  end if;

  return to_jsonb(v_row) || jsonb_build_object('changed', v_changed, 'idempotent', not v_changed);
end;
$$;

revoke execute on function public.mutate_intelligence_card_lifecycle_v1(
  uuid, uuid, text, text, text, text, text, jsonb, text, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.mutate_intelligence_card_lifecycle_v1(
  uuid, uuid, text, text, text, text, text, jsonb, text, text, timestamptz, uuid
) to service_role;
