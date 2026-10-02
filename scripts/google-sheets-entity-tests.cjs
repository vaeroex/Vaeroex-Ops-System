/* eslint-disable @typescript-eslint/no-require-imports -- Actual route/repository with synthetic authenticated RPC; no external requests. */
const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { installLoader, ids } = require("./qbo-customer-test-support.cjs");
let permitted = true, rpcError = false, serviceCalls = 0;
const calls = [];
const authenticatedClient = { async rpc(name, args) {
  calls.push({ name, args, client: this });
  if (rpcError) return { data: null, error: { code: "42501", message: "Synthetic rejection" } };
  return { data: { contractVersion: "business_entity_v1", id: randomUUID(), workspaceId: args.p_workspace_id,
    parentBusinessEntityId: args.p_parent_business_entity_id, entityKey: args.p_entity_key,
    displayName: args.p_display_name, legalName: args.p_legal_name, status: "active", baseCurrency: args.p_base_currency,
    timeZone: args.p_time_zone, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" }, error: null };
} };
Object.assign(process.env, { GOOGLE_SHEETS_ENABLED: "true", VERCEL_ENV: "production",
  GOOGLE_SHEETS_CLIENT_ID: "synthetic-client", GOOGLE_SHEETS_CLIENT_SECRET: "synthetic-secret",
  GOOGLE_SHEETS_REDIRECT_URI: "https://www.vaeroex.com/api/integrations/google-sheets/callback",
  GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), CRON_SECRET: "synthetic-scheduler-secret-at-least-32-characters" });
installLoader({
  "@/lib/supabase/admin": { createSupabaseAdminClient() { serviceCalls++; throw Error("Service client must never create an entity"); } },
  "@/lib/integrations/google-sheets/route-helpers": {
    requireSheetsManager: async () => { if (!permitted) throw Error("google_sheets_management_denied"); return { workspaceId: ids.workspace, supabase: authenticatedClient, user: { id: ids.actor }, sessionId: ids.session }; },
    sheetsRedirect: (kind, code) => Response.redirect(`https://www.vaeroex.com/app/settings/integrations/google-sheets?${kind}=${code}`, 303)
  }
});
const { POST } = require("../app/api/integrations/google-sheets/entity/route.ts");
const fields = { displayName: "Test Operations", entityType: "operating_company", baseCurrency: "USD", timeZone: "UTC", fiscalYearStartMonth: "1", confirmation: "create_entity" };
function request(changes = {}, origin = "https://www.vaeroex.com") {
  return new Request("https://www.vaeroex.com/api/integrations/google-sheets/entity", { method: "POST",
    headers: { origin, host: "www.vaeroex.com", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...fields, ...changes }) });
}
async function denied(req) {
  const before = calls.length;
  const response = await POST(req);
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "entity_create_failed");
  assert.equal(calls.length, before);
}
(async () => {
  let checks = 0;
  const created = await POST(request());
  assert.equal(created.status, 303); assert.equal(new URL(created.headers.get("location")).searchParams.get("result"), "entity_created");
  assert.equal(calls.length, 1); assert.equal(calls[0].client, authenticatedClient); assert.equal(calls[0].name, "create_business_entity_v1");
  assert.equal(calls[0].args.p_workspace_id, ids.workspace); assert.match(calls[0].args.p_entity_key, /^sheets-[a-f0-9-]{36}$/);
  assert.equal(calls[0].args.p_fiscal_year_start_month, 1); assert.equal(calls[0].args.p_parent_business_entity_id, null); checks++;
  await POST(request({ entityType: "division", baseCurrency: "EUR", timeZone: "Europe/Paris", fiscalYearStartMonth: "4" }));
  assert.equal(calls[1].args.p_entity_type, "division"); assert.equal(calls[1].args.p_base_currency, "EUR"); assert.equal(calls[1].args.p_time_zone, "Europe/Paris"); assert.equal(calls[1].args.p_fiscal_year_start_month, 4); assert.notEqual(calls[0].args.p_entity_key, calls[1].args.p_entity_key); checks++;
  for (const input of [{ confirmation: "" }, { workspaceId: ids.entity }, { entityKey: "client-provided" }, { entityType: "unsupported" },
    { baseCurrency: "usd" }, { timeZone: "Unknown/Not_A_Timezone" }, { fiscalYearStartMonth: "13" }, { displayName: "Patient records" }, { displayName: " " }]) { await denied(request(input)); checks++; }
  await denied(request({}, "https://hostile.invalid")); checks++;
  permitted = false; await denied(request()); checks++; permitted = true;
  const duplicate = request(); duplicate.headers.set("content-type", "application/x-www-form-urlencoded");
  await denied(new Request(duplicate.url, { method: "POST", headers: duplicate.headers, body: new URLSearchParams(fields).toString() + "&confirmation=create_entity" })); checks++;
  rpcError = true; const rejected = await POST(request()); assert.equal(new URL(rejected.headers.get("location")).searchParams.get("error"), "entity_create_failed"); checks++;
  assert.equal(serviceCalls, 0); checks++;
  console.log(JSON.stringify({ suite: "google_sheets_business_entity_route", checks, liveWrites: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
