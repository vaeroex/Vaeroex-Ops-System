/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable -- Isolated CommonJS test harness. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === '@/lib/admin/support-requests') return load('lib/admin/support-requests.ts');
    if (name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const helper = load('lib/admin/support-requests.ts');
function form(overrides = {}) {
  const data = new FormData();
  const values = { support_action: 'delete', operation_id: id(100), support_request_ids: [id(1), id(2)], ...overrides };
  for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  return data;
}
function actionFixture({ denied = false, error = null, result = { changed_count: 1, requested_count: 2, replayed: false } } = {}) {
  const calls = [];
  const admin = { rpc: async (...args) => { calls.push(args); return { data: result, error }; }, from: table => { assert.equal(table, 'support_requests'); return { select: fields => { assert.equal(fields, 'message'); return { eq: (column, value) => { assert.equal(column, 'id'); calls.push(['content', value]); return { maybeSingle: async () => ({ data: { message: 'Synthetic support body' }, error }) }; } }; } }; } };
  const actions = load('app/app/admin/support-requests/actions.ts', { 'next/cache': { revalidatePath: p => calls.push(['revalidate', p]) }, '@/lib/admin/vaeroex-admin': { requireVaeroexAdmin: async () => { if (denied) throw new Error('ADMIN_DENIED'); return { admin, user: { id: id(999) } }; } } });
  return { calls, ...actions };
}
test('support filters normalize input and preserve bounded page sizes', () => {
  assert.deepEqual(helper.supportFilters({ status: 'bad', view: 'bad', page: '-1' }), { q: '', status: '', view: 'active', page: 1 });
  assert.equal(helper.supportFilters({ q: 'a'.repeat(200), page: '2' }).q.length, 120);
  assert.equal(helper.SUPPORT_PAGE_SIZE, 25);
  assert.deepEqual(helper.supportFilters({ q: ['a','b'], status: ['open'], view: ['deleted'], page: ['2'] }), { q: '', status: '', view: 'active', page: 1 });
  assert.equal(helper.supportFilters({ page: 'Infinity' }).page, 1);
  assert.match(helper.supportPageHref({ q: 'name@example.invalid', status: 'open', view: 'deleted' }, 2), /view=deleted&page=2&q=name%40example.invalid&status=open/);
});
test('search is represented as escaped quoted filter values, including adversarial punctuation', () => {
  assert.equal(helper.supportSearchExpression('abc'), 'email.ilike."%abc%",name.ilike."%abc%",issue_type.ilike."%abc%"');
  const expression = helper.supportSearchExpression('x",status.eq.open,or(message.neq.secret)_%\\');
  assert.match(expression, /x\\",status/);
  assert.equal((expression.match(/\.ilike\./g) || []).length, 3);
  assert.match(expression, /\\\\_/);
  assert.match(expression, /\\\\%/);
});
test('support mutations reject missing/malformed IDs, action, batch, and operation keys', () => {
  for (const values of [{ support_request_ids: [] }, { support_request_ids: ['bad'] }, { support_action: 'purge' }, { operation_id: '' }, { support_request_ids: Array.from({ length: 51 }, (_, i) => id(i)) }, { support_request_ids: [new File(['x'], 'id')] }, { support_action: 'update', status: 'open', priority: 'Low' }, { support_action: 'update', support_request_ids: [id(1)], status: 'invalid', priority: 'Low' }]) assert.equal(helper.validateSupportMutation(form(values)), null);
  assert.deepEqual(helper.validateSupportMutation(form({ support_request_ids: [id(2), id(1), id(1)] })).ids, [id(1), id(2)]);
});
test('bulk actions use current platform administrator and exact validated service RPC arguments', async () => {
  const h = actionFixture(); const result = await h.manageSupportRequestAction(form());
  assert.equal(result.ok, true); assert.equal(result.changedCount, 1); assert.match(result.message, /1 request moved to Deleted\. 1 unchanged or no longer available/);
  assert.deepEqual(h.calls[0], ['admin_manage_support_requests_v1', { p_actor_user_id: id(999), p_request_ids: [id(1), id(2)], p_action: 'delete', p_operation_id: id(100), p_status: null, p_priority: null }]);
  assert.deepEqual(h.calls[1], ['revalidate', '/app/admin/support-requests']);
});
test('ordinary user and invalid input cannot invoke mutation or support-content reads', async () => {
  const denied = actionFixture({ denied: true });
  await assert.rejects(denied.manageSupportRequestAction(form()), /ADMIN_DENIED/);
  await assert.rejects(denied.getSupportRequestContentAction(id(1)), /ADMIN_DENIED/);
  assert.deepEqual(denied.calls, []);
  const invalid = actionFixture(); assert.equal((await invalid.manageSupportRequestAction(form({ support_request_ids: ['invalid'] }))).ok, false); await invalid.getSupportRequestContentAction('invalid'); assert.deepEqual(invalid.calls, []);
});
test('provider errors and invalid outcomes are sanitized without request contents', async () => {
  const h = actionFixture({ error: { message: 'SECRET provider payload and support body' } });
  const result = await h.manageSupportRequestAction(form()); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /SECRET|provider payload/); assert.equal(h.calls.length, 1);
  assert.equal((await actionFixture({ result: { changed_count: 3, requested_count: 2 } }).manageSupportRequestAction(form())).ok, false);
});
test('replayed operations report previous actual changed count and triage validates status/priority', async () => {
  const replay = await actionFixture({ result: { changed_count: 0, requested_count: 2, replayed: true } }).manageSupportRequestAction(form());
  assert.match(replay.message, /^Previously completed: 0 requests/);
  const h = actionFixture({ result: { changed_count: 1, requested_count: 1 } });
  assert.equal((await h.updateSupportRequestAction(form({ support_request_ids: [id(1)], status: 'in_review', priority: 'High' }))).ok, true);
  assert.equal(h.calls[0][1].p_action, 'update'); assert.equal(h.calls[0][1].p_status, 'in_review');
});
test('only requested support body is fetched on demand, with no transcripts or broad selects', async () => {
  const h = actionFixture(); assert.deepEqual(await h.getSupportRequestContentAction(id(1)), { message: 'Synthetic support body', error: null }); assert.deepEqual(h.calls, [['content', id(1)]]);
  assert.doesNotMatch(helper.SUPPORT_REQUEST_LIST_FIELDS, /message|user_id|folder_id|\*/);
});
function pageFixture(rows, denied = false) {
  const calls = [];
  const admin = { from: table => {
    calls.push(['from', table]);
    if (table === 'workspaces') return { select: fields => { assert.equal(fields, 'id,name'); return { in: async (key, ids) => { assert.equal(key, 'id'); assert(ids.length <= 25); return { data: ids.map(id => ({ id, name: 'Synthetic workspace' })), error: null }; } }; } };
    assert.equal(table, 'support_requests'); let filtered = rows.slice();
    const query = {
      select(fields, options) { assert.equal(fields, helper.SUPPORT_REQUEST_LIST_FIELDS); assert.deepEqual(options, { count: 'exact' }); return this; },
      eq(key, value) { calls.push(['eq', key]); filtered = filtered.filter(row => row[key] === value); return this; },
      is(key) { calls.push(['is', key]); filtered = filtered.filter(row => row[key] === null); return this; },
      not(key) { calls.push(['not', key]); filtered = filtered.filter(row => row[key] !== null); return this; },
      or(value) { calls.push(['or', value]); filtered = filtered.filter(row => row.email.includes('older')); return this; },
      order(key) { calls.push(['order', key]); return this; },
      async range(start, end) { calls.push(['range', start, end]); return { data: filtered.slice(start, end + 1), count: filtered.length, error: null }; }
    }; return query;
  } };
  const Page = load('app/app/admin/support-requests/page.tsx', {
    'next/link': () => null, '@/components/admin/SupportRequestsInbox': { SupportRequestsInbox: 'Inbox' }, '@/components/operations/ErrorNotice': { ErrorNotice: 'Error' }, '@/lib/admin/vaeroex-admin': { getVaeroexAdminAccess: async () => ({ allowed: !denied, admin, error: 'Denied' }) }
  }).default;
  return { calls, Page };
}
function node(tree, type) { if (Array.isArray(tree)) return tree.map(item => node(item, type)).find(Boolean); if (!tree?.props) return null; return tree.type === type ? tree : node(tree.props.children, type); }
const rows = Array.from({ length: 120 }, (_, i) => ({ id: id(i + 1), workspace_id: id(999), name: 'Synthetic', email: i >= 60 ? 'older@example.invalid' : 'recent@example.invalid', issue_type: 'General', status: i % 2 ? 'open' : 'closed', priority: 'Low', created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z', archived_at: null, deleted_at: i < 60 ? '2026-10-12T01:00:00Z' : null }));
test('lifecycle and search/status filters run before pagination, older active requests are not hidden', async () => {
  const h = pageFixture(rows); const tree = await h.Page({ searchParams: Promise.resolve({ q: 'older', status: 'open', view: 'active', page: '2' }) });
  const inbox = node(tree, 'Inbox'); assert.equal(inbox.props.total, 30); assert.equal(inbox.props.requests.length, 5); assert(inbox.props.requests.every(row => row.deleted_at === null && row.status === 'open'));
  const names = h.calls.map(c => c[0]); assert(names.indexOf('or') < names.indexOf('range')); assert(names.lastIndexOf('is') < names.indexOf('range')); assert(names.indexOf('eq') < names.indexOf('range'));
  assert.deepEqual(h.calls.filter(c => c[0] === 'order'), [['order', 'created_at'], ['order', 'id']]);
});
test('all, archived and deleted inbox views use distinct pre-pagination lifecycle predicates', async () => {
  for (const view of ['all', 'archived', 'deleted']) { const h = pageFixture(rows); const tree = await h.Page({ searchParams: Promise.resolve({ view }) }); const inbox = node(tree, 'Inbox'); assert.equal(inbox.props.total, view === 'all' ? 120 : view === 'deleted' ? 60 : 0); assert(inbox.props.requests.length <= 25); }
});
test('ordinary-user page access performs no privileged query', async () => {
  const h = pageFixture(rows, true); assert.equal((await h.Page({})).type, 'Error'); assert.deepEqual(h.calls, []);
});
