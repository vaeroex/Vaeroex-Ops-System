/* eslint-disable @typescript-eslint/no-require-imports -- Focused offline action and Settings rendering harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { installLoader, id } = require("./qbo-customer-test-support.cjs");
const workspaceId = id(401), userId = id(402), otherWorkspaceId = id(403);
let current;
installLoader({
  "@/lib/security/require-workspace-access": { requireWorkspaceAccess: async (...args) => {
    assert.deepEqual(args, [], "never select authority with the caller's workspace ID");
    current.authCalls++;
    if (current.authError) throw current.authError;
    return current.access;
  } },
  "next/cache": { revalidatePath: path => current.revalidated.push(path) },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => { throw Error("Service client forbidden"); } },
  "@/lib/workspaces/page-context": { requireWorkspacePage: async () => ({ context: current.context }) },
  "@/lib/auth/actions": { changePasswordAction: async () => {} },
  "@/components/app/ThemeControls": { ThemeControls: () => React.createElement("div", null, "Theme fixture") }
});
global.fetch = () => { throw Error("Network/provider calls forbidden"); };
const { saveReportingTimezoneAction } = require("../app/app/settings/reporting-timezone-action.ts");
const SettingsPage = require("../app/app/settings/page.tsx").default;

function fixture() {
  const state = { authCalls: 0, calls: [], revalidated: [] };
  const client = { from(table) {
    assert.equal(table, "workspaces");
    const call = { table, filters: [] };
    state.calls.push(call);
    const query = {
      update(row) { call.row = row; return query; },
      eq(column, value) { call.filters.push([column, value]); return query; },
      select(columns) { call.columns = columns; return query; },
      async single() {
        if (state.throwQuery) throw Error("private database diagnostic");
        return { data: Object.hasOwn(state, "data") ? state.data : { id: workspaceId, ...call.row },
          error: state.error ? { message: "private database diagnostic" } : null };
      }
    };
    return query;
  } };
  state.access = { supabase: client, workspaceId, user: { id: userId },
    membership: { workspace_id: workspaceId, user_id: userId, role: "owner", status: "active" } };
  state.context = { activeWorkspace: { id: workspaceId, name: "Test workspace", reporting_timezone: null },
    membership: state.access.membership, profile: null };
  current = state;
  return state;
}
function form(zone = "America/Los_Angeles", expectedWorkspaceId = workspaceId) {
  const data = new FormData();
  data.set("expectedWorkspaceId", expectedWorkspaceId);
  data.set("reportingTimezone", zone);
  return data;
}
const save = data => saveReportingTimezoneAction({ status: "idle" }, data);

test("owner saves only the reporting timezone on the server-derived workspace", async () => {
  for (const timezone of ["America/Los_Angeles", "UTC", "Asia/Kolkata", "Etc/GMT+5"]) {
    const h = fixture(), data = form(timezone);
    data.set("created_by", id(404));
    data.set("workspace_id", otherWorkspaceId);
    assert.deepEqual(await save(data), { status: "success", message: `Reporting timezone saved: ${timezone}.` });
    assert.deepEqual(h.calls, [{ table: "workspaces", filters: [["id", workspaceId]],
      row: { reporting_timezone: timezone }, columns: "id, reporting_timezone" }]);
    assert.deepEqual(h.revalidated, ["/app/settings", "/app/intelligence"]);
    assert.equal(h.authCalls, 1);
  }
});
test("explicit unconfigured choice stores null with UTC status, never an inferred entity timezone", async () => {
  const h = fixture();
  assert.deepEqual(await save(form("")), { status: "success", message: "Reporting timezone cleared. Refresh timestamps use UTC until configured." });
  assert.deepEqual(h.calls[0].row, { reporting_timezone: null });
});
test("stale workspace rejects before any update", async () => {
  const h = fixture();
  assert.match((await save(form("UTC", otherWorkspaceId))).message, /active workspace changed/);
  assert.deepEqual(h.calls, []);
});
test("non-owner, inactive, foreign membership and foreign account cannot save", async () => {
  for (const change of [{ role: "admin" }, { role: "manager" }, { role: "staff" }, { role: "viewer" },
    { status: "disabled" }, { workspace_id: otherWorkspaceId }, { user_id: id(404) }, { user_id: null }]) {
    const h = fixture(); Object.assign(h.access.membership, change);
    assert.equal((await save(form())).status, "error");
    assert.deepEqual(h.calls, []);
  }
});
test("strict Intl validation rejects syntactically plausible unknown names and malformed inputs", async () => {
  for (const timezone of ["Not/ARealZone", " UTC ", "UTC\n", "America//Los_Angeles", "+01:00", "x".repeat(65)]) {
    const h = fixture();
    assert.equal((await save(form(timezone))).status, "error");
    assert.deepEqual(h.calls, []);
  }
  for (const mutate of [data => data.delete("reportingTimezone"), data => data.append("reportingTimezone", "UTC"),
    data => data.append("expectedWorkspaceId", otherWorkspaceId), data => data.set("expectedWorkspaceId", "not-a-uuid"),
    data => data.set("reportingTimezone", new Blob(["UTC"]), "timezone.txt")]) {
    const h = fixture(), data = form(); mutate(data);
    assert.equal((await save(data)).status, "error"); assert.deepEqual(h.calls, []);
  }
});
test("database denial, no-op, mismatched acknowledgment and transport failures never report success", async () => {
  for (const failure of [{ error: true }, { throwQuery: true }, { data: null },
    { data: { id: otherWorkspaceId, reporting_timezone: "UTC" } },
    { data: { id: workspaceId, reporting_timezone: null } }]) {
    const h = Object.assign(fixture(), failure);
    const result = await save(form("UTC"));
    assert.deepEqual(result, { status: "error", message: "The reporting timezone could not be saved. Try again." });
    assert.deepEqual(h.revalidated, []);
  }
});
test("authentication navigation is preserved and previous client state carries no authority", async () => {
  const h = fixture(), error = Object.assign(Error("redirect"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  h.authError = error;
  await assert.rejects(save(form()), value => value === error);
  assert.deepEqual(h.calls, []);
  fixture();
  const result = await saveReportingTimezoneAction({ status: "success", workspaceId: otherWorkspaceId, role: "admin" }, form("UTC"));
  assert.equal(result.status, "success");
  assert.deepEqual(current.calls[0].filters, [["id", workspaceId]]);
});
test("Settings renders owner-only timezone control and explicitly unconfigured UTC", async () => {
  fixture();
  const ownerHtml = renderToStaticMarkup(await SettingsPage({}));
  assert.match(ownerHtml, /name="expectedWorkspaceId"/);
  assert.match(ownerHtml, /name="reportingTimezone"/);
  assert.match(ownerHtml, /Not configured \(UTC\)/);
  assert.match(ownerHtml, /Save timezone/);
  for (const role of ["admin", "manager", "staff", "viewer"]) {
    const h = fixture(); h.context.membership.role = role;
    const html = renderToStaticMarkup(await SettingsPage({}));
    assert.doesNotMatch(html, /name="reportingTimezone"|Save timezone/);
    assert.match(html, /Not configured \(UTC\)/);
  }
});
test("Settings preserves stored recognized aliases and configured non-owner display", async () => {
  const h = fixture(); h.context.activeWorkspace.reporting_timezone = "US/Pacific";
  assert.match(renderToStaticMarkup(await SettingsPage({})), /value="US\/Pacific" selected=""/);
  h.context.membership.role = "viewer";
  const html = renderToStaticMarkup(await SettingsPage({}));
  assert.match(html, /US\/Pacific/);
  assert.doesNotMatch(html, /Not configured \(UTC\)/);
});
