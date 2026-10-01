import "server-only";

import { z } from "zod";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

export const QBO_ACCOUNTING_PATH = "/app/settings/integrations/quickbooks/accounting";
export const QBO_ACCOUNTING_API_PATH = "/api/integrations/qbo/accounting-authority";
export const QBO_ACCOUNTING_CONSENT = "qbo_posted_accrual_transaction_detail_v1";
export const QBO_ACCOUNTING_ERRORS = {
  disabled: "QuickBooks connections are unavailable.",
  denied: "Workspace owner access to this QuickBooks connection is required.",
  stale: "Accounting authority changed. Reload and review before confirming again.",
  conflict: "Another accounting authority conflicts with this policy. Review is required.",
  query: "Review the connection, effective date and required confirmation.",
  unavailable: "Accounting authority could not be verified. Reload before trying again."
} as const;
export const QBO_ACCOUNTING_POLICY = [
  "QuickBooks posted accrual transaction detail is the authoritative source for supported revenue contributions from the selected effective date.",
  "QuickBooks reports are nonadditive controls; their totals are not added to transaction detail.",
  "Square payments remain separate and are excluded from this accounting revenue policy. Manual entries and uploads are also excluded.",
  "Conflicts hold contributions for review. Fallback requires review; no other source is automatically substituted."
] as const;

export class QboAccountingAuthorityError extends Error {
  constructor(readonly reason: "disabled" | "query" | "denied" | "unavailable" | "stale" | "conflict") {
    super(`qbo_accounting_authority_${reason}`);
  }
}

const uuid = z.string().uuid();
const effectiveDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return !value.startsWith("0000-") && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value &&
    time <= Date.now();
}, "Select a valid date that is not in the future.");
const expectedAuthorityId = z.union([uuid, z.literal("").transform(() => null), z.null()]);

export const QboAccountingAuthorityRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enable"), connectionId: uuid, expectedAuthorityId,
    effectiveDate, policyConsent: z.literal(QBO_ACCOUNTING_CONSENT)
  }).strict(),
  z.object({
    action: z.literal("revoke"), connectionId: uuid, expectedAuthorityId: uuid,
    confirmation: z.literal("revoke")
  }).strict()
]);

export const QboAccountingAuthoritySchema = z.object({
  connectionId: uuid, businessEntityId: uuid, businessEntityName: z.string().min(1).max(240),
  authorityId: uuid.nullable(), enabled: z.boolean(),
  effectiveFrom: z.string().datetime({ offset: true }).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/), coverage: z.literal("not_assessed")
}).strict().refine((value) => value.authorityId === null
  ? !value.enabled && value.effectiveFrom === null : value.effectiveFrom !== null);

export type QboAccountingAuthority = z.infer<typeof QboAccountingAuthoritySchema>;
export type QboAccountingAccess = Awaited<ReturnType<typeof requireQboAccountingOwner>>;

export function parseQboAccountingSelection(params: Record<string, string | string[] | undefined>) {
  return z.object({ connectionId: uuid.optional() }).strict().parse(params).connectionId;
}

export async function readQboAccountingRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/x-www-form-urlencoded" && contentType !== "application/json") {
    throw new QboAccountingAuthorityError("query");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new QboAccountingAuthorityError("query");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new QboAccountingAuthorityError("query");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (contentType === "application/json") return QboAccountingAuthorityRequestSchema.parse(JSON.parse(text));
  const form = new URLSearchParams(text);
  const entries = [...form.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new QboAccountingAuthorityError("query");
  }
  return QboAccountingAuthorityRequestSchema.parse(Object.fromEntries(entries));
}

export async function requireQboAccountingOwner() {
  if (!qboProductionCustomerConnectionsEnabled()) throw new QboAccountingAuthorityError("disabled");
  // Keep authentication redirects outside request/RPC error handling.
  const access = await requireWorkspaceAccess();
  if (access.membership.role !== "owner" || access.membership.status !== "active" ||
    access.membership.user_id !== access.user.id || access.membership.workspace_id !== access.workspaceId) {
    throw new QboAccountingAuthorityError("denied");
  }
  const claims = await access.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== access.user.id ||
    !uuid.safeParse(claims.data.claims.session_id).success) {
    throw new QboAccountingAuthorityError("denied");
  }
  return access;
}

async function selectedConnection(access: QboAccountingAccess, connectionId: string) {
  const { data, error } = await access.supabase.from("integration_connection_summaries")
    .select("id,business_entity_id,status")
    .eq("workspace_id", access.workspaceId).eq("id", uuid.parse(connectionId))
    .eq("provider_key", "quickbooks_online").eq("provider_environment", "production")
    .neq("status", "deleted").maybeSingle();
  if (error) throw new QboAccountingAuthorityError("unavailable");
  if (!data) throw new QboAccountingAuthorityError("denied");
  return data;
}

function rpcFailure(error: { code?: string; message?: string }) {
  if (error.code === "40001") return new QboAccountingAuthorityError("stale");
  if (error.message === "qbo_accounting_authority_conflict" || error.message === "qbo_accounting_family_conflict") {
    return new QboAccountingAuthorityError("conflict");
  }
  return new QboAccountingAuthorityError(error.code === "42501" ? "denied" : "unavailable");
}

export async function readQboAccountingAuthority(access: QboAccountingAccess, connectionId: string) {
  const connection = await selectedConnection(access, connectionId);
  const client = access.supabase as unknown as ExternalIntegrationsRpcClient;
  const result = await client.rpc("read_qbo_customer_accounting_authority_v1", { p_connection_id: connection.id });
  if (result.error) throw rpcFailure(result.error);
  const parsed = QboAccountingAuthoritySchema.safeParse(result.data);
  if (!parsed.success || parsed.data.connectionId !== connection.id ||
    parsed.data.businessEntityId !== connection.business_entity_id) {
    throw new QboAccountingAuthorityError("unavailable");
  }
  return parsed.data;
}

export async function setQboAccountingAuthority(access: QboAccountingAccess, input: unknown) {
  const value = QboAccountingAuthorityRequestSchema.parse(input);
  const current = await readQboAccountingAuthority(access, value.connectionId);
  if (value.action === "revoke" && current.effectiveFrom === null) throw new QboAccountingAuthorityError("stale");
  // SQL owns optimistic concurrency, replay handling and atomic withdrawal.
  const client = access.supabase as unknown as ExternalIntegrationsRpcClient;
  const result = await client.rpc("set_qbo_customer_accounting_authority_v1", {
    p_connection_id: value.connectionId,
    p_expected_authority_id: value.expectedAuthorityId,
    p_enabled: value.action === "enable",
    p_effective_from: value.action === "enable" ? `${value.effectiveDate}T00:00:00.000Z` : current.effectiveFrom
  });
  if (result.error) throw rpcFailure(result.error);
  const parsed = z.object({ authorityId: uuid, enabled: z.literal(value.action === "enable"), idempotent: z.boolean() })
    .strict().safeParse(result.data);
  if (!parsed.success) throw new QboAccountingAuthorityError("unavailable");
  return parsed.data;
}
