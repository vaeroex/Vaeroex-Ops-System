import "server-only";

import { z } from "zod";
import {
  QBO_OAUTH_CALLBACK_HANDOFF_HEADERS,
  sanitizedQboOAuthConfirmationUrl
} from "@/lib/integrations/provider-runtime/qbo/callback-handoff";
import { normalizeProviderOAuthReturnPath } from "@/lib/integrations/credentials/oauth-policy";
import { QBO_PRODUCTION_OAUTH_POLICY } from "@/lib/integrations/provider-runtime/qbo/oauth-policy";

export const QBO_PRODUCTION_DENIED_HANDOFF_VERSION = "qbo_oauth_denied_handoff_v1";
const deniedCallback = z.object({
  state: z.string().regex(/^(?:i1_|r1_)[A-Za-z0-9_-]{43}$/),
  error: z.literal("access_denied")
}).strict();

export function parseQboProductionDeniedHandoff(input: {
  method: string; requestUrl: string;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  rawHeaders: readonly string[];
}) {
  const names = QBO_OAUTH_CALLBACK_HANDOFF_HEADERS;
  if (input.headers[names.version] !== QBO_PRODUCTION_DENIED_HANDOFF_VERSION) return null;
  const counts = new Map<string, number>();
  if (input.rawHeaders.length % 2 !== 0) throw new Error("qbo_production_denied_handoff_invalid");
  for (let index = 0; index < input.rawHeaders.length; index += 2) {
    const name = input.rawHeaders[index].toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (input.method !== "GET" || input.requestUrl !== "/oauth/callback" ||
    counts.get(names.version) !== 1 || counts.get(names.state) !== 1 ||
    counts.has(names.code) || counts.has(names.realmId) ||
    input.headers[names.code] !== undefined || input.headers[names.realmId] !== undefined ||
    input.headers["transfer-encoding"] !== undefined || input.headers.expect !== undefined ||
    (counts.get("content-length") ?? 0) > 1 ||
    (input.headers["content-length"] !== undefined && input.headers["content-length"] !== "0")) {
    throw new Error("qbo_production_denied_handoff_invalid");
  }
  const parsed = deniedCallback.safeParse({ state: input.headers[names.state], error: "access_denied" });
  if (!parsed.success) throw new Error("qbo_production_denied_handoff_invalid");
  return parsed.data;
}

/** The fixed denial classification is encoded by the edge version, not by an
 * arbitrary provider error header. Only the broker consumes the bound state. */
export async function completeQboProductionDeniedHandoff(input: {
  callback: z.infer<typeof deniedCallback>; applicationOrigin: string;
  callBroker: (path: string, body: unknown) => Promise<unknown>;
}) {
  try {
    const callback = deniedCallback.parse(input.callback);
    const result = z.object({ outcome: z.literal("denied"), returnIntent: z.string().max(512) }).strict().parse(
      await input.callBroker("/oauth/denied", callback)
    );
    const path = normalizeProviderOAuthReturnPath(QBO_PRODUCTION_OAUTH_POLICY, result.returnIntent);
    const origin = new URL(input.applicationOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash) {
      throw new Error("qbo_production_return_origin_invalid");
    }
    const target = new URL(path, origin);
    if (target.origin !== origin.origin) throw new Error("qbo_production_return_intent_invalid");
    return sanitizedQboOAuthConfirmationUrl(target.toString());
  } catch {
    throw new Error("qbo_production_denied_callback_rejected");
  }
}
