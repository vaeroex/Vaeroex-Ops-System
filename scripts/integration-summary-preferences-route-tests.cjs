/* eslint-disable @typescript-eslint/no-require-imports -- Focused offline TypeScript route harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { installLoader, id } = require("./qbo-customer-test-support.cjs");
const workspaceId = id(301), userId = id(302), otherWorkspaceId = id(303), otherUserId = id(304);
const key = `quickbooks_online:${"a".repeat(64)}`, otherKey = `quickbooks_online:${"b".repeat(64)}`;
const input = (changes = {}) => ({ expectedWorkspaceId: workspaceId, summaryKey: key, hiddenWhenDisconnected: true, ...changes });
let current;

installLoader({
  "@/lib/security/require-workspace-access": { requireWorkspaceAccess: async (...args) => {
    assert.deepEqual(args, [], "request workspace IDs must never choose the authority context");
    current.authCalls++;
    if (current.authError) throw Error("private-auth-diagnostic");
    return current.access;
  } },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => { throw Error("Service-role client forbidden"); } }
});
global.fetch = () => { throw Error("Network/provider calls forbidden"); };
const { readIntegrationSummaryPreferences, saveIntegrationSummaryPreference, IntegrationSummaryKeySchema } =
  require("../lib/integrations/dashboard/preferences-server.ts");
const { PATCH } = require("../app/api/integrations/dashboard/preferences/route.ts");

function fixture() {
  const state = { authCalls: 0, calls: [], rows: [], error: false, authError: false };
  const client = { from(table) {
    assert.equal(table, "integration_summary_preferences", "preferences must not mutate integration or auth-bearing records");
    const call = { table, filters: [] };
    state.calls.push(call);
    const query = {
      eq(column, value) { call.filters.push([column, value]); return query; },
      single() { return Promise.resolve(result(true)); },
      then(resolve, reject) { return Promise.resolve().then(() => result(false)).then(resolve, reject); }
    };
    function result(single) {
      if (state.error) return { data: null, error: { message: "private-database-diagnostic" } };
      if (state.throwQuery) throw Error("private-query-diagnostic");
      if (call.row) {
        const index = state.rows.findIndex(row => row.workspace_id === call.row.workspace_id && row.user_id === call.row.user_id && row.summary_key === call.row.summary_key);
        if (index < 0) state.rows.push({ ...call.row }); else state.rows[index] = { ...call.row };
      }
      const rows = state.rows.filter(row => call.filters.every(([column, value]) => row[column] === value));
      if (single && Object.hasOwn(state, "saveData")) return { data: state.saveData, error: null };
      if (!single && Object.hasOwn(state, "readData")) return { data: state.readData, error: null };
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return {
      select(columns) { call.columns = columns; return query; },
      upsert(row, options) {
        call.row = row; call.options = options;
        return { select(columns) { call.columns = columns; return query; } };
      }
    };
  } };
  state.access = { supabase: client, workspaceId, user: { id: userId },
    membership: { workspace_id: workspaceId, user_id: userId, status: "active", role: "viewer" } };
  current = state;
  return state;
}

function request(body = input(), options = {}) {
  const headers = { origin: "https://app.vaeroex.test", "content-type": "application/json", ...options.headers };
  for (const name of options.omitHeaders ?? []) delete headers[name];
  return new Request("https://app.vaeroex.test/api/integrations/dashboard/preferences", {
    method: "PATCH", headers, body: options.raw ?? JSON.stringify(body)
  });
}

test("save and restore are checked, scoped, idempotent entry writes with no owner requirement", async () => {
  const h = fixture();
  for (const hiddenWhenDisconnected of [true, true, false]) {
    const response = await PATCH(request(input({ hiddenWhenDisconnected })));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, workspaceId, summaryKey: key, hiddenWhenDisconnected });
  }
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].hidden_when_disconnected, false);
  for (const call of h.calls) {
    assert.deepEqual(call.row, { workspace_id: workspaceId, user_id: userId, summary_key: key,
      hidden_when_disconnected: call.row.hidden_when_disconnected });
    assert.deepEqual(call.options, { onConflict: "workspace_id,user_id,summary_key" });
    assert.deepEqual(call.filters, [["workspace_id", workspaceId], ["user_id", userId], ["summary_key", key]]);
  }
});

test("injected clients keep two logical entries independent and avoid repeated auth resolution", async () => {
  const h = fixture();
  await saveIntegrationSummaryPreference(input(), h.access);
  await saveIntegrationSummaryPreference(input({ summaryKey: otherKey }), h.access);
  await saveIntegrationSummaryPreference(input({ hiddenWhenDisconnected: false }), h.access);
  const result = await readIntegrationSummaryPreferences(h.access);
  assert.equal(result.state, "ready");
  assert.deepEqual(result.hiddenSummaryKeys, [otherKey]);
  assert.equal(h.authCalls, 0);
});

test("reads filter both current workspace and user; absent preferences mean visible", async () => {
  const h = fixture();
  assert.deepEqual(await readIntegrationSummaryPreferences(), { state: "ready", workspaceId, preferences: [], hiddenSummaryKeys: [] });
  h.rows = [
    { workspace_id: workspaceId, user_id: userId, summary_key: key, hidden_when_disconnected: true },
    { workspace_id: otherWorkspaceId, user_id: userId, summary_key: otherKey, hidden_when_disconnected: true },
    { workspace_id: workspaceId, user_id: otherUserId, summary_key: otherKey, hidden_when_disconnected: true }
  ];
  assert.deepEqual((await readIntegrationSummaryPreferences()).hiddenSummaryKeys, [key]);
  for (const call of h.calls) assert.deepEqual(call.filters, [["workspace_id", workspaceId], ["user_id", userId]]);
});

test("read errors, malformed rows, and foreign scopes leave every entry visible", async () => {
  const row = { workspace_id: workspaceId, user_id: userId, summary_key: key, hidden_when_disconnected: true };
  for (const override of [{ error: true }, { throwQuery: true }, { authError: true }, { readData: null },
    { readData: [{ ...row, user_id: otherUserId }] }, { readData: [{ ...row, workspace_id: otherWorkspaceId }] },
    { readData: [{ ...row, summary_key: "square:raw-provider-identity" }] },
    { readData: [{ ...row, hidden_when_disconnected: "true" }] }]) {
    const h = Object.assign(fixture(), override);
    assert.deepEqual(await readIntegrationSummaryPreferences(), { state: "unavailable", preferences: [], hiddenSummaryKeys: [] });
    assert(!h.calls.some(call => call.row));
  }
});

test("stale cookie guard rejects before persistence even when the user could access both workspaces", async () => {
  const h = fixture();
  const response = await PATCH(request(input({ expectedWorkspaceId: otherWorkspaceId })));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, error: "workspace_changed" });
  assert.deepEqual(h.calls, []);
});

test("missing or mismatched membership and failed auth never reach preference storage", async () => {
  for (const membership of [{ status: "disabled" }, { status: "invited" }, { user_id: otherUserId }, { user_id: null },
    { workspace_id: otherWorkspaceId }]) {
    const h = fixture(); Object.assign(h.access.membership, membership);
    assert.equal((await PATCH(request())).status, 403);
    assert.deepEqual(h.calls, []);
  }
  const h = fixture(); h.authError = true;
  assert.equal((await PATCH(request())).status, 503);
  assert.deepEqual(h.calls, []);
});

test("bounded opaque summary keys reject provider-wide, raw, uppercase, and whitespace identities", () => {
  for (const provider of ["square", "quickbooks_online", "google_sheets"]) {
    assert.equal(IntegrationSummaryKeySchema.safeParse(`${provider}:${"f".repeat(64)}`).success, true);
  }
  for (const candidate of ["square", "square:merchant-id", `other:${"a".repeat(64)}`, `square:${"A".repeat(64)}`,
    `square:${"a".repeat(63)}`, `square:${"a".repeat(65)}`, ` ${key}`, `${key}\n`, `${key}\r`, "x".repeat(1000)]) {
    assert.equal(IntegrationSummaryKeySchema.safeParse(candidate).success, false, candidate);
  }
});

test("strict input rejects caller authority and nonboolean or malformed fields before auth", async () => {
  for (const body of [input({ userId: otherUserId }), input({ workspaceId: otherWorkspaceId }), input({ providerKey: "square" }),
    input({ hiddenWhenDisconnected: "true" }), input({ summaryKey: "square" }), input({ expectedWorkspaceId: "bad" }),
    {}, null, [], { summaryKey: key, hiddenWhenDisconnected: true }]) {
    const h = fixture();
    assert.equal((await PATCH(request(body))).status, 400);
    assert.equal(h.authCalls, 0); assert.deepEqual(h.calls, []);
  }
  const h = fixture();
  await assert.rejects(saveIntegrationSummaryPreference(input({ userId: otherUserId }), h.access), { code: "invalid_preference" });
  assert.deepEqual(h.calls, []);
});

test("same-origin and JSON gates reject cross-site, missing origin, and wrong content type", async () => {
  for (const [options, status] of [
    [{ headers: { origin: "https://attacker.test" } }, 403], [{ omitHeaders: ["origin"] }, 403],
    [{ headers: { origin: "null" } }, 403], [{ headers: { "sec-fetch-site": "same-site" } }, 403],
    [{ headers: { "sec-fetch-site": "cross-site" } }, 403],
    [{ headers: { "content-type": "text/plain" } }, 415], [{ omitHeaders: ["content-type"] }, 415]
  ]) {
    const h = fixture(), response = await PATCH(request(input(), options));
    assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(h.authCalls, 0); assert.deepEqual(h.calls, []);
  }
});

test("declared and streamed oversized bodies and malformed JSON cannot reach auth or storage", async () => {
  for (const [options, status] of [[{ headers: { "content-length": "1025" } }, 413],
    [{ raw: " ".repeat(1025) }, 413], [{ raw: "{" }, 400]]) {
    const h = fixture(); assert.equal((await PATCH(request(input(), options))).status, status);
    assert.equal(h.authCalls, 0); assert.deepEqual(h.calls, []);
  }
  const h = fixture(); let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(600)); }, cancel() { cancelled = true; } });
  const response = await PATCH(new Request("https://app.vaeroex.test/api/integrations/dashboard/preferences", {
    method: "PATCH", headers: { origin: "https://app.vaeroex.test", "content-type": "application/json" }, body, duplex: "half"
  }));
  assert.equal(response.status, 413); assert.equal(cancelled, true); assert.equal(h.authCalls, 0);
});

test("save requires matching database acknowledgement and never exposes diagnostics", async () => {
  const row = { workspace_id: workspaceId, user_id: userId, summary_key: key, hidden_when_disconnected: true };
  for (const override of [{ error: true }, { throwQuery: true }, { saveData: null }, { saveData: {} },
    { saveData: { ...row, workspace_id: otherWorkspaceId } }, { saveData: { ...row, user_id: otherUserId } },
    { saveData: { ...row, summary_key: otherKey } }, { saveData: { ...row, hidden_when_disconnected: false } }]) {
    Object.assign(fixture(), override);
    const response = await PATCH(request());
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: false, error: "preference_save_failed" });
  }
});
