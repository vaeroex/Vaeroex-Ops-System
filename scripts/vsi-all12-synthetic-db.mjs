// Disposable synthetic-only SQL fixture. This is not a Supabase instance or an
// OAuth/import simulator. Never point these helpers at a hosted database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  read, uuid, w, other, owner, owner2, member, session, secondSession, memberSession,
  entity, otherEntity, conn, login, admin, map, typedSetup, sheetsFixture
} from './shared-evidence-sql-fixture.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const pt409BodySha256 = '460322cb8730ac1ff72438027771b14b42a8533b0a152836f5ba0443205e82a3';
const pt409ForwardSha256 = '249e8ff836f384680c954cf1197dbe076db6d2256871c6670dc6721efbeeb20b';
const retentionRoot = uuid(9100);
const fixtureDatabases = new WeakSet();

// Extract one complete, unmodified function body from a reviewed SQL source.
// The surrounding migration installs many unrelated dependencies that this
// bounded fixture does not pretend to reproduce.
function exactFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0 && source.indexOf(marker, start + marker.length) < 0, 'one_exact_function_required');
  const bodyStart = source.indexOf('as $$', start);
  const end = source.indexOf('$$;', bodyStart + 5);
  assert(bodyStart > start && end > bodyStart, 'complete_function_required');
  const definition = source.slice(start, end + 3);
  assert.equal((definition.match(/as \$\$/g) || []).length, 1);
  return { definition, body: source.slice(bodyStart + 5, end) };
}

export const syntheticDatabaseLimitations = Object.freeze({
  disposableInMemoryOnly: true,
  actualProviderImports: false,
  actualOAuthOrTokens: false,
  actualSupabaseAuthOrPostgrest: false,
  actualBrowserOrServerSession: false,
  fullProductionSchemaAndRls: false,
  fullWorkspaceWriterFenceInstalled: false,
  concurrentWriterProof: false,
  syntheticAuthClaimsAndSessions: true,
  syntheticBillingEntitlement: true,
  fixtureSeededReadTicketsAndRetentionRoots: true,
  readTicketBinding: 'exact migration RPC and screened checked-ticket helpers; synthetic initial ticket only',
  sourceReadabilityPredicate: 'exact migration function on minimal synthetic retention tables',
  typedSheetsResolver: 'exact draft12 function; complete draft12 trigger graph is not installed',
  otherDependencies: 'existing screened SQL fixture; document authority and product/provider policy remain modeled',
  liveModelQualified: false
});

