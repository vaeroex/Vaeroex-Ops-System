/* eslint-disable @typescript-eslint/no-require-imports -- Pure hosted qualification guard tests; no network, credentials, or provider calls. */
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { validateConfig, readConfig, selectCases, actorForCase, sanitizer, responseChecks } = require("./vsi-hosted-browser-qualification.cjs");
const config = () => ({ synthetic: true, origin: "https://vsi-synthetic-abc.vercel.app", allowedStageOrigins: ["https://vsi-synthetic-abc.vercel.app"], apiUrl: "https://synthetic.supabase.co", anonKey: "synthetic-public-anon-placeholder",
  allowedWorkspaceIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
  actors: [{ id: "00000000-0000-4000-8000-000000000003", email: "synthetic-bicycle@example.invalid", password: "synthetic-password-a", workspaceId: "00000000-0000-4000-8000-000000000001" },
    { id: "00000000-0000-4000-8000-000000000004", email: "vsi-catering@example.invalid", password: "synthetic-password-b", workspaceId: "00000000-0000-4000-8000-000000000002" }] });

test("qualification accepts only the explicitly allowlisted HTTPS preview and synthetic identities", () => {
  assert.equal(validateConfig(config()).origin, config().origin);
  for (const patch of [{ synthetic: false }, { origin: "http://vsi-synthetic-abc.vercel.app" }, { origin: "https://vaeroex.com" },
    { allowedStageOrigins: [] }, { origin: "https://other.vercel.app" }, { apiUrl: "http://localhost:54321" }, { serviceKey: "forbidden" },
    { vercelShareUrl: "https://other.vercel.app/?_vercel_share=private" }, { contextCookies: [{ name: "sb-auth", value: "private" }] }]) {
    assert.throws(() => validateConfig({ ...config(), ...patch }));
  }
  const wrongActor = config(); wrongActor.actors[0].email = "customer@example.com"; assert.throws(() => validateConfig(wrongActor));
  const wrongWorkspace = config(); wrongWorkspace.actors[0].workspaceId = "00000000-0000-4000-8000-000000000099"; assert.throws(() => validateConfig(wrongWorkspace));
});

test("private configuration must be a caller-owned regular 0600 file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vsi-hosted-config-test-")), file = path.join(directory, "synthetic.json");
  try {
    fs.writeFileSync(file, JSON.stringify(config()), { mode: 0o600 }); assert.equal(readConfig(file).synthetic, true);
    fs.chmodSync(file, 0o644); assert.throws(() => readConfig(file));
    fs.chmodSync(file, 0o600); const alias = path.join(directory, "alias.json"); fs.symlinkSync(file, alias); assert.throws(() => readConfig(alias));
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test("bounded cases always begin with real UI general/current/business questions and remap catering to workspace B", () => {
  assert.deepEqual(selectCases(false).map(item => item.id), ["general-writing", "current-weather", "repair-kpi"]);
  const full = selectCases(true); assert.equal(full.length, 12); assert.equal(new Set(full.map(item => item.id)).size, 12);
  assert(full.length * 0.10 <= 2); assert.equal(actorForCase(config(), full.find(item => item.id === "catering-business")).workspaceId, config().allowedWorkspaceIds[1]);
});

test("sanitized evidence cannot expose configured credentials or token-bearing query strings", () => {
  const value = config(), redact = sanitizer(value);
  const result = redact(`${value.anonKey} ${value.actors[0].password} ${value.actors[0].email} https://x.vercel.app/?_vercel_share=private-secret`);
  assert(!result.includes(value.anonKey)); assert(!result.includes(value.actors[0].password)); assert(!result.includes(value.actors[0].email)); assert(!result.includes("private-secret"));
});

test("transport success alone cannot pass missing evidence or missing current timestamps", () => {
  const exchange = { id: "00000000-0000-4000-8000-000000000007", answer: "A useful response returned for this synthetic question.", citations: [] };
  assert(responseChecks({ id: "general-writing" }, exchange).includes("general_without_business_evidence"));
  assert.throws(() => responseChecks({ id: "current-weather" }, exchange)); assert.throws(() => responseChecks({ id: "repair-kpi" }, exchange));
  const weather = { ...exchange, citations: [{ sourceType: "web", url: "https://weather.gov/", retrievedAt: new Date().toISOString() }] };
  assert(responseChecks({ id: "current-weather" }, weather).includes("web_source_and_current_lookup_timestamp"));
  weather.citations[0].retrievedAt = "2020-01-01T00:00:00Z"; assert.throws(() => responseChecks({ id: "current-weather" }, weather));
});
