import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  GOOGLE_SHEETS_CALLBACK_PATH,
  GOOGLE_SHEETS_READ_SCOPE,
  HeaderRowSchema,
  SheetIdSchema,
  SpreadsheetIdSchema,
  assertBusinessLabel,
  safeHeaders,
  sheetRange
} from "@/lib/integrations/google-sheets/contracts";

import { withSheetsRequest, type SheetsAbortableResult, type SheetsExecutionBudget } from "./execution";

const tokenSchema = z.object({
  accessToken: z.string().min(10).max(8192),
  refreshToken: z.string().min(10).max(8192),
  expiresAt: z.string().datetime()
}).strict();

const tokenResponseSchema = z.object({
  access_token: z.string().min(10).max(8192),
  refresh_token: z.string().min(10).max(8192).optional(),
  expires_in: z.number().int().positive().max(86400),
  scope: z.string().optional(),
  token_type: z.string().optional()
}).passthrough();

const metadataSchema = z.object({
  spreadsheetId: SpreadsheetIdSchema,
  properties: z.object({ title: z.string().max(200) }),
  sheets: z.array(z.object({
    properties: z.object({
      sheetId: SheetIdSchema,
      title: z.string().min(1).max(200),
      sheetType: z.string().optional(),
      gridProperties: z.object({ rowCount: z.number().int().min(0) }).optional()
    })
  })).max(100)
});

export type SheetsTab = { id: number; title: string; rowCount: number };

export function sheetsEnabled() {
  if (process.env.GOOGLE_SHEETS_ENABLED !== "true") return false;
  try {
    sheetsConfiguration();
    return createSupabaseAdminClient() !== null;
  } catch {
    return false;
  }
}

export function sheetsConfiguration() {
  if (process.env.GOOGLE_SHEETS_ENABLED !== "true") throw new Error("google_sheets_disabled");
  const app = new URL(process.env.GOOGLE_SHEETS_REDIRECT_URI ?? "");
  const redirect = new URL(process.env.GOOGLE_SHEETS_REDIRECT_URI ?? "");
  if (app.protocol !== "https:" || app.username || app.password || app.pathname !== GOOGLE_SHEETS_CALLBACK_PATH ||
      app.search || app.hash || redirect.origin !== app.origin ||
      redirect.pathname !== GOOGLE_SHEETS_CALLBACK_PATH || redirect.search || redirect.hash) {
    throw new Error("google_sheets_origin_invalid");
  }
  z.string().min(32).max(512).parse(process.env.CRON_SECRET);
  const clientId = z.string().min(10).max(512).parse(process.env.GOOGLE_SHEETS_CLIENT_ID);
  const clientSecret = z.string().min(10).max(512).parse(process.env.GOOGLE_SHEETS_CLIENT_SECRET);
  if (process.env.VERCEL_ENV === "production" && app.origin !== PUBLIC_SITE_URL) throw new Error("google_sheets_origin_invalid");
  const keyText = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).parse(
    process.env.GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY
  );
  const encryptionKey = Buffer.from(keyText, "base64");
  if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== keyText) throw new Error("google_sheets_encryption_key_invalid");
  return { appOrigin: app.origin, redirectUri: redirect.toString(), clientId, clientSecret, encryptionKey };
}

export function sheetsAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("google_sheets_database_unavailable");
  return admin;
}

export function assertSheetsOrigin(request: Request, callback = false) {
  const expected = sheetsConfiguration().appOrigin, url = new URL(request.url);
  if (url.origin !== expected || url.hash || request.headers.get("host") !== new URL(expected).host ||
      request.headers.has("x-forwarded-host") && request.headers.get("x-forwarded-host") !== new URL(expected).host ||
      request.headers.has("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "https" ||
      !callback && (request.headers.get("origin") !== expected || url.search || request.method !== "POST" ||
        request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    throw new Error("google_sheets_request_origin_denied");
  }
}

export async function readSheetsForm(request: Request, maxBytes = 16_384) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const length = request.headers.get("content-length");
  if (contentType !== "application/x-www-form-urlencoded" || !request.body ||
      length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new Error("google_sheets_request_content_type_invalid");
  }
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, interrupted = false;
  const cancel = () => { interrupted = true; void reader.cancel().catch(() => undefined); };
  const timeout = setTimeout(cancel, 5000);
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.signal.aborted) cancel();
    for (;;) {
      const next = await reader.read();
      if (interrupted) throw new Error("google_sheets_request_interrupted");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes || chunks.length >= 128) throw new Error("google_sheets_request_too_large");
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
    for (const part of text.split("&")) for (const field of part.split("=")) decodeURIComponent(field.replace(/\+/g, " "));
    const params = new URLSearchParams(text), fields: Record<string, string> = Object.create(null);
    for (const [key, value] of params) {
      if (Object.hasOwn(fields, key)) throw new Error("google_sheets_duplicate_form_field");
      fields[key] = value;
    }
    return fields;
  } finally {
    clearTimeout(timeout); request.signal.removeEventListener("abort", cancel);
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}

