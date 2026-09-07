import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { UuidSchema } from "@/lib/integrations/contracts/primitives";
import { SQUARE_API_VERSION, SQUARE_ORDER_REQUEST_AUTHORITY_VERSION } from "@/lib/integrations/providers/square/contracts";
import { parseSquareCatalogValidatedResponse } from "@/lib/integrations/providers/square/catalog-response-validation";
import { parseSquareInventoryResponse } from "@/lib/integrations/providers/square/inventory-responses";
import { parseSquarePaymentResponse } from "@/lib/integrations/providers/square/payment-responses";
import { parseSquareRefundResponse } from "@/lib/integrations/providers/square/refund-responses";
import { parseSquareOrderCoreResponse, parseSquareOrderLineItemResponse, parseSquareOrderAdjustmentResponse, parseSquareOrderTenderResponse } from "@/lib/integrations/providers/square/order-responses";
import { squareResponseProvenance, squareMinimizedProjectionFingerprint } from "@/lib/integrations/providers/square/response-validation";
import { assertSquareReadOperation, type SquareReadOperationAuthorizationInput } from "@/lib/integrations/providers/square/request-validators";
import {
  SQUARE_INGESTION_STREAMS, squareIngestionScopeFingerprint,
  type SquareIngestionAuthority, type SquareIngestionGrant, type SquareIngestionOutcome,
  type SquarePageRepository, type SquareSyntheticTransport, type SquarePageLease,
  type SquarePrivateCursor, type SquarePageBinding
} from "@/lib/integrations/providers/square/ingestion-contracts";
import { readSquareBoundedResponse } from "@/lib/integrations/providers/square/ingestion-client";
import { mapSquareParsedPage } from "@/lib/integrations/providers/square/ingestion-mapping";

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/);
const grantSchema = z.object({
  scope: z.object({
    workspaceId: UuidSchema, businessEntityId: UuidSchema, connectionId: UuidSchema,
    sellerId: id, environment: z.enum(["sandbox", "production"]),
    authorizedLocationIds: z.array(id).min(1).max(1_000),
    generation: z.number().int().positive().safe()
  }).strict(),
  stream: z.enum(SQUARE_INGESTION_STREAMS), operation: z.string().max(80),
  scanId: UuidSchema,
  request: z.object({ method: z.enum(["GET", "POST"]), url: z.string().max(16_384), body: z.string().max(1_048_576).nullable() }).strict(),
  resolvedDefaultLocationId: id.optional(), expiresAt: z.number().int().positive().safe()
}).strict();

const streamOperations = {
  order_core: ["retrieve_order", "orders_batch_retrieve", "orders_search"],
  order_line_items: ["retrieve_order", "orders_batch_retrieve", "orders_search"],
  order_adjustments: ["retrieve_order", "orders_batch_retrieve", "orders_search"],
  order_tenders: ["retrieve_order", "orders_batch_retrieve", "orders_search"],
  payments: ["list_payments", "retrieve_payment"],
  refunds: ["list_payment_refunds", "retrieve_payment_refund"],
  catalog: ["list_catalog", "retrieve_catalog_object", "catalog_search", "catalog_batch_retrieve"],
  inventory: ["retrieve_inventory_count", "retrieve_inventory_adjustment", "retrieve_inventory_physical_count", "inventory_counts_batch_retrieve", "inventory_changes_batch_retrieve"]
} as const;

