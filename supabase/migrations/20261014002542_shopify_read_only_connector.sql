begin;
create schema if not exists private;
create table private.shopify_connections (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 shop text not null unique check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' and length(shop)<=80),
 generation integer not null default 1,
 status text not null check(status in ('pending','exchanging','connected','reauthorization_required','disconnected')),
 state_hash text, state_expires_at timestamptz, actor_id uuid, session_id uuid,
 ciphertext text check(length(ciphertext)<=20000), credential_version integer not null default 0,
 lease_id uuid, lease_expires_at timestamptz, report jsonb,
 updated_at timestamptz not null default clock_timestamp()
);
create table private.shopify_privacy_cutoffs (shop text primary key, cutoff timestamptz not null);
alter table private.shopify_connections enable row level security;
alter table private.shopify_privacy_cutoffs enable row level security;
revoke all on private.shopify_connections,private.shopify_privacy_cutoffs from public,anon,authenticated,service_role;

-- All access is through the restricted service RPC. Browser roles cannot read credentials.
create function private.shopify_owner(p_workspace uuid,p_actor uuid,p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_workspace is null or p_actor is null or p_session is null then raise exception 'shopify_owner_denied' using errcode='42501'; end if;
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
  join public.workspace_members m on m.user_id=u.id
  where s.id=p_session and s.user_id=p_actor and (s.not_after is null or s.not_after>clock_timestamp())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and m.workspace_id=p_workspace and m.status='active' and m.role='owner' for share of s,u,m;
 if not found then raise exception 'shopify_owner_denied' using errcode='42501'; end if;
end $$;
revoke all on function private.shopify_owner(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.shopify_lifecycle_v1(p_operation text,p_workspace_id uuid default null,
 p_actor_id uuid default null,p_session_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.shopify_connections%rowtype; cutoff timestamptz; item jsonb; op_shop text; n integer;
begin
 if p_operation='webhook' then
  op_shop:=p_payload->>'shop';
  if op_shop is null or op_shop !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' then raise exception 'shopify_shop_invalid'; end if;
  -- Serialize every connection operation for the shop, including reconnect after erasure.
  perform pg_advisory_xact_lock(hashtextextended(op_shop,218));
  if p_payload->>'topic'='customers/data_request' then return '{"ok":true,"customerRecordsStored":false}'::jsonb;
  elsif p_payload->>'topic'='customers/redact' then
   insert into private.shopify_privacy_cutoffs(shop,cutoff) values(op_shop,clock_timestamp())
    on conflict(shop) do update set cutoff=excluded.cutoff;
   -- Invalidate in-flight reads and discard the entire aggregate, conservatively.
   update private.shopify_connections set report=null,generation=generation+1,ciphertext=null,
    status='reauthorization_required',state_hash=null,lease_id=null,updated_at=clock_timestamp() where shop=op_shop;
  elsif p_payload->>'topic' in ('shop/redact','app/uninstalled') then
   delete from private.shopify_connections where shop=op_shop;
   -- Keep only the cutoff, with no customer identifiers, so old orders cannot reappear.
   insert into private.shopify_privacy_cutoffs(shop,cutoff) values(op_shop,clock_timestamp())
    on conflict(shop) do update set cutoff=excluded.cutoff;
  else raise exception 'shopify_topic_invalid'; end if;
  if p_payload->>'topic'='shop/redact' then delete from private.shopify_privacy_cutoffs where shop=op_shop; end if;
  return '{"ok":true}'::jsonb;
 end if;
 perform private.shopify_owner(p_workspace_id,p_actor_id,p_session_id);
 if p_operation='begin' then
  op_shop:=p_payload->>'shop';
  if op_shop is null or op_shop !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' or length(op_shop)>80
   or coalesce(p_payload->>'stateHash','') !~ '^[a-f0-9]{64}$' then raise exception 'shopify_begin_invalid'; end if;
 else
  select shop into op_shop from private.shopify_connections where workspace_id=p_workspace_id;
 end if;
 if op_shop is not null then perform pg_advisory_xact_lock(hashtextextended(op_shop,218)); end if;
 select * into c from private.shopify_connections where workspace_id=p_workspace_id for update;
 if p_operation='begin' then
  if c.workspace_id is not null and c.shop<>op_shop then raise exception 'shopify_disconnect_first'; end if;
  if c.updated_at>clock_timestamp()-interval '10 seconds' and c.status in ('pending','exchanging') then raise exception 'shopify_busy'; end if;
  insert into private.shopify_connections(workspace_id,shop,status,state_hash,state_expires_at,actor_id,session_id)
   values(p_workspace_id,op_shop,'pending',p_payload->>'stateHash',clock_timestamp()+interval '10 minutes',p_actor_id,p_session_id)
   on conflict(workspace_id) do update set generation=private.shopify_connections.generation+1,status='pending',
    state_hash=excluded.state_hash,state_expires_at=excluded.state_expires_at,actor_id=excluded.actor_id,session_id=excluded.session_id,
    ciphertext=null,credential_version=0,lease_id=null,lease_expires_at=null,updated_at=clock_timestamp()
   returning * into c;
 elsif p_operation='view' then
  if c.workspace_id is null then return 'null'::jsonb; end if;
  return jsonb_build_object('shop',c.shop,'status',c.status,'report',c.report,'updatedAt',c.updated_at);
 elsif c.workspace_id is null then raise exception 'shopify_connection_missing';
 elsif p_operation='consume' then
  if c.status<>'pending' or c.state_expires_at<=clock_timestamp() or c.actor_id<>p_actor_id or c.session_id<>p_session_id
   or c.shop<>p_payload->>'shop' or c.state_hash is distinct from p_payload->>'stateHash' then raise exception 'shopify_state_invalid'; end if;
  update private.shopify_connections set status='exchanging',state_hash=null,lease_id=(p_payload->>'leaseId')::uuid,
   lease_expires_at=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where workspace_id=p_workspace_id returning * into c;
 elsif p_operation='disconnect' then
  -- Token access and reports are removed even if the provider is unavailable.
  insert into private.shopify_privacy_cutoffs(shop,cutoff) values(c.shop,clock_timestamp()) on conflict(shop) do update set cutoff=excluded.cutoff;
  delete from private.shopify_connections where workspace_id=p_workspace_id;
  return '{"ok":true}'::jsonb;
 elsif p_operation='claim_sync' then
  if c.status<>'connected' or c.ciphertext is null or c.lease_expires_at>clock_timestamp() then raise exception 'shopify_sync_unavailable'; end if;
  update private.shopify_connections set lease_id=(p_payload->>'leaseId')::uuid,lease_expires_at=clock_timestamp()+interval '5 minutes'
   where workspace_id=p_workspace_id returning * into c;
 elsif p_operation in ('complete','refresh','report','fail') then
  if c.generation<>(p_payload->>'generation')::integer or c.lease_id is null or
   c.lease_id is distinct from (p_payload->>'leaseId')::uuid or c.lease_expires_at<=clock_timestamp() then raise exception 'shopify_lease_invalid'; end if;
  if p_operation in ('complete','refresh') then
   if (p_operation='complete' and c.status<>'exchanging') or (p_operation='refresh' and c.status<>'connected')
    or (p_payload->>'credentialVersion')::integer<>c.credential_version+1
    or coalesce(p_payload->>'ciphertext','') !~ '^sh1\.[A-Za-z0-9_-]+$' then raise exception 'shopify_credential_invalid'; end if;
   update private.shopify_connections set status='connected',ciphertext=p_payload->>'ciphertext',
    credential_version=(p_payload->>'credentialVersion')::integer,updated_at=clock_timestamp(),
    lease_id=case when p_operation='complete' then null else lease_id end,
    lease_expires_at=case when p_operation='complete' then null else lease_expires_at end
    where workspace_id=p_workspace_id returning * into c;
  elsif p_operation='report' then
   if c.status<>'connected' or jsonb_typeof(p_payload->'report')<>'object'
    or jsonb_typeof(p_payload->'report'->'days')<>'array'
    or jsonb_array_length(p_payload->'report'->'days')>930 or pg_column_size(p_payload->'report')>300000 then raise exception 'shopify_report_invalid'; end if;
   -- Stored report is an allowlist, never raw provider order/customer JSON.
   if (p_payload->'report') - array['start','end','syncedAt','days','orderCount'] <> '{}'::jsonb then raise exception 'shopify_report_fields'; end if;
   n:=0;
   for item in select value from jsonb_array_elements(p_payload->'report'->'days') loop
    if item - array['day','currency','orders','cancelled','orderTotal','refunded']<>'{}'::jsonb
     or coalesce(item->>'day','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(item->>'currency','') !~ '^[A-Z]{3}$'
     or coalesce(item->>'orderTotal','') !~ '^\d{1,12}(\.\d{1,6})?$' or coalesce(item->>'refunded','') !~ '^\d{1,12}(\.\d{1,6})?$'
     or (item->>'orders')::integer not between 0 and 10000 or (item->>'cancelled')::integer not between 0 and (item->>'orders')::integer
     then raise exception 'shopify_report_row_invalid'; end if;
    n:=n+(item->>'orders')::integer;
   end loop;
   if n<>(p_payload->'report'->>'orderCount')::integer or n>10000 then raise exception 'shopify_report_count'; end if;
   select p.cutoff into cutoff from private.shopify_privacy_cutoffs p where p.shop=c.shop;
   if (p_payload->'report'->>'start')::timestamptz<cutoff then raise exception 'shopify_redaction_fence'; end if;
   update private.shopify_connections set report=p_payload->'report',lease_id=null,lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id returning * into c;
  else
   update private.shopify_connections set lease_id=null,lease_expires_at=null,
    status=case when (p_payload->>'reauthorize')::boolean or status='exchanging' then 'reauthorization_required' else status end,
    ciphertext=case when (p_payload->>'reauthorize')::boolean then null else ciphertext end,
    updated_at=clock_timestamp() where workspace_id=p_workspace_id returning * into c;
  end if;
 else raise exception 'shopify_operation_invalid'; end if;
 select p.cutoff into cutoff from private.shopify_privacy_cutoffs p where p.shop=c.shop;
 return to_jsonb(c)||jsonb_build_object('privacy_cutoff',cutoff);
end $$;
revoke all on function public.shopify_lifecycle_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.shopify_lifecycle_v1(text,uuid,uuid,uuid,jsonb) to service_role;
commit;
