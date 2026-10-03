#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS local preview transpiles the actual TypeScript component inside an explicit synthetic-only import boundary. */
/*
 * Local-only visual preview: actual React panel, project CSS, and browse SQL.
 * Identity, selected-workspace cookie, platform schema, and records are fixtures.
 * This never loads Next, .env, Supabase clients, provider adapters, or credentials.
 * The in-memory PGlite database disappears when the process exits. It is not a
 * complete canonical Supabase database or an end-to-end authentication test.
 *
 * node scripts/square-payments-ui-preview.cjs --pglite /path/to/pglite/dist/index.js
 * Add --self-test for HTTP/database checks that close the server when finished.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Module = require("node:module");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const postcss = require("postcss");
const tailwindcss = require("tailwindcss");
const autoprefixer = require("autoprefixer");

const root = path.resolve(__dirname, "..");
const settingsPath = "/app/settings";
const squarePath = `${settingsPath}/integrations/square`;
const actorId = "11111111-1111-4111-8111-111111111111";
const sessionId = "aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const currentConnectionId = "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa";
const historicConnectionId = "aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa";
const demoCookie = `vaeroex_workspace_id=${workspaceId}`;
const workspaceLabel = "Northstar Coffee — local demo";
const panelPath = "components/integrations/SquareDirectCustomerPanel.tsx";
const browsePath = "lib/integrations/square-direct/payment-browse.ts";
const contractsPath = "lib/integrations/square-direct/contracts.ts";
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const port = Number(option("--port") || 4176);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, "Use a loopback preview port from 1024 through 65535.");

function source(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }

// Restrict application imports to the component and its harmless data contracts.
// Loading the production server layer in this preview is an error.
function loadTs(relative, overrideSource) {
  const allowed = new Set([panelPath, browsePath, contractsPath, "tailwind.config.ts"]);
  assert(allowed.has(relative), `Preview module is outside the fixture boundary: ${relative}`);
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => {
    if (name.startsWith("@/") || name.startsWith(".")) {
      const requested = name.startsWith("@/") ? name.slice(2) : path.relative(root, path.resolve(path.dirname(filename), name));
      const resolved = /\.tsx?$/.test(requested) ? requested : `${requested}.ts`;
      return loadTs(resolved);
    }
    assert(["react", "react/jsx-runtime", "zod", "next/link", "lucide-react"].includes(name), `Preview dependency is not allowed: ${name}`);
    return require(name);
  };
  loaded._compile(ts.transpileModule(overrideSource ?? source(relative), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return loaded.exports;
}

const { DirectViewSchema } = loadTs(contractsPath);
const { DirectPaymentBrowserSchema, parseDirectPaymentBrowseQuery } = loadTs(browsePath);
let beforeSource = null;
try { beforeSource = execFileSync("git", ["show", `95d1b0df:${panelPath}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
catch { /* /before returns 404 when the named local baseline is unavailable. */ }

let cssCache = { key: "", value: "" };
async function compiledCss() {
  const key = [panelPath, "tailwind.config.ts", "postcss.config.mjs", "app/globals.css"].map(file => fs.statSync(path.join(root, file)).mtimeMs).join(":");
  if (cssCache.key === key) return cssCache.value;
  const config = loadTs("tailwind.config.ts").default;
  const postcssConfig = (await import(pathToFileURL(path.join(root, "postcss.config.mjs")).href)).default;
  assert.deepEqual(Object.keys(postcssConfig.plugins), ["tailwindcss", "autoprefixer"], "Review changed project PostCSS plugins before using this fixture.");
  const content = config.content.map(file => path.join(root, file));
  if (beforeSource) content.push({ raw: beforeSource, extension: "tsx" });
  content.push({ raw: source("scripts/square-payments-ui-preview.cjs"), extension: "js" });
  const compiled = await postcss([
    tailwindcss({ ...config, content }), autoprefixer(postcssConfig.plugins.autoprefixer),
  ]).process(source("app/globals.css"), { from: path.join(root, "app/globals.css") });
  cssCache = { key, value: compiled.css };
  return compiled.css;
}

