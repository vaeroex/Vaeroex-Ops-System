create table if not exists public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action_name text not null,
  operation_type text not null check (
    operation_type in (
      'READ',
      'CREATE_DRAFT',
      'CREATE_RECORD',
      'UPDATE_RECORD',
      'DELETE_RECORD',
      'EXPORT',
      'BILLING',
      'ADMIN',
      'SYSTEM'
    )
  ),
  target_table text,
  target_record_id text,
  initiated_by text not null check (initiated_by in ('user', 'ai_suggestion', 'system')),
  required_confirmation boolean not null default false,
  confirmation_received boolean not null default false,
  allowed boolean not null default false,
  reason_blocked text,
  request_id text,
  model text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_audit_events_workspace_created_idx
  on public.security_audit_events(workspace_id, created_at desc);

create index if not exists security_audit_events_action_idx
  on public.security_audit_events(action_name, operation_type, allowed, created_at desc);

alter table public.security_audit_events enable row level security;

drop policy if exists "security audit events managers read" on public.security_audit_events;
drop policy if exists "security audit events members create" on public.security_audit_events;

create policy "security audit events managers read"
  on public.security_audit_events for select
  to authenticated
  using (public.can_edit_operations(workspace_id));

create policy "security audit events members create"
  on public.security_audit_events for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

grant select, insert on public.security_audit_events to authenticated;
