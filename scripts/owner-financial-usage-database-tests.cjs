/* eslint-disable @typescript-eslint/no-require-imports -- Native rollback-only quota qualification. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

// Caller owns/guards the isolated DB, transaction and authenticated synthetic actor.
// No model calls, secret output, committed fixture changes or authorization mocks.
async function qualify({ client: db, claims, workspaceId, dependencies, otherConnectionId }) {
  const results = [];
  const hash = label => createHash('sha256').update('private usage regression ' + label).digest('hex');
  async function call(sql, args = [], jwt = claims, role = 'authenticated') {
    await db.query('savepoint usage_probe');
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(jwt)]);
      await db.query('set local role ' + role);
      const result = await db.query(sql, args);
      await db.query('reset role'); await db.query('release savepoint usage_probe');
      return { rows: result.rows, count: result.rowCount, value: result.rows[0]?.r };
    } catch (error) {
      await db.query('rollback to savepoint usage_probe');
      return { error: error.code, message: error.message };
    }
  }
  async function check(name, fn) {
    await db.query('savepoint usage_case');
    try { await fn(); results.push({ name, pass: true }); }
    catch (error) { error.message = name + ': ' + error.message; throw error; }
    finally { await db.query('rollback to savepoint usage_case'); }
  }
  const claim = label => call('select public.claim_owner_financial_brief_v1($1,$2::jsonb,$3) r', [workspaceId, JSON.stringify(dependencies), hash(label)]);
  const finish = (c, artifact = null) => call('select public.finish_owner_financial_brief_v1($1,$2,$3::jsonb) r', [c.id, c.leaseId, artifact && JSON.stringify(artifact)], { role: 'service_role' }, 'service_role');
  const slots = async () => Number((await db.query("select count(*) n from public.ai_agent_runs where workspace_id=$1 and created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC'", [workspaceId])).rows[0].n);
  const usage = async id => (await db.query('select r.* from public.ai_agent_runs r join private.owner_financial_briefings_v1 b on b.usage_run_id=r.id where b.id=$1', [id])).rows[0];
  async function limit(n) {
    // Rollback-only custom plan to exercise exact capacity without 1000 inserts.
    await db.query("insert into public.subscription_plans(name,slug,max_ai_runs_per_month) values('Synthetic quota test','private-quota-test',$1) on conflict(slug) do update set max_ai_runs_per_month=excluded.max_ai_runs_per_month", [n]);
    await db.query("insert into public.customer_subscriptions(workspace_id,customer_email,plan_slug,status,billing_provider,stripe_customer_id,stripe_subscription_id,current_period_end,created_at) values($1,'quota@example.invalid','private-quota-test','active','stripe','cus_synthetic_private_quota','sub_synthetic_private_quota',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 minute')", [workspaceId]);
    assert.equal((await db.query("select private.workspace_persisted_limit_v1($1,'ai_runs_this_month') n", [workspaceId])).rows[0].n, n);
  }
  await check('new private claim reserves exactly one content-free shared slot', async () => {
    const before = await slots(); const c = await claim('opaque'); assert.equal(c.value?.status, 'claimed', JSON.stringify(c));
    const r = await usage(c.value.id); assert.equal(await slots(), before + 1);
    assert.equal(r.agent_type, 'private_analysis_reservation_v1'); assert.deepEqual(r.input_json, {}); assert.deepEqual(r.output_json, {}); assert.equal(r.error_message, null);
    assert.equal(r.created_by, claims.sub); assert.equal(r.workspace_id, workspaceId); assert.equal(r.status, 'processing');
    const b = (await db.query('select created_at from private.owner_financial_briefings_v1 where id=$1', [c.value.id])).rows[0]; assert.equal(r.created_at.toISOString(), b.created_at.toISOString());
    assert.equal((await call('select input_json,output_json from public.ai_agent_runs where id=$1', [r.id])).count, 1);
  });
  await check('duplicate and in-flight claims do not reserve again', async () => {
    const c = await claim('duplicate'); assert.equal(c.value?.status, 'claimed'); const before = await slots();
    assert.equal((await claim('duplicate')).value.id, c.value.id); assert.equal((await claim('another')).value.status, 'processing'); assert.equal(await slots(), before);
  });
  await check('failure retains its slot; duplicate failed key does not charge twice', async () => {
    const c = (await claim('failed')).value; assert.equal(c?.status, 'claimed'); const before = await slots(); assert.equal((await finish(c)).value, true);
    assert.equal((await usage(c.id)).status, 'failed'); assert.equal((await claim('failed')).value.status, 'failed'); assert.equal(await slots(), before);
    assert.equal((await finish(c)).value, false);
  });
  await check('successful private completion never copies artifact into shared slot', async () => {
    const c = (await claim('complete')).value; const artifact = { workspaceId, generationKey: hash('complete'), contractId: 'intelligence_briefing_v1', testOnly: 'PRIVATE PROSE' };
    assert.equal((await finish(c, artifact)).value, true); const r = await usage(c.id); assert.equal(r.status, 'completed'); assert.deepEqual(r.output_json, {}); assert.deepEqual(r.input_json, {});
  });
  await check('private claims and ordinary runs share final monthly slot', async () => {
    const before = await slots(); await limit(before + 1); const attempt = await claim('last-slot'); const c = attempt.value; assert.equal(c?.status, 'claimed', JSON.stringify(attempt));
    assert.equal((await finish(c)).value, true);
    const denied = await call("insert into public.ai_agent_runs(workspace_id,agent_type) values($1,'synthetic_quota_probe')", [workspaceId]); assert.equal(denied.error, '23514'); assert.equal(denied.message, 'workspace_usage_limit_reached');
    const second = await claim('over-quota'); assert.equal(second.error, '23514'); assert.equal(second.message, 'workspace_usage_limit_reached'); assert.equal(await slots(), before + 1);
    assert.equal(Number((await db.query('select count(*) n from private.owner_financial_briefings_v1 where generation_key=$1', [hash('over-quota')])).rows[0].n), 0);
  });
  await check('ordinary shared run consumes final slot before private claim', async () => {
    const before = await slots(); await limit(before + 1);
    assert.equal((await call("insert into public.ai_agent_runs(workspace_id,agent_type,status) values($1,'synthetic_quota_probe','failed')", [workspaceId])).count, 1);
    assert.equal((await claim('ordinary-first')).message, 'workspace_usage_limit_reached'); assert.equal(await slots(), before + 1);
  });
  await check('reservation cannot be deleted, relabeled, enriched, hidden or backdated', async () => {
    const c = (await claim('immutable')).value; const r = await usage(c.id);
    for (const sql of ['delete from public.ai_agent_runs where id=$1', "update public.ai_agent_runs set agent_type='intelligence_briefing_v1' where id=$1", "update public.ai_agent_runs set input_json='{\"source\":\"private\"}' where id=$1", "update public.ai_agent_runs set output_json='{\"summary\":\"private\"}' where id=$1", "update public.ai_agent_runs set created_at='2000-01-01' where id=$1", "update public.ai_agent_runs set deleted_at=clock_timestamp() where id=$1", "update public.ai_agent_runs set status='completed' where id=$1"]) {
      const r = await call(sql, [await usage(c.id).then(r => r.id)]); assert(r.error === '23514' || r.count === 0, JSON.stringify(r));
    }
    assert.equal((await usage(c.id)).status, 'processing'); assert.equal((await usage(c.id)).id, r.id);
  });
  await check('service cannot delete or enrich a reservation either', async () => {
    const c = (await claim('service-immutable')).value; const r = await usage(c.id);
    for (const sql of ['delete from public.ai_agent_runs where id=$1', "update public.ai_agent_runs set output_json='{\"private\":true}' where id=$1"]) assert.equal((await call(sql, [r.id], {role:'service_role'}, 'service_role')).error, '23514');
  });
  await check('UTC monthly quota excludes historical slots but includes failed current slots', async () => {
    const before = await slots();
    await db.query("insert into public.ai_agent_runs(workspace_id,agent_type,status,created_at) values($1,'synthetic_historical_probe','failed',(date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 microsecond')", [workspaceId]);
    assert.equal(await slots(), before); await limit(before + 1); const c = (await claim('utc')).value; assert.equal(c?.status, 'claimed'); await finish(c); assert.equal(await slots(), before + 1);
  });
  await check('authorization rejection creates no slot; direct private write remains denied', async () => {
    const before = await slots(); await db.query("update public.workspace_members set role='staff' where workspace_id=$1 and user_id=$2", [workspaceId, claims.sub]);
    assert.equal((await claim('staff')).error, '42501'); assert.equal(await slots(), before);
    assert.equal((await call('select * from private.owner_financial_briefings_v1')).error, '42501');
    if(otherConnectionId) assert.equal((await call('select public.claim_owner_financial_brief_v1($1,$2::jsonb,$3) r', [workspaceId, JSON.stringify([{...dependencies[0],connectionId:otherConnectionId}]), hash('cross-tenant')])).error, '42501');
  });
  await check('reservation internal helpers remain uncallable', async () => {
    for (const helper of ['reserve_owner_financial_brief_usage_v1','sync_owner_financial_brief_usage_v1','protect_private_analysis_reservation_v1']) {
      const grants = (await db.query("select has_function_privilege('authenticated',$1,'execute') a,has_function_privilege('service_role',$1,'execute') s", ['private.' + helper + '()'])).rows[0]; assert.deepEqual(grants, {a:false,s:false});
    }
  });
  return results;
}
module.exports = { qualify };

// Schema-level integration qualification for pristine CI databases. These
// trusted test inserts exercise storage triggers only, not owner admission.
// The authenticated claim/receipt/session path is separately qualified above.
async function qualifyStorage({ client: db }) {
  const { randomUUID } = require('node:crypto');
  const actor = randomUUID(), workspace = randomUUID(), plan = 'quota-' + randomUUID();
  const results = [];
  await db.query('savepoint reservation_storage');
  try {
    await db.query("select set_config('request.jwt.claims','{}',true)");
    await db.query('insert into auth.users(id,email) values($1,$2)', [actor, actor + '@example.invalid']);
    await db.query("insert into public.profiles(id,email) values($1,$2) on conflict(id) do nothing", [actor, actor + '@example.invalid']);
    await db.query("insert into public.workspaces(id,name,subscription_required,manually_unlocked) values($1,'Rollback-only private usage qualification',true,true)", [workspace]);
    await db.query("insert into public.subscription_plans(name,slug,max_ai_runs_per_month) values('Rollback-only quota', $1,1)", [plan]);
    await db.query("insert into public.customer_subscriptions(workspace_id,customer_email,plan_slug,status,billing_provider,manually_activated) values($1,'quota@example.invalid',$2,'active','manual',true)", [workspace,plan]);
    const insert = "insert into private.owner_financial_briefings_v1(workspace_id,owner_id,session_id,generation_key,dependencies,status,created_at) values($1,$2,$3,$4,'[{\"testOnly\":true}]','processing', $5) returning id,usage_run_id,created_at";
    const past = (await db.query("select (date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 microsecond' d")).rows[0].d;
    const old = (await db.query(insert, [workspace, actor, randomUUID(), 'a'.repeat(64), past])).rows[0];
    const run = (await db.query(insert, [workspace, actor, randomUUID(), 'b'.repeat(64), new Date()])).rows[0];
    const rows = (await db.query('select id,input_json,output_json,error_message,status from public.ai_agent_runs where workspace_id=$1 order by created_at', [workspace])).rows;
    assert.equal(rows.length,2); assert(rows.every(r=>r.error_message===null&&JSON.stringify(r.input_json)==='{}'&&JSON.stringify(r.output_json)==='{}'));
    results.push({name:'native private insertion reserves empty public slot with UTC historical exclusion',pass:true});
    async function reject(name, sql, args, code='23514') {
      await db.query('savepoint reject_probe'); let caught;
      try { await db.query(sql,args); } catch(e) { caught=e; }
      await db.query('rollback to savepoint reject_probe'); assert.equal(caught?.code,code,name); results.push({name,pass:true});
    }
    await reject('private excess claim atomically fails shared quota', insert, [workspace,actor,randomUUID(),'c'.repeat(64),new Date()]);
    await reject('public workflow sees private slot at exact capacity', "insert into public.ai_agent_runs(workspace_id,agent_type) values($1,'synthetic_quota_probe')", [workspace]);
    await reject('native reservation hard delete denied', 'delete from public.ai_agent_runs where id=$1', [run.usage_run_id]);
    await reject('native reservation payload enrichment denied', "update public.ai_agent_runs set output_json='{\"secret\":true}' where id=$1", [run.usage_run_id]);
    await reject('native reservation relabel denied', "update public.ai_agent_runs set agent_type='intelligence_briefing_v1' where id=$1", [run.usage_run_id]);
    await reject('native reservation status forgery denied', "update public.ai_agent_runs set status='completed' where id=$1", [run.usage_run_id]);
    await db.query("update private.owner_financial_briefings_v1 set status='failed' where id=$1",[run.id]);
    assert.equal((await db.query('select status from public.ai_agent_runs where id=$1',[run.usage_run_id])).rows[0].status,'failed');
    results.push({name:'private failed lifecycle syncs status without restoring slot',pass:true});
    await db.query('savepoint erase_owner');
    await db.query('delete from auth.users where id=$1',[actor]);
    await db.query('delete from public.profiles where id=$1',[actor]);
    assert((await db.query('select created_by from public.ai_agent_runs where workspace_id=$1',[workspace])).rows.every(r=>r.created_by===null));
    assert.equal(Number((await db.query('select count(*) n from public.ai_agent_runs where workspace_id=$1',[workspace])).rows[0].n),2);
    results.push({name:'owner erasure retains content-free historical usage',pass:true});
    await db.query('rollback to savepoint erase_owner');
    await db.query('delete from public.workspaces where id=$1',[workspace]);
    await db.query('set constraints private.owner_financial_brief_usage_fk immediate');
    assert.equal(Number((await db.query('select count(*) n from public.ai_agent_runs where id=any($1::uuid[])',[[run.usage_run_id,old.usage_run_id]])).rows[0].n),0);
    results.push({name:'workspace erasure cascades private artifacts and reservations',pass:true});
    return results;
  } finally { await db.query('rollback to savepoint reservation_storage'); }
}
module.exports.qualifyStorage = qualifyStorage;