async function createDatabase() {
  let pgliteFile = option("--pglite");
  if (!pgliteFile) {
    try { pgliteFile = require.resolve("@electric-sql/pglite"); }
    catch { throw new Error("Pass --pglite with the installed local PGlite17 dist/index.js path. No packages are downloaded."); }
  }
  const { PGlite } = await import(pathToFileURL(path.resolve(pgliteFile)).href);
  const db = new PGlite();
  try {
    const identity = await db.query("select current_setting('server_version_num') as version");
    assert.equal(Math.floor(Number(identity.rows[0].version) / 10000), 17, "The exact migrations require PostgreSQL17.");
    // Minimal synthetic platform dependencies. Real owner helpers and the three
    // exact Square migrations are loaded below without rewriting their SQL.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create role square_production_oauth_authority; create role square_production_broker_authority;
      create role square_production_runtime_authority; create role square_production_evidence_authority;
      create role square_production_scheduler_authority; create role square_production_webhook_authority;
      grant usage on schema public to anon,authenticated,service_role;
      create schema auth; create schema private; create schema extensions; create schema supabase_migrations;
      create function auth.role() returns text language sql stable as $$select coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role'$$;
      create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then sha256($1) end$$;
      create table supabase_migrations.schema_migrations(version text primary key);
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users,not_after timestamptz);
      create table public.profiles(id uuid primary key,email text,full_name text);
      create table public.workspaces(id uuid primary key,name text,created_by uuid,manually_unlocked boolean not null default false);
      create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text,primary key(workspace_id,user_id));
      create table public.business_entities(id uuid primary key,workspace_id uuid not null,entity_key text,display_name text,base_currency text,timezone text,created_by uuid,updated_by uuid,status text not null default 'active',unique(workspace_id,id));
      create table public.customer_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,workspace_id uuid,customer_email text,status text,billing_provider text,current_period_end timestamptz,stripe_customer_id text,stripe_subscription_id text,manually_activated boolean,created_at timestamptz not null default now());
      create table private.square_production_customer_connections(id uuid);
      create table private.square_production_customer_bindings(id uuid);
    `);
    const versions = fs.readdirSync(path.join(root, "supabase/migrations"))
      .filter(name => /^\d+_.+\.sql$/.test(name) && name.split("_")[0] <= "20260902191325").sort().map(name => name.split("_")[0]);
    versions.push("20260925032300");
    assert.equal(versions.length, 105);
    for (const version of versions) await db.query("insert into supabase_migrations.schema_migrations values($1)", [version]);
    const appliedAuthority = source("supabase/production-migrations/20260925032300_square_production_customer_connection.sql");
    for (const name of ["require_owner", "require_eligible", "require_keys"]) {
      const pattern = new RegExp(`create function private\\.square_production_customer_${name}_v1\\([\\s\\S]*?\\$function\\$;`);
      const helper = appliedAuthority.match(pattern)?.[0];
      assert(helper, `Missing applied authority helper ${name}`);
      await db.exec(helper);
    }
    for (const filename of ["20260929004917_square_customer_service_backend.sql", "20260929041048_square_customer_payment_history.sql", "20260929052211_square_customer_payment_browse.sql"]) {
      await db.exec(source(`supabase/production-migrations/${filename}`));
      await db.query("insert into supabase_migrations.schema_migrations values($1)", [filename.split("_")[0]]);
    }
    // Use the reviewed SQL regression's seed: 375 current payments, one saved
    // archived payment, 40 unused attempts, and an isolated second workspace.
    const fixture = source("supabase/tests/square_customer_payment_browse.test.sql");
    const separator = "create temp table browse_before";
    assert(fixture.includes(separator), "Reviewed synthetic fixture boundary is missing.");
    await db.exec(fixture.slice(0, fixture.indexOf(separator)));
    await db.exec("commit");
    await db.query("update public.workspaces set name=$1,manually_unlocked=true where id=$2", [workspaceLabel, workspaceId]);
    // The exact existing entitlement helper requires both manual unlock and an
    // active manual subscription. This paid-workspace record exists only in the
    // disposable synthetic database and never activates an external workspace.
    await db.query(`insert into public.customer_subscriptions(user_id,workspace_id,customer_email,status,billing_provider,manually_activated)
      values($1,$2,'northstar-owner@example.invalid','active','manual',true)`, [actorId, workspaceId]);
    await db.query("update public.business_entities set display_name='Northstar Coffee' where workspace_id=$1", [workspaceId]);
    await db.query(`update square_customer_private.connections set seller_label='Northstar Coffee',
      locations='[{"id":"location_a","label":"Oakland counter"}]',created_at='2026-09-28T12:00:00Z',
      last_read_start='2026-05-01T00:00:00Z',last_read_end='2026-06-01T00:00:00Z',
      last_read_kind='created',last_read_completed_at='2026-09-29T03:56:40Z' where connection_id=$1`, [currentConnectionId]);
    await db.query(`update square_customer_private.connections set seller_label='Northstar Coffee — previous connection',
      locations='[{"id":"location_history","label":"Previous Oakland counter"}]' where connection_id=$1`, [historicConnectionId]);
    // Enables the fixture's existing controls visually. HTTP rejects every POST
    // before any handler or database call, so none can change fixture/provider state.
    await db.exec("update square_customer_private.configuration set enabled=true,application_id='sq0idp-browse-fixture'");
    await db.exec("set role service_role; select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
    return db;
  } catch (error) { await db.close(); throw error; }
}

function searchRecord(params) {
  const result = {};
  for (const [key, value] of params) result[key] = Object.hasOwn(result, key) ? [].concat(result[key], value) : value;
  return result;
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function documentHtml(content, comparison = false) {
  // The actual root layout defaults to Pulsar. Square lives outside the app shell.
  return `<!doctype html><html lang="en" class="dark pulsar" data-theme="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Square Payments — synthetic local preview</title><link rel="stylesheet" href="/preview.css"></head><body><aside class="border-b border-line px-6 py-2 text-xs text-slate-600" aria-label="Preview fixture">Local synthetic preview · ${comparison ? "Before: 95d1b0df" : "Working component"} · ${escapeHtml(workspaceLabel)} · PostgreSQL17 in memory · writes disabled</aside>${content}</body></html>`;
}

