/* Loaded by the consent suite's TS/alias/zero-AI test boundary. */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { canonicalContractJson } = require("../lib/integrations/contracts/canonical.ts");
const { createInternalMapping, createInternalPaymentsRuntime, createInternalPaymentsBroker, createInternalEvidence } = require("../services/external-integrations-production/internal-consent/manual-read.ts");
const { createInternalRpc } = require("../services/external-integrations-production/internal-consent/database.ts");
const { createInternalConsentServer } = require("../services/external-integrations-production/internal-consent/server.ts");

module.exports = async function ({ permit: p, actor, now, fp }) {
  const c = { credentialId: randomUUID(), credentialVersion: 1, mappingRowVersion: 3,
    scanId: randomUUID(), taskId: randomUUID(), leaseId: randomUUID(), leaseOwnerFingerprint: fp(["owner"]),
    paymentWindowStart: "2026-09-24T10:00:00.000Z", paymentWindowEnd: "2026-09-24T11:00:00.000Z",
    runtimeOrigin: "https://square-production-runtime-u5c6zahmpq-uw.a.run.app",
    evidenceOrigin: "https://square-production-evidence-u5c6zahmpq-uw.a.run.app" };
  const base = { permit: p, configuration: c, now: () => now };
  const aad = { credentialId: c.credentialId, credentialVersion: "1", environment: "production", generation: String(p.generation),
    permitId: p.permitId, projectId: "vaeroex-integrations-prod", providerKey: "square" };
  const kmsKey = "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials";
  const credential = { schemaVersion: "oauth_credential_envelope_v1", providerKey: "square", environment: "production",
    externalAuthorizedEntityReference: p.expectedMerchantId, accessToken: "synthetic_private_access_token_000", refreshToken: "synthetic_private_refresh_token_000",
    grantedScopes: ["PAYMENTS_READ"], issuedAt: "2026-09-24T09:00:00.000Z", updatedAt: "2026-09-24T09:00:00.000Z",
    accessExpiresAt: "2026-09-24T13:00:00.000Z", refreshExpiresAt: null };
  function fixture(options = {}) {
    const calls = [], pages = [];
    let mapped = false, prepared = false, leased = false, committed, responseCount = 0, decrypted;
    const checkAuthority = () => { if (options.revoked) throw new Error("synthetic authority revoked"); };
    const broker = createInternalPaymentsBroker({ ...base, brokerRpc: async (op, request) => {
      checkAuthority(); calls.push(op); assert.equal(op, "read_credential");
      assert.equal(request.requestFingerprint, fp(["read-credential-v1", c.scanId, c.leaseId, c.leaseOwnerFingerprint, c.credentialId, 1]));
      assert.equal(request.permitId, p.permitId); assert.equal(request.scanId, c.scanId); assert.equal(request.leaseId, c.leaseId);
      return { permitId: p.permitId, scanId: c.scanId, credentialId: c.credentialId, credentialVersion: 1,
        ciphertextBase64: Buffer.from("synthetic ciphertext").toString("base64"), aadContext: aad,
        aadDigest: fp(["aad-v1", "square", "production", "vaeroex-integrations-prod", p.generation, p.permitId, c.credentialId, 1]),
        kmsKeyResource: kmsKey, externalEntityFingerprint: fp(["external-entity-v1", p.expectedMerchantId, p.expectedLocationId]),
        accessExpiresAt: "2026-09-24T13:00:00+00:00", ...options.storedChange };
    }, kms: { encrypt: async () => { throw new Error("not allowed"); }, decrypt: async request => {
      assert.equal(request.keyResource, kmsKey);
      assert.equal(Buffer.from(request.additionalAuthenticatedData).toString(), canonicalContractJson(aad));
      decrypted = Buffer.from(JSON.stringify({ ...credential, ...options.credentialChange })); return decrypted;
    } }, network: async (url, init) => {
      responseCount++; assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
      const parsed = new URL(url); assert.equal(parsed.origin, "https://connect.squareup.com"); assert.equal(parsed.pathname, "/v2/payments");
      assert.deepEqual(Object.fromEntries(parsed.searchParams), { begin_time: c.paymentWindowStart, end_time: c.paymentWindowEnd,
        location_id: p.expectedLocationId, limit: "100", sort_order: "ASC" });
      assert.equal(init.headers.Authorization, `Bearer ${credential.accessToken}`);
      return Response.json({ payments: options.empty ? [] : [{ id: "SYNTHETIC_PAYMENT", location_id: p.expectedLocationId,
        created_at: "2026-09-24T10:30:00+00:00", status: "COMPLETED", amount_money: { amount: 100, currency: "USD" },
        customer_id: "synthetic_private_customer", ...options.paymentChange }], cursor: "synthetic_next_page_never_followed" });
    } });
    const mapping = createInternalMapping({ ...base, oauthRpc: async (op, request) => {
      checkAuthority(); calls.push(op); assert.equal(op, "confirm_mapping"); assert.equal(mapped, false);
      assert.equal(request.mappingFingerprint, fp(["confirm-mapping-v1", p.permitId, actor.actorId, actor.sessionId,
        p.expectedMerchantId, p.expectedLocationId, 3]));
      mapped = true; if (options.lostMapping) throw new Error("lost mapping ack");
      return { permitId: p.permitId, state: "mapped", mappingFingerprint: request.mappingFingerprint, auditFingerprint: fp(["audit"]) };
    } });
    const runtime = createInternalPaymentsRuntime({ ...base, readPage: async request => {
      const page = await broker(request); pages.push(page); return page;
    }, runtimeRpc: async (op, request) => {
      checkAuthority(); calls.push(op);
      const scanFp = fp(["create-scan-v1", p.permitId, c.scanId, c.taskId, c.paymentWindowStart, c.paymentWindowEnd, c.leaseOwnerFingerprint, 4]);
      if (op === "create_scan") {
        assert.equal(mapped, true); assert.equal(prepared, false); prepared = true;
        assert.equal(request.requestFingerprint, scanFp);
        if (options.lostPrepare) throw new Error("lost scan ack");
        return { permitId: p.permitId, scanId: c.scanId, taskId: c.taskId, status: "ready", stream: "payments", operation: "list_payments", auditFingerprint: fp(["audit"]) };
      }
      if (op === "acquire_page") {
        assert.equal(prepared, true); assert.equal(request.workspaceId, actor.workspaceId); assert.equal(request.businessEntityId, actor.businessEntityId);
        assert.equal(request.actorId, actor.actorId); assert.equal(request.sessionId, actor.sessionId); assert.equal(request.generation, p.generation);
        assert.equal(request.scanRequestFingerprint, scanFp);
        assert.equal(request.requestFingerprint, fp(["acquire-page-v2", c.scanId, c.leaseId, c.leaseOwnerFingerprint, scanFp,
          p.permitId, actor.workspaceId, actor.businessEntityId, actor.actorId, actor.sessionId, p.generation, 1]));
        if (committed) return { permitId: p.permitId, scanId: c.scanId, status: "committed", replayed: true };
        const replayed = leased || !!options.leasedReplay; leased = true;
        return { permitId: p.permitId, scanId: c.scanId, status: "leased", replayed, leaseId: c.leaseId,
          leaseExpiresAt: "2026-09-24T12:02:00+00:00", method: "GET", path: "/v2/payments",
          beginTime: "2026-09-24T10:00:00+00:00", endTime: "2026-09-24T11:00:00+00:00", continuationAllowed: false,
          requestFingerprint: request.requestFingerprint, ...options.leaseChange };
      }
      assert.equal(op, "commit_page"); assert.equal(request.continuation, false);
      const pageId = fp(["payments-page-v1", c.scanId, request.responseFingerprint]); assert.equal(request.pageId, pageId);
      const rows = request.observations.map(row => {
        assert.equal(row.sourceFingerprint, fp(["payment-observation-v1", c.scanId, pageId, row.ordinal, row.paymentFingerprint,
          row.versionFingerprint, row.locationFingerprint, row.paymentStatus, row.occurredAt, row.observedAt]));
        return fp(["page-observation-v1", row.sourceVersionId, row.ordinal, row.paymentFingerprint, row.versionFingerprint,
          row.locationFingerprint, row.paymentStatus, row.occurredAt, row.observedAt, row.sourceFingerprint]);
      });
      const resultFingerprint = fp(["page-result-v2", c.scanId, pageId, rows.join(",")]);
      assert.equal(request.commandFingerprint, fp(["commit-page-v1", c.scanId, c.leaseId, pageId, request.responseFingerprint, resultFingerprint, "false"]));
      const replayed = !!committed;
      if (committed) assert.deepEqual(request, committed, "lost_ack_reuses_exact_commit_payload"); else committed = structuredClone(request);
      if (options.lostCommit && !replayed) throw new Error("lost commit ack");
      return { permitId: p.permitId, scanId: c.scanId, pageId, status: "committed", commandFingerprint: request.commandFingerprint, replayed,
        ...(replayed ? {} : { resultFingerprint, observationCount: request.observations.length }) };
    } });
    const evidence = createInternalEvidence({ ...base, evidenceRpc: async (op, request) => {
      checkAuthority(); calls.push(op); assert.equal(op, "read"); assert.ok(committed);
      assert.equal(request.requestFingerprint, fp(["read-evidence-v1", p.permitId, p.generation, p.configurationFingerprint, 6,
        actor.workspaceId, actor.businessEntityId, actor.actorId, actor.sessionId]));
      return { permitId: p.permitId, generation: p.generation, configurationFingerprint: p.configurationFingerprint, rowVersion: 6,
        state: "synced", fenced: false, runtimeEnabled: false, providerCallsEnabled: false, customerOnboardingEnabled: false,
        webhookIntakeEnabled: false, economicContributionsEnabled: false, aiDispatchEnabled: false,
        scanCount: 1, pageReceiptCount: 1, credentialVersionCount: 1, observationCount: committed.observations.length,
        privateDiagnostic: "must_not_escape" };
    } });
    return { mapping, runtime, broker, evidence, calls, pages, count: () => responseCount, cleared: () => decrypted.every(x => x === 0) };
  }
  for (const options of [{}, { lostCommit: true }, { empty: true }]) {
    const f = fixture(options);
    await f.mapping(actor); await f.runtime({ action: "prepare", actor });
    const result = await f.runtime({ action: "read", actor });
    assert.equal(result.observationCount, options.empty ? 0 : 1); assert.equal(f.count(), 1);
    assert.equal((await f.runtime({ action: "read", actor })).replayed, true); assert.equal(f.count(), 1);
    const evidence = await f.evidence(actor); assert.equal(evidence.observationCount, options.empty ? 0 : 1);
    assert.equal(evidence.historicalCompleteness, "unknown"); assert.equal(evidence.economicContributions, false);
    assert.doesNotMatch(JSON.stringify([result, evidence, f.pages]), /synthetic_private|SYNTHETIC_PAYMENT|synthetic_next_page|must_not_escape|amountMoney/);
    assert.equal(f.cleared(), true, "decrypted_bytes_cleared");
  }
  for (const field of ["actorId", "sessionId", "workspaceId", "businessEntityId"]) {
    const f = fixture(), foreign = { ...actor, [field]: randomUUID() };
    await assert.rejects(() => f.mapping(foreign)); await assert.rejects(() => f.runtime({ action: "read", actor: foreign }));
    await assert.rejects(() => f.evidence(foreign)); assert.deepEqual(f.calls, []);
  }
  for (const options of [{ leasedReplay: true }, { paymentChange: { location_id: "OTHER_LOCATION" } },
    { paymentChange: { id: null } }, { paymentChange: { created_at: null } },
    { credentialChange: { externalAuthorizedEntityReference: "OTHER_SELLER" } }, { storedChange: { credentialVersion: 2 } },
    { leaseChange: { beginTime: "2026-09-24T10:01:00+00:00" } }, { storedChange: { accessExpiresAt: "2026-09-24T11:00:00+00:00" } }]) {
    const f = fixture(options); await f.mapping(actor); await f.runtime({ action: "prepare", actor });
    await assert.rejects(() => f.runtime({ action: "read", actor }));
    assert.equal(f.calls.includes("commit_page"), false);
    if (options.leasedReplay || options.credentialChange || options.storedChange) assert.equal(f.count(), 0);
  }
  for (const [option, action] of [["lostMapping", "map"], ["lostPrepare", "prepare"]]) {
    const f = fixture({ [option]: true });
    if (action === "prepare") await f.mapping(actor);
    await assert.rejects(() => action === "map" ? f.mapping(actor) : f.runtime({ action, actor }));
    assert.equal(f.calls.filter(x => x === (action === "map" ? "confirm_mapping" : "create_scan")).length, 1);
    assert.equal(f.count(), 0);
  }
  const revoke = {}; const f = fixture(revoke); await f.mapping(actor); await f.runtime({ action: "prepare", actor });
  revoke.revoked = true; await assert.rejects(() => f.runtime({ action: "read", actor })); assert.equal(f.count(), 0);
  for (const profile of ["runtime", "evidence"]) {
    const seen = [];
    const rpc = createInternalRpc(profile, async () => ({ query: async sql => {
      seen.push(sql); return sql.startsWith("select session_user") ? { rows: [{ login: `square_production_${profile}`, current_login: `square_production_${profile}` }] } : { rows: [{ value: {} }] };
    }, end: async () => seen.push("closed") }));
    await rpc(profile === "runtime" ? "acquire_page" : "read", {});
    assert.equal(seen[1], `set role square_production_${profile}_authority`);
    assert.equal(seen[2], `select public.square_production_internal_${profile}_v1($1::text,$2::jsonb) as value`);
    assert.equal(seen[3], "closed"); await assert.rejects(() => rpc("read_credential", {}), /operation_denied/);
  }
  let invoked = 0;
  const server = createInternalConsentServer({ profile: "runtime", runtime: async raw => { invoked++; return { status: raw.action }; },
    authenticateOAuthService: async request => request.headers.get("authorization") === "Bearer synthetic_authenticated_service" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/internal/square/runtime/manual`;
    assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal(invoked, 0);
    const ok = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic_authenticated_service" }, body: JSON.stringify({ action: "read", actor }) });
    assert.deepEqual(await ok.json(), { status: "read" }); assert.equal(invoked, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log("Square manual Production handlers: mapping, one page, exact replay/lost-ack, tenant/seller/session denial, minimized evidence, zero AI: passed");
};
