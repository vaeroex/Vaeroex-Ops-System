begin;

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
create unique index reporting_one_active on public.reporting_connections(workspace_id,provider) where status<>'disconnected';
create table public.reporting_credentials (
 workspace_id uuid not null,
 provider text not null,
 connection_id uuid primary key,
 ciphertext text not null check(char_length(ciphertext) between 32 and 65536),
 foreign key(workspace_id,provider,connection_id) references public.reporting_connections(workspace_id,provider,id) on delete cascade
);
create table public.reporting_oauth_states (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
 workspace_id uuid not null,
 provider text not null,
 connection_id uuid not null unique,
 initiated_by uuid not null references public.profiles(id),
 expires_at timestamptz not null default now()+interval '10 minutes',
 consumed_at timestamptz,
 foreign key(workspace_id,provider,connection_id) references public.reporting_connections(workspace_id,provider,id) on delete cascade
);
alter table public.reporting_connections enable row level security;
alter table public.reporting_credentials enable row level security;
alter table public.reporting_oauth_states enable row level security;
create policy reporting_connections_read on public.reporting_connections for select to authenticated using (
 exists(select 1 from public.workspace_members m where m.workspace_id=reporting_connections.workspace_id and m.user_id=(select auth.uid()) and m.status='active')
);
revoke all on public.reporting_connections,public.reporting_credentials,public.reporting_oauth_states from public,anon,authenticated;
grant select on public.reporting_connections to authenticated;
grant all on public.reporting_connections,public.reporting_credentials,public.reporting_oauth_states to service_role;

-- One transaction admits a connection attempt. Failed/expired attempts must be explicitly cancelled.
create function public.begin_reporting_connection(p_workspace uuid,p_provider text,p_actor uuid,p_connection uuid,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_actor and status='active' and role='owner') then raise exception 'owner_required'; end if;
 insert into public.reporting_connections(id,workspace_id,provider,created_by) values(p_connection,p_workspace,p_provider,p_actor);
 if p_hash is not null then
  insert into public.reporting_oauth_states(state_hash,workspace_id,provider,connection_id,initiated_by) values(p_hash,p_workspace,p_provider,p_connection,p_actor);
 end if;
