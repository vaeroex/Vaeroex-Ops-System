alter table public.security_audit_events
  alter column workspace_id drop not null;

create index if not exists security_audit_events_created_idx
  on public.security_audit_events(created_at desc);

drop policy if exists "security audit events managers read" on public.security_audit_events;
drop policy if exists "security audit events members create" on public.security_audit_events;

create policy "security audit events managers read"
  on public.security_audit_events for select
  to authenticated
  using (workspace_id is not null and public.can_edit_operations(workspace_id));

create policy "security audit events members create"
  on public.security_audit_events for insert
  to authenticated
  with check (workspace_id is not null and public.is_workspace_member(workspace_id));
