/* eslint-disable @typescript-eslint/no-require-imports -- Offline test loader for actual TypeScript contracts and view. */
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function installLoader(mocks = {}) {
  for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
  const resolve = Module._resolveFilename, load = Module._load;
  Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
    return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
  };
  Module._load = function(request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    return load.call(this, request, parent, isMain);
  };
}
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const ids = { actor: id(1), session: id(2), workspace: id(3), entity: id(4), connection: id(5), mapping: id(6) };
const timestamp = "2026-09-29T12:00:00Z";
function record(type = "Invoice", status = "active") {
  return { contractVersion: "qbo_source_record_minimized_v1", provider: { providerKey: "quickbooks_online", realmId: "realm-never-expose", sourceEnvironment: "production" },
    recordType: type, id: "doc-100", displayName: null, active: true, status,
    metadata: { providerCreatedAt: timestamp, providerUpdatedAt: timestamp, syncToken: "sync-never-expose" },
    temporal: { postingDate: "2026-09-28", providerCreatedAt: timestamp, providerUpdatedAt: timestamp },
    accounting: { basis: "unknown", sourceCurrency: "USD", homeCurrency: "EUR", exchangeRate: "0.9" },
    relationships: {}, amounts: { total: { amount: "100", currency: "USD" }, balance: { amount: "40", currency: "USD" }, home_total: { amount: "90", currency: "USD" } },
    lines: [], providerVersionReference: "sync-never-expose", minimizationVersion: "qbo_minimizer_v1" };
}
function report(type = "ProfitAndLoss") {
  return { contractVersion: "qbo_report_control_observation_v1", provider: { providerKey: "quickbooks_online", realmId: "realm-never-expose", sourceEnvironment: "production" },
    reportType: type, reportBasis: "accrual", sourceCurrency: "USD", periodStart: "2026-09-01", periodEnd: "2026-09-28",
    columns: [{ columnKey: "label", title: "Account", type: "Account" }, { columnKey: "amount", title: "Total", type: "Money" }],
    rows: [{ rowType: "summary", group: "Income", cells: [{ columnKey: "label", value: "QBO income", id: "cell-never-expose" },
      { columnKey: "amount", value: "100.00", id: null }], children: [] }],
    contributionFamily: "control_observation", additive: false, parserVersion: "qbo_report_parser_v1" };
}
function pgliteModule() {
  if (process.env.QBO_TEST_PGLITE_MODULE) return process.env.QBO_TEST_PGLITE_MODULE;
  try { return require.resolve("@electric-sql/pglite"); }
  catch { throw new Error("Install pinned devDependency @electric-sql/pglite@0.3.14. Optional QBO_TEST_PGLITE_MODULE is for local tooling only."); }
}
async function database(modulePath = pgliteModule()) {
  const { pathToFileURL } = require("node:url");
  const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const db = new PGlite();
  // Dependency fixture only, not a substitute for the full canonical Supabase ledger.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema public to anon,authenticated,service_role;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.workspaces(id uuid primary key);
    create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text);
    create table public.business_entities(id uuid primary key,workspace_id uuid,display_name text,status text);
    create table private.integration_connections(id uuid primary key,workspace_id uuid,business_entity_id uuid,
      provider_key text,provider_environment text,status text,safe_display_name text,created_at timestamptz default now());
    create table private.provider_entity_mappings(id uuid primary key,workspace_id uuid,business_entity_id uuid,connection_id uuid,
      provider_key text,provider_environment text,status text,verified_at timestamptz);
    create table private.external_source_records(id uuid primary key,workspace_id uuid,business_entity_id uuid,connection_id uuid,
      mapping_id uuid,source_kind text,provider_key text,provider_record_type text,provider_record_id text,current_version_id uuid,lifecycle_state text);
    create table private.external_source_record_versions(id uuid primary key,workspace_id uuid,business_entity_id uuid,connection_id uuid,
      source_record_id uuid,source_kind text,provider_key text,provider_record_type text,provider_record_id text,temporal_basis text,
      posting_date date,period_start date,period_end date,effective_at timestamptz,source_timezone text,accounting_basis text,accounting_currency char(3),
      observed_at timestamptz,synchronized_at timestamptz,normalized_projection jsonb,validation_state text,change_kind text);
    alter table private.external_source_record_versions add column prior_version_id uuid;
    create table private.qbo_production_source_validation_work(source_version_id uuid primary key,source_record_id uuid,
      workspace_id uuid,business_entity_id uuid,connection_id uuid,mapping_id uuid,state text,completed_version_id uuid);
    do $$declare t text; begin foreach t in array array['public.business_entities','private.integration_connections',
      'private.provider_entity_mappings','private.external_source_records','private.external_source_record_versions',
      'private.qbo_production_source_validation_work'] loop
      execute 'alter table '||t||' enable row level security'; execute 'alter table '||t||' force row level security'; end loop; end $$;
  `);
  // Verify 030 can install before 040 creates the separately owned work table.
  await db.exec("alter table private.qbo_production_source_validation_work rename to validation_work_not_yet_installed");
  await db.exec(fs.readFileSync(path.join(root, "supabase/production-migrations/20260930003000_qbo_customer_source_browse.sql"), "utf8"));
  await db.exec("alter table private.validation_work_not_yet_installed rename to qbo_production_source_validation_work");
  await db.query("insert into auth.users(id) values ($1)", [ids.actor]);
  await db.query("insert into auth.sessions(id,user_id) values ($1,$2)", [ids.session, ids.actor]);
  await db.query("insert into public.workspaces values ($1)", [ids.workspace]);
  await db.query("insert into public.workspace_members values ($1,$2,'owner','active')", [ids.workspace, ids.actor]);
  await db.query("insert into public.business_entities values ($1,$2,'Main entity','active')", [ids.entity, ids.workspace]);
  await db.query("insert into private.integration_connections(id,workspace_id,business_entity_id,provider_key,provider_environment,status,safe_display_name) values ($1,$2,$3,'quickbooks_online','production','active','Stored QBO company')", [ids.connection, ids.workspace, ids.entity]);
  await db.query("insert into private.provider_entity_mappings values ($1,$2,$3,$4,'quickbooks_online','production','active',now())", [ids.mapping, ids.workspace, ids.entity, ids.connection]);
  return db;
}
async function insertSource(db, number, projection, { lifecycle = "active", validation = "pending", provider = "quickbooks_online", type, changeKind = "created" } = {}) {
  if (projection?.recordType) projection = { ...projection, id: `doc-${number}` };
  type ??= projection?.recordType ?? projection?.reportType ?? "Invoice";
  const isReport = Boolean(projection?.reportType), sourceId = id(number), versionId = id(number + 100000);
  const providerId = projection?.id ?? [type, projection?.reportBasis, projection?.periodStart ?? "open",
    projection?.periodEnd ?? "open", projection?.sourceCurrency ?? "currency_unspecified"].join(":");
  await db.query("insert into private.external_source_records values ($1,$2,$3,$4,$5,'provider',$6,$7,$8,$9,$10)",
    [sourceId, ids.workspace, ids.entity, ids.connection, ids.mapping, provider, type, providerId, versionId, lifecycle]);
  await db.query(`insert into private.external_source_record_versions values ($1,$2,$3,$4,$5,'provider',$6,$7,$8,$9,$10,$11,$12,null,null,$13,$14,$15,$15,$16,$17,$18,null)`,
    [versionId, ids.workspace, ids.entity, ids.connection, sourceId, provider, type, providerId, isReport ? "period" : "event",
      isReport ? null : "2026-09-28", isReport ? projection.periodStart : null, isReport ? projection.periodEnd : null,
      isReport ? projection.reportBasis : "unknown", projection?.sourceCurrency ?? projection?.accounting?.sourceCurrency ?? null,
      timestamp, projection, validation, changeKind]);
  return sourceId;
}
async function browse(db, args = {}, claims = {}) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: "authenticated", sub: ids.actor, session_id: ids.session, ...claims })]);
  await db.exec("set role authenticated");
  try {
    return (await db.query("select public.qbo_customer_source_browse_v1($1,$2,$3,$4,$5) as result", [args.workspaceId ?? ids.workspace,
      args.connectionId === undefined ? ids.connection : args.connectionId, args.after ?? null, args.sourceId ?? null, args.kind ?? "all"])).rows[0].result;
  } finally { await db.exec("reset role"); }
}
module.exports = { root, installLoader, id, ids, timestamp, record, report, database, insertSource, browse, pgliteModule };
