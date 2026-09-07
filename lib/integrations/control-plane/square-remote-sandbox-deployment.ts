import "server-only";

import { getVercelOidcTokenSync } from "@vercel/oidc";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { SQUARE_REMOTE_SANDBOX, type SquareRemoteSandboxBinding } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";

const TEAM_SLUG = "vaeroex-2167s-projects";
const issuer = `https://oidc.vercel.com/${TEAM_SLUG}`;
// Fixed public signing-key origin, never derived from JWT jku/iss or input URLs.
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), {
  timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 300_000
});

export function assertSquareRemoteSandboxDeploymentClaims(binding: SquareRemoteSandboxBinding, payload: JWTPayload, now = Date.now()) {
  if (binding.vercelTeamSlug !== TEAM_SLUG || payload.iss !== issuer ||
    payload.aud !== `https://vercel.com/${TEAM_SLUG}` ||
    payload.sub !== `owner:${TEAM_SLUG}:project:${SQUARE_REMOTE_SANDBOX.vercelProjectName}:environment:production` ||
    payload.owner !== TEAM_SLUG || payload.owner_id !== SQUARE_REMOTE_SANDBOX.vercelTeamId ||
    payload.project !== SQUARE_REMOTE_SANDBOX.vercelProjectName || payload.project_id !== binding.vercelProjectId ||
    payload.environment !== "production" ||
    !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
    payload.iat! * 1_000 > now || payload.exp! * 1_000 <= now || payload.exp! - payload.iat! > 7_200 ||
    process.env.VERCEL_PROJECT_ID !== binding.vercelProjectId) throw new Error("square_remote_deployment_denied");
}

/** Vercel's production target here belongs ONLY to the dedicated Sandbox project.
 * This is not Square Production. Every request verifies a signed short-lived
 * platform token, and the DB independently approves that exact project ID. */
export async function verifySquareRemoteSandboxDeployment(binding: SquareRemoteSandboxBinding) {
  try {
    // Use only the platform's current request token. The async convenience API
    // can refresh through a local developer CLI; that fallback is not authority
    // for a deployed Sandbox and must not read any developer authentication.
    const token = getVercelOidcTokenSync();
    if (typeof token !== "string" || token.length > 16_384) throw new Error();
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience: `https://vercel.com/${TEAM_SLUG}`,
      subject: `owner:${TEAM_SLUG}:project:${SQUARE_REMOTE_SANDBOX.vercelProjectName}:environment:production`,
      algorithms: ["RS256"], requiredClaims: ["iat", "exp", "sub", "aud", "iss", "project_id", "owner_id", "environment"],
      // Current Vercel Function tokens live two hours; build tokens live one.
      maxTokenAge: "2 hours", clockTolerance: 0
    });
    assertSquareRemoteSandboxDeploymentClaims(binding, payload);
    // Return privately to the exact approved WIF exchange. Never serialize/log it.
    return token;
  } catch { throw new Error("square_remote_deployment_denied"); }
}
