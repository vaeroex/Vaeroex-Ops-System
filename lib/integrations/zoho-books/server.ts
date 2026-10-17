import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const CALLBACK_PATH = "/api/integrations/zoho-books/callback";
const SCOPE = "ZohoBooks.settings.READ,ZohoBooks.invoices.READ,ZohoBooks.expenses.READ";
const TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token";
const API_DOMAIN = "https://www.zohoapis.com";
const ACCOUNT_ORIGIN = "https://accounts.zoho.com";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const tokenResponse = z.object({
  access_token: z.string().min(10).max(8192),
  refresh_token: z.string().min(10).max(8192).optional(),
  api_domain: z.literal(API_DOMAIN),
  expires_in: z.coerce.number().int().min(60).max(86400)
}).passthrough();
const savedToken = z.object({
  accessToken: z.string().min(10), refreshToken: z.string().min(10), expiresAt: z.string().datetime()
}).strict();
const organizationResponse = z.object({
  code: z.literal(0),
  organizations: z.array(z.object({
    organization_id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().min(1).max(200),
    currency_code: z.string().regex(/^[A-Z]{3}$/),
    country_code: z.string().optional(),
    address: z.object({ country: z.string().optional() }).nullish()
  }).passthrough()).max(100)
}).passthrough();
const pageContext = z.union([z.object({ has_more_page: z.boolean().optional() }).passthrough(),
  z.array(z.object({ has_more_page: z.boolean().optional() }).passthrough()).max(1)]).optional();
const invoiceResponse = z.object({
  code: z.literal(0), invoices: z.array(z.object({
    invoice_id: z.union([z.string(), z.number()]).transform(String),
    date: z.string().regex(datePattern), status: z.string(),
    currency_code: z.string().regex(/^[A-Z]{3}$/),
    total: z.coerce.number().finite(), balance: z.coerce.number().finite()
  }).passthrough()).max(200), page_context: pageContext
}).passthrough();
const expenseResponse = z.object({
  code: z.literal(0), expenses: z.array(z.object({
    expense_id: z.union([z.string(), z.number()]).transform(String),
    date: z.string().regex(datePattern),
    currency_code: z.string().regex(/^[A-Z]{3}$/), total: z.coerce.number().finite()
  }).passthrough()).max(200), page_context: pageContext
}).passthrough();

export type Organization = { id: string; name: string; currency: string };
export type DailySummary = { day: string; invoice_count: number; invoice_total: number;
  outstanding_total: number; expense_count: number; expense_total: number; excluded_foreign_count: number };

export function config() {
  if (process.env.ZOHO_BOOKS_ENABLED !== "true") throw new Error("zoho_books_disabled");
  const redirect = new URL(process.env.ZOHO_BOOKS_REDIRECT_URI ?? "");
  if (redirect.protocol !== "https:" || redirect.pathname !== CALLBACK_PATH || redirect.search || redirect.hash ||
      redirect.username || redirect.password) throw new Error("zoho_books_redirect_invalid");
  const clientId = z.string().min(10).max(512).parse(process.env.ZOHO_BOOKS_CLIENT_ID);
  const clientSecret = z.string().min(10).max(512).parse(process.env.ZOHO_BOOKS_CLIENT_SECRET);
  const keyText = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).parse(process.env.ZOHO_BOOKS_TOKEN_ENCRYPTION_KEY);
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText) throw new Error("zoho_books_key_invalid");
  if (process.env.VERCEL_ENV === "production" && redirect.origin !== "https://www.vaeroex.com")
    throw new Error("zoho_books_origin_invalid");
  return { redirectUri: redirect.toString(), origin: redirect.origin, clientId, clientSecret, key };
}

export function enabled() {
  try { config(); return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
  catch { return false; }
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("zoho_books_database_unavailable");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function assertOrigin(request: Request, callback = false) {
  const expected = config().origin, url = new URL(request.url);
  if (url.origin !== expected || request.headers.get("host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-host") && request.headers.get("x-forwarded-host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "https" ||
      !callback && (request.method !== "POST" || request.headers.get("origin") !== expected || url.search ||
        request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))
    throw new Error("zoho_books_origin_denied");
}

export function requireOwner(access: { membership?: { role?: string } | null; context?: { membership?: { role?: string } | null } }) {
  if ((access.membership ?? access.context?.membership)?.role !== "owner") throw new Error("zoho_books_owner_required");
}

export function stateHash(state: string) { return createHash("sha256").update(state).digest("hex"); }

export function authorizationUrl(state: string) {
  const { clientId, redirectUri } = config();
  const url = new URL("/oauth/v2/auth", ACCOUNT_ORIGIN);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", scope: SCOPE, state, access_type: "offline", prompt: "consent" }).toString();
  return url.toString();
}

async function tokenRequest(input: URLSearchParams) {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: input, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? "zoho_books_authorization_required" : "zoho_books_provider_unavailable");
  const payload = tokenResponse.parse(await response.json());
  return payload;
}

export async function exchangeCode(code: string) {
  const c = config();
  const payload = await tokenRequest(new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, code, grant_type: "authorization_code" }));
  if (!payload.refresh_token) throw new Error("zoho_books_refresh_token_missing");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString() };
}

export async function refreshToken(refreshToken: string) {
  const c = config();
  const payload = await tokenRequest(new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, refresh_token: refreshToken, grant_type: "refresh_token" }));
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString() };
}

