const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

// Run the real exported actions and spreadsheet parser against an in-memory
// workspace. No browser session, service credentials, network or database.
function load(relativePath, mocks = {}, cache = new Map()) {
  if (cache.has(relativePath)) return cache.get(relativePath).exports;
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename
  }).outputText;
  const result = { exports: {} };
  cache.set(relativePath, result);
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "server-only") return {};
    if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`, mocks, cache);
    if (name.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)), mocks, cache);
    return require(name);
  };
  Function("require", "module", "exports", compiled)(localRequire, result, result.exports);
  return result.exports;
}

function redirect(url) {
  const error = new Error("NEXT_REDIRECT");
  error.digest = `NEXT_REDIRECT;replace;${url};307;`;
  error.url = url;
  throw error;
}

function harness(options = {}) {
  const workspaceId = "workspace-one";
  const writes = [];
  const authorizations = [];
  const rateChecks = [];
  const files = new Map();
  const imports = [];
  const rows = [];
  let storageCalls = 0;
  let savedBuffer;
  const supabase = {
    rpc: async () => ({ data: { status: "not_started" }, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user-one", email: "fixture@example.invalid" } } }) },
    storage: { from: () => ({
      async upload(storagePath, buffer, settings) {
        storageCalls++;
        assert.ok(storagePath.startsWith(`${workspaceId}/`));
        assert.equal(settings.upsert, false);
        if (options.storageThrows) throw new Error("SDK connection interrupted");
        savedBuffer = buffer;
        return { error: options.storageError ? { message: "storage unavailable" } : null };
      },
      async download() {
        if (options.downloadThrows) throw new Error("Saved file download interrupted");
        return { data: new Blob([savedBuffer]), error: null };
      }
    }) },
    from(table) {
      const filters = [];
      let operation = "select";
      let value;
      const query = {
        select() { return query; },
        insert(next) { operation = "insert"; value = next; return query; },
        update(next) { operation = "update"; value = next; return query; },
        delete() { operation = "delete"; return query; },
        eq(key, next) { filters.push([key, next]); return query; },
        is(key, next) { filters.push([key, next]); return query; },
        in() { return query; },
        order() { return query; },
        limit() { return query; },
        maybeSingle() { return query; },
        single() { return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (operation !== "select") writes.push({ table, operation, value, filters });
            const filter = (key) => filters.find(([field]) => field === key)?.[1];
            if (table === "record_folders") {
              assert.equal(filter("workspace_id"), workspaceId);
              return { data: options.invalidFolder ? null : { id: filter("id") }, error: null };
            }
            if (table === "file_uploads") {
              if (operation === "insert") {
                if (options.recordThrows) throw new Error("Source record response interrupted");
                const file = { ...value, id: "saved-source", imported_rows: 0 };
                files.set(file.id, file);
                return { data: { id: file.id }, error: options.recordError ? { message: "record failed" } : null };
              }
              assert.equal(filter("workspace_id"), workspaceId);
              if (operation === "update") {
                Object.assign(files.get(filter("id")), value);
                return { data: null, error: null };
              }
              if (filter("original_name")) {
                if (options.duplicateThrows) throw new Error("Duplicate query interrupted");
                return { data: options.duplicate ? { id: "existing", display_name: "Existing source" } : null, error: options.duplicateError ? { message: "query failed" } : null };
              }
              return { data: files.has(filter("id")) ? structuredClone(files.get(filter("id"))) : null, error: null };
            }
            if (table === "file_imports" && operation === "insert") {
              const record = { ...value, id: "prepared-import" };
              imports.push(record);
              return { data: { id: record.id }, error: null };
            }
            if (table === "file_import_rows" && operation === "insert") {
              rows.push(...value);
              return { data: null, error: null };
            }
            if (table === "file_processing_jobs") return { data: null, error: null };
            throw new Error(`Unexpected authority or query: ${table}/${operation}`);
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  const forbidden = () => { throw new Error("Upload must not analyze, index, learn or approve"); };
  const mocks = {
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect },
    "@/lib/ai/evidence-index": { indexFileAnalysisEvidence: forbidden, indexWorksheetImportEvidence: forbidden },
    "@/lib/ai/vaeroex-client": { runVaeroexCompletionWithUsage: forbidden },
    "@/lib/ai/usage": {},
    "@/lib/ai/vaeroex-workflows": {},
    "@/lib/billing/require-active-subscription": { requireActiveSubscription: async () => { if (options.authRedirect) redirect("/login"); } },
    "@/lib/billing/usage-limits": { isUsageLimitReached: async () => ({ reached: !!options.fileLimit, limitValue: 10 }) },
    "@/lib/kpis/settings": {},
    "@/lib/kpis/semantics": {},
    "@/lib/security/rate-limit": {
      enforceRateLimit: async (request) => { rateChecks.push(request); return { allowed: !options.rateDenied }; },
      rateLimitMessage: () => "Upload limit reached."
    },
    "@/lib/security/tool-execution-gateway": { requireToolExecution: async (context, request) => {
      authorizations.push({ context, request });
      assert.equal(request.toolName, "stage_file_import");
      assert.equal(request.confirmationReceived, true);
      assert.equal(request.initiatedBy, "user");
      assert.equal(context.workspaceId, workspaceId);
      if (options.role === "viewer") throw new Error("Your workspace role cannot prepare imports.");
    } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => supabase },
    "@/lib/workspaces/current": { getWorkspaceContext: async () => ({
      activeWorkspace: { id: workspaceId }, membership: { workspace_id: workspaceId, role: options.role || "owner", status: "active" }
    }) }
  };
  const actions = load("app/app/files/actions.ts", mocks);
  return { actions, files, imports, rows, writes, authorizations, rateChecks, storageCalls: () => storageCalls };
}

function form(filename = "metrics.csv", content = "Metric,Value,Date\nOrders,10,2026-09-01\n", type = "text/csv") {
  const value = new FormData();
  value.set("file", new File([content], filename, { type }));
  value.set("display_name", "September operations");
  value.set("folder_id", "folder-one");
  value.set("return_path", "/app/sources");
  return value;
}

async function redirected(promise) {
  try { await promise; assert.fail("Expected navigation after upload"); } catch (error) {
    assert.equal(error.message, "NEXT_REDIRECT");
    return new URL(error.url, "https://fixture.invalid");
  }
}

async function main() {
  for (const [options, payload, expected] of [
    [{}, new FormData(), /Choose a file/],
    [{}, form("script.exe", "bad", "application/octet-stream"), /not allowed|not supported|supported file|blocked/i],
    [{ duplicate: true }, form(), /duplicate/],
    [{ rateDenied: true }, form(), /limit reached/],
    [{ fileLimit: true }, form(), /upload limit/],
    [{ invalidFolder: true }, form(), /Folder not found/],
    [{ duplicateError: true }, form(), /could not be checked/]
  ]) {
    const test = harness(options);
    const selectedFile = payload.get("file");
    const result = await test.actions.uploadSourceAction({ error: null }, payload);
    assert.match(result.error, expected);
    assert.ok(!result.blocked);
    assert.equal(test.storageCalls(), 0, "validation must not upload");
    assert.equal(payload.get("file"), selectedFile, "the submitted File remains available for a corrected retry");
    if (selectedFile) assert.equal(payload.get("display_name"), "September operations");
  }

  for (const payload of [form(), form("workbook.xlsx", fs.readFileSync(path.join(root, "scripts/fixtures/Vaeroex_Retail_Full_Demo_Dataset_Dated.xlsx")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]) {
    const test = harness();
    const url = await redirected(test.actions.uploadSourceAction({ error: null }, payload));
    assert.equal(url.pathname, "/app/sources/saved-source");
    assert.equal(url.searchParams.get("section"), "imported");
    assert.match(url.searchParams.get("message"), /Review the mappings before saving/);
    assert.equal(test.storageCalls(), 1);
    assert.equal(test.imports.length, 1);
    assert.equal(test.imports[0].status, "needs_review");
    assert.equal(test.imports[0].rows_imported, 0);
    assert.equal(test.rows.length, payload.get("file").name.endsWith("xlsx") ? 303 : 1);
    assert.ok(test.rows.every((row) => row.status === "staged" && row.workspace_id === "workspace-one"));
    assert.equal(test.authorizations.length, 1);
    assert.equal(test.authorizations[0].request.args.rowsDetected, test.rows.length);
    assert.deepEqual(test.rateChecks.map((request) => request.action), ["file.upload", "file.import_stage"]);
    assert.equal(test.files.get("saved-source").imported_rows, 0);
    assert.ok(!test.writes.some((write) => ["kpis", "operational_metrics", "business_memory_chunks", "ai_agent_runs"].includes(write.table)));
  }

  const duplicate = harness({ duplicate: true });
  const override = form();
  override.set("allow_duplicate", "on");
  await redirected(duplicate.actions.uploadSourceAction({ error: null }, override));
  assert.equal(duplicate.storageCalls(), 1, "explicit duplicate override performs exactly one upload");

  const document = harness();
  const documentUrl = await redirected(document.actions.uploadSourceAction({ error: null }, form("notes.pdf", "%PDF-1.7\nfixture", "application/pdf")));
  assert.equal(documentUrl.pathname, "/app/sources/saved-source");
  assert.match(documentUrl.searchParams.get("message"), /Choose Analyze source/);
  assert.match(documentUrl.searchParams.get("message"), /not yet available/);
  assert.equal(document.imports.length, 0);
  assert.equal(document.authorizations.length, 0);

  for (const options of [{ role: "viewer" }, { downloadThrows: true }]) {
    const test = harness(options);
    const url = await redirected(test.actions.uploadSourceAction({ error: null }, form()));
    assert.equal(url.pathname, "/app/sources/saved-source");
    assert.ok(url.searchParams.get("error"));
    assert.equal(test.storageCalls(), 1);
    assert.equal(test.files.size, 1, "preparation failure preserves the uploaded source");
    assert.notEqual(test.files.get("saved-source").processing_status, "processing");
    assert.equal(test.imports.length, 0);
  }

  for (const options of [{ storageThrows: true }, { storageError: true }, { recordThrows: true }, { recordError: true }]) {
    const test = harness(options);
    const url = await redirected(test.actions.uploadSourceAction({ error: null }, form()));
    assert.match(url.searchParams.get("error"), /Check Sources before uploading/);
    assert.equal(test.storageCalls(), 1, "uncertain results must not automatically retry the upload");
    assert.equal(test.imports.length, 0);
  }
  const uncertain = harness({ duplicateThrows: true });
  const uncertainState = await uncertain.actions.uploadSourceAction({ error: null }, form());
  assert.equal(uncertainState.blocked, true, "unexpected SDK exceptions must not produce a retryable form");
  assert.match(uncertainState.error, /Check Sources before uploading/);
  const auth = harness({ authRedirect: true });
  assert.equal((await redirected(auth.actions.uploadSourceAction({ error: null }, form()))).pathname, "/login");
  const legacy = harness({ duplicate: true });
  assert.match((await redirected(legacy.actions.uploadFileAction(form()))).searchParams.get("error"), /duplicate/);
  assert.equal(legacy.storageCalls(), 0);
  console.log("Source upload action tests passed: retained validation state, one-time preparation, tenant/role gates, approval boundary, uncertain outcomes and legacy redirects.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
