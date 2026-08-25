import { z } from "zod";

import { BoundedIdentifierSchema } from "@/lib/integrations/contracts/primitives";

export const QBO_OAUTH_CALLBACK_HANDOFF_VERSION =
  "qbo_oauth_callback_handoff_v1" as const;
export const QBO_OAUTH_CALLBACK_HANDOFF_HEADERS = {
  version: "x-vaeroex-oauth-handoff-version",
  code: "x-vaeroex-oauth-code",
  state: "x-vaeroex-oauth-state",
  realmId: "x-vaeroex-oauth-realm-id"
} as const;

const CallbackHandoffSchema = z
  .object({
    code: z.string().min(8).max(8_192),
    state: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
    realmId: BoundedIdentifierSchema
  })
  .strict();

function oneHeader(value: string | readonly string[] | undefined) {
  if (typeof value !== "string") {
    throw new Error("qbo_oauth_callback_handoff_header_invalid");
  }
  return value;
}

export function parseQboOAuthCallbackHandoff(input: {
  method: string;
  requestUrl: string;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}) {
  const url = new URL(input.requestUrl, "https://phase8b-callback.invalid");
  if (
    input.method !== "GET" ||
    url.pathname !== "/oauth/callback" ||
    url.search !== "" ||
    url.hash !== "" ||
    oneHeader(input.headers[QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.version]) !==
      QBO_OAUTH_CALLBACK_HANDOFF_VERSION
  ) {
    throw new Error("qbo_oauth_callback_handoff_invalid");
  }
  return CallbackHandoffSchema.parse({
    code: oneHeader(input.headers[QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.code]),
    state: oneHeader(input.headers[QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.state]),
    realmId: oneHeader(input.headers[QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.realmId])
  });
}

export function sanitizedQboOAuthConfirmationUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("qbo_oauth_confirmation_url_invalid");
  }
  return url.toString();
}
