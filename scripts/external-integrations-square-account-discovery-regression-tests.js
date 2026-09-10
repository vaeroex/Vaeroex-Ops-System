const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const { ProviderAccessCredential } = require("../lib/integrations/credentials/broker.ts");
const { createSquareAccountDiscovery, SQUARE_ACCOUNT_DISCOVERY_BOUNDS } = require("../lib/integrations/providers/square/account-discovery.ts");
const { createSquareAccountMapping } = require("../lib/integrations/providers/square/account-mapping.ts");
const { SQUARE_MINIMUM_READ_SCOPES, SQUARE_API_VERSION } = require("../lib/integrations/providers/square/contracts.ts");
const { parseSquareMerchantResponse } = require("../lib/integrations/providers/square/merchant-responses.ts");
const { parseSquareLocationResponse } = require("../lib/integrations/providers/square/location-responses.ts");
const { SquareTimeZoneSchema } = require("../lib/integrations/providers/square/response-validation.ts");
const { SQUARE_IANA_TIME_ZONE_NAMES } = require("../lib/integrations/providers/square/iana-time-zone-names.ts");
const NOW = new Date("2026-09-08T00:00:00.000Z");
const TOKEN = "synthetic_square_discovery_secret_canary";
const PRIVATE = "PRIVATE_PROVIDER_RAW_CANARY";
const id = "10000000-0000-4000-8000-000000000001";
let assertions = 0;
const eq = (a, b, label) => { assertions++; assert.deepEqual(a, b, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const rejects = async run => { assertions++; await assert.rejects(run, /^Error: square_account_(discovery|mapping)_denied$/); };
const throws = run => { assertions++; assert.throws(run, /^Error: square_account_discovery_denied$/); };
function credential(changes = {}) {
  return new ProviderAccessCredential({ providerKey: "square", providerEnvironment: "sandbox",
    accessToken: TOKEN, accessExpiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
    grantedScopes: [...SQUARE_MINIMUM_READ_SCOPES].sort(), ...changes });
}
function location(index = 0) {
  return { id: `LOC_${index}`, merchant_id: "SELLER_SYNTHETIC", name: `Location ${index}`, status: "ACTIVE",
    country: "US", currency: "USD", timezone: "America/Los_Angeles", coordinates: { latitude: 33.7889, longitude: -84.3841 },
    phone_number: PRIVATE };
}
function fixtures(count = 1) {
  return {
    "/v2/merchants/me": { merchant: { id: "SELLER_SYNTHETIC", business_name: "Synthetic seller", status: "ACTIVE", country: "US", main_location_id: "LOC_0" } },
    "/v2/locations": { locations: Array.from({ length: count }, (_, index) => location(index)) },
    "/v2/locations/main": { location: location(0) }
  };
}
function factory(data = fixtures(), extras = {}) {
  const calls = [];
  const discovery = createSquareAccountDiscovery({ environment: "sandbox", applicationId: "synthetic-square-app",
    clock: () => NOW, async readAuthenticated(input) { calls.push(input); return data[input.path]; }, ...extras });
  return { discovery, calls };
}
async function verify(discovery, token = credential(), seller = "SELLER_SYNTHETIC") {
  return discovery.verify({ credential: token, externalAuthorizedEntityReference: seller });
}
function counts(value) {
  let values = 1, containers = value !== null && typeof value === "object" ? 1 : 0;
  if (containers) for (const child of Object.values(value)) {
    const count = counts(child); values += count.values; containers += count.containers;
  }
  return { values, containers };
}
function frozen(value) {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(frozen);
}
async function main() {
  ok(Object.isFrozen(SQUARE_IANA_TIME_ZONE_NAMES));
  eq([...new Set(SQUARE_IANA_TIME_ZONE_NAMES)].sort(), SQUARE_IANA_TIME_ZONE_NAMES, "pinned names are unique and sorted");
  for (const timezone of SQUARE_IANA_TIME_ZONE_NAMES) {
    let runtimeSupported = true;
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { runtimeSupported = false; }
    eq(SquareTimeZoneSchema.safeParse(timezone).success, runtimeSupported && timezone.length <= 30, "all pinned IANA names respect runtime and Square length bounds");
  }
  // Square's IANA contract includes UTC and tzdb links, not only the primary
  // zones returned by Intl.supportedValuesOf. Exercise both operation envelopes
  // and the complete authenticated discovery handoff using synthetic data.
  for (const timezone of ["UTC", "Etc/UTC", "US/Pacific", "America/Argentina/Buenos_Aires", "America/Los_Angeles", "EST5EDT", "GMT0", "Etc/GMT+5"]) {
    const data = fixtures();
    data["/v2/locations"].locations[0].timezone = timezone;
    data["/v2/locations/main"].location.timezone = timezone;
    for (const response of [data["/v2/locations"], data["/v2/locations/main"]]) {
      const parsed = parseSquareLocationResponse({ providerKey: "square", providerEnvironment: "sandbox", apiVersion: SQUARE_API_VERSION, response });
      eq(parsed.outcome, "accepted", "IANA timezone accepted: " + timezone);
      eq(parsed.value.items[0].timeZone, timezone, "timezone identity preserved");
      ok(frozen(parsed.value), "accepted timezone projection remains deeply frozen");
    }
    const supported = factory(data);
    await verify(supported.discovery);
    ok(frozen(supported.discovery.consumeVerifiedDiscovery()));
    eq(supported.calls.length, 3, "UTC/alias discovery reaches main-location verification");
  }
  for (const timezone of ["Mars/Olympus", "+01:00", "-05", " UTC", "UTC\n", "A".repeat(31), "ACT", "AET", "BET", "SystemV/PST8PDT", "utc"]) {
    const data = fixtures(); data["/v2/locations"].locations[0].timezone = timezone;
    await rejects(() => verify(factory(data).discovery));
  }
  const first = factory();
  throws(() => first.discovery.consumeVerifiedDiscovery());
  const token = credential();
  const evidence = await verify(first.discovery, token);
  eq(first.calls.map(call => call.path), ["/v2/merchants/me", "/v2/locations", "/v2/locations/main"]);
  ok(first.calls.every(call => call.accessToken === TOKEN && call.environment === "sandbox"));
  eq(evidence.externalAuthorizedEntityReference, "SELLER_SYNTHETIC");
  eq(evidence.providerEntityType, "merchant");
  const handoff = first.discovery.consumeVerifiedDiscovery();
  ok(frozen(handoff)); eq(handoff.fingerprint, evidence.verificationFingerprint);
  eq(handoff.defaultLocationId, "LOC_0");
  ok(!JSON.stringify({ evidence, handoff }).includes(TOKEN)); ok(!JSON.stringify(handoff).includes(PRIVATE));
  throws(() => first.discovery.consumeVerifiedDiscovery());
  await rejects(() => verify(first.discovery));
  assertions++; await assert.rejects(() => token.use(() => undefined), /already_consumed/);

  // Current schemas, not a fixture hunt: max500 list items. Optional populated
  // fields do not alter per-item 3-container parser or 1-container handoff cost.
  const maximumData = fixtures(500), maximum = factory(maximumData);
  await verify(maximum.discovery);
  const largest = maximum.discovery.consumeVerifiedDiscovery();
  eq(counts(largest), { containers: 502, values: 2010 });
  eq(SQUARE_ACCOUNT_DISCOVERY_BOUNDS.maximumContainers, counts(largest).containers);
  const parserInput = response => ({ providerKey: "square", providerEnvironment: "sandbox", apiVersion: SQUARE_API_VERSION, response });
  const merchant = parseSquareMerchantResponse(parserInput(maximumData["/v2/merchants/me"]));
  const list = parseSquareLocationResponse(parserInput(maximumData["/v2/locations"]));
  const mainLocation = parseSquareLocationResponse(parserInput(maximumData["/v2/locations/main"]));
  eq(counts(merchant.value).containers + counts(list.value).containers + counts(mainLocation.value).containers, 1515);
  eq(list.value.items[0].provider, list.value.provider);
  ok(counts(list.value).containers > new Set([list.value, list.value.items, list.value.provider]).size, "shared occurrences receive expanded charges");
  await rejects(() => verify(factory(fixtures(501)).discovery));

  const noOptional = fixtures();
  delete noOptional["/v2/merchants/me"].merchant.business_name;
  delete noOptional["/v2/merchants/me"].merchant.main_location_id;
  delete noOptional["/v2/locations"].locations[0].merchant_id;
  delete noOptional["/v2/locations"].locations[0].name;
  delete noOptional["/v2/locations/main"].location.merchant_id;
  const optional = factory(noOptional); await verify(optional.discovery);
  eq(optional.discovery.consumeVerifiedDiscovery().merchantLabel, "Square seller");
  const maximumMerchant = fixtures(), longMerchant = "SELLER.:_-".padEnd(100, "x");
  maximumMerchant["/v2/merchants/me"].merchant.id = longMerchant;
  maximumMerchant["/v2/merchants/me"].merchant.main_location_id = "LOC.:_-";
  maximumMerchant["/v2/locations"].locations[0].id = "LOC.:_-";
  maximumMerchant["/v2/locations"].locations[0].merchant_id = null;
  maximumMerchant["/v2/locations/main"].location.id = "LOC.:_-";
  maximumMerchant["/v2/locations/main"].location.merchant_id = null;
  const supportedIds = factory(maximumMerchant); await verify(supportedIds.discovery, credential(), longMerchant);
  eq(supportedIds.discovery.consumeVerifiedDiscovery().merchantId, longMerchant, "maximum account-contract intersection and nullable location merchant preserve authenticated authority");
  await rejects(() => verify(factory(maximumMerchant).discovery, credential(), longMerchant + "x"));
  const invalidLeadingId = factory(maximumMerchant);
  await rejects(() => verify(invalidLeadingId.discovery, credential(), "_merchant"));
  eq(invalidLeadingId.calls.length, 0, "unsupported generic evidence identifier rejects before discovery transport");
  const inactive = fixtures(2); inactive["/v2/locations"].locations[1].status = "INACTIVE";
  const activeAndInactive = factory(inactive); await verify(activeAndInactive.discovery);
  eq(activeAndInactive.discovery.consumeVerifiedDiscovery().locations[1].status, "INACTIVE", "listing inactive locations is part of provider contract");

  for (const changes of [{ providerKey: "quickbooks_online" }, { providerEnvironment: "production" },
    { accessExpiresAt: NOW.toISOString() }, { accessExpiresAt: "invalid" },
    { grantedScopes: ["MERCHANT_PROFILE_READ"] }, { grantedScopes: [...SQUARE_MINIMUM_READ_SCOPES].sort().reverse() },
    { grantedScopes: [...SQUARE_MINIMUM_READ_SCOPES, "PAYMENTS_WRITE"].sort() }]) {
    const invalid = factory(); await rejects(() => verify(invalid.discovery, credential(changes))); eq(invalid.calls.length, 0);
  }
  for (const change of [
    data => { data["/v2/merchants/me"].merchant.id = "FOREIGN_SELLER"; },
    data => { data["/v2/merchants/me"].merchant.status = "INACTIVE"; },
    data => { data["/v2/merchants/me"].merchant.main_location_id = "FOREIGN_DEFAULT"; },
    data => { data["/v2/locations"].locations[0].merchant_id = "FOREIGN_SELLER"; },
    data => { data["/v2/locations/main"].location.merchant_id = "FOREIGN_SELLER"; },
    data => { data["/v2/locations/main"].location.id = "FOREIGN_DEFAULT"; },
    data => { data["/v2/locations"].locations[0].status = "INACTIVE"; },
    data => { data["/v2/locations/main"].location.status = "INACTIVE"; },
    data => { data["/v2/locations/main"].location.currency = "CAD"; },
    data => { data["/v2/locations"].locations.push(location(0)); },
    data => { data["/v2/locations"] = {}; },
    data => { data["/v2/locations"] = { locations: [] }; },
    data => { data["/v2/locations"] = { locations: null }; },
    data => { data["/v2/locations"].location = location(0); },
    data => { data["/v2/locations"].orders = []; },
    data => { data["/v2/locations"].errors = []; },
    data => { data["/v2/merchants/me"].merchant = [data["/v2/merchants/me"].merchant]; },
    data => { data["/v2/merchants/me"].errors = [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: TOKEN }]; },
    data => { data["/v2/locations/main"].locations = []; }
  ]) {
    const data = fixtures(); change(data); const invalid = factory(data);
    await rejects(() => verify(invalid.discovery)); throws(() => invalid.discovery.consumeVerifiedDiscovery());
  }

  let traps = 0;
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const getter = Object.defineProperty({}, "merchant", { enumerable: true, get() { traps++; return {}; } });
  const cyclic = {}; cyclic.merchant = cyclic;
  for (const raw of [revoked.proxy, new Proxy({}, { getPrototypeOf() { traps++; return Object.prototype; } }), getter, cyclic,
    { merchant: { nested: new Array(1) } }, { merchant: { number: -0 } }, { merchant: { number: Infinity } },
    { merchant: { number: 9007199254740992 } }, { merchant: { [Symbol("bad")]: "bad" } }]) {
    const data = fixtures(); data["/v2/merchants/me"] = raw;
    await rejects(() => verify(factory(data).discovery));
  }
  eq(traps, 0, "no Proxy or accessor execution");

  // Reach exactly the existing 20,000 raw-value boundary using harmless unknown
  // fields within each existing location schema. No new container cap is guessed.
  const boundaryData = fixtures(500);
  const raw = boundaryData["/v2/locations"];
  for (const item of raw.locations) item.unused = [];
  let remaining = 20_000 - counts(raw).values;
  for (const item of raw.locations) {
    const amount = Math.min(1000, remaining); item.unused = new Array(amount).fill("x"); remaining -= amount;
  }
  eq(remaining, 0); eq(counts(raw).values, 20_000);
  const boundary = factory(boundaryData); await verify(boundary.discovery);
  eq(counts(boundary.discovery.consumeVerifiedDiscovery()), { containers: 502, values: 2010 });
  raw.locations[499].unused.push("x");
  eq(counts(raw).values, 20_001); await rejects(() => verify(factory(boundaryData).discovery));
  const aliased = fixtures(); const repeated = Array.from({ length: 1000 }, () => "x");
  aliased["/v2/merchants/me"].merchant.unused = Array.from({ length: 21 }, () => repeated);
  await rejects(() => verify(factory(aliased).discovery));

  let release;
  const pending = new Promise(resolvePending => { release = resolvePending; });
  const race = factory(fixtures(), { async readAuthenticated(input) { await pending; return fixtures()[input.path]; } });
  const inFlight = verify(race.discovery); await rejects(() => verify(race.discovery));
  throws(() => race.discovery.consumeVerifiedDiscovery()); release(); await inFlight;
  race.discovery.consumeVerifiedDiscovery();
  const controller = new AbortController(); controller.abort();
  const cancelled = factory(fixtures(), { signal: controller.signal });
  await rejects(() => verify(cancelled.discovery)); eq(cancelled.calls.length, 0);
  const beforeHandoff = new AbortController(), completed = factory(fixtures(), { signal: beforeHandoff.signal });
  await verify(completed.discovery); beforeHandoff.abort();
  throws(() => completed.discovery.consumeVerifiedDiscovery());
  let time = NOW.getTime(), expiryReads = 0;
  const expiring = factory(fixtures(), {
    clock: () => new Date(time), async readAuthenticated(input) {
      expiryReads++; time += 3600_000; return fixtures()[input.path];
    }
  });
  await rejects(() => verify(expiring.discovery)); eq(expiryReads, 1);
  const failing = factory(fixtures(), { readAuthenticated() { throw new Error(TOKEN); } });
  await rejects(() => verify(failing.discovery)); throws(() => failing.discovery.consumeVerifiedDiscovery());

  const context = { actor: { actorId: id, workspaceId: id, sessionId: id, role: "owner" },
    environment: "sandbox", applicationId: "synthetic-square-app", redirectUri: "https://vaeroex.invalid/api/integrations/square/callback" };
  let mappingCalls = 0, last;
  const client = { async rpc(name, args) { mappingCalls++; last = { name, args }; return { data: { outcome: "mapped" }, error: null }; } };
  const mapping = createSquareAccountMapping({ client, context });
  const command = { connectionId: id, businessEntityId: id, locationIds: ["LOC_0"], confirmation: "map" };
  eq(await mapping.confirm(command), { outcome: "mapped" });
  eq(last, { name: "square_account_connection_v1", args: { p_context: context, p_operation: "confirm_mapping", p_command: command } });
  await mapping.confirm({ ...command, locationIds: ["LOC.:_-".padEnd(32, "x")] });
  eq(last.args.p_command.locationIds, ["LOC.:_-".padEnd(32, "x")], "supported punctuation and exact location identifier limit remain unchanged");
  await rejects(() => mapping.confirm({ ...command, locationIds: ["x".repeat(33)] }));
  context.actor.role = "staff";
  await mapping.confirm(command); eq(last.args.p_context.actor.role, "owner", "request context captured immutably");
  const before = mappingCalls;
  for (const bad of [null, {}, { ...command, confirmation: "yes" }, { ...command, locationIds: [] },
    { ...command, businessEntityId: "bad" }, { ...command, sellerId: "FORGED" },
    { ...command, locationIds: ["LOC_0", "LOC_0"] }, { ...command, locationIds: new Array(501).fill("LOC_0") }, revoked.proxy]) {
    await rejects(() => mapping.confirm(bad));
  }
  await rejects(() => createSquareAccountMapping({ client, context }).confirm(command));
  eq(mappingCalls, before);
  await rejects(() => createSquareAccountMapping({ context: { ...context, actor: { ...context.actor, role: "owner" } },
    client: { async rpc() { return { data: null, error: { message: TOKEN } }; } } }).confirm(command));
  console.log(`Square account discovery/mapping regression tests passed: ${assertions} assertions.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