export function sheetsStateHash(state: string) {
  z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(state);
  return `sha256:${createHash("sha256").update(state, "utf8").digest("hex")}`;
}

export function sheetsAuthorizationUrl(state: string) {
  const config = sheetsConfiguration();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SHEETS_READ_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  return url;
}

function tokenContext(workspaceId: string, connectionId: string, generation: number, version: number) {
  return Buffer.from(canonicalContractJson({ provider: "google_sheets", format: "gs2", scope: GOOGLE_SHEETS_READ_SCOPE,
    origin: sheetsConfiguration().appOrigin, workspaceId: z.string().uuid().parse(workspaceId),
    connectionId: z.string().uuid().parse(connectionId), generation: z.number().int().positive().safe().parse(generation),
    credentialVersion: z.number().int().positive().safe().parse(version) }));
}
export function encryptSheetsTokens(workspaceId: string, connectionId: string, token: z.infer<typeof tokenSchema>, generation = 1, version = 1) {
  const key = sheetsConfiguration().encryptionKey, aad = tokenContext(workspaceId, connectionId, generation, version);
  const plaintext = Buffer.from(JSON.stringify(tokenSchema.parse(token)));
  try {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `gs2.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
  } finally { key.fill(0); plaintext.fill(0); aad.fill(0); }
}
export function decryptSheetsTokens(workspaceId: string, connectionId: string, value: string, generation = 1, version = 1) {
  const key = sheetsConfiguration().encryptionKey, aad = tokenContext(workspaceId, connectionId, generation, version);
  let packed: Buffer | undefined, plaintext: Buffer | undefined;
  try {
    if (!/^gs2\.[A-Za-z0-9_-]+$/.test(value) || value.length > 32768) throw new Error("invalid");
    packed = Buffer.from(value.slice(4), "base64url");
    if (packed.length < 29 || packed.toString("base64url") !== value.slice(4)) throw new Error("invalid");
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0,12));
    decipher.setAAD(aad); decipher.setAuthTag(packed.subarray(12,28));
    plaintext = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
    return tokenSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
  } catch { throw new Error("google_sheets_token_ciphertext_invalid"); }
  finally { key.fill(0); aad.fill(0); packed?.fill(0); plaintext?.fill(0); }
}

export async function sheetsLifecycle(operation: string, workspaceId: string, connectionId: string | null,
  payload: Record<string, unknown> = {}, actorId: string | null = null, sessionId: string | null = null, deadlineAt?: number) {
  const admin = sheetsAdmin();
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) =>
    SheetsAbortableResult<{ data: unknown; error: unknown }>;
  const result = await withSheetsRequest(deadlineAt, 10_000, signal => rpc("google_sheets_lifecycle_v1", { p_operation: operation, p_workspace_id: workspaceId,
    p_connection_id: connectionId, p_actor_id: actorId, p_session_id: sessionId, p_payload: payload }).abortSignal(signal));
  if (result.error || result.data == null) throw new Error("google_sheets_lifecycle_failed");
  return result.data;
}
const credentialContext = z.object({
  workspaceId: z.string().uuid(), connectionId: z.string().uuid(), generation: z.number().int().positive().safe(),
  credentialVersion: z.number().int().nonnegative().safe(), ciphertext: z.string().nullable(),
  accessExpiresAt: z.string().nullable(), state: z.string(), leaseId: z.string().uuid().nullable(),
  refreshLeaseId: z.string().uuid().nullable(), revocationPending: z.boolean()
}).strict();
export function parseSheetsCredential(value: unknown, workspaceId: string, connectionId?: string) {
  const result = credentialContext.parse(value);
  if (result.workspaceId !== workspaceId || connectionId && result.connectionId !== connectionId) throw new Error("google_sheets_context_denied");
  return result;
}

async function limitedJson(response: Response, limit: number, signal?: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("google_sheets_empty_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("google_sheets_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!response.ok) {
    if (response.status === 400) {
      try {
        const providerError = z.object({ error: z.string() }).parse(JSON.parse(body)).error;
        if (providerError === "invalid_token") throw new Error("google_sheets_revoked_token");
        if (providerError === "invalid_grant") {
          throw new Error("google_sheets_authorization_required");
        }
      } catch (error) {
        if (error instanceof Error && ["google_sheets_authorization_required", "google_sheets_revoked_token"].includes(error.message)) throw error;
      }
    }
    if (response.status === 401) throw new Error("google_sheets_authorization_required");
    throw new Error("google_sheets_provider_request_failed");
  }
  return JSON.parse(body) as unknown;
}

async function tokenRequest(body: URLSearchParams, deadlineAt?: number) {
  return withSheetsRequest(deadlineAt, 10_000, async signal => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
      cache: "no-store", credentials: "omit", redirect: "error", signal
    });
    return tokenResponseSchema.parse(await limitedJson(response, 64_000, signal));
  });
}

function assertScope(scope: string | undefined) {
  if (scope && scope.trim() !== GOOGLE_SHEETS_READ_SCOPE) {
    throw new Error("google_sheets_scope_mismatch");
  }
}

export async function exchangeSheetsCode(code: string) {
  const config = sheetsConfiguration();
  const response = await tokenRequest(new URLSearchParams({
    code: z.string().min(8).max(8192).parse(code),
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code"
  }));
  if (!response.scope) throw new Error("google_sheets_scope_mismatch");
  assertScope(response.scope);
  if (response.token_type?.toLowerCase() !== "bearer" || !response.refresh_token) {
    throw new Error("google_sheets_offline_access_missing");
  }
  return tokenSchema.parse({
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: new Date(Date.now() + response.expires_in * 1000).toISOString()
  });
}

export async function sheetsAccessToken(workspaceId: string, connectionId: string, execution?: SheetsExecutionBudget) {
  let row = parseSheetsCredential(await sheetsLifecycle("credential", workspaceId, connectionId, {}, null, null, execution?.deadlineAt), workspaceId, connectionId);
  if (!row.ciphertext || row.state !== "connected") throw new Error("google_sheets_credential_unavailable");
  const tokens = decryptSheetsTokens(workspaceId, connectionId, row.ciphertext, row.generation, row.credentialVersion);
  if (Date.parse(tokens.expiresAt) !== Date.parse(row.accessExpiresAt ?? "")) throw new Error("google_sheets_credential_context_invalid");
  if (Date.parse(tokens.expiresAt) > Date.now() + 60_000) return tokens.accessToken;
  const leaseId = randomUUID();
  row = parseSheetsCredential(await sheetsLifecycle("claim_refresh", workspaceId, connectionId,
    { leaseId, credentialVersion: row.credentialVersion, generation: row.generation }, null, null, execution?.deadlineAt), workspaceId, connectionId);
  if (row.refreshLeaseId !== leaseId) throw new Error("google_sheets_refresh_busy");
  const config = sheetsConfiguration();
  let refreshed: z.infer<typeof tokenResponseSchema>;
  try {
    refreshed = await tokenRequest(new URLSearchParams({ refresh_token: tokens.refreshToken,
      client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" }), execution?.deadlineAt);
    assertScope(refreshed.scope);
    if (refreshed.token_type && refreshed.token_type.toLowerCase() !== "bearer") throw new Error("google_sheets_token_type_invalid");
  } catch (error) {
    await sheetsLifecycle("fail_refresh", workspaceId, connectionId, { leaseId,
      reauthorize: error instanceof Error && error.message === "google_sheets_authorization_required" }, null, null, execution?.cleanupDeadlineAt).catch(() => undefined);
    throw error;
  }
  const next = tokenSchema.parse({ accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() });
  const version = row.credentialVersion + 1;
  const ciphertext = encryptSheetsTokens(workspaceId, connectionId, next, row.generation, version);
  let receipt: unknown;
  try { receipt = await sheetsLifecycle("commit_refresh", workspaceId, connectionId,
    { leaseId, credentialVersion: version, ciphertext, accessExpiresAt: next.expiresAt }, null, null, execution?.cleanupDeadlineAt); }
  catch { receipt = await sheetsLifecycle("credential", workspaceId, connectionId, {}, null, null, execution?.cleanupDeadlineAt); }
  const committed = parseSheetsCredential(receipt, workspaceId, connectionId);
  if (committed.credentialVersion !== version || committed.ciphertext !== ciphertext || committed.generation !== row.generation)
    throw new Error("google_sheets_refresh_storage_failed");
  return next.accessToken;
}

async function sheetsGet(workspaceId: string, connectionId: string, path: string, params: URLSearchParams, limit: number, execution?: SheetsExecutionBudget) {
  const token = await sheetsAccessToken(workspaceId, connectionId, execution);
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${path}`);
  url.search = params.toString();
  try {
    return await withSheetsRequest(execution?.deadlineAt, 15_000, async signal => limitedJson(await fetch(url, {
      method: "GET", headers: { authorization: `Bearer ${token}` },
      cache: "no-store", credentials: "omit", redirect: "error", signal
    }), limit, signal));
  } catch (error) {
    if (error instanceof Error && error.message === "google_sheets_authorization_required") {
      try {
        const current = parseSheetsCredential(await sheetsLifecycle("credential", workspaceId, connectionId, {}, null, null, execution?.cleanupDeadlineAt), workspaceId, connectionId);
        if (current.ciphertext && decryptSheetsTokens(workspaceId, connectionId, current.ciphertext, current.generation, current.credentialVersion).accessToken === token)
          await sheetsLifecycle("mark_reauthorization", workspaceId, connectionId, { credentialVersion: current.credentialVersion, generation: current.generation }, null, null, execution?.cleanupDeadlineAt);
      } catch { /* A concurrent refresh/disconnect remains authoritative. */ }
    }
    throw error;
  }
}

