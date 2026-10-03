-- Native PostgreSQL ONLY: minimal Supabase platform prerequisites, not application
-- replacements or an Auth/Storage service implementation. All repository migrations
-- run unchanged after this file. CI also qualifies against the real Supabase image.
-- auth.uid/jwt/role read the same request GUCs used by Supabase's SQL boundary;
-- no token verification, real identities, or OAuth authority is provided here.
-- Roles/default public grants follow supabase/postgres initial-schema.sql; the
-- application migrations must explicitly revoke sensitive function/table access.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists dblink with schema extensions;

do $roles$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
end;
$roles$;
grant usage on schema public,extensions to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  deleted_at timestamptz,
  banned_until timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Synthetic session evidence only, not session/token issuance or validation.
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz
);
create function auth.jwt() returns jsonb language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim',true),''),
    nullif(current_setting('request.jwt.claims',true),''))::jsonb;
$fn$;
create function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    auth.jwt()->>'sub')::uuid;
$fn$;
create function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
    auth.jwt()->>'role');
$fn$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.jwt(),auth.role() to anon,authenticated,service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now()
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated,service_role;
grant all on storage.buckets,storage.objects to anon,authenticated,service_role;
