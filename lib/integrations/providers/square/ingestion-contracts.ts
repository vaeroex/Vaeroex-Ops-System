import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import type { ContractJsonValue } from "@/lib/integrations/contracts/primitives";
import type { ExternalSourceRecordVersion } from "@/lib/integrations/contracts/source-facts";
import type { SquareProviderEnvironmentKey } from "@/lib/integrations/providers/square/contracts";
import type { SquareReadOperationAuthorizationInput, SquareReadOperationDecision } from "@/lib/integrations/providers/square/request-validators";

export const SQUARE_INGESTION_VERSION = "square_dormant_ingestion_v1" as const;
export const SQUARE_INGESTION_STREAMS = [
  "order_core", "order_line_items", "order_adjustments", "order_tenders",
  "payments", "refunds", "catalog", "inventory"
] as const;
export type SquareIngestionStream = (typeof SQUARE_INGESTION_STREAMS)[number];

/** Explicit injected authority, NOT an OAuth or Merchant/Location verification implementation. */
export type SquareIngestionScope = Readonly<{
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  sellerId: string;
  environment: SquareProviderEnvironmentKey;
  authorizedLocationIds: readonly string[];
  generation: number;
}>;

/** Trusted/internal callers only: generation is a separate CAS fence, never resource identity. */
export function squareIngestionScopeFingerprint(scope: SquareIngestionScope): string {
  return contractSha256({
    purpose: "square_ingestion_scope_v1", workspaceId: scope.workspaceId,
    businessEntityId: scope.businessEntityId, connectionId: scope.connectionId,
    sellerId: scope.sellerId, environment: scope.environment,
    authorizedLocationIds: [...scope.authorizedLocationIds].sort()
  });
}

/** Trusted resolver supplies a cursor-free request. There is no public ID-to-authority mint. */
export type SquareIngestionGrant = Readonly<{
  scope: SquareIngestionScope;
  stream: SquareIngestionStream;
  operation: string;
  scanId: string;
  request: Readonly<{ method: "GET" | "POST"; url: string; body: string | null }>;
  /** OAuth/location discovery must establish this when ListPayments omits location_id. */
  resolvedDefaultLocationId?: string;
  expiresAt: number;
}>;
export interface SquareIngestionAuthority {
  resolve(invocation: unknown): Promise<SquareIngestionGrant | null>;
}

/** Transport implementations must honor manual redirects and AbortSignal; no live implementation exists. */
export type SquareSyntheticTransportRequest = Readonly<{
  method: "GET" | "POST";
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string | null;
  redirect: "manual";
  signal: AbortSignal;
}>;
export type SquareSyntheticTransportResponse = Readonly<{
  status: number;
  url: string;
  redirected: boolean;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
  cancel(): void | Promise<void>;
}>;
export type SquareSyntheticTransport = (request: SquareSyntheticTransportRequest) => Promise<SquareSyntheticTransportResponse>;
export type SquareReadFailureCode =
  | "authorization" | "rate_limited" | "transient" | "malformed_response"
  | "provider_error" | "redirect_denied" | "destination_denied" | "response_too_large"
  | "deadline" | "cancelled" | "request_denied";
export type SquareReadOutcome =
  | Readonly<{ outcome: "read"; response: Readonly<Record<string, ContractJsonValue>>; decision: SquareReadOperationDecision }>
  | Readonly<{ outcome: "failed"; code: SquareReadFailureCode; retryAfterMs: number | null }>;
export type SquareBoundedReadInput = Readonly<{
  request: SquareReadOperationAuthorizationInput;
  transport: SquareSyntheticTransport;
  signal?: AbortSignal;
  attempt: number;
  /** Synthetic only: never a real credential, nor an environment lookup. */
  syntheticCredential: "square-synthetic-fixture";
}>;

export type SquareCompletenessReason =
  | "partial_page_sequence" | "history_unknown" | "economic_fields_omitted"
  | "references_unresolved" | "returns_unknown" | "eventual_consistency"
  | "overlapping_representations" | "inventory_optional" | "unsupported_page"
  | "interrupted_scan" | "unordered_provider_revision";
