"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Pure offline diagnostic allowlist tests. */
const assert = require("node:assert/strict");
// No fixture, database, filesystem credential input or connection is created.
delete process.env.VAEROEX_NATIVE_TEST_DEPENDENCIES;
const { connectionFailureStage } = require("./fixture.cjs");
const marker = "SYNTHETIC_SENSITIVE_VALUE_DO_NOT_EMIT";
const cases = [
  ["28P01", "password_rejected"], ["28000", "login_rejected"], ["42501", "permission_rejected"], ["53300", "connection_capacity"],
  ["57P01", "server_shutdown"], ["57P02", "server_restarting"], ["57P03", "server_not_ready"],
  ["ECONNREFUSED", "connection_refused"], ["ECONNRESET", "connection_reset"], ["ETIMEDOUT", "connection_timeout"],
  ["EPIPE", "connection_closed"], ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_identity"],
  ["CERT_HAS_EXPIRED", "tls_expired"], ["CERT_NOT_YET_VALID", "tls_not_yet_valid"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls_trust"], ["SELF_SIGNED_CERT_IN_CHAIN", "tls_trust"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls_trust"]
];
let assertions = 0;
for (const [code, category] of cases) for (const transport of ["tls", "socket"]) {
  const error = new Error(marker); error.code = code; error.detail = marker; error.password = marker;
  const result = connectionFailureStage(error, transport, "candidate");
  assert.equal(result, `local_connect_${transport}_candidate_${category}`);
  assert.match(result, /^[a-z_0-9]+$/); assert(!result.includes(marker)); assertions += 3;
}
assert.equal(connectionFailureStage(new Error("timeout expired"), "tls", "candidate"), "local_connect_tls_candidate_connection_timeout");
assert.equal(connectionFailureStage(new Error(`timeout expired ${marker}`), "tls", "candidate"), "local_connect_tls_candidate_unclassified");
for (const value of [undefined, null, marker, { code: marker, message: marker }, { code: "ZZZZZ", message: marker }]) {
  assert.equal(connectionFailureStage(value, marker, marker), "local_connect_unknown_other_unclassified"); assertions++;
}
const accessor = { get code() { throw Error("must_not_evaluate"); }, get message() { throw Error("must_not_evaluate"); } };
assert.equal(connectionFailureStage(accessor, "socket", "admin"), "local_connect_socket_admin_unclassified"); assertions += 3;
console.log(JSON.stringify({ suite: "native_connection_diagnostic_allowlist", passed: true, assertions, rawDiagnosticsEmitted: false, connectionsAttempted: 0 }));
