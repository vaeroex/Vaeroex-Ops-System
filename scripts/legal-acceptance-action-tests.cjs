/* eslint-disable @typescript-eslint/no-require-imports -- Offline tests execute the actual server action with isolated server dependency mocks. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { installLoader, id, ids } = require("./qbo-customer-test-support.cjs");

const consentFields = ["accept_terms", "accept_privacy", "accept_ai", "accept_sensitive"];
const successRedirect = "/app?message=Vaeroex policy acceptance recorded.";
const missingConsentRedirect = "/app?error=Please review and accept all required Vaeroex policies.";
const unavailableRedirect = "/app?error=We could not confirm policy acceptance. Reload before trying again.";
const workspaceChangedRedirect = "/app?error=Your workspace access changed. Reload before accepting policies.";
const privateMarker = "SYNTHETIC-PRIVATE-ERROR-NOT-FOR-OUTPUT";
const sensitiveError = {
  code: "42501",
  message: `${privateMarker}: permission denied for table legal_acceptances; synthetic-actor@example.test`,
  details: `select secret from private.example; ${ids.session}`,
  hint: "Synthetic credential: never-return-this"
};

class Redirect extends Error {
  constructor(location) {
    super("Expected Next.js redirect");
    this.location = location;
  }
}

let state;
const serverClient = {
  auth: {
    async getUser() {
      state.events.push("getUser");
      if (state.userThrows) throw state.userThrows;
      return { data: { user: state.user }, error: state.userError };
    },
    async getClaims() {
      state.events.push("getClaims");
      if (state.claimsThrows) throw state.claimsThrows;
      return state.claimsResponse;
    }
  },
  from(table) {
    state.forbiddenCalls.push({ kind: "server.from", table });
    throw new Error("Direct table access is forbidden in this action test");
  },
  rpc(name) {
    state.forbiddenCalls.push({ kind: "server.rpc", name });
    throw new Error("Acceptance must use only the protected server-only admin RPC");
  }
};
const adminClient = {
  async rpc(name, args) {
    state.events.push("rpc");
    state.rpcCalls.push({ name, args });
    assert.equal(name, "record_trusted_in_app_legal_acceptance_v2", "No legacy or fallback writer is permitted");
    if (state.rpcThrows) throw state.rpcThrows;
    return { data: state.rpcData, error: state.rpcError };
  },
  from(table) {
    state.forbiddenCalls.push({ kind: "admin.from", table });
    throw new Error("Direct admin table access is forbidden");
  }
};

installLoader({
  "next/headers": { headers: async () => {
    state.events.push("headers");
    if (state.headersThrows) throw state.headersThrows;
    return new Headers(state.headerValues);
  } },
  "next/cache": { revalidatePath: path => state.revalidated.push(path) },
  "next/navigation": { redirect: location => { throw new Redirect(location); } },
  "@/lib/supabase/server": { createSupabaseServerClient: async () => {
    state.events.push("serverClient");
    return state.serverAvailable ? serverClient : null;
  } },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => {
    state.events.push("adminClient");
    if (state.adminThrows) throw state.adminThrows;
    return state.adminAvailable ? adminClient : null;
  } },
  "@/lib/workspaces/current": { getWorkspaceContext: async (...args) => {
    state.events.push("workspaceContext");
    state.contextCalls.push(args);
    if (state.contextThrows) throw state.contextThrows;
    return state.context;
  } }
});
const { acceptLegalPoliciesAction } = require("../app/app/legal/actions.ts");
const { LEGAL_DOCUMENT_VERSIONS } = require("../lib/legal/content.ts");

test.beforeEach(t => {
  state = {
    user: { id: ids.actor, email: "synthetic-actor@example.test" },
    userError: null,
    claimsResponse: { data: { claims: { sub: ids.actor, session_id: ids.session } }, error: null },
    context: {
      profile: { id: ids.actor, email: "untrusted-profile@example.test" },
      workspaces: [{ id: ids.workspace }],
      activeWorkspace: { id: ids.workspace },
      membership: { user_id: ids.actor, workspace_id: ids.workspace, status: "active", role: "viewer" }
    },
    serverAvailable: true,
    adminAvailable: true,
    rpcData: id(99),
    rpcError: null,
    headerValues: { "user-agent": "Synthetic legal acceptance test", "x-forwarded-for": "192.0.2.10, 192.0.2.11" },
    events: [], rpcCalls: [], forbiddenCalls: [], contextCalls: [], revalidated: [], logs: [], networkCalls: []
  };
  for (const method of ["error", "warn", "log", "info", "debug"]) {
    t.mock.method(console, method, (...args) => state.logs.push({ method, args }));
  }
  t.mock.method(globalThis, "fetch", async (...args) => {
    state.networkCalls.push(args);
    throw new Error("Network access is forbidden in this credential-free test");
  });
});

test.afterEach(() => {
  assert.deepEqual(state.forbiddenCalls, [], "No direct insert, legacy RPC, or alternate writer may execute");
  assert.deepEqual(state.networkCalls, [], "No real service or model calls may execute");
});

function acceptedForm() {
  const form = new FormData();
  for (const field of consentFields) form.set(field, "on");
  return form;
}

async function submit(form = acceptedForm()) {
  try {
    await acceptLegalPoliciesAction(form);
    assert.fail("The action must finish with a redirect");
  } catch (error) {
    if (!(error instanceof Redirect)) throw error;
    return error.location;
  }
}

function assertNoWriter() {
  assert.equal(state.events.includes("adminClient"), false, "Do not create a privileged writer before validation");
  assert.deepEqual(state.rpcCalls, []);
  assert.deepEqual(state.revalidated, []);
}

function assertSafeFailure(location, expected = unavailableRedirect) {
  assert.equal(location, expected, "Preserve the bounded redirect for this failure category");
  assert.ok(location.length < 400, "Failure redirects must be bounded");
  const output = decodeURIComponent(location) + JSON.stringify(state.logs);
  for (const forbidden of [privateMarker, "permission denied", "legal_acceptances", "42501", "select secret", "never-return-this",
    state.user?.email, "untrusted-profile@example.test", ids.actor, ids.session, ids.workspace].filter(Boolean)) {
    assert.equal(output.includes(forbidden), false, `Failure output must not expose synthetic private metadata: ${forbidden}`);
  }
  assert.deepEqual(state.revalidated, []);
}

function expectedArgs(workspaceId = ids.workspace) {
  return {
    p_user_id: ids.actor,
    p_workspace_id: workspaceId,
    p_user_email: state.user.email,
    p_terms_version: LEGAL_DOCUMENT_VERSIONS.terms,
    p_privacy_version: LEGAL_DOCUMENT_VERSIONS.privacy,
    p_ai_disclaimer_version: LEGAL_DOCUMENT_VERSIONS.aiDisclaimer,
    p_sensitive_data_policy_version: LEGAL_DOCUMENT_VERSIONS.sensitiveData,
    p_user_agent: "Synthetic legal acceptance test",
    p_ip_address: "192.0.2.10",
    p_session_id: ids.session
  };
}

test("active viewer submits explicit consent through the protected v2 function with verified server context", async () => {
  assert.equal(await submit(), successRedirect);
  assert.deepEqual(state.rpcCalls, [{ name: "record_trusted_in_app_legal_acceptance_v2", args: expectedArgs() }]);
  assert.deepEqual(state.contextCalls, [[undefined, { supabase: serverClient, user: state.user }]]);
  assert.deepEqual(state.revalidated, ["/app"]);
  assert.ok(state.events.indexOf("getUser") < state.events.indexOf("getClaims"));
  assert.ok(state.events.indexOf("getClaims") < state.events.indexOf("workspaceContext"));
  assert.ok(state.events.indexOf("workspaceContext") < state.events.indexOf("adminClient"));
});

for (const field of consentFields) {
  for (const value of [null, "", "true", "ON", "off"]) {
    test(`${field} ${value === null ? "missing" : `set to ${JSON.stringify(value)}`} rejects before authentication or writes`, async () => {
      const form = acceptedForm();
      if (value === null) form.delete(field); else form.set(field, value);
      assert.equal(await submit(form), missingConsentRedirect);
      assert.deepEqual(state.events, []);
      assertNoWriter();
    });
  }
}

test("a file upload cannot stand in for checked consent", async () => {
  const form = acceptedForm();
  form.set("accept_terms", new Blob(["on"], { type: "text/plain" }), "consent.txt");
  assert.equal(await submit(form), missingConsentRedirect);
  assert.deepEqual(state.events, []);
  assertNoWriter();
});

test("form-controlled actor, workspace, session, email, and legal versions cannot override server facts", async () => {
  const form = acceptedForm();
  for (const field of ["user_id", "workspace_id", "session_id", "p_user_id", "p_workspace_id", "p_session_id"]) form.set(field, id(555));
  for (const field of ["terms_version", "privacy_version", "ai_disclaimer_version", "sensitive_data_policy_version",
    "p_terms_version", "p_privacy_version", "p_ai_disclaimer_version", "p_sensitive_data_policy_version"]) form.set(field, "forged-version");
  form.set("user_email", "forged@example.test");
  form.set("p_user_email", "forged@example.test");
  assert.equal(await submit(form), successRedirect);
  assert.deepEqual(state.rpcCalls[0].args, expectedArgs());
  assert.equal(state.rpcCalls.length, 1);
});

test("verified account without active workspace uses the existing null-workspace RPC path", async () => {
  state.context = { profile: null, workspaces: [], activeWorkspace: null, membership: null };
  assert.equal(await submit(), successRedirect);
  assert.deepEqual(state.rpcCalls[0].args, expectedArgs(null));
  assert.equal(state.rpcCalls.length, 1);
});

const authFailures = [
  ["server client unavailable", () => { state.serverAvailable = false; }, "/app?error=Supabase is not configured."],
  ["user missing", () => { state.user = null; }],
  ["verified actor UUID missing", () => { delete state.user.id; }],
  ["verified actor UUID malformed", () => { state.user.id = "not-a-uuid"; }],
  ["getUser returns error even alongside a user", () => { state.userError = sensitiveError; }],
  ["getUser throws", () => { state.userThrows = sensitiveError; }, unavailableRedirect],
  ["verified user email missing instead of falling back to profile email", () => { delete state.user.email; }],
  ["verified user email empty", () => { state.user.email = ""; }],
  ["verified user email whitespace", () => { state.user.email = "  "; }],
  ["claims response missing data", () => { state.claimsResponse = { data: null, error: null }; }],
  ["claims missing", () => { state.claimsResponse = { data: { claims: null }, error: null }; }],
  ["claims property absent", () => { state.claimsResponse = { data: {}, error: null }; }],
  ["claims verification error", () => { state.claimsResponse.error = sensitiveError; }],
  ["getClaims throws", () => { state.claimsThrows = sensitiveError; }, unavailableRedirect],
  ["claims have wrong subject", () => { state.claimsResponse.data.claims.sub = id(444); }],
  ["claims have no subject", () => { delete state.claimsResponse.data.claims.sub; }],
  ["claims have no session", () => { delete state.claimsResponse.data.claims.session_id; }],
  ["claims have non-UUID session", () => { state.claimsResponse.data.claims.session_id = "invalid-session"; }],
  ["claims have numeric session", () => { state.claimsResponse.data.claims.session_id = 123; }]
];
for (const [name, change, expected = "/login"] of authFailures) {
  test(`${name} fails closed without creating a privileged client`, async () => {
    change();
    assertSafeFailure(await submit(), expected);
    assertNoWriter();
  });
}

const contextFailures = [
  ["missing membership", () => { state.context.membership = null; }],
  ["disabled membership", () => { state.context.membership.status = "disabled"; }],
  ["pending membership", () => { state.context.membership.status = "invited"; }],
  ["membership belongs to another user", () => { state.context.membership.user_id = id(444); }],
  ["membership belongs to another workspace", () => { state.context.membership.workspace_id = id(444); }],
  ["active workspace UUID malformed", () => { state.context.activeWorkspace.id = "not-a-uuid"; }],
  ["membership exists without active workspace", () => { state.context.activeWorkspace = null; }],
  ["workspace resolution throws", () => { state.contextThrows = sensitiveError; }, unavailableRedirect]
];
for (const [name, change, expected = workspaceChangedRedirect] of contextFailures) {
  test(`${name} rejects before privileged writer creation`, async () => {
    change();
    assertSafeFailure(await submit(), expected);
    assertNoWriter();
  });
}

test("request-header failure is bounded and occurs before writer creation", async () => {
  state.headersThrows = sensitiveError;
  assertSafeFailure(await submit());
  assertNoWriter();
});

test("missing admin configuration fails safely after validation without any writer invocation", async () => {
  state.adminAvailable = false;
  assertSafeFailure(await submit());
  assert.equal(state.events.filter(event => event === "adminClient").length, 1);
  assert.deepEqual(state.rpcCalls, []);
});

test("admin initialization failure is bounded and does not leak errors or invoke fallback writes", async () => {
  state.adminThrows = sensitiveError;
  assertSafeFailure(await submit());
  assert.deepEqual(state.rpcCalls, []);
});

for (const [name, change] of [
  ["RPC denies expired session", () => { state.rpcError = { ...sensitiveError, message: `${privateMarker}: live session required` }; }],
  ["RPC denies changed workspace access", () => { state.rpcError = sensitiveError; }],
  ["RPC denies policy version", () => { state.rpcError = { ...sensitiveError, code: "22023", message: `${privateMarker}: invalid policy version` }; }],
  ["RPC throws operational error", () => { state.rpcThrows = sensitiveError; }]
]) {
  test(`${name} remains a safe failure with exactly one attempted protected call and no retry`, async () => {
    change();
    assertSafeFailure(await submit());
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.events.filter(event => event === "adminClient").length, 1);
  });
}

for (const result of [null, undefined, "", "not-a-uuid", 1, true, { id: id(99) }, [id(99)]]) {
  test(`malformed protected RPC result ${JSON.stringify(result)} cannot claim successful acceptance`, async () => {
    state.rpcData = result;
    assertSafeFailure(await submit());
    assert.equal(state.rpcCalls.length, 1);
  });
}

test("request metadata remains optional and x-real-ip is used only when forwarded-for is absent", async () => {
  state.headerValues = { "x-real-ip": "192.0.2.12" };
  assert.equal(await submit(), successRedirect);
  assert.equal(state.rpcCalls[0].args.p_user_agent, null);
  assert.equal(state.rpcCalls[0].args.p_ip_address, "192.0.2.12");
});

test("request metadata absent stays null", async () => {
  state.headerValues = {};
  assert.equal(await submit(), successRedirect);
  assert.equal(state.rpcCalls[0].args.p_user_agent, null);
  assert.equal(state.rpcCalls[0].args.p_ip_address, null);
});

test("repeated explicit submissions each make one protected call, while later missing consent makes none", async () => {
  assert.equal(await submit(), successRedirect);
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(await submit(), successRedirect);
  assert.equal(state.rpcCalls.length, 2);
  assert.equal(await submit(new FormData()), missingConsentRedirect);
  assert.equal(state.rpcCalls.length, 2);
  assert.deepEqual(state.revalidated, ["/app", "/app"]);
});
