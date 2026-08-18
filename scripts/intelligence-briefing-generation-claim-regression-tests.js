const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { claimIntelligenceBriefingGeneration } = require("../lib/ai/intelligence-briefing/generation-claim.ts");
const { INTELLIGENCE_BRIEFING_CONTRACT_ID } = require("../lib/ai/intelligence-briefing/contracts.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const generationKey = "a".repeat(64);
const inputJson = { briefing_type: "monthly", generation_key: generationKey };

function createAdmin(existingRows) {
  return {
    from(table) {
      assert.equal(table, "ai_agent_runs");
      return {
        insert(payload) {
          const input = payload.input_json;
          const collision = existingRows.some((row) =>
            row.workspace_id === payload.workspace_id
              && row.agent_type === payload.agent_type
              && ["processing", "completed"].includes(row.status)
              && row.input_json.briefing_type === input.briefing_type
              && row.input_json.generation_key === input.generation_key
          );
          return {
            select() {
              return {
                async maybeSingle() {
                  return collision
                    ? { data: null, error: { code: "23505" } }
                    : { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null };
                }
              };
            }
          };
        },
        select() {
          const filters = [];
          const builder = {
            eq(field, value) {
              filters.push((row) => row[field] === value);
              return builder;
            },
            contains(field, value) {
              filters.push((row) => Object.entries(value).every(([key, expected]) => row[field]?.[key] === expected));
              return builder;
            },
            in(field, values) {
              filters.push((row) => values.includes(row[field]));
              return builder;
            },
            async limit(count) {
              return { data: existingRows.filter((row) => filters.every((filter) => filter(row))).slice(0, count), error: null };
            }
          };
          return builder;
        }
      };
    }
  };
}

function row(status, overrides = {}) {
  return {
    id: overrides.id || `run-${status}`,
    workspace_id: workspaceId,
    agent_type: INTELLIGENCE_BRIEFING_CONTRACT_ID,
    input_json: inputJson,
    output_json: {},
    status,
    archived_at: null,
    deleted_at: null,
    ...overrides
  };
}

async function claim(existingRows) {
  return claimIntelligenceBriefingGeneration({
    admin: createAdmin(existingRows),
    workspaceId,
    userId,
    briefingType: "monthly",
    generationKey,
    inputJson
  });
}

(async () => {
  assert.deepEqual(
    await claim([row("failed")]),
    { status: "claimed", runId: "33333333-3333-4333-8333-333333333333" },
    "a failed validation run cannot block a corrected contract version from claiming a fresh generation"
  );
  assert.deepEqual(await claim([row("processing")]), { status: "processing" }, "an active identical generation remains concurrency-safe");
  assert.equal(
    (await claim([row("processing"), row("processing", { id: "run-processing-duplicate" })])).status,
    "failed_closed",
    "ambiguous active generation state fails closed"
  );
  assert.deepEqual(
    await claim([row("failed"), row("processing")]),
    { status: "processing" },
    "failed history is ignored while the one authoritative active claim remains protected"
  );
  console.log("Intelligence Briefing generation-claim regressions passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
