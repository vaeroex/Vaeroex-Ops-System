const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function loadTsx(relative, mocks = {}) {
  const filename = path.resolve(__dirname, "..", relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}

const preferences = loadTsx("lib/theme/preferences.ts");
const { ThemeControls } = loadTsx("components/app/ThemeControls.tsx", { "@/lib/theme/preferences": preferences });
const { SectionCard } = loadTsx("components/operations/SectionCard.tsx");
const { AuthMessage } = loadTsx("components/auth/AuthMessage.tsx");
const PageHeader = ({ title, description }) => React.createElement("header", null,
  React.createElement("h1", null, title), React.createElement("p", null, description));
const render = component => renderToStaticMarkup(component);

function settingsFixture({ enabled = true, role = "owner" } = {}) {
  const supabase = { from() { throw new Error("UNEXPECTED_DATABASE_QUERY"); } };
  const { default: SettingsPage } = loadTsx("app/app/settings/page.tsx", {
    "next/headers": { headers: async () => new Headers() },
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/components/auth/AuthMessage": { AuthMessage },
    "@/components/app/ThemeControls": { ThemeControls },
    "@/components/integrations/ConnectionStatusPanel": { ConnectionStatusPanel: () => { throw new Error("UNEXPECTED_QBO_PANEL"); } },
    "@/components/integrations/SquareEvidenceCard": { SquareEvidenceCard: () => null },
    "@/components/operations/PageHeader": { PageHeader },
    "@/components/operations/SectionCard": { SectionCard },
    "@/lib/auth/actions": { changePasswordAction: "/synthetic-password-action" },
    "@/lib/integrations/control-plane/qbo-customer-availability": { qboProductionCustomerConnectionsEnabled: () => false },
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => enabled },
    "@/lib/integrations/control-plane/square-workspace-evidence": { readSquareWorkspaceEvidence: async (client, workspaceId) => {
      assert.equal(client, supabase);
      assert.equal(workspaceId, "workspace-a");
      return null;
    } },
    "@/lib/workspaces/page-context": { requireWorkspacePage: async () => ({
      supabase, workspaceId: "workspace-a", context: {
        membership: { role }, activeWorkspace: { name: "Workspace A" }, profile: { email: "owner@example.invalid" },
      },
    }) },
  });
  return async params => render(await SettingsPage({ searchParams: Promise.resolve(params ?? {}) }));
}

test("Settings puts the Integrations entry before account, workspace, and collapsed appearance", async () => {
  const html = await settingsFixture()();
  const positions = ["id=\"settings-integrations\"", ">Account<", ">Workspace</h3>", ">Appearance</span>"].map(value => html.indexOf(value));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(html, /Square, QuickBooks, and Google Sheets connections for this workspace/);
  assert.match(html, /href="\/app\/integrations"/);
  assert.match(html, /Workspace A/);
  assert.equal((html.match(/owner@example\.invalid/g) ?? []).length, 1);
  assert.match(html, /workspace-settings-account-grid/);
  assert.doesNotMatch(html, /href="\/app\/settings\/integrations\/square"|businessEntityId/);
  assert.doesNotMatch(html, /name="workspaceId"|workspaceId=|<details[^>]*\bopen(?:=|>)/);
});

test("optional Square navigation retains its enabled-owner restriction on Integrations", async () => {
  for (const config of [{ enabled: false }, { role: "admin" }, { role: "manager" }, { role: "member" }]) {
    const html = await settingsFixture(config)();
    assert.doesNotMatch(html, /Manage Square|settings-connections/);
    assert.match(html, /Current workspace/);
    assert.match(html, /Appearance/);
    assert.match(html, /href="\/app\/integrations"/);
    const { harness } = require("./integrations-ui-test-support");
    const h = harness({ squareEnabled: config.enabled ?? true, role: config.role ?? "owner", qboEnabled: false });
    assert.doesNotMatch(await h.render("app/app/integrations/page.tsx"), /Manage Square|Connect Square|href="\/app\/settings\/integrations\/square"/);
    assert(!h.calls.includes("square"));
  }
});

test("password entry is collapsed until selected and response feedback opens it without changing the action", async () => {
  const page = settingsFixture();
  const collapsed = await page();
  assert.match(collapsed, /<details><summary[^>]*>Change password<\/summary><form[^>]*action="\/synthetic-password-action"/);
  assert.equal((collapsed.match(/type="password"/g) ?? []).length, 2);
  assert.equal((collapsed.match(/autoComplete="new-password"/g) ?? []).length, 2);
  assert.equal((collapsed.match(/minLength="8"/g) ?? []).length, 2);
  assert.match(collapsed, /name="confirm_password"/);
  for (const response of [{ error: "Synthetic validation error" }, { message: "Synthetic update complete" }]) {
    const html = await page(response);
    assert.match(html, /<details open=""><summary[^>]*>Change password<\/summary>/);
    assert.ok(html.includes(Object.values(response)[0]));
  }
});

test("appearance shows a compact current setting with choices and preview disclosed separately", () => {
  const html = render(React.createElement(ThemeControls));
  assert.equal((html.match(/<details[ >]/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>)/);
  assert.match(html, /Current: Pulsar/);
  assert.match(html, /Change theme/);
  assert.match(html, /Theme preview/);
  assert.match(html, /Theme settings are personal to this browser/);
  assert.equal((html.match(/type="button"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  const compact = render(React.createElement(ThemeControls, { variant: "compact" }));
  assert.match(compact, /aria-label="Theme preference"/);
  assert.doesNotMatch(compact, /<details/);
});
