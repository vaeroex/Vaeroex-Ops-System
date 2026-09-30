import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Same Google JWKS / JOSE verifier used by the reviewed customer broker. Never
// authorize from Cloud Run's stripped X-Serverless-Authorization JWT payload.
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5_000 });
const callers: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  credential_broker: {
    "/oauth/complete": "QBO_OAUTH_INGRESS_SERVICE_ACCOUNT",
    "/oauth/denied": "QBO_OAUTH_INGRESS_SERVICE_ACCOUNT",
    "/webhooks/verify": "QBO_OAUTH_INGRESS_SERVICE_ACCOUNT",
    "/credentials/read": "QBO_PROVIDER_RUNTIME_SERVICE_ACCOUNT",
    "/credentials/refresh": "QBO_PROVIDER_RUNTIME_SERVICE_ACCOUNT",
    "/credentials/revoke-pending": "QBO_TASK_SCHEDULER_SERVICE_ACCOUNT"
  },
  provider_runtime: {
    "/tasks/execute": "QBO_RUNTIME_INVOKER_SERVICE_ACCOUNT",
    "/tasks/validate-pending": "QBO_TASK_SCHEDULER_SERVICE_ACCOUNT"
  },
  task_scheduler: { "/tasks/schedule": "QBO_INITIALIZATION_SCHEDULER_SERVICE_ACCOUNT" },
  task_dispatcher: { "/tasks/dispatch": "QBO_DISPATCH_SCHEDULER_SERVICE_ACCOUNT" }
};

/** Environment/key resolution are trusted server composition, never request inputs. */
export function createQboInternalOperationAuthorizer(
  environment: Readonly<Record<string, string | undefined>>,
  keys: JWTVerifyGetKey = googleKeys
) {
  return async (input: {
    mode: string; method: string | undefined; url: URL;
    headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    rawHeaders: readonly string[];
  }): Promise<boolean> => {
    try {
      const caller = callers[input.mode]?.[input.url.pathname];
      if (!caller || input.method !== "POST" || input.url.search || input.url.hash) return false;
      const audience = environment.QBO_SERVICE_AUDIENCE;
      if (!audience || new URL(audience).origin !== audience || !audience.startsWith("https://")) return false;
      const expected = environment[caller];
      if (!expected || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(expected)) return false;
      const authorization = input.headers.authorization;
      if (typeof authorization !== "string" || authorization.length > 16_384 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization)) return false;
      let count = 0;
      for (let index = 0; index < input.rawHeaders.length; index += 2) {
        if (input.rawHeaders[index].toLowerCase() === "authorization") count++;
      }
      if (count !== 1) return false;
      const { payload } = await jwtVerify(authorization.slice(7), keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"], audience, algorithms: ["RS256"],
        requiredClaims: ["iat", "exp", "sub", "email", "email_verified"], maxTokenAge: "1 hour", clockTolerance: 0
      });
      return payload.aud === audience && payload.email === expected && payload.email_verified === true &&
        typeof payload.sub === "string" && /^[0-9]{1,32}$/.test(payload.sub) &&
        Number.isSafeInteger(payload.iat) && Number.isSafeInteger(payload.exp) &&
        payload.exp! > payload.iat! && payload.exp! - payload.iat! <= 3_900;
    } catch { return false; }
  };
}
