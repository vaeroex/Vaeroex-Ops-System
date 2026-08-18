drop policy if exists "workspace creators can read own workspace" on public.workspaces;

create policy "workspace creators can read own workspace"
  on public.workspaces for select
  to authenticated
  using (created_by = auth.uid());;
