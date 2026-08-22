import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  ProviderRuntimePageSchema,
  RUNTIME_CONTRACT_VERSIONS,
  type RuntimeCheckpointCommit
} from "@/lib/integrations/runtime/contracts";

export type SyntheticRuntimeScenario =
  | "successful_page"
  | "continuation_page"
  | "empty_page"
  | "rate_limit"
  | "transient_5xx"
  | "timeout"
  | "malformed_response"
  | "stale_cursor"
  | "provider_deletion"
  | "mass_update"
  | "authorization_failure"
  | "permanent_error";

export class SyntheticRuntimeProviderError extends Error {
  readonly category:
    | "authorization"
    | "rate_limit"
    | "availability"
    | "timeout"
    | "contract"
    | "data_anomaly";
  readonly safeCode: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(input: {
    category: SyntheticRuntimeProviderError["category"];
    safeCode: string;
    retryable: boolean;
    retryAfterMs?: number | null;
  }) {
    super("synthetic_provider_runtime_failure");
    this.category = input.category;
    this.safeCode = input.safeCode;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }
}

function syntheticRecord(sequence: number, changeKind: "created" | "updated" | "deleted") {
  const identity = contractSha256({
    fingerprintPurpose: "synthetic_provider_record_identity",
    fingerprintVersion: "synthetic_provider_record_identity_v1",
    sequence
  });
  return {
    sourceIdentityFingerprint: identity,
    sourceFingerprint: contractSha256({
      fingerprintPurpose: "synthetic_provider_record",
      fingerprintVersion: "synthetic_provider_record_fingerprint_v1",
      payload: { identity, sequence, changeKind }
    }),
    changeKind,
    normalizedProjection: changeKind === "deleted"
      ? null
      : {
          recordKind: "synthetic_runtime_record",
          recordKey: `synthetic_${sequence}`,
          valueCanonical: String(sequence)
        }
  } as const;
}

export class SyntheticRuntimeProvider {
  #calls = 0;

  get callCount() {
    return this.#calls;
  }

  async fetchPage(input: {
    scenario: SyntheticRuntimeScenario;
    now: Date;
    checkpoint: RuntimeCheckpointCommit | null;
  }) {
    this.#calls += 1;
    const observedAt = input.now.toISOString();
    if (input.scenario === "rate_limit") {
      throw new SyntheticRuntimeProviderError({
        category: "rate_limit",
        safeCode: "synthetic_rate_limited",
        retryable: true,
        retryAfterMs: 30_000
      });
    }
    if (input.scenario === "transient_5xx") {
      throw new SyntheticRuntimeProviderError({
        category: "availability",
        safeCode: "synthetic_provider_unavailable",
        retryable: true
      });
    }
    if (input.scenario === "timeout") {
      throw new SyntheticRuntimeProviderError({
        category: "timeout",
        safeCode: "synthetic_provider_timeout",
        retryable: true
      });
    }
    if (input.scenario === "malformed_response") {
      throw new SyntheticRuntimeProviderError({
        category: "contract",
        safeCode: "synthetic_response_malformed",
        retryable: false
      });
    }
    if (input.scenario === "stale_cursor") {
      throw new SyntheticRuntimeProviderError({
        category: "data_anomaly",
        safeCode: "synthetic_cursor_stale",
        retryable: false
      });
    }
    if (input.scenario === "authorization_failure") {
      throw new SyntheticRuntimeProviderError({
        category: "authorization",
        safeCode: "synthetic_authorization_required",
        retryable: false
      });
    }
    if (input.scenario === "permanent_error") {
      throw new SyntheticRuntimeProviderError({
        category: "contract",
        safeCode: "synthetic_permanent_failure",
        retryable: false
      });
    }

    const count = input.scenario === "mass_update" ? 10_000 : input.scenario === "empty_page" ? 0 : 2;
    const records = Array.from({ length: count }, (_, index) =>
      syntheticRecord(index + 1, input.scenario === "provider_deletion" && index === 0 ? "deleted" : "updated")
    );
    const continuation = input.scenario === "continuation_page" || input.scenario === "mass_update";
    const nextCursor = continuation
      ? {
          protocolVersion: RUNTIME_CONTRACT_VERSIONS.checkpoint,
          cursorKind: "cursor" as const,
          cursorValue: `synthetic_cursor_${this.#calls + 1}`,
          windowStartAt: input.checkpoint?.cursor.windowStartAt ?? null,
          windowEndAt: input.checkpoint?.cursor.windowEndAt ?? null
        }
      : null;
    return ProviderRuntimePageSchema.parse({
      contractVersion: RUNTIME_CONTRACT_VERSIONS.providerPage,
      records,
      nextCursor,
      providerWatermarkAt: observedAt,
      rateLimit: {
        policyVersion: "synthetic_runtime_rate_limit_v1",
        category: "none",
        retryAfterMs: null,
        safeCode: "synthetic_ok",
        observedAt
      }
    });
  }
}
