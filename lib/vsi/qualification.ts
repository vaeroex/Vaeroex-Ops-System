import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pluginProviders } from "@/lib/ai/shared-evidence/contracts";

// Opt-in, preview-only campaign. No keys, prompts, responses or source text are logged.
// Three immutable request IDs use the existing durable reservation/idempotency ledger;
// attempt > 1 is never allowed to reach transport, including after a crashed worker.
export const VSI_QUALIFICATION_LIMITS = Object.freeze({ requests: 3, callsPerRequest: 5,
  callsTotal: 15, inputBytes: 192_000, outputTokens: 8_000, reserveUsd: 0.572,
  conservativeTotalUsd: 1.716, approvedCapUsd: 2 });
const slot = z.object({ caseId: z.enum(["owner_private", "demo_private", "business_brief"]),
  actorUserId: z.string().uuid(), workspaceId: z.string().uuid(), conversationId: z.string().uuid(),
  requestId: z.string().uuid(), questionHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedSourceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(24),
  approvedProviders: z.array(z.enum(pluginProviders)).min(2).max(12).optional(),
  preparedSelection: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().optional() }).strict();
const manifestSchema = z.object({ campaignId: z.string().uuid(), startsAt: z.string().datetime(),
  expiresAt: z.string().datetime(), slots: z.array(slot).length(3), inspectCitations: z.boolean().optional() }).strict();
export type VsiQualificationSlot = z.infer<typeof slot>;
const issuedSlots = new WeakSet<VsiQualificationSlot>();
type Scope = { actorUserId: string; workspaceId: string; conversationId?: string; question: string };
const markers = { owner_private: "amber otter has 17 tokens", demo_private: "violet heron has 23 tokens" };
export const qualificationHash = (value: string) => createHash("sha256").update(value).digest("hex");
export class VsiQualificationError extends Error {
  constructor(readonly reason: "configuration" | "scope" | "attempt" | "transport" | "context" | "limit") {
    super(`vsi_qualification_${reason}`);
  }
}
function manifest() {
  const raw = process.env.VAEROEX_VSI_QUALIFICATION;
  if (raw === undefined) return null;
  try {
    if (process.env.VERCEL_ENV !== "preview" || raw.length > 8000) throw new Error();
    const value = manifestSchema.parse(JSON.parse(raw));
    const start = Date.parse(value.startsAt), end = Date.parse(value.expiresAt), now = Date.now();
    if (end <= start || end - start > 3_600_000 || now < start || now >= end
      || new Set(value.slots.map(s => s.caseId)).size !== 3
      || new Set(value.slots.map(s => s.requestId)).size !== 3
      || value.slots.some(s => new Set(s.approvedSourceHashes).size !== s.approvedSourceHashes.length
        || s.approvedProviders && new Set(s.approvedProviders).size !== s.approvedProviders.length
        || (s.caseId === "business_brief" ? s.approvedSourceHashes.length < 2 : s.approvedSourceHashes.length !== 0 || s.approvedProviders !== undefined))) throw new Error();
    return { ...value, hash: qualificationHash(raw) };
  } catch { throw new VsiQualificationError("configuration"); }
}
/** Called after normal authorization, before reservation. Client request IDs are
 * replaced with the approved fixed slot, so reloads cannot manufacture more slots. */
export function qualificationSlot(input: Scope): VsiQualificationSlot | null {
  const campaign = manifest();
  if (!campaign) return null;
  const selected = campaign.slots.find(s => s.actorUserId === input.actorUserId && s.workspaceId === input.workspaceId
    && s.conversationId === input.conversationId
    && s.questionHash === qualificationHash(input.question));
  if (!selected) throw new VsiQualificationError("scope");
  issuedSlots.add(selected);
  return Object.freeze(selected);
}
export function qualificationDispatchGuard(input: Scope & { requestId: string; reservedRequest?: { id: string; attempt: number } }) {
  const selected = qualificationSlot(input), campaign = manifest();
  if (!selected || !campaign) return null;
  if (!input.reservedRequest || input.reservedRequest.attempt !== 1 || selected.requestId !== input.requestId) {
    throw new VsiQualificationError("attempt");
  }
  let calls = 0;
  return Object.assign((serialized: string, manifestId?: string) => {
    // Recheck expiry and immutable configuration at every actual dispatch.
    if (manifest()?.hash !== campaign.hash) throw new VsiQualificationError("configuration");
    if (calls >= VSI_QUALIFICATION_LIMITS.callsPerRequest) throw new VsiQualificationError("limit");
    let body: Record<string, unknown>, payload: Record<string, unknown>;
    try {
      body = JSON.parse(serialized);
      const messages = z.array(z.object({ role: z.string(), content: z.string() })).parse(body.input);
      if (messages.length !== 2 || messages[0].role !== "system" || messages[1].role !== "user") throw new Error();
      payload = JSON.parse(messages[1].content);
    } catch { throw new VsiQualificationError("transport"); }
    const bytes = Buffer.byteLength(serialized, "utf8");
    const allowedKeys = new Set(["model", "store", "stream", "reasoning", "max_output_tokens", "input", "text"]);
    if (Object.keys(body).some(key => !allowedKeys.has(key))
      || body.model !== "gpt-6-luna" || body.store !== false || body.stream !== false
      || "tools" in body || "tool_choice" in body || "previous_response_id" in body
      || "conversation" in body || "background" in body || "prompt" in body
      || !Number.isSafeInteger(body.max_output_tokens) || Number(body.max_output_tokens) < 1
      || Number(body.max_output_tokens) > VSI_QUALIFICATION_LIMITS.outputTokens
      || bytes > VSI_QUALIFICATION_LIMITS.inputBytes) throw new VsiQualificationError("transport");
    // Parse first, so JSON escaping cannot hide a canary in a string value.
    const strings = (v: unknown): string => typeof v === "string" ? v : Array.isArray(v) ? v.map(strings).join(" ")
      : v && typeof v === "object" ? Object.values(v).map(strings).join(" ") : "";
    const allText = strings(body).toLowerCase();
    // The payload is itself a JSON string in the transport envelope.
    const payloadText = strings(payload).toLowerCase();
    const history = strings([payload.privateConversationSummary, payload.recentConversation]).toLowerCase();
    const own = selected.caseId === "business_brief" ? null : markers[selected.caseId];
    const foreign = Object.values(markers).filter(m => m !== own);
    const ownPresent = own === null ? null : history.includes(own);
    const foreignAbsent = foreign.every(m => !allText.includes(m) && !payloadText.includes(m));
    const sources = [payload.businessSources, payload.historicalSources].flatMap(value => Array.isArray(value) ? value : []);
    const sourcesApproved = sources.every(source => source?.sourceType === "product_context"
      || selected.approvedSourceHashes.includes(source?.sourceId))
      && (!Array.isArray(payload.qualitative_sources) || payload.qualitative_sources.every(source => selected.approvedSourceHashes.includes(source?.binding)));
    const passed = ownPresent !== false && foreignAbsent && payload.question === input.question
      && sourcesApproved && (selected.caseId !== "business_brief" || Boolean(manifestId));
    console.info("[vsi-qualification-dispatch]", { campaignHash: campaign.hash, caseId: selected.caseId,
      requestId: selected.requestId, attempt: 1, dispatch: calls + 1, requestBytes: bytes,
      payloadHash: qualificationHash(serialized), ownMarkerPresent: ownPresent, foreignMarkerAbsent: foreignAbsent,
      sharedManifestId: manifestId ?? null, sourcesApproved, passed });
    if (!passed) throw new VsiQualificationError("context");
    const remainingMs = Date.parse(campaign.expiresAt) - Date.now();
    if (remainingMs < 4000) throw new VsiQualificationError("limit");
    calls++;
    return remainingMs;
  }, { sharedEvidence: selected.caseId === "business_brief" });
}

