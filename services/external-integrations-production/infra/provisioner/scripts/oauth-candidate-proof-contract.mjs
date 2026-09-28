// Only the retained candidate from PR #435. Not a general secret-read mode.
export const OAUTH_PROOF_MODE = "oauth_candidate_proof";
export const OAUTH_PROOF_ROLE = "projects/vaeroex-integrations-prod/roles/squareProductionOAuthCandidateProof";
export const OAUTH_PROOF_VERSION = "projects/711446392261/secrets/square-production-oauth-db/versions/1";
export const OAUTH_PROOF_PERMISSIONS = Object.freeze(["secretmanager.versions.access", "secretmanager.versions.get"]);
export const OAUTH_PROOF_TITLE = "bounded-oauth-existing-candidate-proof";
export const OAUTH_PROOF_DESCRIPTION = "Only retained OAuth version 1 during the separately authorized proof window.";

export function privateAccessMode(value) {
  if (value === undefined || value === "provision") return "provision";
  if (value === OAUTH_PROOF_MODE) return value;
  const error = new Error("private_access_mode_invalid");
  error.fixedLabel = "private_access_mode_invalid";
  throw error;
}

export function oauthProofCondition(start, expiry) {
  return `resource.service == 'secretmanager.googleapis.com' && resource.type == 'secretmanager.googleapis.com/SecretVersion' && resource.name == '${OAUTH_PROOF_VERSION}' && request.time >= timestamp('${start}') && request.time < timestamp('${expiry}')`;
}
