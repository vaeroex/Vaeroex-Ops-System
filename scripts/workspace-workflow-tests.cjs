/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL action/query contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(name => {
    if (name in mocks) return mocks[name];
    if (name === '@/lib/forms/submission-schema') return schema;
    return {};
  }, compiled, compiled.exports);
  return compiled.exports;
}
const schema = load('lib/forms/submission-schema.ts');
const history = load('lib/records/asset-check-history.ts');
let checks = 0;
function ok(label, fn) { fn(); checks++; console.log(`PASS ${label}`); }
function adapter(db) {
  return { auth: { getUser: async () => ({ data: { user: { id: actor, email: 'synthetic@example.invalid' } } }) }, async rpc(name, args) {
    assert.equal(name, 'submit_internal_form_v1');
    try { return { data: (await db.query('select public.submit_internal_form_v1($1,$2,$3,$4,$5,$6) value',
      [args.p_workspace_id,args.p_form_id,args.p_request_id,args.p_submitter_name,args.p_submitter_email,args.p_data_json])).rows[0].value, error: null }; }
    catch (error) { return { data: null, error }; }
  }, from(table) {
    assert(['forms', 'form_submissions', 'asset_checks', 'assets'].includes(table));
    let conditions = [], values = [], orders = [], range = null, inserted = null, single = false, wantsCount = false;
    const column = name => { assert(/^[a-z_]+$/.test(name)); return `"${name}"`; };
    const comparison = (name, operator, value) => { values.push(value); conditions.push(`${column(name)} ${operator} $${values.length}`); return q; };
    const q = {
      select(_columns, options) { wantsCount = options?.count === 'exact'; return q; },
      eq(name, value) { return comparison(name, '=', value); },
      is(name, value) { assert.equal(value, null); conditions.push(`${column(name)} is null`); return q; },
      not(name, operator, value) { assert.equal(operator, 'is'); assert.equal(value, null); conditions.push(`${column(name)} is not null`); return q; },
      ilike(name, value) { return comparison(name, 'ilike', value); },
      gte(name, value) { return comparison(name, '>=', value); },
      lte(name, value) { return comparison(name, '<=', value); },
      order(name, { ascending }) { orders.push(`${column(name)} ${ascending ? 'asc' : 'desc'}`); return q; },
      range(from, to) { range = [from, to]; return q; },
      insert(row) { inserted = row; return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      async then(resolve, reject) {
        try {
          if (inserted) {
            const keys = Object.keys(inserted), vals = Object.values(inserted);
            const result = await db.query(`insert into ${table} (${keys.map(column).join(',')}) values (${vals.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, vals);
            return resolve({ data: single ? result.rows[0] : result.rows, error: null });
          }
          const where = conditions.length ? ` where ${conditions.join(' and ')}` : '';
          const count = wantsCount ? Number((await db.query(`select count(*) n from ${table}${where}`, values)).rows[0].n) : null;
          const result = await db.query(`select * from ${table}${where}${orders.length ? ' order by ' + orders.join(',') : ''}${range ? ` limit ${range[1] - range[0] + 1} offset ${range[0]}` : ''}`, values);
          return resolve({ data: single ? result.rows[0] || null : result.rows, count, error: null });
        } catch (error) { if (reject) return reject(error); throw error; }
      }
    };
    return q;
  } };
}
const workspace = randomUUID(), foreignWorkspace = randomUUID(), actor = randomUUID(), formId = randomUUID(), foreignFormId = randomUUID(), assetId = randomUUID();
const form = entries => { const data = new FormData(); Object.entries(entries).forEach(([key, value]) => data.set(key, value)); return data; };
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table forms(id uuid primary key default gen_random_uuid(),workspace_id uuid,name text,schema_json jsonb,archived_at timestamptz,deleted_at timestamptz,description text,form_type text,is_public boolean,public_slug text,created_by uuid);
      create table form_submissions(id uuid primary key default gen_random_uuid(),workspace_id uuid,form_id uuid,submitted_by uuid,submitter_name text,submitter_email text,data_json jsonb,ai_summary text,ai_detected_priority text,ai_detected_followups_json jsonb);
      create table asset_checks(id uuid primary key default gen_random_uuid(),workspace_id uuid,asset_id uuid,checked_by uuid,status text,notes text,photos_json jsonb,created_at timestamptz default now(),archived_at timestamptz,deleted_at timestamptz,folder_id uuid);`);
    // Authentication/entitlement are synthetic here; the native companion
    // suite verifies the real repository role/entitlement functions and races.
    await db.exec(`create schema private; create schema auth; create role anon; create role authenticated; create role service_role;
      create table workspaces(id uuid primary key); create table workspace_members(workspace_id uuid,user_id uuid,role text,status text);
      create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
      create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
      create function auth.role() returns text language sql as $$select 'authenticated'::text$$;
      create function private.workspace_entitlement_active_v1(uuid) returns boolean language sql as $$select true$$;`);
    await db.query('insert into workspaces values($1),($2)',[workspace,foreignWorkspace]);
    await db.query("insert into workspace_members values($1,$2,'owner','active')",[workspace,actor]);
    await db.query('insert into auth.users(id) values($1)',[actor]);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261005061024_internal_form_submission_idempotency.sql'),'utf8'));
    const storedSchema = schema.createSubmissionSchema('Business detail\nInspection date\nPriority');
    await db.query('insert into forms(id,workspace_id,name,schema_json) values($1,$2,$3,$4),($5,$6,$3,$4)', [formId, workspace, 'Synthetic internal form', storedSchema, foreignFormId, foreignWorkspace]);
    const legacy = { summary: 'Historical submission stays unchanged', priority: 'Medium', follow_up: '' };
    await db.query('insert into form_submissions(workspace_id,form_id,data_json) values($1,$2,$3)', [workspace, formId, legacy]);
    const supabase = adapter(db);
    let activeRole = "owner", membershipStatus = "active";
    const mocks = {
      'next/navigation': { redirect: value => { throw new Error(`REDIRECT ${decodeURIComponent(value.replace(/\+/g, ' '))}`); } },
      'next/cache': { revalidatePath() {} },
      '@/lib/supabase/server': { createSupabaseServerClient: async () => supabase },
      '@/lib/workspaces/current': { getWorkspaceContext: async () => ({ activeWorkspace: { id: workspace }, membership: { workspace_id: workspace, status: membershipStatus, role: activeRole } }) },
      '@/lib/billing/require-active-subscription': { requireActiveSubscription: async () => {} }
    };
    const actions = load('app/app/operations/actions.ts', mocks);
    const payload = new FormData(); payload.set('synthetic', 'unchanged');
    for (const [modulePath, exportName, originalName] of [
      ['app/app/operations/form-submission-action.ts', 'submitInternalForm', 'createFormSubmissionAction'],
      ['app/app/files/worksheet-approval-action.ts', 'submitWorksheetApproval', 'saveExtractedImportAction'],
      ['app/app/operations/issue-submission-action.ts', 'submitIssue', 'createIssueAction']
    ]) {
      let releaseAdapter, adapterCompleted = false, adapterCalls = 0;
      const adapterWait = new Promise(resolve => { releaseAdapter = resolve; });
      const stateAdapter = load(modulePath, { './actions': { [originalName]: async data => {
        assert.equal(data, payload); adapterCalls++; await adapterWait;
      } } });
      const adapterResult = stateAdapter[exportName](null, payload).then(value => { adapterCompleted = true; return value; });
      await Promise.resolve(); assert.equal(adapterCompleted, false); releaseAdapter();
      assert.equal(await adapterResult, null);
      ok(`${exportName} preserves FormData and awaits the original action once`, () => { assert.equal(adapterCalls, 1); });
      for (const thrown of [new Error('Synthetic action failure'), Object.assign(new Error('Synthetic redirect'), { digest: 'NEXT_REDIRECT;replace;/app/form-submissions;303;' })]) {
        const failedAdapter = load(modulePath, { './actions': { [originalName]: async () => { throw thrown; } } });
        await assert.rejects(failedAdapter[exportName](null, payload), error => error === thrown);
      }
      ok(`${exportName} forwards errors and framework redirects without catching or rewriting`, () => {});
    }

    const valid = () => form({ submission_request_id: randomUUID(), form_id: formId, submitter_name: 'Synthetic operator', submitter_email: 'operator@example.invalid', summary: 'Inspection recorded', priority: 'Medium', follow_up: '', 'field:business-detail': 'Synthetic unit inspected', 'field:inspection-date': '2026-10-04', 'field:priority': 'High' });
    ok('schema preserves supported field types and deduplicates keys', () => {
      assert.deepEqual(schema.createSubmissionSchema('Name\nName').map(f => f.key), ['name', 'name-1']);
      assert.deepEqual(schema.parseSubmissionSchema(storedSchema), storedSchema);
    });
    ok('schema rejects duplicate keys, unsupported types and excessive fields', () => {
      assert.throws(() => schema.parseSubmissionSchema([storedSchema[0], storedSchema[0]]));
      assert.throws(() => schema.parseSubmissionSchema([{ ...storedSchema[0], type: 'script' }]));
      assert.throws(() => schema.createSubmissionSchema(Array(51).fill('Name').join('\n')));
    });
    for (const [label, mutate, message] of [
      ['missing request identity', data => data.delete('submission_request_id'), /Refresh this form/],
      ['repeated request identity', data => data.append('submission_request_id', randomUUID()), /Refresh this form/],
      ['required field', data => data.delete('field:business-detail'), /Business detail is required/],
      ['impossible date', data => data.set('field:inspection-date', '2026-02-30'), /valid date/],
      ['unsupported priority', data => data.set('field:priority', 'Emergency'), /listed priority/],
      ['forged field', data => data.set('field:forged', 'x'), /fields have changed/],
      ['duplicate value', data => data.append('field:business-detail', 'second'), /one text value/],
      ['oversized field', data => data.set('field:business-detail', 'x'.repeat(2001)), /2000 characters/],
      ['foreign parent', data => data.set('form_id', foreignFormId), /unavailable in the current workspace/]
    ]) {
      const data = valid(); mutate(data);
      await assert.rejects(actions.createFormSubmissionAction(data), message);
      assert.equal((await db.query('select count(*) n from form_submissions')).rows[0].n, 1);
      checks++; console.log(`PASS server rejects ${label} without persistence`);
    }
    const accepted = valid();
    await actions.createFormSubmissionAction(accepted).catch(error => assert.match(error.message, /Submission saved/));
    await actions.createFormSubmissionAction(accepted).catch(error => assert.match(error.message, /Submission saved/));
    ok('actual action replay returns success without a second persisted response', () => {});
    accepted.set('summary','Different response using the same identity');
    await assert.rejects(actions.createFormSubmissionAction(accepted), /already used with different responses/); checks++;
    assert.equal((await db.query('select count(*) n from form_submissions')).rows[0].n,2);
    const saved = (await db.query('select * from form_submissions where submitted_by=$1', [actor])).rows[0];
    ok('actual action persists fields and schema snapshot in isolated PostgreSQL', () => {
      assert.equal(saved.workspace_id, workspace); assert.equal(saved.form_id, formId);
      assert.deepEqual(saved.data_json.schema_snapshot, storedSchema);
      assert.equal(saved.data_json.fields['inspection-date'], '2026-10-04');
      assert.equal(saved.data_json.fields.priority, 'High');
    });
    ok('legacy submission payload remains unchanged', () => assert.deepEqual(legacy, { summary: 'Historical submission stays unchanged', priority: 'Medium', follow_up: '' }));
    assert.deepEqual((await db.query('select data_json from form_submissions where submitted_by is null')).rows[0].data_json, legacy);
    await db.query('update forms set archived_at=now() where id=$1', [formId]);
    await assert.rejects(actions.createFormSubmissionAction(valid()), /unavailable in the current workspace/); checks++;
    for (let i = 0; i < 60; i++) await db.query('insert into asset_checks(workspace_id,asset_id,status,notes,created_at,archived_at,deleted_at) values($1,$2,$3,$4,$5,$6,$7)', [workspace, assetId, i % 2 ? 'Ready' : 'Needs attention', `Synthetic inspection ${i}${i === 10 ? ' 100%_literal' : ''}`, '2026-10-04T12:00:00Z', i < 2 ? '2026-10-04T13:00:00Z' : null, i >= 2 && i < 4 ? '2026-10-04T13:00:00Z' : null]);
    await db.query("insert into asset_checks(workspace_id,asset_id,status,notes) values($1,$2,'Ready','Foreign record')", [foreignWorkspace, randomUUID()]);
    activeRole = 'viewer';
    await assert.rejects(actions.createFormSubmissionAction(valid()), /do not have permission to submit/); checks++;
    activeRole = 'owner'; membershipStatus = 'suspended';
    await assert.rejects(actions.createFormSubmissionAction(valid()), /Workspace access is required/); checks++;
    membershipStatus = 'active';
    assert.equal((await db.query('select count(*) n from form_submissions')).rows[0].n, 2);
    const all = [], pageSizes = [];
    for (let page = 1; page <= 3; page++) { const result = await history.loadAssetCheckHistory(supabase, workspace, history.assetCheckHistoryFilters({ view: 'all', page: String(page) })); assert.equal(result.count, 60); all.push(...result.data.map(r => r.id)); pageSizes.push(result.data.length); }
    ok('bounded pages reach all 60 checks exactly once, with tied timestamps', () => { assert.deepEqual(pageSizes, [25, 25, 10]); assert.equal(new Set(all).size, 60); });
    for (const [view, expected] of [['active', 56], ['archived', 2], ['deleted', 2]]) { const result = await history.loadAssetCheckHistory(supabase, workspace, history.assetCheckHistoryFilters({ view })); assert.equal(result.count, expected); checks++; }
    const literal = await history.loadAssetCheckHistory(supabase, workspace, history.assetCheckHistoryFilters({ q: '100%_literal' }));
    ok('literal wildcard search and workspace scoping are applied in SQL', () => { assert.equal(literal.count, 1); assert(!literal.data.some(row => row.workspace_id === foreignWorkspace)); });
    const foreign = await history.loadAssetCheckHistory(supabase, foreignWorkspace, history.assetCheckHistoryFilters({ asset_id: assetId })); assert.equal(foreign.count, 0); checks++;
    const beyond = await history.loadAssetCheckHistory(supabase, workspace, history.assetCheckHistoryFilters({ page: '999999', view: 'all', size: '25' }));
    ok('out-of-range pagination clamps without hiding the last page', () => { assert.equal(beyond.page, 3); assert.equal(beyond.data.length, 10); });
    ok('invalid filter IDs and calendar dates are rejected before SQL', () => { assert.throws(() => history.assetCheckHistoryFilters({ asset_id: 'forged' })); assert.throws(() => history.assetCheckHistoryFilters({ from: '2026-02-30' })); });
    // Exercise the installed HTTP client as well as the SQL fixture: unlike a
    // SQL empty result, an out-of-range PostgREST response has error/count=null.
    async function rangeTransport(label, responses, verify) {
      const requests = [];
      const rest = createClient('http://127.0.0.1:54321', 'synthetic-anon-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async (input, init) => {
          const url = new URL(String(input));
          assert.equal(url.origin, 'http://127.0.0.1:54321');
          assert.equal(url.pathname, '/rest/v1/asset_checks');
          assert.equal(init.method, 'GET');
          assert.match(new Headers(init.headers).get('prefer'), /count=exact/);
          const response = responses[requests.length];
          assert(response, 'recovery exceeded the expected request budget');
          requests.push({ ...Object.fromEntries(url.searchParams), created_at_all: url.searchParams.getAll("created_at") });
          return new Response(JSON.stringify(response.error || response.rows || []), {
            status: response.error ? response.error.code === 'PGRST103' ? 416 : 500 : 200,
            headers: { 'content-type': 'application/json', 'content-range': `*/${response.count}` }
          });
        } }
      });
      const scopedFilters = history.assetCheckHistoryFilters({ page: '99', size: '25', asset_id: assetId, folder: '10000000-0000-4000-8000-000000000001', view: 'archived', status: 'Needs attention', q: '100%_literal', from: '2026-01-01', to: '2026-10-04' });
      const result = await history.loadAssetCheckHistory(rest, workspace, scopedFilters);
      assert(requests.length <= 3);
      const scope = Object.fromEntries(Object.entries(requests[0]).filter(([key]) => key !== "offset" && key !== "limit"));
      assert.equal(scope.workspace_id, `eq.${workspace}`);
      assert.equal(scope.asset_id, `eq.${assetId}`);
      assert.equal(scope.folder_id, 'eq.10000000-0000-4000-8000-000000000001');
      assert.equal(scope.archived_at, 'not.is.null'); assert.equal(scope.deleted_at, 'is.null');
      assert.deepEqual(scope.created_at_all, ['gte.2026-01-01T00:00:00.000Z', 'lte.2026-10-04T23:59:59.999999Z']);
      assert.equal(scope.status, 'eq.Needs attention');
      assert.equal(scope.order, 'created_at.desc,id.desc');
      for (const request of requests) {
        const { offset, limit, ...sameScope } = request;
        assert.deepEqual(sameScope, scope, 'all recovery reads preserve every scoped filter and ordering');
        assert.equal(limit, '25'); assert(Number(offset) >= 0);
      }
      verify(result, requests);
      checks++; console.log(`PASS actual HTTP client: ${label}`);
    }
    const outOfRange = count => ({ count, error: { code: 'PGRST103', message: 'Requested range not satisfiable', details: 'Synthetic stale page', hint: null } });
    const pageRows = count => Array.from({ length: count }, (_, i) => ({ id: `synthetic-${i}` }));
    await rangeTransport('stale last page recovers within three scoped requests', [outOfRange(60), { count: 60, rows: pageRows(25) }, { count: 60, rows: pageRows(10) }], (result, requests) => {
      assert.equal(result.error, null); assert.equal(result.page, 3); assert.equal(result.data.length, 10);
      assert.deepEqual(requests.map(request => request.offset), ['2450', '0', '50']);
    });
    await rangeTransport('all matching rows disappeared', [outOfRange(0), { count: 0, rows: [] }], (result, requests) => {
      assert.equal(result.error, null); assert.equal(result.page, 1); assert.equal(result.count, 0); assert.deepEqual(result.data, []); assert.equal(requests.length, 2);
    });
    await rangeTransport('persistent range failure remains an error', [outOfRange(60), outOfRange(0)], (result, requests) => {
      assert.equal(result.error.code, 'PGRST103'); assert.equal(result.count, null); assert.equal(requests.length, 2);
    });
    await rangeTransport('second recovery race stops at the three-request budget', [outOfRange(60), { count: 60, rows: pageRows(25) }, outOfRange(20)], (result, requests) => {
      assert.equal(result.error.code, 'PGRST103'); assert.equal(result.count, null); assert.equal(requests.length, 3);
    });
    await rangeTransport('non-range failure is never hidden or retried', [{ count: 0, error: { code: 'XX000', message: 'Synthetic unavailable' } }], (result, requests) => {
      assert.equal(result.error.code, 'XX000'); assert.equal(requests.length, 1);
    });
    const checkData = form({ asset_id: assetId, status: 'Ready', notes: 'Synthetic action insertion' });
    await assert.rejects(actions.createAssetCheckAction(checkData), /Asset check saved/);
    assert.equal((await db.query("select count(*) n from asset_checks where notes='Synthetic action insertion'")).rows[0].n, 1); checks++;
    const retired = load('app/app/operations/record-management-actions.ts', { 'next/navigation': mocks['next/navigation'] });
    for (const name of ['createRecordFolderAction', 'renameRecordFolderAction', 'archiveRecordFolderAction', 'updateManagedRecordAction', 'manageRecordAction', 'bulkManageRecordsAction']) {
      await assert.rejects(retired[name](form({ collection: 'crm_leads' })), /has been retired/); checks++;
    }
    console.log(JSON.stringify({ checks, scope: 'Actual schema validator, server actions and history query builder with isolated PGlite persistence; installed Supabase client range recovery through synthetic fetch responses. Auth, billing and Next redirect/cache are stubbed. Asset parent transaction is covered by separate migration tests; no deployed Supabase/provider access.' }));
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