export async function sheetsMetadata(workspaceId: string, connectionId: string, spreadsheetId: string, execution?: SheetsExecutionBudget) {
  const id = SpreadsheetIdSchema.parse(spreadsheetId);
  const raw = await sheetsGet(workspaceId, connectionId, id, new URLSearchParams({
    fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,gridProperties(rowCount)))"
  }), 256_000, execution);
  const metadata = metadataSchema.parse(raw);
  if (metadata.spreadsheetId !== id) throw new Error("google_sheets_spreadsheet_identity_mismatch");
  return {
    title: assertBusinessLabel(metadata.properties.title),
    tabs: metadata.sheets.filter((sheet) => sheet.properties.sheetType === "GRID")
      .map((sheet): SheetsTab => ({
        id: sheet.properties.sheetId,
        title: assertBusinessLabel(sheet.properties.title),
        rowCount: sheet.properties.gridProperties?.rowCount ?? 0
      }))
  };
}

export async function sheetsHeaders(
  workspaceId: string, connectionId: string, spreadsheetId: string,
  tabTitle: string, headerRow: number, execution?: SheetsExecutionBudget
) {
  const row = HeaderRowSchema.parse(headerRow);
  const range = sheetRange(tabTitle, "A", row, row).replace(/A\d+:A\d+$/, `A${row}:CV${row}`);
  const raw = await sheetsGet(workspaceId, connectionId,
    `${SpreadsheetIdSchema.parse(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" }), 64_000, execution);
  const values = z.object({ values: z.array(z.array(z.unknown())).optional() }).parse(raw).values;
  return safeHeaders(values?.[0] ?? []);
}

export async function sheetsMappedColumns(
  workspaceId: string, connectionId: string, spreadsheetId: string,
  ranges: string[], render: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" = "FORMATTED_VALUE", execution?: SheetsExecutionBudget
) {
  z.array(z.string().min(1).max(512)).min(1).max(16).parse(ranges);
  const params = new URLSearchParams({ valueRenderOption: render, dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" });
  for (const range of ranges) params.append("ranges", range);
  const raw = await sheetsGet(workspaceId, connectionId,
    `${SpreadsheetIdSchema.parse(spreadsheetId)}/values:batchGet`, params, 4_000_000, execution);
  const response = z.object({
    valueRanges: z.array(z.object({ values: z.array(z.array(z.unknown())).optional() })).length(ranges.length)
  }).parse(raw);
  return response.valueRanges.map((range) => range.values ?? []);
}

export async function revokeSheetsToken(token: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: z.string().min(10).max(8192).parse(token) }),
    cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000)
  });
  if (response.status === 200) { await response.body?.cancel(); return; }
  // Google documents invalid_token for an already-revoked/expired credential.
  if (response.status === 400) {
    try { await limitedJson(response, 4096); } catch (error) {
      if (error instanceof Error && error.message === "google_sheets_revoked_token") return;
    }
  }
  throw new Error("google_sheets_revocation_pending");
}

export function validSheetsSchedulerSecret(authorization: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || secret.length > 512 || !authorization) return false;
  const actual = Buffer.from(authorization), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
