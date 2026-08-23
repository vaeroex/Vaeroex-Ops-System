export const PHASE_5_LEAKAGE_CANARIES = {
  accessToken: "vaeroex_fake_access_token_CANARY_5A7C",
  refreshToken: "vaeroex_fake_refresh_token_CANARY_8D2F",
  authorizationCode: "vaeroex_fake_authorization_code_CANARY_4B1E",
  clientSecret: "vaeroex_fake_client_secret_CANARY_9C6D"
} as const;

const credentialShapes = [
  /(?:access|refresh)[_-]?token["'\s:=]+[^\s"']+/gi,
  /authorization[_-]?code["'\s:=]+[^\s"']+/gi,
  /client[_-]?secret["'\s:=]+[^\s"']+/gi,
  /bearer\s+[A-Za-z0-9._~+/-]+/gi
];

export function redactCredentialMaterial(value: unknown) {
  let redacted = String(value ?? "credential_operation_failed");
  for (const canary of Object.values(PHASE_5_LEAKAGE_CANARIES)) {
    redacted = redacted.split(canary).join("[redacted]");
  }
  for (const pattern of credentialShapes) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

export function assertNoCredentialLeakage(value: unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (
    Object.values(PHASE_5_LEAKAGE_CANARIES).some((canary) =>
      serialized.includes(canary)
    )
  ) {
    throw new Error("credential_leakage_canary_detected");
  }
  return true;
}

export function safeCredentialBrokerError(reasonCode: string) {
  const allowed = new Set([
    "oauth_state_rejected",
    "authorization_failed",
    "refresh_not_acquired",
    "refresh_failed",
    "reauthorization_required",
    "credential_read_failed",
    "disconnect_completed"
  ]);
  return allowed.has(reasonCode)
    ? reasonCode
    : "credential_operation_failed";
}