export function encryptToken(workspaceId: string, connectionId: string, value: z.infer<typeof savedToken>) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config().key, iv);
  cipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(savedToken.parse(value))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptToken(workspaceId: string, connectionId: string, ciphertext: string) {
  const bytes = Buffer.from(ciphertext, "base64");
  if (bytes.length < 29) throw new Error("zoho_books_token_invalid");
  const decipher = createDecipheriv("aes-256-gcm", config().key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return savedToken.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
}

async function apiGet(path: string, accessToken: string) {
  const response = await fetch(`${API_DOMAIN}/books/v3${path}`, { headers: {
    authorization: `Zoho-oauthtoken ${accessToken}`, accept: "application/json"
  }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "zoho_books_authorization_required" : "zoho_books_provider_unavailable");
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error("zoho_books_response_too_large");
  return JSON.parse(text) as unknown;
}

export async function organizations(accessToken: string): Promise<Organization[]> {
  const result = organizationResponse.parse(await apiGet("/organizations", accessToken));
  const usa = new Set(["US", "USA", "U.S.A", "U.S.A.", "United States", "United States of America"]);
  return result.organizations.filter((org) => org.currency_code === "USD" &&
    usa.has(org.country_code ?? org.address?.country ?? ""))
    .map((org) => ({ id: org.organization_id, name: org.name, currency: org.currency_code }));
}

async function listPages<T>(path: "invoices" | "expenses", accessToken: string, organizationId: string,
  startDate: string, endDate: string, parse: (value: unknown) => { items: T[]; more?: boolean }): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ organization_id: organizationId, date_start: startDate,
      date_end: endDate, page: String(page), per_page: "200" });
    const result = parse(await apiGet(`/${path}?${query}`, accessToken));
    all.push(...result.items);
    if (result.more === false || (result.more === undefined && result.items.length < 200)) return all;
  }
  throw new Error("zoho_books_page_limit_exceeded");
}

function morePages(context: z.infer<typeof pageContext>) {
  return Array.isArray(context) ? context[0]?.has_more_page : context?.has_more_page;
}

function cents(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new Error("zoho_books_amount_invalid");
  return Math.round(value * 100);
}

export async function recentSummaries(accessToken: string, organizationId: string, startDate: string, endDate: string): Promise<DailySummary[]> {
  if (!/^\d{5,30}$/.test(organizationId) || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate)
    throw new Error("zoho_books_window_invalid");
  const [invoices, expenses] = await Promise.all([
    listPages("invoices", accessToken, organizationId, startDate, endDate, (value) => {
      const result = invoiceResponse.parse(value);
      return { items: result.invoices, more: morePages(result.page_context) };
    }),
    listPages("expenses", accessToken, organizationId, startDate, endDate, (value) => {
      const result = expenseResponse.parse(value);
      return { items: result.expenses, more: morePages(result.page_context) };
    })
  ]);
  const days = new Map<string, { invoiceCount: number; invoiceCents: number; balanceCents: number;
    expenseCount: number; expenseCents: number; foreignCount: number }>();
  for (let day = startDate; day <= endDate; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    days.set(day, { invoiceCount: 0, invoiceCents: 0, balanceCents: 0, expenseCount: 0, expenseCents: 0, foreignCount: 0 });
    if (days.size > 7) throw new Error("zoho_books_window_too_large");
  }
  const invoiceIds = new Set<string>(), expenseIds = new Set<string>();
  for (const item of invoices) {
    if (invoiceIds.has(item.invoice_id)) throw new Error("zoho_books_duplicate_invoice");
    invoiceIds.add(item.invoice_id);
    const day = days.get(item.date);
    if (!day || item.status === "draft" || item.status === "void") continue;
    if (!["sent", "paid", "overdue", "unpaid", "partially_paid", "viewed"].includes(item.status))
      throw new Error("zoho_books_invoice_status_unknown");
    if (item.currency_code !== "USD") { day.foreignCount++; continue; }
    day.invoiceCount++;
    day.invoiceCents += cents(item.total);
    day.balanceCents += cents(item.balance);
  }
  for (const item of expenses) {
    if (expenseIds.has(item.expense_id)) throw new Error("zoho_books_duplicate_expense");
    expenseIds.add(item.expense_id);
    const day = days.get(item.date);
    if (!day) continue;
    if (item.currency_code !== "USD") { day.foreignCount++; continue; }
    day.expenseCount++;
    day.expenseCents += cents(item.total);
  }
  return [...days].map(([day, item]) => ({ day, invoice_count: item.invoiceCount,
    invoice_total: item.invoiceCents / 100, outstanding_total: item.balanceCents / 100,
    expense_count: item.expenseCount, expense_total: item.expenseCents / 100,
    excluded_foreign_count: item.foreignCount }));
}

export function redirect(status: "connected" | "choose" | "disconnected" | "error" | "synced") {
  const url = new URL("/app/integrations/zoho-books", config().origin);
  url.searchParams.set("result", status);
  return Response.redirect(url, 303);
}

export async function activeToken(workspaceId: string, connectionId: string) {
  const db = admin();
  const { data: credential, error: credentialError } = await db.from("zoho_books_credentials")
    .select("token_ciphertext").eq("workspace_id", workspaceId).eq("connection_id", connectionId).single();
  if (credentialError || !credential) throw new Error("zoho_books_authorization_required");
  let token = decryptToken(workspaceId, connectionId, credential.token_ciphertext);
  if (Date.parse(token.expiresAt) < Date.now() + 60_000) {
    token = await refreshToken(token.refreshToken);
    const { error: updateError } = await db.from("zoho_books_credentials").update({
      token_ciphertext: encryptToken(workspaceId, connectionId, token),
      access_expires_at: token.expiresAt, updated_at: new Date().toISOString()
    }).eq("workspace_id", workspaceId).eq("connection_id", connectionId);
    if (updateError) throw new Error("zoho_books_credential_storage_failed");
  }
  return token.accessToken;
}
