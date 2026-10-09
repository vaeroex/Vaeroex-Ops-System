/* eslint-disable @typescript-eslint/no-require-imports -- Native PostgreSQL qualification. */
// Requires the repository-owned disposable full stack; refuses every remote URL.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const { discoverVsiDatabaseTarget } = require('./vsi-local-database-target.cjs');
const root = path.resolve(__dirname, '..');
const target = discoverVsiDatabaseTarget();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008190000_vsi_private_chat.sql'), 'utf8');
const researchMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261009041421_vsi_adaptive_research.sql'), 'utf8');
const A = randomUUID(), B = randomUUID(), actors = Array.from({ length: 8 }, () => randomUUID());
const clients = [], passed = [];
async function connect() { const c = new Client({ ...target.connection, connectionTimeoutMillis: 5000, statement_timeout: 15000 }); await c.connect(); clients.push(c); return c; }
async function identity(c, role, id = actors[0]) {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false),set_config('request.jwt.claims',$3,false)", [id, role, JSON.stringify({ sub: id, role })]);
  if (role !== 'postgres') await c.query(`set role ${role}`);
}
async function rpc(c, actor, action, input = {}, workspace = A) {
  return (await c.query('select public.vsi_mutate_v1($1,$2,$3,$4::jsonb) result', [workspace, actor, action, JSON.stringify(input)])).rows[0].result;
}
function ok(name, actual, expected) { assert.deepEqual(actual, expected, name); passed.push(name); }
async function denied(name, operation) { await assert.rejects(operation, error => error.code === '42501', name); passed.push(name); }
async function run() {
  const admin = await connect();
  await target.verify(admin);
  // Idempotent local application only. Production release uses its ledger.
  const exists = (await admin.query("select to_regclass('public.vsi_conversations') present")).rows[0].present;
  if (target.kind === 'supabase-local') assert(exists, 'CI must apply the VSI migration before running tests');
  else if (!exists) await admin.query(migration);
  else if (process.env.VSI_REFRESH_LOCAL_RPC === '1') {
    const fn = migration.match(/create function public\.vsi_mutate_v1\([\s\S]*?\n\$\$;/)?.[0];
    assert(fn, 'Migration RPC missing');
    await admin.query(fn.replace('create function', 'create or replace function'));
    for (const index of migration.matchAll(/create index [^;]+;/g)) await admin.query(index[0].replace('create index', 'create index if not exists'));
  }
  const researchExists = (await admin.query("select 1 from information_schema.columns where table_schema='public' and table_name='vsi_exchanges' and column_name='public_research_topics'")).rowCount === 1;
  if (target.kind === 'supabase-local') assert(researchExists, 'CI must apply the adaptive research migration');
  else if (!researchExists) await admin.query(researchMigration);
  else if (process.env.VSI_REFRESH_LOCAL_RPC === '1') {
    await admin.query(researchMigration.match(/create or replace function public\.vsi_mutate_v1\([\s\S]*?\n\$\$;/)[0]);
  }
  await admin.query('insert into public.profiles(id,email) select x, x::text||\'@vsi-test.invalid\' from unnest($1::uuid[]) x', [actors]);
  await admin.query("insert into public.workspaces(id,name,subscription_required,subscription_status) values($1,'VSI synthetic A',false,'demo'),($2,'VSI synthetic B',false,'demo')", [A, B]);
  for (let i = 0; i < actors.length; i++) await admin.query('insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,$3)', [i === 7 ? B : A, actors[i], i === 2 ? 'viewer' : i === 0 || i === 7 ? 'owner' : 'staff']);
  await admin.query("insert into public.workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [B, actors[0]]);
  const server = await connect(); await identity(server, 'service_role');
  const chat = await rpc(server, actors[0], 'create');
  const reservation = (requestId = randomUUID(), conversationId = chat.id) => ({ conversationId, requestId, questionHash: 'synthetic-question', reserveUsd: .1, monthlyBudgetUsd: 50 });
  const input = reservation();
  const first = await rpc(server, actors[0], 'reserve', input);
  ok('First question reserves once', first.state, 'reserved');
  ok('Research lease allows bounded engine plus settlement', Math.round((Date.parse(first.request.lease_until) - Date.parse(first.request.started_at)) / 1000), 240);
  ok('In-flight idempotent retry is pending', (await rpc(server, actors[0], 'reserve', input)).error, 'in_progress');
  ok('Idempotency key cannot change question', (await rpc(server, actors[0], 'reserve', { ...input, questionHash: 'changed' })).error, 'idempotency_conflict');
  const complete = { conversationId: chat.id, id: first.request.id, attempt: first.request.attempt, question: 'Synthetic question', answer: 'Synthetic answer', citations: [{ id: 'W1', sourceType: 'web', url: 'https://example.org/public', retrievedAt: new Date().toISOString() }], publicResearchTopics: ['Public Bicycle Industry'], usage: { model: 'gpt-6-luna', inputTokens: 30, outputTokens: 20, webSearchCalls: 0, estimatedCostUsd: .002 }, summary: 'Private synthetic context' };
  await rpc(server, actors[0], 'settle', complete);
  await rpc(server, actors[0], 'settle', complete);
  ok('Private research provenance survives settlement', (await admin.query('select public_research_topics from public.vsi_exchanges where id=$1', [first.request.id])).rows[0].public_research_topics, ['Public Bicycle Industry']);
  ok('Public topics never enter retained usage ledger', (await admin.query("select usage_json::text like '%Public Bicycle Industry%' leaked from public.vsi_cost_events where request_id=$1", [first.request.id])).rows[0].leaked, false);
  for (const [name, value] of [
    ['Research provenance rejects non-array', { topic: 'Public industry' }],
    ['Research provenance rejects non-string members', ['Public industry', 42]],
    ['Research provenance rejects more than twelve terms', Array(13).fill('Public industry')],
    ['Research provenance rejects oversized content', ['x'.repeat(2600)]]
  ]) {
    await assert.rejects(() => admin.query('update public.vsi_exchanges set public_research_topics=$1::jsonb where id=$2', [JSON.stringify(value), first.request.id]),
      error => ['23514', '22023'].includes(error.code), name);
    passed.push(name);
  }
  ok('Rejected provenance updates preserve the original terms', (await admin.query('select public_research_topics from public.vsi_exchanges where id=$1', [first.request.id])).rows[0].public_research_topics, ['Public Bicycle Industry']);
  ok('Completed retry replays', (await rpc(server, actors[0], 'reserve', input)).state, 'completed');
  ok('Duplicate completion counted exactly once', (await rpc(server, actors[0], 'usage')).used, 1);
  ok('Ordinary chat creates no note', (await admin.query('select count(*)::int n from public.business_notes where workspace_id=$1', [A])).rows[0].n, 0);
  const actor = await connect(); await identity(actor, 'authenticated');
  ok('Owner reads private transcript', (await actor.query('select count(*)::int n from public.vsi_exchanges where conversation_id=$1', [chat.id])).rows[0].n, 1);
  await denied('Authenticated owner cannot forge public research provenance', () => actor.query('update public.vsi_exchanges set public_research_topics=$1::jsonb where id=$2', [JSON.stringify(['Forged target']), first.request.id]));
  await denied('Authenticated caller cannot forge completion', () => rpc(actor, actors[0], 'settle', complete));
  await denied('Authenticated caller cannot insert chat', () => actor.query('insert into public.vsi_conversations(workspace_id,actor_user_id,actor_role) values($1,$2,\'owner\')', [A, actors[0]]));
  await identity(actor, 'authenticated', actors[1]);
  ok('Another member cannot read owner chat', (await actor.query('select count(*)::int n from public.vsi_exchanges where conversation_id=$1', [chat.id])).rows[0].n, 0);
  await identity(actor, 'authenticated', actors[7]);
  ok('Second workspace cannot read private chat', (await actor.query('select count(*)::int n from public.vsi_conversations where id=$1', [chat.id])).rows[0].n, 0);
  await denied('Service operation checks actual actor membership', () => rpc(server, actors[7], 'rename', { conversationId: chat.id, title: 'Unauthorized' }));
  await admin.query("update public.workspace_members set role='staff' where workspace_id=$1 and user_id=$2", [A, actors[0]]);
  await identity(actor, 'authenticated');
  ok('Role downgrade hides historical evidence and replies', (await actor.query('select count(*)::int n from public.vsi_exchanges where conversation_id=$1', [chat.id])).rows[0].n, 0);
  await admin.query("update public.workspace_members set role='owner' where workspace_id=$1 and user_id=$2", [A, actors[0]]);
  await admin.query("update public.workspaces set subscription_required=true,subscription_status='expired' where id=$1", [A]);
  ok('Expired entitlement hides direct Data API transcript', (await actor.query('select count(*)::int n from public.vsi_conversations where id=$1', [chat.id])).rows[0].n, 0);
  await denied('Expired entitlement denies new question', () => rpc(server, actors[0], 'reserve', reservation()));
  await admin.query("update public.workspaces set subscription_required=false,subscription_status='demo' where id=$1", [A]);
  const failure = await rpc(server, actors[0], 'reserve', reservation());
  await rpc(server, actors[0], 'settle', { conversationId: chat.id, id: failure.request.id, attempt: failure.request.attempt, usage: { estimatedCostUsd: .003, failed: true } });
  ok('Failed answer does not consume question', (await rpc(server, actors[0], 'usage')).used, 1);
  ok('Failed provider call still consumes spend', Number((await rpc(server, actors[0], 'usage')).spentUsd), .005);
  // Two connections really race a reserve, rather than a mocked JS counter.
  const otherServer = await connect(); await identity(otherServer, 'service_role');
  const race = await Promise.all([rpc(server, actors[0], 'reserve', reservation()), rpc(otherServer, actors[0], 'reserve', reservation())]);
  ok('Concurrent tabs accept only one request', race.filter(x => x.state === 'reserved').length, 1);
  ok('Concurrent tabs return recoverable conflict', race.filter(x => x.error === 'in_progress').length, 1);
  const won = race.find(x => x.state === 'reserved');
  await rpc(server, actors[0], 'settle', { conversationId: chat.id, id: won.request.id, attempt: won.request.attempt, usage: { estimatedCostUsd: 0 } });
  const otherChat = await rpc(server, actors[0], 'create', {}, B);
  const pendingA = await rpc(server, actors[0], 'reserve', reservation());
  ok('Person concurrency also spans workspaces', (await rpc(otherServer, actors[0], 'reserve', reservation(randomUUID(), otherChat.id), B)).error, 'in_progress');
  await rpc(server, actors[0], 'settle', { conversationId: chat.id, id: pendingA.request.id, attempt: pendingA.request.attempt, usage: { estimatedCostUsd: 0 } });
  const parallelChats = [];
  for (const a of actors.slice(1, 6)) parallelChats.push(await rpc(server, a, 'create'));
  const workspaceClaims = [];
  for (let i = 0; i < parallelChats.length; i++) workspaceClaims.push(await rpc(server, actors[i + 1], 'reserve', reservation(randomUUID(), parallelChats[i].id)));
  ok('Workspace concurrent requests capped at four', workspaceClaims.filter(x => x.state === 'reserved').length, 4);
  ok('Workspace overload is recoverable', workspaceClaims[4].error, 'workspace_busy');
  for (let i = 0; i < 4; i++) await rpc(server, actors[i + 1], 'settle', { conversationId: parallelChats[i].id, id: workspaceClaims[i].request.id, attempt: 1, usage: { estimatedCostUsd: 0 } });
  ok('Workspace spend can stop below person allowance', (await rpc(server, actors[0], 'reserve', { ...reservation(), monthlyBudgetUsd: .01 })).error, 'workspace_budget');
  // Retry the same logical question in a new month: old cost must not move.
  const monthInput = reservation(randomUUID(), parallelChats[4].id);
  const monthClaim = await rpc(server, actors[5], 'reserve', monthInput);
  await admin.query("update public.vsi_requests set started_at=date_trunc('month',clock_timestamp())-interval '1 day' where id=$1", [monthClaim.request.id]);
  await rpc(server, actors[5], 'settle', { conversationId: monthInput.conversationId, id: monthClaim.request.id, attempt: 1, usage: { estimatedCostUsd: .4 } });
  const monthRetry = await rpc(server, actors[5], 'reserve', monthInput);
  await rpc(server, actors[5], 'settle', { conversationId: monthInput.conversationId, id: monthRetry.request.id, attempt: 2, usage: { estimatedCostUsd: .001 } });
  ok('Retry preserves previous-month spend date', Number((await rpc(server, actors[0], 'usage')).spentUsd), .006);
  ok('Retry records both distinct provider attempts', (await admin.query('select count(*)::int n from public.vsi_cost_events where request_id=$1', [monthClaim.request.id])).rows[0].n, 2);
  const crashInput = reservation(randomUUID(), parallelChats[4].id);
  const crash = await rpc(server, actors[5], 'reserve', crashInput);
  await admin.query("update public.vsi_requests set lease_until=clock_timestamp()-interval '1 second' where id=$1", [crash.request.id]);
  const recovered = await rpc(server, actors[5], 'reserve', crashInput);
  ok('Crashed answer retry receives a fresh attempt', recovered.request.attempt, 2);
  ok('Late completion cannot replace a retried attempt', (await rpc(server, actors[5], 'settle', { conversationId: crashInput.conversationId, id: crash.request.id, attempt: 1, answer: 'Late answer', question: 'Old question', usage: { estimatedCostUsd: .01 } })).error, 'stale_attempt');
  await rpc(server, actors[5], 'settle', { conversationId: crashInput.conversationId, id: recovered.request.id, attempt: 2, usage: { estimatedCostUsd: 0 } });
  ok('Unknown crashed cost remains conservatively accounted', Number((await rpc(server, actors[0], 'usage')).spentUsd), .106);
  // Synthetic historical accepted requests exercise the true rolling window.
  await admin.query("insert into public.vsi_requests(workspace_id,actor_user_id,conversation_id,request_id,question_hash,status,accepted_at,started_at) select $1,$2,$3,gen_random_uuid(),'synthetic','completed',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours' from generate_series(1,99)", [A, actors[0], chat.id]);
  ok('100 accepted questions is a hard rolling ceiling', (await rpc(server, actors[0], 'reserve', reservation())).error, 'daily_limit');
  ok('Rolling person ceiling spans workspaces', (await rpc(server, actors[0], 'reserve', reservation(randomUUID(), otherChat.id), B)).error, 'daily_limit');
  await admin.query("update public.vsi_requests set accepted_at=clock_timestamp()-interval '25 hours' where workspace_id=$1 and question_hash='synthetic'", [A]);
  ok('24-hour window expires historical questions', (await rpc(server, actors[0], 'usage')).used, 1);
  await admin.query('update public.vsi_conversations set exchange_count=250 where id=$1', [chat.id]);
  ok('250-exchange transcript becomes read only', (await rpc(server, actors[0], 'reserve', reservation())).error, 'thread_full');
  const continued = await rpc(server, actors[0], 'continue', { conversationId: chat.id });
  ok('Continuation preserves a link to old transcript', continued.parent_conversation_id, chat.id);
  ok('Continuation carries only bounded private summary', continued.context_summary, 'Private synthetic context');
  ok('Continuation retry creates one child', (await rpc(server, actors[0], 'continue', { conversationId: chat.id })).id, continued.id);
  ok('Original transcript remains intact', (await admin.query('select count(*)::int n from public.vsi_exchanges where conversation_id=$1', [chat.id])).rows[0].n, 1);
  // Preserve exact note proposal under confirmation; no provider or shared index.
  const noteContent = 'We sell repair services in two locations.';
  await admin.query('update public.vsi_exchanges set remember_proposal=$1::jsonb where id=$2', [JSON.stringify({ title: 'Repair business', content: noteContent }), first.request.id]);
  const noteInput = { conversationId: chat.id, exchangeId: first.request.id, content: noteContent, sourceHash: createHash('sha256').update(noteContent).digest('hex'), releaseChannel: 'development', extraction: {}, spans: [] };
  const note = await rpc(server, actors[0], 'remember', noteInput);
  ok('Confirmation is exactly once', (await rpc(server, actors[0], 'remember', noteInput)).noteId, note.noteId);
  const noteRow = (await admin.query('select original_note_text,status,evidence_lifecycle_status from public.business_notes where id=$1', [note.noteId])).rows[0];
  ok('Note retains exact approved text and requires review', noteRow, { original_note_text: noteContent, status: 'review_required', evidence_lifecycle_status: 'inactive' });
  ok('Chat note is not silently indexed as shared fact', (await admin.query('select count(*)::int n from public.business_memory_chunks where workspace_id=$1 and source_id=$2', [A, note.noteId])).rows[0].n, 0);
  await admin.query("update public.business_notes set status='rejected' where id=$1", [note.noteId]);
  ok('Reconfirming a rejected note returns its real state', (await rpc(server, actors[0], 'remember', noteInput)).error, 'note_rejected');
  await admin.query('update public.vsi_exchanges set saved_note_id=null where id=$1', [first.request.id]);
  ok('Same-text rejected note is not silently reopened', (await rpc(server, actors[0], 'remember', noteInput)).error, 'note_rejected');
  await admin.query("update public.business_notes set status='archived',evidence_lifecycle_status='archived' where id=$1", [note.noteId]);
  ok('Same-text archived note is not silently recreated', (await rpc(server, actors[0], 'remember', noteInput)).error, 'note_archived');
  ok('Rejected and archived confirmations create no duplicate', (await admin.query('select count(*)::int n from public.business_notes where workspace_id=$1', [A])).rows[0].n, 1);
  ok('Archived note remains archived and inactive', (await admin.query('select status,evidence_lifecycle_status from public.business_notes where id=$1', [note.noteId])).rows[0], { status: 'archived', evidence_lifecycle_status: 'archived' });
  await denied('Viewer cannot confirm Business Note', () => rpc(server, actors[2], 'remember', { ...noteInput, conversationId: parallelChats[1].id }));
  await rpc(server, actors[0], 'delete', { conversationId: chat.id });
  ok('Delete removes full transcript', (await admin.query('select count(*)::int n from public.vsi_exchanges where conversation_id=$1', [chat.id])).rows[0].n, 0);
  ok('Delete does not reset person quota', (await rpc(server, actors[0], 'usage')).used, 1);
  ok('Delete does not reset financial ledger', Number((await rpc(server, actors[0], 'usage')).spentUsd), .106);
  await identity(actor, 'anon');
  await denied('Anonymous users cannot list transcripts', () => actor.query('select * from public.vsi_conversations'));
  const catalog = await admin.query(fs.readFileSync(path.join(root, 'supabase/tests/vsi_private_chat.test.sql'), 'utf8'));
  const tap = catalog.flatMap(result => result.rows).flatMap(row => Object.values(row)).map(String);
  assert(!tap.some(line => /^not ok/.test(line)), tap.join('\n'));
  ok('pgTAP grants, RLS, RPC and deletion catalog checks', tap.filter(line => /^ok \d+/.test(line)).length, 10);
  console.log(JSON.stringify({ status: 'passed', migrationSha256: createHash('sha256').update(migration).digest('hex'), checks: passed.length, passed }, null, 2));
}
run().catch(error => { console.error(JSON.stringify({ error: error.message, passed })); process.exitCode = 1; }).finally(async () => {
  const admin = clients[0];
  if (admin) { await identity(admin, 'postgres').catch(() => {}); await admin.query('delete from public.workspaces where id=any($1::uuid[])', [[A, B]]).catch(() => {}); await admin.query('delete from public.profiles where id=any($1::uuid[])', [actors]).catch(() => {}); }
  await Promise.all(clients.map(c => c.end()));
});
