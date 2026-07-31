create table public.easter_egg_workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  public_participation_requested boolean not null default false,
  public_display_name text,
  moderation_status text not null default 'none'
    check (moderation_status in ('none', 'pending', 'approved', 'rejected')),
  workspace_approved_by uuid,
  workspace_approved_at timestamptz,
  moderated_by uuid,
  moderated_at timestamptz,
  moderation_reason_code text
    check (moderation_reason_code is null or moderation_reason_code in ('inappropriate', 'reserved', 'unclear', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  constraint easter_egg_workspace_settings_display_name_length
    check (public_display_name is null or char_length(public_display_name) between 2 and 48),
  constraint easter_egg_workspace_settings_participation_consistency
    check (
      (not public_participation_requested
        and public_display_name is null
        and moderation_status = 'none'
        and workspace_approved_by is null
        and workspace_approved_at is null
        and moderated_by is null
        and moderated_at is null
        and moderation_reason_code is null)
      or
      (public_participation_requested
        and public_display_name is not null
        and workspace_approved_by is not null
        and workspace_approved_at is not null
        and moderation_status in ('pending', 'approved', 'rejected'))
    ),
  constraint easter_egg_workspace_settings_moderation_consistency
    check (
      (moderation_status = 'pending' and moderated_by is null and moderated_at is null and moderation_reason_code is null)
      or (moderation_status = 'approved' and moderated_by is not null and moderated_at is not null and moderation_reason_code is null)
      or (moderation_status = 'rejected' and moderated_by is not null and moderated_at is not null and moderation_reason_code is not null)
      or (moderation_status = 'none')
    )
);

create table public.easter_egg_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  idempotency_key uuid not null,
  game_contract_version text not null
    check (game_contract_version = 'easter_egg_runner_v1'),
  seed bigint not null check (seed between 0 and 4294967295),
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'rejected')),
  score integer check (score is null or score between 0 and 10000000),
  run_duration_ms integer check (run_duration_ms is null or run_duration_ms between 0 and 3600000),
  obstacle_count integer check (obstacle_count is null or obstacle_count between 0 and 100000),
  active_tick_count integer check (active_tick_count is null or active_tick_count between 0 and 216000),
  validation_reason_code text
    check (validation_reason_code is null or validation_reason_code in (
      'accepted', 'malformed', 'duration_mismatch', 'impossible_obstacle_count',
      'score_mismatch', 'submission_too_early', 'submission_expired', 'contract_mismatch'
    )),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint easter_egg_runs_workspace_actor_idempotency_unique
    unique (workspace_id, actor_user_id, idempotency_key),
  constraint easter_egg_runs_terminal_consistency
    check (
      (validation_status = 'pending'
        and score is null
        and run_duration_ms is null
        and obstacle_count is null
        and active_tick_count is null
        and validation_reason_code is null
        and completed_at is null)
      or
      (validation_status in ('valid', 'rejected')
        and score is not null
        and run_duration_ms is not null
        and obstacle_count is not null
        and active_tick_count is not null
        and validation_reason_code is not null
        and completed_at is not null)
    )
);

create index easter_egg_runs_workspace_valid_score_idx
  on public.easter_egg_runs(workspace_id, score desc, completed_at asc)
  where validation_status = 'valid';

create index easter_egg_runs_recent_idx
  on public.easter_egg_runs(created_at desc);

create index easter_egg_workspace_settings_moderation_idx
  on public.easter_egg_workspace_settings(moderation_status, updated_at desc)
  where public_participation_requested;

create trigger set_easter_egg_workspace_settings_updated_at
before update on public.easter_egg_workspace_settings
for each row execute function public.set_updated_at();

alter table public.easter_egg_workspace_settings enable row level security;
alter table public.easter_egg_runs enable row level security;

revoke all privileges on table public.easter_egg_workspace_settings from anon, authenticated, service_role;
grant select, insert, update on table public.easter_egg_workspace_settings to service_role;

revoke all privileges on table public.easter_egg_runs from anon, authenticated, service_role;
grant select, insert, update, delete on table public.easter_egg_runs to service_role;

create view public.easter_egg_public_leaderboard_v1
with (security_invoker = true)
as
with workspace_best as (
  select
    settings.workspace_id,
    settings.public_display_name,
    max(runs.score) as score,
    min(runs.completed_at) filter (
      where runs.score = (
        select max(best.score)
        from public.easter_egg_runs best
        where best.workspace_id = settings.workspace_id
          and best.validation_status = 'valid'
      )
    ) as achieved_at
  from public.easter_egg_workspace_settings settings
  join public.easter_egg_runs runs
    on runs.workspace_id = settings.workspace_id
   and runs.validation_status = 'valid'
  where settings.public_participation_requested
    and settings.moderation_status = 'approved'
    and settings.public_display_name is not null
  group by settings.workspace_id, settings.public_display_name
), ranked as (
  select
    workspace_id,
    public_display_name,
    score,
    achieved_at,
    dense_rank() over (order by score desc) as score_rank,
    row_number() over (order by score desc, achieved_at asc, workspace_id asc) as leaderboard_position
  from workspace_best
)
select workspace_id, public_display_name, score, achieved_at, score_rank, leaderboard_position
from ranked;

revoke all privileges on table public.easter_egg_public_leaderboard_v1 from anon, authenticated, service_role;
grant select on table public.easter_egg_public_leaderboard_v1 to service_role;

comment on table public.easter_egg_runs is
  'Private, workspace-scoped casual game runs. Excluded from Evidence, Business Memory, search indexing, embeddings, AI context, Trust telemetry, Saved Analyses, and IntelligenceSnapshotV1.';

comment on table public.easter_egg_workspace_settings is
  'Workspace-owned opt-in and moderated public display name for the Easter Egg leaderboard. No personal identity is exposed publicly.';
