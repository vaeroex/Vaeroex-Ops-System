alter table public.easter_egg_runs
  drop constraint if exists easter_egg_runs_game_contract_version_check;

alter table public.easter_egg_runs
  add constraint easter_egg_runs_game_contract_version_check
  check (game_contract_version in (
    'easter_egg_runner_v1',
    'easter_egg_runner_v2',
    'easter_egg_runner_v3'
  ));

comment on column public.easter_egg_runs.game_contract_version is
  'Immutable fixed-tick game contract used to reconstruct and validate the submitted course. Historical V1 and V2 rows remain readable; new starts use V3.';
