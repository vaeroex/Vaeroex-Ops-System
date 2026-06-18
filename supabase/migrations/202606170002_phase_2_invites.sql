create or replace function public.accept_workspace_invites_for_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or current_email = '' then
    return;
  end if;

  update public.workspace_members
  set user_id = auth.uid(),
      status = 'active'
  where user_id is null
    and status = 'invited'
    and invited_email is not null
    and lower(invited_email) = current_email;
end;
$$;

grant execute on function public.accept_workspace_invites_for_current_user() to authenticated;
