-- Existing anonymous INSERT policy remains; provider metadata is server-controlled.
create function public.guard_support_notification_metadata() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if current_user in ('anon','authenticated') and
    (new.notification_status is not null or new.notification_attempted_at is not null
     or new.notification_detail is not null or new.notification_provider_id is not null) then
    raise exception 'notification metadata is server controlled' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_support_notification_metadata() from public,anon,authenticated;
create trigger guard_support_notification_metadata before insert or update on public.support_requests
for each row execute function public.guard_support_notification_metadata();
