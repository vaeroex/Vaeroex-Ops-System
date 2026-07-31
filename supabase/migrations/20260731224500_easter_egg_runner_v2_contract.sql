alter table public.easter_egg_runs
  drop constraint if exists easter_egg_runs_game_contract_version_check;

alter table public.easter_egg_runs
  add constraint easter_egg_runs_game_contract_version_check
  check (game_contract_version in ('easter_egg_runner_v1', 'easter_egg_runner_v2'));

alter table public.easter_egg_runs
  drop constraint if exists easter_egg_runs_validation_reason_code_check;

alter table public.easter_egg_runs
  add constraint easter_egg_runs_validation_reason_code_check
  check (validation_reason_code is null or validation_reason_code in (
    'accepted', 'malformed', 'duration_mismatch', 'impossible_obstacle_count',
    'impossible_platform_count', 'difficulty_tier_mismatch', 'course_mismatch',
    'score_mismatch', 'submission_too_early', 'submission_expired', 'contract_mismatch'
  ));

comment on column public.easter_egg_runs.obstacle_count is
  'Cleared hazardous objects only. Safe platform traversal is reconstructed from the run seed and game contract and is never treated as an obstacle.';
