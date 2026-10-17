begin;

-- Finish an OAuth callback as one transaction. A saved connection can only be
-- reauthorized for the same merchant and currency as its stored receipts.
create function public.complete_loyverse_oauth(
  p_workspace_id uuid, p_connection_id uuid, p_merchant_id uuid,
  p_business_name text, p_currency_code text, p_token_ciphertext text,
  p_access_expires_at timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare saved public.loyverse_connections%rowtype;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'loyverse_service_role_required' using errcode = '42501';
  end if;
  if p_merchant_id is null or p_business_name is null or char_length(p_business_name) not between 1 and 200 or
    p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$' or
    p_token_ciphertext is null or char_length(p_token_ciphertext) not between 32 and 32768 or
    p_access_expires_at is null or p_access_expires_at <= clock_timestamp() then
    raise exception 'loyverse_authorization_invalid';
  end if;

  select * into saved from public.loyverse_connections
    where workspace_id = p_workspace_id and id = p_connection_id for update;
  if not found or saved.status <> 'pending' then return false; end if;
  if saved.merchant_id is not null and saved.merchant_id <> p_merchant_id then
    raise exception 'loyverse_merchant_mismatch';
  end if;
  if saved.currency_code is not null and saved.currency_code <> p_currency_code then
    raise exception 'loyverse_currency_mismatch';
  end if;

  insert into public.loyverse_credentials
    (workspace_id, connection_id, token_ciphertext, access_expires_at, scope)
  values (p_workspace_id, p_connection_id, p_token_ciphertext, p_access_expires_at,
    'MERCHANT_READ RECEIPTS_READ')
  on conflict (connection_id) do update set
    token_ciphertext = excluded.token_ciphertext,
    access_expires_at = excluded.access_expires_at,
    scope = excluded.scope,
    updated_at = clock_timestamp();

  update public.loyverse_connections set status = 'connected', merchant_id = p_merchant_id,
    business_name = p_business_name, currency_code = p_currency_code,
    last_error_code = null, sync_lease_id = null, sync_lease_expires_at = null,
    updated_at = clock_timestamp()
    where workspace_id = p_workspace_id and id = p_connection_id;
  return true;
end $function$;

revoke all on function public.complete_loyverse_oauth(uuid,uuid,uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_loyverse_oauth(uuid,uuid,uuid,text,text,text,timestamptz)
  to service_role;

commit;
