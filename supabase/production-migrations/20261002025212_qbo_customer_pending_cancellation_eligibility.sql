-- Forward-only owner projection; no state, lifecycle, audit or grant changes to
-- existing objects. Apply after 20261002012700 on either migration layout.
begin;

create function public.read_qbo_customer_pending_cancellations_v1(p_workspace_id uuid)
returns table(connection_id uuid, can_cancel boolean)
language plpgsql stable security definer set search_path = '' as $function$
declare actor uuid; session_id uuid;
begin
  if auth.jwt()->>'role' is distinct from 'authenticated' or p_workspace_id is null then
    raise exception 'qbo_customer_pending_read_denied' using errcode='42501';
  end if;
  begin
    actor := auth.uid();
    session_id := (auth.jwt()->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'qbo_customer_pending_read_denied' using errcode='42501';
  end;
  -- Same live owner/session checks as customer source browse, independent of
  -- the connection rowset. Entitlement is not required to cancel an attempt.
  if actor is null or session_id is null or not exists (
    select from auth.sessions s join auth.users u on u.id=s.user_id
    join public.workspace_members m on m.user_id=u.id and m.workspace_id=p_workspace_id
    join public.workspaces w on w.id=m.workspace_id
    where s.id=session_id and s.user_id=actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and (s.not_after is null or s.not_after>statement_timestamp())
      and m.role='owner' and m.status='active'
  ) then raise exception 'qbo_customer_pending_read_denied' using errcode='42501'; end if;

  -- Advisory snapshot only. The cancel RPC still locks, checks CAS and repeats
  -- the exact unconsented predicate before any terminal mutation.
  return query
    select n.id, private.qbo_pending_is_unconsented_v1(n) and exists (
      select from public.business_entities e where e.id=n.business_entity_id
        and e.workspace_id=n.workspace_id and e.status='active'
    )
    from private.integration_connections n
    where n.workspace_id=p_workspace_id and n.provider_key='quickbooks_online'
      and n.provider_environment='production' and n.status in ('pending_authorization','error')
    order by n.id;
end;
$function$;
alter function public.read_qbo_customer_pending_cancellations_v1(uuid) owner to postgres;
revoke all on function public.read_qbo_customer_pending_cancellations_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_qbo_customer_pending_cancellations_v1(uuid) to authenticated;

commit;