async function main() {
  const db = await createDatabase();
  await compiledCss();
  const browse = async query => {
    const result = await db.query("select public.square_customer_payments_v1($1,$2,$3,$4,$5,$6,$7,$8) as browser", [actorId, sessionId, workspaceId, query.connectionId, query.page, query.startDate, query.endDate, query.status]);
    return DirectPaymentBrowserSchema.parse(result.rows[0].browser);
  };
  const view = async () => {
    const result = await db.query("select public.square_customer_backend_v1('status',$1,$2,$3,'sq0idp-browse-fixture','{}') as view", [actorId, sessionId, workspaceId]);
    return DirectViewSchema.parse(result.rows[0].view);
  };
  const server = http.createServer(async (request, response) => {
    const headers = {
      "cache-control": "no-store", "referrer-policy": "same-origin",
      "content-security-policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-preview-data": "synthetic-postgresql17", "x-preview-workspace": workspaceId,
    };
    const send = (status, body, contentType = "text/html; charset=utf-8") => {
      response.writeHead(status, { ...headers, "content-type": contentType });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) return send(404, "Loopback preview only.");
    if (!["GET", "HEAD"].includes(request.method)) return send(405, "Local preview: all writes are disabled. No import, update, connect, mapping, or disconnect was performed.", "text/plain; charset=utf-8");
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname === "/preview.css") return send(200, await compiledCss(), "text/css; charset=utf-8");
      if (url.pathname === "/favicon.ico") return send(204, "");
      const selected = /(?:^|;\s*)vaeroex_workspace_id=([^;]+)/.exec(request.headers.cookie || "")?.[1];
      if (selected && selected !== workspaceId) return send(403, "This fixture accepts only its fixed synthetic workspace.", "text/plain; charset=utf-8");
      if (!selected) headers["set-cookie"] = `${demoCookie}; Path=/; HttpOnly; SameSite=Lax`;
      if (url.pathname === "/") {
        response.writeHead(302, { ...headers, location: squarePath }); response.end(); return;
      }
      if (url.pathname === settingsPath) return send(200, documentHtml(`<main class="mx-auto max-w-5xl space-y-6 p-6"><h1 class="text-2xl font-semibold">Vaeroex Settings</h1><p>Selected workspace: <strong>${escapeHtml(workspaceLabel)}</strong></p><p class="text-sm text-muted">Fixed demo owner · workspace cookie preserved</p><a class="inline-block rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white" href="${squarePath}">Manage Square</a><p class="text-xs text-muted">This settings page is a navigation fixture. The Square page renders the actual component.</p></main>`));
      if (url.pathname !== squarePath && url.pathname !== "/before") return send(404, "Unknown local preview route.");
      const before = url.pathname === "/before";
      if (before && !beforeSource) return send(404, "The local 95d1b0df comparison snapshot is unavailable.");
      let browser = null;
      let browseError = null;
      try { browser = await browse(parseDirectPaymentBrowseQuery(searchRecord(url.searchParams))); }
      catch { browseError = "Saved-payment browsing is unavailable or the filters are invalid. Your connection and saved records are unchanged."; }
      const { SquareDirectCustomerPanel } = loadTs(panelPath, before ? beforeSource : undefined);
      const html = renderToStaticMarkup(React.createElement(SquareDirectCustomerPanel, { view: await view(), browser, browseError }));
      send(200, documentHtml(html, before));
    } catch (error) {
      console.error(JSON.stringify({ label: "square_ui_preview_request_failed", message: error.message, productionAccess: false }));
      send(500, "The local synthetic preview could not render. See local preview output.");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${port}`;
  const close = async () => { await new Promise(resolve => server.close(resolve)); await db.close(); };
  if (args.includes("--self-test")) {
    try {
      const request = (route, options = {}) => fetch(`${origin}${route}`, { redirect: "manual", ...options });
      const initial = await request(squarePath);
      assert.equal(initial.status, 200);
      assert(initial.headers.get("set-cookie").startsWith(demoCookie));
      const initialHtml = await initial.text();
      assert.match(initialHtml, /Northstar Coffee/);
      assert.equal((await view()).available, true, "Synthetic eligibility must show the normal active-customer controls.");
      assert.match(initialHtml, />Update Payments<|>Update saved Payments</);
      assert.match(initialHtml, /Import historical Payments/);
      const all = await browse(parseDirectPaymentBrowseQuery({}));
      assert.equal(all.totalCount, 375); assert.equal(all.totalPages, 15); assert.equal(all.connections.length, 42);
      assert.equal(all.currentConnection?.connectionId, currentConnectionId, "Load the latest sanitized currentConnection projection.");
      const seen = new Set();
      for (let page = 1; page <= 15; page++) {
        const result = await browse(parseDirectPaymentBrowseQuery({ page: String(page) }));
        for (const payment of result.payments) { assert(!seen.has(payment.id)); seen.add(payment.id); }
      }
      assert.equal(seen.size, 375);
      const localDate = await browse(parseDirectPaymentBrowseQuery({ startDate: "2026-05-04", endDate: "2026-05-04" }));
      assert.equal(localDate.totalCount, 49);
      const failed = await browse(parseDirectPaymentBrowseQuery({ startDate: "2026-05-04", endDate: "2026-05-04", status: "FAILED" }));
      assert.equal(failed.totalCount, 16);
      const history = await browse(parseDirectPaymentBrowseQuery({ connectionId: historicConnectionId }));
      assert.equal(history.totalCount, 1); assert.equal(history.payments[0].id, "historic_saved");
      const cookieHeaders = { cookie: demoCookie };
      for (const route of [settingsPath, squarePath, `${squarePath}?page=2`, `${squarePath}?status=FAILED&startDate=2026-05-04&endDate=2026-05-04`]) {
        const response = await request(route, { headers: cookieHeaders });
        assert.equal(response.status, 200); assert.equal(response.headers.get("x-preview-workspace"), workspaceId);
        assert.equal(response.headers.get("set-cookie"), null, "Navigation must retain the existing selected-workspace cookie.");
      }
      assert.equal((await request(settingsPath, { headers: { cookie: "vaeroex_workspace_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } })).status, 403);
      for (const action of ["read", "disconnect", "connect", "mapping"]) {
        assert.equal((await request(`/api/integrations/square/${action}`, { method: "POST", headers: cookieHeaders, body: "fixture=only" })).status, 405);
      }
      assert.equal((await request("/preview.css")).status, 200);
      if (beforeSource) assert.equal((await request("/before")).status, 200);
      assert.deepEqual(await browse(parseDirectPaymentBrowseQuery({})), all, "Rejected write requests must leave data unchanged.");
      console.log(JSON.stringify({ label: "square_ui_preview_self_test_passed", actualSql: true, actualComponent: true, actualCss: true,
        currentPayments: seen.size, connectionOptions: all.connections.length, may4LocalPayments: localDate.totalCount,
        may4FailedPayments: failed.totalCount, workspaceCookiePreserved: true, allPostRejected: true, beforeSnapshot: Boolean(beforeSource),
        activeCustomerControlsVisible: true, currentConnectionProjection: true,
        fixture: "minimal_platform_with_exact_square_migrations_and_authority_helpers", fullCanonicalBaseline: false, productionAccess: false }));
    } finally { await close(); }
  } else {
    console.log(JSON.stringify({ label: "square_ui_preview_ready", url: `${origin}${squarePath}`, before: beforeSource ? `${origin}/before` : null,
      workspace: workspaceLabel, currentPayments: 375, engine: "actual_SQL_in_disposable_PGlite17", mocked: "identity_cookie_platform_dependencies_and_synthetic_records",
      component: "actual_React_SSR", css: "actual_project_Tailwind_PostCSS", writes: "HTTP_405", productionAccess: false }));
    process.once("SIGINT", () => close().then(() => process.exit(0)));
    process.once("SIGTERM", () => close().then(() => process.exit(0)));
  }
}

main().catch(error => { console.error(JSON.stringify({ label: "square_ui_preview_failed", message: error.message, productionAccess: false })); process.exitCode = 1; });
