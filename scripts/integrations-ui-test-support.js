const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const Link = ({ children, ...props }) => {
  delete props.prefetch;
  return React.createElement("a", props, children);
};

function loadSource(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "server-only") return {};
    if (name.startsWith("@/") || name.startsWith(".")) {
      const target = name.startsWith("@/") ? name.slice(2) : path.relative(root, path.resolve(path.dirname(filename), name));
      const extension = ["", ".ts", ".tsx"].find(ext => fs.existsSync(path.join(root, target + ext)) && fs.statSync(path.join(root, target + ext)).isFile());
      if (extension !== undefined) return loadSource(target + extension, mocks);
    }
    return require(name);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename
  }).outputText, filename);
  return loaded.exports;
}

function harness(options = {}) {
  const state = { role: "owner", qboEnabled: true, squareEnabled: true, workspaceId: "workspace-a",
    connections: [], freshness: [], errorTable: null, square: { available: true, connections: [] }, squareEvidence: null, ...options };
  const calls = [], queries = [];
  const access = { workspaceId: state.workspaceId,
    context: { membership: { role: state.role }, profile: { email: "synthetic@example.invalid" }, activeWorkspace: { name: "Synthetic workspace" } },
    supabase: { from(table) {
      const queryCalls = [];
      queries.push({ table, calls: queryCalls });
      const query = { then(resolve) {
        assert(queryCalls.some(([method, key, value]) => method === "eq" && key === "workspace_id" && value === state.workspaceId), "every query requires the authenticated workspace");
        if (table === "integration_connection_summaries") {
          assert(queryCalls.some(([method, key, value]) => method === "eq" && key === "provider_key" && value === "quickbooks_online"));
          assert(queryCalls.some(([method, key, value]) => method === "eq" && key === "provider_environment" && value === "production"));
        }
        if (table === "integration_freshness_summaries") {
          assert.deepEqual(queryCalls.find(([method]) => method === "in"), ["in", "connection_id", state.connections.map(row => row.id)]);
        }
        return resolve({ data: state.errorTable === table ? null : table === "integration_connection_summaries" ? state.connections
          : table === "integration_freshness_summaries" ? state.freshness : [{ id: "entity-a", display_name: "Synthetic entity" }],
        error: state.errorTable === table ? { message: "private database error" } : null });
      } };
      for (const method of ["select", "eq", "not", "order", "in"]) query[method] = (...args) => { queryCalls.push([method, ...args]); return query; };
      return query;
    } }
  };
  const mocks = {
    "next/link": { __esModule: true, default: Link },
    "next/navigation": { notFound: () => { throw Error("NOT_FOUND"); }, usePathname: () => state.pathname || "/app/integrations" },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/workspaces/page-context": { requireWorkspacePage: async () => { calls.push("workspace"); return access; } },
    "@/lib/integrations/control-plane/qbo-customer-availability": { qboProductionCustomerConnectionsEnabled: () => state.qboEnabled },
    "@/lib/integrations/square-direct/server": { squareDirectEnabled: () => state.squareEnabled,
      squareDirectView: async () => { calls.push("square"); return state.square; }, squareSettingsPath: "/app/settings/integrations/square" },
    "@/lib/integrations/control-plane/square-workspace-evidence": { readSquareWorkspaceEvidence: async (client, workspaceId) => {
      assert.equal(client, access.supabase);
      assert.equal(workspaceId, state.workspaceId);
      return state.squareEvidence;
    } },
    "@/components/help/ContextualHelp": { ContextualHelp: () => null },
    "@/components/app/ThemeControls": { ThemeControls: () => null },
    "@/lib/auth/actions": { changePasswordAction: async () => { throw Error("mutation_forbidden"); } }
  };
  return { state, calls, queries, load: relative => loadSource(relative, mocks),
    async render(relative, props = {}) { return renderToStaticMarkup(await loadSource(relative, mocks).default(props)); } };
}

const connection = (status = "active") => ({ id: "connection-a", provider_key: "quickbooks_online", status,
  safe_display_name: "Synthetic company", status_changed_at: "2026-10-01T00:00:00Z" });
module.exports = { root, loadSource, harness, connection, React, renderToStaticMarkup };