export async function setupAll12SyntheticDb({ question = 'Question' } = {}) {
  assert.equal(typeof question, 'string');
  assert(question.length > 0 && question.length <= 8000);
  // typedSetup constructs its own in-memory PGlite. No adapter, connection URL,
  // caller-supplied database or network-backed createDatabase is accepted here.
  const { db, ref } = await typedSetup();
  try {
    await admin(db);
    await sheetsFixture(db);
    for (const file of ['07-reopen-shared-artifact.sql', '08-sheets-projection.sql',
      '10-memory-semantic-receipts.sql', '11-generation-discovery.sql']) {
      await db.exec(read(`docs/security-drafts/${file}`));
    }
    const upgrade = read('docs/security-drafts/identity-conflict-upgrade/forward.sql');
    assert.equal(sha(upgrade), pt409ForwardSha256, 'reviewed_identity_upgrade_required');
    await db.exec(upgrade);
    const patched = (await db.query(`select encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_hash,
      proacl::text acl,prosecdef security_definer,proconfig config
      from pg_proc where oid=to_regprocedure('private.shared_evidence_before_memory_receipts_v1(uuid,jsonb,uuid)')`)).rows[0];
    assert.equal(patched.body_hash, pt409BodySha256);
    assert.equal(patched.acl, '{postgres=X/postgres}');
    assert.equal(patched.security_definer, true);
    assert.deepEqual(patched.config, ['search_path=""']);

    // Preserve the actual readability conditions without importing the entire
    // platform erasure workflow. The roots below are explicitly synthetic setup.
    await db.exec(`
      alter table public.google_sheets_connections add column disconnected_at timestamptz;
      create table public.google_sheets_sync_runs(id uuid primary key,workspace_id uuid,connection_id uuid);
      create table private.google_sheets_retention_roots(id uuid primary key,workspace_id uuid,expires_at timestamptz not null,erased_at timestamptz);
      create table private.google_sheets_derivation_roots(workspace_id uuid,table_name text,record_id uuid,root_id uuid references private.google_sheets_retention_roots(id));
      create table private.google_sheets_source_root_links(workspace_id uuid,source_row_id uuid,connection_id uuid,root_id uuid references private.google_sheets_retention_roots(id));
      create table private.google_sheets_connection_root_links(workspace_id uuid,connection_id uuid,root_id uuid references private.google_sheets_retention_roots(id));
      revoke all on private.google_sheets_retention_roots,private.google_sheets_derivation_roots,private.google_sheets_source_root_links,private.google_sheets_connection_root_links from public,anon,authenticated,service_role;
    `);
    await db.query(`insert into private.google_sheets_retention_roots values($1,$2,clock_timestamp()+interval '1 day',null)`, [retentionRoot, w]);
    const privacySql = read('supabase/migrations/20261012191836_google_sheets_restricted_erasure_retention.sql');
    const readability = exactFunction(privacySql,
      'create function public.google_sheets_record_readable_v1(p_workspace_id uuid,p_table text,p_record_id uuid) returns boolean');
    assert.match(readability.body, /google_sheets_privacy_epochs/);
    assert.match(readability.body, /r\.erased_at is not null or r\.expires_at<=statement_timestamp\(\)/);
    // The base fixture's always-true stub uses different argument names. Remove
    // only that local stub (without CASCADE), then install the exact definition.
    await db.exec('drop function public.google_sheets_record_readable_v1(uuid,text,uuid);');
    await db.exec(readability.definition);
    await db.exec('revoke all on function public.google_sheets_record_readable_v1(uuid,text,uuid) from public,anon; grant execute on function public.google_sheets_record_readable_v1(uuid,text,uuid) to authenticated,service_role;');
    const allowedSource = exactFunction(privacySql, 'create function private.google_sheets_allowed_source_v1(p_table text) returns boolean');
    const bind = exactFunction(privacySql, 'create function public.bind_google_sheets_read_v1(p_ticket_id uuid,p_sources jsonb) returns jsonb');
    await db.exec(allowedSource.definition);
    await db.exec(bind.definition);
    await db.exec('revoke all on function private.google_sheets_allowed_source_v1(text) from public,anon,authenticated,service_role; revoke all on function public.bind_google_sheets_read_v1(uuid,jsonb) from public,anon; grant execute on function public.bind_google_sheets_read_v1(uuid,jsonb) to authenticated,service_role;');

    const typed = exactFunction(read('docs/security-drafts/12-workspace-writer-fence.sql'),
      'create or replace function private.shared_evidence_typed_v1(w uuid,a uuid,j jsonb) returns jsonb');
    for (const guard of ['approver.deleted_at is null', 'approver.banned_until', 'm.field_mapping=c.field_mapping',
      'public.google_sheets_record_readable_v1', 'for share of approver nowait']) assert(typed.body.includes(guard));
    await db.exec(typed.definition);
    await db.exec('revoke all on function private.shared_evidence_typed_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;');
    const installed = (await db.query(`select proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') body_hash
      from pg_proc where oid in(to_regprocedure('private.shared_evidence_typed_v1(uuid,uuid,jsonb)'),to_regprocedure('public.google_sheets_record_readable_v1(uuid,text,uuid)'))`)).rows;
    assert.equal(installed.find(row => row.proname === 'shared_evidence_typed_v1').body_hash, sha(typed.body));
    assert.equal(installed.find(row => row.proname === 'google_sheets_record_readable_v1').body_hash, sha(readability.body));
    await db.query("update public.vsi_requests set question_hash=encode(sha256(convert_to($1,'UTF8')),'hex') where id=$2", [question, uuid(103)]);
    fixtureDatabases.add(db);
    await seedReadableSheetsRows(db);
    await login(db);
    return {
      db, ref, uuid, w, other, owner, owner2, member, session, secondSession, memberSession,
      entity, otherEntity, conn, login, admin, map, retentionRoot, seedReadableSheetsRows, bindTicketRoots,
      metadata: Object.freeze({ ...syntheticDatabaseLimitations, pt409BodySha256, pt409ForwardSha256,
        sheetsResolverBodySha256: sha(typed.body), readabilityBodySha256: sha(readability.body), ticketBindingBodySha256: sha(bind.body) })
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

// Fixture setup only: records which synthetic rows share this case's synthetic
// import-retention root. It does not grant production authority or mint consent.
export async function seedReadableSheetsRows(db) {
  assert(fixtureDatabases.has(db), 'local_fixture_database_required');
  await admin(db);
  await db.query(`insert into private.google_sheets_source_root_links
    select distinct r.workspace_id,r.id,r.connection_id,$2::uuid from public.google_sheets_source_rows r
    where r.workspace_id=$1 and not exists(select 1 from private.google_sheets_source_root_links l
      where l.workspace_id=r.workspace_id and l.source_row_id=r.id and l.root_id=$2)`, [w, retentionRoot]);
  await db.query(`insert into private.google_sheets_derivation_roots
    select distinct f.workspace_id,'kpis',f.kpi_id,$2::uuid from public.google_sheets_fact_links f
    where f.workspace_id=$1 and not exists(select 1 from private.google_sheets_derivation_roots d
      where d.workspace_id=f.workspace_id and d.table_name='kpis' and d.record_id=f.kpi_id and d.root_id=$2)`, [w, retentionRoot]);
  await db.query(`insert into private.google_sheets_connection_root_links
    select distinct c.workspace_id,c.id,$2::uuid from public.google_sheets_connections c
    where c.workspace_id=$1 and not exists(select 1 from private.google_sheets_connection_root_links l
      where l.workspace_id=c.workspace_id and l.connection_id=c.id and l.root_id=$2)`, [w, retentionRoot]);
  await login(db);
}

export async function bindTicketRoots(db, ticketId, roots, { actor = owner, sid = session, role = 'authenticated' } = {}) {
  assert(fixtureDatabases.has(db), 'local_fixture_database_required');
  assert(['authenticated', 'service_role', 'anon'].includes(role), 'fixture_role_denied');
  await login(db, actor, sid, role);
  return (await db.query('select public.bind_google_sheets_read_v1($1,$2) bound', [ticketId, JSON.stringify(roots)])).rows[0].bound;
}

export { uuid, w, other, owner, owner2, member, session, secondSession, memberSession,
  entity, otherEntity, conn, login, admin, map, retentionRoot };
