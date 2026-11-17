// Shared local proof fixture: actual protected reader SQL, synthetic identity/session checks.
import { readFileSync } from 'node:fs';
import { asService, ids } from './reporting-recurring-test-db.mjs';
export const entity = '77777777-7777-4777-8777-777777777777';
const session = '88888888-8888-4888-8888-888888888888';

export async function installProtectedReaders(db, tables = ['reporting_connections']) {
  await asService(db);
  // Emulate Supabase's server service role, keeping authenticated RLS separate.
  await db.exec('alter role service_role bypassrls');
  await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    create table public.business_entities(workspace_id uuid,id uuid,status text,primary key(workspace_id,id));
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function private.square_production_customer_require_owner_v1(a uuid,s uuid,w uuid,unused uuid)
    returns void language plpgsql security definer set search_path='' as $$begin
      if not exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
        join auth.sessions j on j.user_id=u.id where m.workspace_id=w and m.user_id=a and m.role='owner' and m.status='active'
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<clock_timestamp())
        and j.id=s and j.not_after>clock_timestamp()) then raise exception 'fixture_owner_session_denied' using errcode='42501'; end if;
    end$$;`);
  await db.query("insert into business_entities values($1,$2,'active')", [ids.workspace, entity]);
  await db.query("insert into auth.sessions values($1,$2,clock_timestamp()+interval '1 day')", [session, ids.actor]);
  const source = readFileSync(new URL('../docs/security-drafts/01-legacy-evidence.sql', import.meta.url), 'utf8');
  // Complete unchanged table/reader definitions. Later all-provider triggers
  // require unrelated connector stores; this fixture installs the reporting one.
  await db.exec(source.slice(source.indexOf('begin;'), source.indexOf('create function private.revoke_legacy_evidence_binding_v1')) + '\ncommit;');
  const triggerStart = source.indexOf('create function private.revoke_legacy_evidence_binding_v1');
  const triggerEnd = source.indexOf('create trigger legacy_evidence_revoke', triggerStart);
  await db.exec(source.slice(triggerStart, triggerEnd));
  for (const table of tables) {
    if (!['reporting_connections', 'loyverse_connections', 'zoho_books_connections', 'wix_order_connections'].includes(table)) throw new Error('fixture_table_denied');
    await db.exec(`create trigger legacy_evidence_revoke before update or delete on public.${table}
      for each row execute function private.revoke_legacy_evidence_binding_v1();`);
  }
  await db.exec(`revoke all on function private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
    grant execute on function public.preview_legacy_evidence_mapping_v1(uuid,text,uuid),public.confirm_legacy_evidence_mapping_v1(uuid,text,uuid,uuid,text),
      public.capture_legacy_evidence_v1(uuid,uuid,date,date),public.reopen_legacy_evidence_v1(uuid,uuid) to authenticated;`);
}
export async function owner(db, workspace = ids.workspace, actor = ids.actor) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims',$2,false)",
    [actor, JSON.stringify({ sub: actor, session_id: session, role: 'authenticated', workspace })]);
  await db.exec('set role authenticated');
}
