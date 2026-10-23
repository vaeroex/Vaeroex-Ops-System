-- INACTIVE LOCAL DRAFT. Katana has no token-refresh operation in this app.
-- Installation identity is a random, non-secret nonce, never derived from key
-- bytes or the provider's non-identifying key-account display marker.
-- ROLLOUT PRECONDITION: quiesce Katana connection/credential writers through
-- commit. Backfill and trigger installation are not safe against a concurrent
-- credential insertion; the missing nonce would fail closed, not establish identity.
-- This window and writer concurrency must be qualified before applying the draft.
begin;
create table private.katana_evidence_installations (
 connection_id uuid primary key references public.reporting_connections(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 nonce uuid not null default gen_random_uuid()
);
alter table private.katana_evidence_installations enable row level security;
revoke all on private.katana_evidence_installations from public,anon,authenticated,service_role;
-- Metadata-only initialization; this establishes a new boundary, not historical
-- identity. No ciphertext is selected, compared, hashed or logged.
insert into private.katana_evidence_installations(connection_id,workspace_id)
 select connection_id,workspace_id from public.reporting_credentials where provider='katana';
create function private.guard_katana_installation_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare state text; conn uuid; ws uuid; provider_name text;
begin
 if tg_table_name='reporting_connections' then
  if old.provider='katana' and (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id or new.provider is distinct from old.provider
   or (old.status='connected' and new.status in ('pending','choose_account'))
   or (old.status='reauthorization_required' and new.status not in ('reauthorization_required','disconnected'))
   or (old.status='disconnected' and new.status<>'disconnected')) then
   raise exception 'katana_new_installation_required' using errcode='42501';end if;
  if old.provider<>'katana' and new.provider='katana' then raise exception 'katana_new_installation_required' using errcode='42501';end if;
  return new;
 end if;
 if tg_op='DELETE' then conn:=old.connection_id;ws:=old.workspace_id;provider_name:=old.provider;
 else conn:=new.connection_id;ws:=new.workspace_id;provider_name:=new.provider;end if;
 if tg_op='UPDATE' and (old.provider='katana' or new.provider='katana') and
  (new.connection_id is distinct from old.connection_id or new.workspace_id is distinct from old.workspace_id or new.provider is distinct from old.provider) then
   raise exception 'katana_credential_identity_immutable' using errcode='42501';end if;
 if provider_name='katana' then
  -- Do not acquire a connection row lock while holding a credential row lock:
  -- normal setup/disconnect RPCs take connection then credential. The nonce
  -- detects every credential mutation independently of the observed state.
  select status into state from public.reporting_connections where workspace_id=ws and provider='katana' and id=conn;
  if (tg_op='INSERT' and state is distinct from 'pending')
   or (tg_op='UPDATE' and state is distinct from 'choose_account')
   or (tg_op='DELETE' and state is not null and state not in ('pending','choose_account','reauthorization_required','disconnected')) then
   raise exception 'katana_new_installation_required' using errcode='42501';end if;
  if tg_op='DELETE' then delete from private.katana_evidence_installations where connection_id=conn and workspace_id=ws;
  else insert into private.katana_evidence_installations(connection_id,workspace_id,nonce) values(conn,ws,gen_random_uuid())
   on conflict(connection_id) do update set nonce=excluded.nonce;end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger shared_katana_connection_identity before update on public.reporting_connections
 for each row execute function private.guard_katana_installation_v1();
create trigger shared_katana_key_identity before insert or update or delete on public.reporting_credentials
 for each row execute function private.guard_katana_installation_v1();
alter function private.legacy_evidence_connection_v1(uuid,text,uuid) rename to legacy_evidence_connection_before_katana_v1;
create function private.legacy_evidence_connection_v1(p_workspace_id uuid,p_provider text,p_connection_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;installation uuid;
begin
 result:=private.legacy_evidence_connection_before_katana_v1(p_workspace_id,p_provider,p_connection_id);
 if p_provider='katana' then
  select nonce into installation from private.katana_evidence_installations where workspace_id=p_workspace_id and connection_id=p_connection_id;
  if not found then raise exception 'katana_installation_unavailable' using errcode='42501';end if;
  result:=jsonb_set(result,'{incarnation_hash}',to_jsonb(private.evidence_digest_v1(jsonb_build_array(result->>'incarnation_hash',installation))));
 end if;
 return result;
end $$;
revoke all on function private.guard_katana_installation_v1(),private.legacy_evidence_connection_v1(uuid,text,uuid),private.legacy_evidence_connection_before_katana_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
commit;
-- Rollback must disable shared Katana admission first. Dropping this boundary
-- while retaining its references would remove installation-change detection.
-- Source-writer versus completion races still require multi-session qualification.