end $$;
create function public.finish_reporting_connection(p_workspace uuid,p_provider text,p_connection uuid,p_ciphertext text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 perform 1 from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection and status='pending' for update;
 if not found then return false; end if;
 insert into public.reporting_credentials(workspace_id,provider,connection_id,ciphertext) values(p_workspace,p_provider,p_connection,p_ciphertext);
 update public.reporting_connections set status='choose_account' where workspace_id=p_workspace and provider=p_provider and id=p_connection;
 return true;
end $$;
create function public.select_reporting_account(p_workspace uuid,p_provider text,p_connection uuid,p_account jsonb,p_ciphertext text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 perform 1 from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection and status='choose_account' for update;
 if not found then return false; end if;
 if p_account is null or jsonb_typeof(p_account)<>'object' or not (p_account ?& array['id','name']) or
  jsonb_typeof(p_account->'id') is distinct from 'string' or jsonb_typeof(p_account->'name') is distinct from 'string' or
  (p_account->>'id') !~ '^[A-Za-z0-9_-]{1,80}$' or char_length(p_account->>'name') not between 1 and 200 or
  (p_account - array['id','name','parent','user']) <> '{}'::jsonb then raise exception 'invalid_account'; end if;
 update public.reporting_credentials set ciphertext=p_ciphertext where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
 if not found then raise exception 'missing_credential'; end if;
 update public.reporting_connections set status='connected',account=p_account where workspace_id=p_workspace and provider=p_provider and id=p_connection;
 return true;
end $$;
create function public.claim_reporting_sync(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 update public.reporting_connections set lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '65 seconds',next_sync_at=clock_timestamp()+interval '1 hour'
 where workspace_id=p_workspace and provider=p_provider and id=p_connection and status='connected'
 and next_sync_at<=clock_timestamp() and (lease_expires_at is null or lease_expires_at<clock_timestamp());
 return found;
end $$;
-- A disconnect takes the same connection lock: an in-flight refresh cannot restore a removed credential.
create function public.save_reporting_refresh(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_ciphertext text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 perform 1 from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection and status='connected'
 and lease_id=p_lease and lease_expires_at>clock_timestamp() for update;
 if not found then return false; end if;
 update public.reporting_credentials set ciphertext=p_ciphertext where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
 return found;
end $$;
create function public.apply_reporting_snapshot(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare keys text[]; metric jsonb;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 keys := case p_provider when 'xero' then array['invoices','billed','outstanding','bills','purchases']
 when 'harvest' then array['entries','hours','billable_hours','running'] when 'clockify' then array['entries','hours','billable_hours','running']
 when 'zoho-inventory' then array['items','low_stock'] when 'toggl' then array['projects','hours'] when 'katana' then array['stock_rows','unavailable'] end;
 if keys is null or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or not(p_snapshot ?& array['start','end','metrics']) or
 jsonb_typeof(p_snapshot->'start') is distinct from 'string' or jsonb_typeof(p_snapshot->'end') is distinct from 'string' or
 (p_snapshot-array['start','end','metrics'])<>'{}'::jsonb or jsonb_typeof(p_snapshot->'metrics')<>'array' or
 jsonb_array_length(p_snapshot->'metrics') not between 1 and 100 or octet_length(p_snapshot::text)>16000 or
 (p_snapshot->>'start')::timestamptz>(p_snapshot->>'end')::timestamptz or
 (p_snapshot->>'start')::timestamptz<clock_timestamp()-interval '8 days' or
 (p_snapshot->>'end')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'invalid_snapshot'; end if;
 for metric in select value from jsonb_array_elements(p_snapshot->'metrics') loop
  if jsonb_typeof(metric)<>'object' or not(metric ?& array['key','value']) or (metric-array['key','value','currency'])<>'{}'::jsonb or
   jsonb_typeof(metric->'key') is distinct from 'string' or not((metric->>'key')=any(keys)) or jsonb_typeof(metric->'value')<>'number' or
   (metric->>'value')::numeric not between 0 and 1e12 or
   ((p_provider='xero')<>(metric ? 'currency')) or (metric ? 'currency' and (jsonb_typeof(metric->'currency') is distinct from 'string' or (metric->>'currency')!~'^[A-Z]{3}$')) then raise exception 'invalid_metric'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'metrics') m group by m->>'key',m->>'currency' having count(*)>1) then raise exception 'duplicate_metric'; end if;
 update public.reporting_connections set snapshot=p_snapshot,last_sync_at=clock_timestamp(),last_error_code=null,lease_id=null,lease_expires_at=null
 where workspace_id=p_workspace and provider=p_provider and id=p_connection and status='connected' and lease_id=p_lease and lease_expires_at>clock_timestamp();
 return found;
end $$;
create function public.disconnect_reporting_connection(p_workspace uuid,p_provider text,p_connection uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
 update public.reporting_connections set status='disconnected',account=null,snapshot=null,last_sync_at=null,last_error_code=null,lease_id=null,lease_expires_at=null
 where workspace_id=p_workspace and provider=p_provider and id=p_connection and status<>'disconnected';
 if not found then return false; end if;
 delete from public.reporting_credentials where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
 delete from public.reporting_oauth_states where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
 return true;
end $$;
revoke all on function public.begin_reporting_connection(uuid,text,uuid,uuid,text),public.finish_reporting_connection(uuid,text,uuid,text),public.select_reporting_account(uuid,text,uuid,jsonb,text),public.claim_reporting_sync(uuid,text,uuid,uuid),public.save_reporting_refresh(uuid,text,uuid,uuid,text),public.apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb),public.disconnect_reporting_connection(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.begin_reporting_connection(uuid,text,uuid,uuid,text),public.finish_reporting_connection(uuid,text,uuid,text),public.select_reporting_account(uuid,text,uuid,jsonb,text),public.claim_reporting_sync(uuid,text,uuid,uuid),public.save_reporting_refresh(uuid,text,uuid,uuid,text),public.apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb),public.disconnect_reporting_connection(uuid,text,uuid) to service_role;
commit;