// The trusted dependency can still malfunction: snapshot before validation, without invoking
// accessors/proxies. At most5,000 values,depth8,64 object fields/1,000 array entries and2MiB
// aggregate text. The actual schema is <1,020 values plus the bounded request body.
function snapshotGrant(input: unknown): SquareIngestionGrant {
  let nodes = 0, text = 0;
  const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 5_000 || depth > 8) throw new Error("grant_invalid");
    if (typeof value === "string") {
      text += value.length;
      if (text > 2_097_152) throw new Error("grant_invalid");
      return value;
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object" || isProxy(value) || ancestors.has(value)) throw new Error("grant_invalid");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) throw new Error("grant_invalid");
    const keys = Reflect.ownKeys(value);
    if (keys.length > (array ? 1_001 : 64)) throw new Error("grant_invalid");
    ancestors.add(value);
    try {
      const result: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (array && key === "length") continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== "string" || key === "__proto__" || !descriptor?.enumerable || !("value" in descriptor)) throw new Error("grant_invalid");
        result[key] = copy(descriptor.value, depth + 1);
      }
      if (array) {
        if (keys.length !== value.length + 1 || Object.keys(result).some((key, index) => key !== String(index))) throw new Error("grant_invalid");
        return Object.freeze(Object.values(result));
      }
      return Object.freeze(result);
    } finally { ancestors.delete(value); }
  };
  const grant = grantSchema.parse(copy(input, 0));
  const locations = grant.scope.authorizedLocationIds;
  if (new Set(locations).size !== locations.length ||
      (grant.resolvedDefaultLocationId !== undefined && !locations.includes(grant.resolvedDefaultLocationId))) throw new Error("grant_invalid");
  if (!(streamOperations[grant.stream] as readonly string[]).includes(grant.operation)) throw new Error("grant_invalid");
  locations.sort();
  Object.freeze(locations); Object.freeze(grant.scope); Object.freeze(grant.request);
  return Object.freeze(grant);
}

function requestFor(grant: SquareIngestionGrant, cursor: SquarePrivateCursor | null, cursorBindingFingerprint?: string): SquareReadOperationAuthorizationInput {
  const { method } = grant.request;
  const url = new URL(grant.request.url);
  // Values are literal, as required by the unchanged request validators. Never decode/re-encode
  // query separators or duplicate keys into a different authorized request.
  if (url.searchParams.has("cursor")) throw new Error("initial_cursor_forbidden");
  let body = grant.request.body;
  if (method === "POST") {
    const data = JSON.parse(body ?? "null") as Record<string, unknown> | null;
    if (!data || Array.isArray(data) || Object.hasOwn(data, "cursor")) throw new Error("initial_cursor_forbidden");
    if (cursor) body = JSON.stringify({ ...data, cursor: cursor.value });
  }
  const suffix = cursor && method === "GET" ? `${url.search ? "&" : "?"}cursor=${cursor.value}` : "";
  return {
    providerKey: "square", providerEnvironment: grant.scope.environment,
    method, url: grant.request.url + suffix,
    headers: { "Square-Version": SQUARE_API_VERSION, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    body, ...(cursor ? { expectedCursorBindingFingerprint: cursorBindingFingerprint } : {})
  };
}

function parserContext(grant: SquareIngestionGrant, request: SquareReadOperationAuthorizationInput, lease: SquarePageLease | null) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.search.slice(1).split("&").filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator), part.slice(separator + 1)];
  }));
  const body = request.method === "POST" ? JSON.parse(request.body as string) as Record<string, unknown> : {};
  const authorizedLocationIds = grant.scope.authorizedLocationIds;
  const selectedLocations = [query.location_id, ...(query.location_ids?.split(",") ?? []),
    body.location_id, ...(Array.isArray(body.location_ids) ? body.location_ids : [])].filter((value) => value !== undefined);
  if (selectedLocations.some((value) => typeof value !== "string" || !authorizedLocationIds.includes(value))) throw new Error("request_location_unauthorized");
  const operation = grant.operation;
  const requestedId = url.pathname.split("/").at(-1)!;
  const cursor = lease?.cursor;
  const pagination = cursor ? {
    expectedCursorBindingFingerprint: lease.binding.cursorBindingFingerprint,
    expectedResponseCursorFingerprint: cursor.responseFingerprint
  } : {};
  if (grant.stream.startsWith("order_")) {
    if (operation === "retrieve_order") return { authorizedLocationIds, orderId: requestedId };
    if (operation === "orders_batch_retrieve") return { authorizedLocationIds, orderIds: body.order_ids, locationId: body.location_id ?? null };
    const filter = (body.query as { filter?: { state_filter?: { states?: unknown } } } | undefined)?.filter;
    return { authorizedLocationIds, locationIds: body.location_ids, states: filter?.state_filter?.states ?? null, returnEntries: false };
  }
  if (grant.stream === "payments" || grant.stream === "refunds") {
    if (operation.startsWith("retrieve_")) return { authorizedLocationIds, [grant.stream === "payments" ? "paymentId" : "refundId"]: requestedId };
    const locationId = query.location_id ?? (grant.stream === "payments" ? grant.resolvedDefaultLocationId : null);
    if (grant.stream === "payments" && !locationId) throw new Error("default_location_authority_required");
    return { authorizedLocationIds, locationId, query, ...pagination };
  }
  if (grant.stream === "catalog") return {
    ...(request.method === "GET" ? { query } : { body }),
    ...(operation === "retrieve_catalog_object" ? { objectId: requestedId } : {}), ...pagination
  };
  if (operation.startsWith("inventory_")) return { authorizedLocationIds, body, ...pagination };
  return operation === "retrieve_inventory_count" ? { authorizedLocationIds, catalogObjectId: requestedId, query, ...pagination }
    : { authorizedLocationIds, id: requestedId };
}

