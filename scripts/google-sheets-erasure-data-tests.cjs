/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic PostgreSQL qualification. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { qualify } = require('./google-sheets-data-tests.cjs');

async function qualifyApproval(db) {
  const baseline = await qualify(db);
  await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261002225025_google_sheets_support_erasure.sql'), 'utf8'));
  const owner = randomUUID(), stranger = randomUUID(), session = randomUUID(), strangerSession = randomUUID();
  const workspace = randomUUID(), otherWorkspace = randomUUID(), request = randomUUID(), connection = randomUUID();
  const artifact = randomUUID(), scope = 'a'.repeat(64), deleteArtifacts = [{ table: 'reports', id: artifact }];
  await db.query('insert into auth.users(id) values($1),($2)', [owner, stranger]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [session, owner, strangerSession, stranger]);
  await db.query('insert into public.workspaces(id) values($1),($2)', [workspace, otherWorkspace]);
  await db.query("insert into public.workspace_members values($1,$2,'owner','active'),($3,$4,'owner','active')", [workspace, owner, otherWorkspace, stranger]);
  const inventory = { version: 1, workspaceId: workspace, connectionId: connection,
    base: [{ table: 'google_sheets_source_versions', id: randomUUID(), hash: 'b'.repeat(64) }], candidates: [] };
  const decisions = [...deleteArtifacts.map(item => ({ ...item, action: 'delete' })), { table: 'reports', id: randomUUID(), action: 'keep_unrelated' }];
  await db.query(`insert into private.google_sheets_erasure_requests(id,workspace_id,connection_id,case_id,inventory,decisions,scope_hash)
    values($1,$2,$3,$4,$5,$6,$7)`, [request, workspace, connection, randomUUID(), inventory, decisions, scope]);
  let checks = 0;
  const as = async (role, user, sid, action) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [user, JSON.stringify({ sub: user, session_id: sid })]);
    await db.exec(`set role ${role}`);
    try { return await action(); } finally { await db.exec('reset role'); }
  };
  const read = () => db.query('select public.read_google_sheets_erasure_request_v1($1) result', [request]);
  const confirm = (hash = scope, artifacts = deleteArtifacts) => db.query('select public.confirm_google_sheets_erasure_request_v1($1,$2,$3) result', [request, hash, artifacts]);
  const deny = async (action, expected) => { await assert.rejects(action, expected); checks++; };
  for (const role of ['anon', 'service_role', 'google_sheets_erasure_support']) {
    await deny(() => as(role, owner, session, read), /permission denied/);
    await deny(() => as(role, owner, session, confirm), /permission denied/);
  }
  await deny(() => as('authenticated', stranger, strangerSession, read), /owner_denied/);
  await deny(() => as('authenticated', owner, strangerSession, confirm), /session_denied|owner_denied/);
  await deny(() => as('authenticated', owner, session, () => confirm('c'.repeat(64))), /scope_changed/);
  await deny(() => as('authenticated', owner, session, () => confirm(scope, [])), /artifact_confirmation_required/);
  await deny(() => as('authenticated', owner, session, () => confirm(scope, [...deleteArtifacts, ...deleteArtifacts])), /artifact_confirmation_required/);
  await deny(() => as('authenticated', owner, session, () => confirm(scope, [{ table: 'reports', id: randomUUID() }])) , /artifact_confirmation_required/);
  await deny(() => as('authenticated', owner, session, () => confirm(scope, [{ ...deleteArtifacts[0], payload: 'forbidden' }])) , /artifact_confirmation_required/);
  const view = (await as('authenticated', owner, session, read)).rows[0].result;
  assert.equal(view.workspaceId, workspace); assert.equal(view.counts.google_sheets_source_versions, 1); checks++;
  assert.deepEqual(view.artifacts, decisions); checks++;
  await as('authenticated', owner, session, confirm);
  const snapshot = (await db.query('select * from private.google_sheets_erasure_requests where id=$1', [request])).rows[0];
  assert.equal(snapshot.state, 'approved'); assert.equal(snapshot.approved_by, owner); assert.equal(snapshot.approved_session_id, session); checks++;
  await as('authenticated', owner, session, confirm);
  assert.deepEqual((await db.query('select * from private.google_sheets_erasure_requests where id=$1', [request])).rows[0], snapshot); checks++;
  await db.query("update public.workspace_members set status='suspended' where workspace_id=$1", [workspace]);
  await deny(() => as('authenticated', owner, session, confirm), /owner_denied/);
  await db.query("update public.workspace_members set status='active' where workspace_id=$1", [workspace]);
  await db.query('delete from auth.sessions where id=$1', [session]);
  await deny(() => as('authenticated', owner, session, read), /session_denied|owner_denied/);
  for (const role of ['authenticated', 'service_role', 'google_sheets_erasure_support']) {
    await deny(() => as(role, owner, session, () => db.query('update private.google_sheets_erasure_requests set state=\'completed\'')), /permission denied/);
  }
  const rls = (await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.google_sheets_erasure_requests'::regclass")).rows[0];
  assert.equal(rls.relrowsecurity, true); assert.equal(rls.relforcerowsecurity, true); checks++;
  await deny(() => db.exec('delete from public.google_sheets_source_versions'), /immutable/);
  await deny(() => db.exec('delete from public.google_sheets_mapping_approvals'), /immutable/);
  return { baseline, checks, scope: 'requester approval only; no destructive executor installed' };
}
module.exports = { qualifyApproval };
if (require.main === module) {
  const db = new PGlite();
  qualifyApproval(db).then(result => console.log(JSON.stringify({ suite: 'google_sheets_erasure_approval_database', ...result })))
    .catch(error => { console.error({ stage: 'synthetic_approval', code: error.code, message: error.message }); process.exitCode = 1; })
    .finally(() => db.close());
}
