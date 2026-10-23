-- SYNTHETIC FOUNDATION ONLY. No full application schema or deployed trigger parity.
-- Auth/roles are supplied by the existing owned-container platform fixture.
create schema private;
create table public.workspaces(id uuid primary key);
create table public.profiles(id uuid primary key);
create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);
create table public.business_entities(workspace_id uuid,id uuid,status text,primary key(workspace_id,id));
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019001207_ready_account_reporting_connectors.sql
create table public.reporting_connections (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 provider text not null check(provider in ('xero','harvest','zoho-inventory','clockify','toggl','katana')),
 created_by uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','choose_account','connected','reauthorization_required','disconnected')),
 account jsonb,
 snapshot jsonb,
 last_sync_at timestamptz,
 last_error_code text check(last_error_code in ('sync_failed','authorization_required','quota_exceeded','snapshot_too_large')),
 next_sync_at timestamptz not null default now(),
 lease_id uuid,
 lease_expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(workspace_id, provider, id),
 check((lease_id is null)=(lease_expires_at is null)),
 check(account is null or (jsonb_typeof(account)='object' and octet_length(account::text)<1024)),
 check(status <> 'connected' or account is not null)
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019070945_reporting_import_history.sql
create table public.reporting_history_facts (
  workspace_id uuid not null,
  provider text not null check (provider in ('xero','harvest','clockify')),
  connection_id uuid not null,
  record_id text not null check (record_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  day date not null check (isfinite(day)),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'array'),
  primary key (workspace_id,provider,connection_id,record_id),
  foreign key (workspace_id,provider,connection_id) references public.reporting_connections(workspace_id,provider,id) on delete cascade
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019070945_reporting_import_history.sql
create table public.reporting_history_days (
  workspace_id uuid not null,
  provider text not null check (provider in ('xero','harvest','clockify')),
  connection_id uuid not null,
  day date not null check (isfinite(day)),
  currencies text[] not null,
  covered_through timestamptz not null,
  imported_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id,provider,connection_id,day),
  foreign key (workspace_id,provider,connection_id) references public.reporting_connections(workspace_id,provider,id) on delete cascade
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261017013603_loyverse_read_only_connection.sql
create table public.loyverse_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','connected','reauthorization_required','disconnected')),
  merchant_id uuid,
  business_name text check (char_length(business_name) <= 200),
  currency_code text check (currency_code ~ '^[A-Z]{3}$'),
  last_sync_at timestamptz,
  last_error_code text,
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null))
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261017013603_loyverse_read_only_connection.sql
create table public.loyverse_receipt_facts (
  workspace_id uuid not null,
  connection_id uuid not null,
  receipt_number text not null check (char_length(receipt_number) between 1 and 120),
  store_id text not null check (char_length(store_id) between 1 and 120),
  receipt_date timestamptz not null,
  updated_at timestamptz not null,
  receipt_type text not null check (receipt_type in ('SALE','REFUND')),
  total_money numeric(16, 2) not null,
  total_tax numeric(16, 2) not null,
  total_discount numeric(16, 2) not null,
  cancelled boolean not null,
  primary key (workspace_id, connection_id, receipt_number),
  foreign key (workspace_id, connection_id) references public.loyverse_connections(workspace_id, id) on delete cascade
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019070953_loyverse_import_history.sql
create table public.loyverse_import_days (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  covered_through timestamptz not null,
  imported_at timestamptz not null default now(),
  primary key (workspace_id, connection_id, day),
  foreign key (workspace_id, connection_id) references public.loyverse_connections(workspace_id, id) on delete cascade,
  check (covered_through > day::timestamp at time zone 'UTC'
    and covered_through <= (day + 1)::timestamp at time zone 'UTC')
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261017023221_zoho_books_read_only_connection.sql
create table public.zoho_books_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','choose_organization','connected','reauthorization_required','disconnected')),
  organization_id text check (organization_id ~ '^[0-9]{5,30}$'),
  organization_name text check (char_length(organization_name) <= 200),
  currency_code text check (currency_code = 'USD'),
  last_sync_at timestamptz,
  last_error_code text,
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null))
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019070949_zoho_books_import_history.sql
create table public.zoho_books_history_facts (
  workspace_id uuid not null,
  connection_id uuid not null,
  kind text not null check (kind in ('invoice','expense')),
  source_id text not null check (source_id ~ '^[0-9]{1,30}$'),
  day date not null,
  counted boolean not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total numeric(16,2) not null check (total >= 0 and total <= 1000000000),
  outstanding numeric(16,2) not null check (outstanding >= 0 and outstanding <= 1000000000),
  primary key (workspace_id,connection_id,kind,source_id),
  foreign key (workspace_id,connection_id) references public.zoho_books_connections(workspace_id,id) on delete cascade,
  check ((counted and currency = 'USD') or (total = 0 and outstanding = 0)),
  check (kind = 'invoice' or (counted and outstanding = 0))
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019070949_zoho_books_import_history.sql
create table public.zoho_books_history_coverage (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  imported_at timestamptz not null default clock_timestamp(),
  covered_through timestamptz not null,
  primary key (workspace_id,connection_id,day),
  foreign key (workspace_id,connection_id) references public.zoho_books_connections(workspace_id,id) on delete cascade,
  check (covered_through >= (day::timestamp at time zone 'UTC') and covered_through <= ((day+1)::timestamp at time zone 'UTC'))
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261017051502_wix_orders_read_only_connection.sql
create table public.wix_order_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null check (status in ('pending','connected','reauthorization_required','disconnected')),
  instance_hash text unique check (instance_hash ~ '^[a-f0-9]{64}$'),
  site_id uuid,
  last_sync_at timestamptz,
  last_error_code text,
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null)),
  check (status <> 'connected' or instance_hash is not null)
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261017051502_wix_orders_read_only_connection.sql
create table public.wix_order_facts (
  workspace_id uuid not null,
  connection_id uuid not null,
  order_id uuid not null,
  created_at timestamptz not null,
  total_amount numeric(16,2) not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  payment_status text not null check (char_length(payment_status) between 1 and 40),
  primary key (workspace_id, connection_id, order_id),
  foreign key (workspace_id, connection_id) references public.wix_order_connections(workspace_id,id) on delete cascade
);
-- Exact CREATE TABLE excerpt: supabase/migrations/20261019071008_wix_orders_import_history.sql
create table public.wix_order_import_days (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  imported_through timestamptz not null,
  imported_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, connection_id, day),
  foreign key (workspace_id, connection_id) references public.wix_order_connections(workspace_id,id) on delete cascade,
  check (imported_through > day::timestamp at time zone 'UTC'
    and imported_through <= (day + 1)::timestamp at time zone 'UTC')
);
CREATE OR REPLACE FUNCTION private.square_production_customer_require_owner_v1(p_actor_id uuid, p_session_id uuid, p_workspace_id uuid, p_business_entity_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare expires_at timestamptz; member_role text; member_status text; entity_status text; now_at timestamptz;
begin
  if p_actor_id is null or p_session_id is null or p_workspace_id is null then
    raise exception 'square_production_customer_owner_denied' using errcode='42501';
  end if;
  perform 1 from public.workspaces where id=p_workspace_id for share;
  if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  select s.not_after into expires_at from auth.sessions s
    join auth.users u on u.id=s.user_id
    where s.id=p_session_id and s.user_id=p_actor_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp())
    for share of s,u;
  if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  select m.role,m.status into member_role,member_status from public.workspace_members m
    where m.user_id=p_actor_id and m.workspace_id=p_workspace_id for share;
  if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  if p_business_entity_id is not null then
    select e.status into entity_status from public.business_entities e
      where e.id=p_business_entity_id and e.workspace_id=p_workspace_id for share;
    if not found then raise exception 'square_production_customer_owner_denied' using errcode='42501'; end if;
  end if;
  now_at:=clock_timestamp();
  -- Supabase leaves not_after NULL when absolute session time-boxing is off.
  -- The exact live session/user binding above remains mandatory; finite
  -- expirations are enforced, and request JWT validity is checked by the host.
  if (expires_at is not null and expires_at<=now_at) or member_role<>'owner'
    or member_status<>'active' or (p_business_entity_id is not null and entity_status<>'active') then
    raise exception 'square_production_customer_owner_denied' using errcode='42501';
  end if;
end
$function$
;
revoke all on function private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