function parserInput(grant: SquareIngestionGrant, request: SquareReadOperationAuthorizationInput, lease: SquarePageLease | null, response: unknown) {
  return {
    providerKey: "square" as const, providerEnvironment: grant.scope.environment,
    apiVersion: SQUARE_API_VERSION, operation: grant.operation,
    connectionAuthority: {
      ...(grant.stream.startsWith("order_") ? {} : { workspaceId: grant.scope.workspaceId }),
      connectionId: grant.scope.connectionId, providerEntityType: "merchant", providerEntityId: grant.scope.sellerId
    }, requestContext: parserContext(grant, request, lease), response
  };
}

function parsePage(input: ReturnType<typeof parserInput>, grant: SquareIngestionGrant) {
  switch (grant.stream) {
    case "order_core": return parseSquareOrderCoreResponse(input);
    case "order_line_items": return parseSquareOrderLineItemResponse(input);
    case "order_adjustments": return parseSquareOrderAdjustmentResponse(input);
    case "order_tenders": return parseSquareOrderTenderResponse(input);
    case "payments": return parseSquarePaymentResponse(input);
    case "refunds": return parseSquareRefundResponse(input);
    case "catalog": return parseSquareCatalogValidatedResponse(input);
    case "inventory": return parseSquareInventoryResponse(input);
  }
}

// Orders predate request-policy cursor validation. Reproduce their unchanged response cursor
// fingerprint against the current trusted context; full query/scope/generation custody is also
// fenced by the repository binding. No accepted token is created or accepted as an input.
function checkOrderCursor(grant: SquareIngestionGrant, request: SquareReadOperationAuthorizationInput, lease: SquarePageLease) {
  if (!lease.cursor || !grant.stream.startsWith("order_")) return;
  if (grant.operation !== "orders_search") throw new Error("cursor_invalid");
  const input = parserInput(grant, request, null, {});
  const provider = squareResponseProvenance(input);
  const requestAuthorityFingerprint = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_order_request_authority", fingerprintVersion: SQUARE_ORDER_REQUEST_AUTHORITY_VERSION,
    provider, operation: grant.operation, connectionAuthority: input.connectionAuthority, requestContext: input.requestContext
  });
  const expected = squareMinimizedProjectionFingerprint({
    fingerprintPurpose: "square_order_response_cursor", fingerprintVersion: "square_order_response_cursor_fingerprint_v1",
    provider, operation: grant.operation, requestAuthorityFingerprint, cursor: lease.cursor.value
  });
  if (lease.cursor.responseFingerprint !== expected) throw new Error("cursor_invalid");
}