export type SquarePageCompleteness = Readonly<{
  pageSequence: "partial" | "finished" | "blocked";
  historical: "unknown";
  economic: "blocked";
  reasons: readonly SquareCompletenessReason[];
}>;
export type SquareProviderRevision = Readonly<{
  version: string | null;
  updatedAt: string | null;
}>;
/** Pre-allocation pending observation. Immutable ordinal/priorVersionId are allocated atomically by the repository. */
export type SquarePendingSource = Readonly<{
  resourceKey: string;
  versionKey: string;
  scope: SquareIngestionScope;
  stream: SquareIngestionStream;
  providerRecordId: string;
  providerRecordType: string;
  providerRevision: SquareProviderRevision;
  observedAt: string;
  deleted: boolean;
  projection: Readonly<Record<string, ContractJsonValue>> | null;
}>;
export type SquareMappedPage = Readonly<{
  sources: readonly SquarePendingSource[];
  completeness: SquarePageCompleteness;
}>;
export type SquareProviderOrdering = "same" | "newer" | "older" | "conflict" | "unordered";
export type SquareStoredSource = Readonly<{
  pending: SquarePendingSource;
  version: ExternalSourceRecordVersion;
  ordering: SquareProviderOrdering;
}>;

/** Private cursor values never occur in public adapter outcomes or diagnostics. */
export type SquarePrivateCursor = Readonly<{
  value: string;
  responseFingerprint: string;
  expiresAt: number;
}>;
export type SquarePageBinding = Readonly<{
  scanKey: string;
  scopeFingerprint: string;
  queryFingerprint: string;
  cursorBindingFingerprint: string;
  generation: number;
}>;
export type SquarePageLease = Readonly<{
  binding: SquarePageBinding;
  leaseId: string;
  expiresAt: number;
  checkpointVersion: number;
  cursor: SquarePrivateCursor | null;
  attempt: number;
  pageNumber: number;
}>;
export type SquareLeaseResult =
  | Readonly<{ outcome: "leased"; lease: SquarePageLease }>
  | Readonly<{ outcome: "finished" | "conflict" | "expired" | "blocked" | "deferred"; completeness: SquarePageCompleteness | null; retryAfterMs: number | null }>;
export type SquarePageCommitResult = Readonly<{
  outcome: "committed" | "replayed" | "conflict";
  completeness: SquarePageCompleteness | null;
  continuation: boolean;
}>;
export type SquareAtomicPageCommit = Readonly<{
  lease: SquarePageLease;
  pageId: string;
  sources: readonly SquarePendingSource[];
  completeness: SquarePageCompleteness;
  nextCursor: SquarePrivateCursor | null;
  now: number;
}>;
/**
 * A future durable implementation MUST atomically fence current tenant/generation + lease/CAS,
 * deduplicate versionKey, allocate immutable versions and commit the private cursor. Lost-ACK
 * retries return the committed checkpoint. No source-first/checkpoint-first split is permitted.
 * Implementations retain source versions without promoting unordered/conflicting/older values.
 * The in-memory implementation is a bounded synthetic model, not database crash durability.
 */
export interface SquarePageRepository {
  acquire(binding: SquarePageBinding, now: number): Promise<SquareLeaseResult>;
  commitPage(command: SquareAtomicPageCommit): Promise<SquarePageCommitResult>;
  release(lease: SquarePageLease, input: Readonly<{ now: number; retryAfterMs: number | null; blocked: boolean; completeness?: SquarePageCompleteness }>): Promise<void>;
}

export type SquareIngestionOutcome = Readonly<{
  outcome: "committed" | "finished" | "retry" | "rejected" | "blocked" | "conflict";
  code: string;
  sourceCount: number;
  continuation: boolean;
  retryAfterMs: number | null;
  completeness: SquarePageCompleteness | null;
}>;