/** The manifest pins reviewed original projections, not just a valid workspace.
 * Fail before sealing/dispatch if preparation adds any other business source.
 * These checks supplement normal protected admission; they cannot grant access. */
export function assertQualificationSources(input: Scope, rows: readonly { hash: string; provider: string }[], prepared?: { fingerprint: string; start: string; end: string }) {
  const selected = qualificationSlot(input);
  if (!selected) return;
  if (selected.preparedSelection && (!prepared || Object.entries(selected.preparedSelection).some(([key, value]) => prepared[key as keyof typeof prepared] !== value))) {
    throw new VsiQualificationError("context");
  }
  const providers = selected.approvedProviders ?? ["xero", "google_sheets"];
  if (new Set(rows.map(row => row.hash)).size !== selected.approvedSourceHashes.length
    || rows.some(row => !selected.approvedSourceHashes.includes(row.hash))
    || (selected.caseId === "business_brief" && (providers.some(provider => !rows.some(row => row.provider === provider))
      || rows.some(row => !providers.includes(row.provider as typeof providers[number]))))) {
    throw new VsiQualificationError("context");
  }
}

/** Optional read-only acceptance window. This is an additional scope gate, not
 * source authorization: callers must use the normal actor RLS and reopen RPC.
 * Older manifests keep hiding citations. Expiry never enables ordinary access. */
export function qualificationCitationScope(input: { actorUserId: string; workspaceId: string }) {
  try {
    const campaign = manifest();
    if (!campaign?.inspectCitations) return null;
    return campaign.slots.find(s => s.caseId === "business_brief" && s.actorUserId === input.actorUserId
      && s.workspaceId === input.workspaceId) ?? null;
  } catch { return null; }
}

// A process-local capability, never serialized or accepted from the browser.
// Issued from a slot already validated before reservation; terminal accounting
// may finish after expiry but cannot authorize another request or generation.
declare const accountingBrand: unique symbol;
export type QualificationAccountingPermit = { readonly [accountingBrand]: true };
type AccountingBinding = { actorUserId: string; workspaceId: string; conversationId: string; id: string; attempt: number };
const accountingPermits = new WeakMap<QualificationAccountingPermit, AccountingBinding>();
export function qualificationAccountingPermit(selected: VsiQualificationSlot | null, request: { id: string; attempt: number }): QualificationAccountingPermit | undefined {
  if (!selected) return undefined;
  if (!issuedSlots.has(selected) || !z.string().uuid().safeParse(request.id).success
    || !Number.isSafeInteger(request.attempt) || request.attempt < 1) throw new VsiQualificationError("attempt");
  const permit = Object.freeze({}) as QualificationAccountingPermit;
  accountingPermits.set(permit, { actorUserId: selected.actorUserId, workspaceId: selected.workspaceId,
    conversationId: selected.conversationId, id: request.id, attempt: request.attempt });
  return permit;
}
export function qualificationAccountingAllowed(permit: QualificationAccountingPermit | undefined,
  input: { actorUserId: string; workspaceId: string; conversationId: unknown; id: unknown; attempt: unknown }): boolean {
  const bound = permit && accountingPermits.get(permit);
  return Boolean(bound && bound.actorUserId === input.actorUserId && bound.workspaceId === input.workspaceId
    && bound.conversationId === input.conversationId && bound.id === input.id && bound.attempt === input.attempt);
}