function outcome(outcome: SquareIngestionOutcome["outcome"], code: string, extras: Partial<SquareIngestionOutcome> = {}): SquareIngestionOutcome {
  return Object.freeze({ outcome, code, sourceCount: 0, continuation: false, retryAfterMs: null, completeness: null, ...extras });
}

/** No transport/credential/repository/authority defaults; this is deliberately dormant DI only. */
export function createSquareDormantIngestionAdapter(dependencies: Readonly<{
  authority: SquareIngestionAuthority;
  transport: SquareSyntheticTransport;
  repository: SquarePageRepository;
  now?: () => number;
}>) {
  const now = dependencies.now ?? Date.now;
  return Object.freeze({
    async run(invocation: unknown, signal?: AbortSignal): Promise<SquareIngestionOutcome> {
      const controller = new AbortController();
      let resolveCancellation: (value: SquareIngestionOutcome) => void = () => {};
      const cancelled = new Promise<SquareIngestionOutcome>((resolve) => { resolveCancellation = resolve; });
      const cancel = () => { controller.abort(); resolveCancellation(outcome("retry", "cancelled", { retryAfterMs: 30_000 })); };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      let deadline = false;
      let lease: SquarePageLease | null = null;
      let stopped = false;
      const active = () => { if (stopped || controller.signal.aborted) throw new Error("invocation_stopped"); };
      let timeout: ReturnType<typeof setTimeout>;
      const expired = new Promise<SquareIngestionOutcome>((resolve) => {
        timeout = setTimeout(() => {
          deadline = true; stopped = true; controller.abort();
          resolve(outcome("retry", "invocation_deadline", { retryAfterMs: 500 }));
        }, 30_000);
      });
      const work = async (): Promise<SquareIngestionOutcome> => {
        try {
          active();
          const grant = snapshotGrant(await dependencies.authority.resolve(invocation));
          active();
          if (grant.expiresAt <= now()) return outcome("rejected", "authority_expired");
          const initialRequest = requestFor(grant, null);
          const initialDecision = assertSquareReadOperation(initialRequest);
          if (initialDecision.operationKey !== (grant.request.method === "POST" ? `${grant.scope.environment}_${grant.operation}` : grant.operation)) throw new Error("operation_mismatch");
          // Build context before transport, so missing explicit/default location authority fails early.
          parserContext(grant, initialRequest, null);
          const binding: SquarePageBinding = Object.freeze({
            scanKey: contractSha256({ purpose: "square_ingestion_scan_v1", workspaceId: grant.scope.workspaceId,
              businessEntityId: grant.scope.businessEntityId, connectionId: grant.scope.connectionId, stream: grant.stream, scanId: grant.scanId }),
            scopeFingerprint: squareIngestionScopeFingerprint(grant.scope),
            queryFingerprint: contractSha256({ request: initialDecision.requestFingerprint, operation: grant.operation,
              resolvedDefaultLocationId: grant.resolvedDefaultLocationId ?? null }),
            cursorBindingFingerprint: initialDecision.cursorBindingFingerprint, generation: grant.scope.generation
          });
          const acquired = await dependencies.repository.acquire(binding, now());
          active();
          if (acquired.outcome !== "leased") return outcome(acquired.outcome === "finished" ? "finished" : acquired.outcome === "deferred" ? "retry" : acquired.outcome === "conflict" ? "conflict" : "blocked", `checkpoint_${acquired.outcome}`, {
            completeness: acquired.completeness, retryAfterMs: acquired.retryAfterMs
          });
          lease = acquired.lease;
          if (contractSha256(lease.binding) !== contractSha256(binding) || lease.expiresAt <= now() || (lease.cursor && lease.cursor.expiresAt <= now())) throw new Error("lease_invalid");
          const request = requestFor(grant, lease.cursor, binding.cursorBindingFingerprint);
          checkOrderCursor(grant, request, lease);
          const read = await readSquareBoundedResponse({ request, transport: dependencies.transport,
            signal: controller.signal, attempt: lease.attempt, syntheticCredential: "square-synthetic-fixture" });
          active();
          if (read.outcome === "failed") {
            await dependencies.repository.release(lease, { now: now(), retryAfterMs: read.retryAfterMs, blocked: read.retryAfterMs === null });
            return outcome(read.retryAfterMs === null ? "blocked" : "retry", read.code, { retryAfterMs: read.retryAfterMs });
          }
          const parsed = parsePage(parserInput(grant, request, lease, read.response), grant);
          if (parsed.outcome !== "accepted") {
            const completeness = Object.freeze({ pageSequence: "blocked" as const, historical: "unknown" as const, economic: "blocked" as const,
              reasons: Object.freeze(["unsupported_page", "interrupted_scan", "history_unknown"] as const) });
            await dependencies.repository.release(lease, { now: now(), retryAfterMs: null, blocked: true, completeness });
            return outcome("blocked", parsed.outcome === "unsupported" ? "unsupported_page" : "response_rejected", {
              completeness
            });
          }
          // The only path into mapping is the value just returned by this direct parser call.
          // Acceptance is never deserialized, caller-supplied, injected, persisted or replayed.
          const mapped = mapSquareParsedPage(grant.scope, grant.stream, parsed.value, new Date(now()).toISOString(), parsed.value.pagination.cursorPresent);
          if (mapped.completeness.pageSequence === "blocked") {
            await dependencies.repository.release(lease, { now: now(), retryAfterMs: null, blocked: true, completeness: mapped.completeness });
            return outcome("blocked", "unsupported_page", { completeness: mapped.completeness });
          }
          const rawCursor = read.response.cursor;
          const nextCursor: SquarePrivateCursor | null = parsed.value.pagination.cursorPresent ? Object.freeze({
            value: typeof rawCursor === "string" ? rawCursor : "",
            responseFingerprint: parsed.value.pagination.cursorFingerprint!, expiresAt: Math.min(grant.expiresAt, now() + 3_600_000)
          }) : null;
          if (nextCursor && (!nextCursor.value || nextCursor.value.length > 4_096 || !nextCursor.responseFingerprint || nextCursor.value === lease.cursor?.value)) throw new Error("cursor_invalid");
          const refreshed = snapshotGrant(await dependencies.authority.resolve(invocation));
          active();
          if (contractSha256(refreshed) !== contractSha256(grant) || refreshed.expiresAt <= now()) throw new Error("authority_changed");
          const pageId = contractSha256({ purpose: "square_ingestion_page_v1", binding,
            checkpointVersion: lease.checkpointVersion, requestFingerprint: read.decision.requestFingerprint,
            versions: mapped.sources.map((source) => source.versionKey), nextCursorFingerprint: nextCursor?.responseFingerprint ?? null });
          const committed = await dependencies.repository.commitPage({ lease, pageId, sources: mapped.sources,
            completeness: mapped.completeness, nextCursor, now: now() });
          active();
          return outcome(committed.outcome === "conflict" ? "conflict" : "committed", `page_${committed.outcome}`, {
            sourceCount: committed.outcome === "conflict" ? 0 : mapped.sources.length,
            continuation: committed.continuation, completeness: committed.completeness
          });
        } catch {
          // A failed/lost commit acknowledgement is uncertain, not a claimed rollback. The next
          // invocation consults atomic repository state; lease expiry provides bounded recovery.
          return outcome(lease ? "retry" : "rejected", deadline ? "invocation_deadline" : controller.signal.aborted ? "cancelled" : lease ? "invocation_interrupted" : "invocation_rejected", { retryAfterMs: lease ? 30_000 : null });
        }
      };
      try { return await Promise.race([work(), expired, cancelled]); }
      finally { clearTimeout(timeout!); stopped = true; controller.abort(); signal?.removeEventListener("abort", cancel); }
    }
  });
}
