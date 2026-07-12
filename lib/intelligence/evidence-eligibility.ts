import type { Json } from "@/lib/supabase/types";

export type EvidenceSourceKind = "business_record" | "platform_run" | "business_memory";
export type EvidenceClassification =
  | "business_evidence"
  | "platform_telemetry"
  | "user_failure_state"
  | "invalid_evidence";
export type EvidenceLifecycle = "active" | "inactive" | "failed";

export type EvidenceEligibility = {
  eligible: boolean;
  classification: EvidenceClassification;
  lifecycle: EvidenceLifecycle;
  reason:
    | "eligible"
    | "archived"
    | "deleted"
    | "inactive"
    | "platform_failure"
    | "platform_telemetry"
    | "user_failure_state"
    | "invalid_evidence";
};

type EvidenceRecord = {
  status?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  metadata_json?: Json;
  source_metadata?: Json;
  source_data_json?: Json;
  source_summary?: Json;
  output_json?: Json;
  body_markdown?: string | null;
  analysis_summary?: string | null;
  error_message?: string | null;
  title?: string | null;
  name?: string | null;
  category?: string | null;
  description?: string | null;
  root_cause?: string | null;
  notes?: string | null;
  ai_generated?: boolean | null;
};

const TELEMETRY_CLASSIFICATIONS = new Set([
  "diagnostic",
  "diagnostics",
  "operational_telemetry",
  "platform_failure",
  "platform_telemetry",
  "system_failure",
  "telemetry"
]);
const USER_FAILURE_CLASSIFICATIONS = new Set(["user_failure", "user_failure_state", "user_rejected"]);
const INVALID_CLASSIFICATIONS = new Set(["invalid", "invalid_evidence", "malformed_evidence", "unverified_evidence"]);
const INACTIVE_LIFECYCLES = new Set(["archived", "deleted", "disabled", "inactive", "rejected", "superseded"]);
const INVALID_LIFECYCLES = new Set(["corrupt", "corrupted", "invalid", "malformed"]);
const USER_FAILURE_RUN_STATUSES = new Set(["blocked", "cancelled", "canceled", "rejected"]);
const FAILED_RUN_STATUSES = new Set(["error", "failed", "failure", "timed_out", "timeout"]);
const SUCCESSFUL_RUN_STATUSES = new Set(["complete", "completed", "success", "succeeded"]);

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function metadataRecords(value: EvidenceRecord) {
  return [record(value.metadata_json), record(value.source_metadata), record(value.source_data_json), record(value.source_summary), record(value.output_json)].filter(
    (item): item is Record<string, unknown> => Boolean(item)
  );
}

function nestedValue(objects: Record<string, unknown>[], keys: string[]) {
  for (const object of objects) {
    for (const key of keys) {
      if (key in object) return object[key];
    }

    for (const containerKey of ["evidence", "evidence_lineage", "lineage", "lifecycle"]) {
      const container = record(object[containerKey]);
      if (!container) continue;
      for (const key of keys) {
        if (key in container) return container[key];
      }
    }
  }

  return undefined;
}

function containsPlatformFailureText(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || value === undefined) return false;
  if (typeof value === "string") return isPlatformFailureText(value);
  if (Array.isArray(value)) return value.some((item) => containsPlatformFailureText(item, depth + 1));
  const object = record(value);
  return object ? Object.values(object).some((item) => containsPlatformFailureText(item, depth + 1)) : false;
}

export function classifyEvidenceEligibility(
  value: EvidenceRecord,
  { sourceKind = "business_record" }: { sourceKind?: EvidenceSourceKind } = {}
): EvidenceEligibility {
  if (value.deleted_at) {
    return { eligible: false, classification: "business_evidence", lifecycle: "inactive", reason: "deleted" };
  }
  if (value.archived_at) {
    return { eligible: false, classification: "business_evidence", lifecycle: "inactive", reason: "archived" };
  }

  const metadata = metadataRecords(value);
  const classification = normalized(
    nestedValue(metadata, ["evidence_classification", "record_classification", "classification_type", "classification"])
  );
  const telemetryOnly = nestedValue(metadata, ["telemetry_only", "platform_failure"]) === true;
  const explicitlyIneligible = nestedValue(metadata, ["business_evidence_eligible", "eligible_for_business_evidence"]) === false;
  const explicitlyInvalid = nestedValue(metadata, ["evidence_valid", "valid_business_evidence", "metadata_valid"]) === false;

  if (
    explicitlyInvalid ||
    INVALID_CLASSIFICATIONS.has(classification) ||
    (explicitlyIneligible && !telemetryOnly && !TELEMETRY_CLASSIFICATIONS.has(classification) && !USER_FAILURE_CLASSIFICATIONS.has(classification))
  ) {
    return { eligible: false, classification: "invalid_evidence", lifecycle: "failed", reason: "invalid_evidence" };
  }

  if (USER_FAILURE_CLASSIFICATIONS.has(classification)) {
    return { eligible: false, classification: "user_failure_state", lifecycle: "failed", reason: "user_failure_state" };
  }

  if (telemetryOnly || explicitlyIneligible || TELEMETRY_CLASSIFICATIONS.has(classification)) {
    return {
      eligible: false,
      classification: "platform_telemetry",
      lifecycle: classification.includes("failure") || telemetryOnly ? "failed" : "inactive",
      reason: classification.includes("failure") || telemetryOnly ? "platform_failure" : "platform_telemetry"
    };
  }

  const lifecycle = normalized(
    nestedValue(metadata, ["evidence_lifecycle", "lifecycle_status", "record_lifecycle", "evidence_status"])
  );
  if (INACTIVE_LIFECYCLES.has(lifecycle)) {
    return { eligible: false, classification: "business_evidence", lifecycle: "inactive", reason: "inactive" };
  }
  if (INVALID_LIFECYCLES.has(lifecycle)) {
    return { eligible: false, classification: "invalid_evidence", lifecycle: "failed", reason: "invalid_evidence" };
  }

  if (sourceKind === "platform_run") {
    const status = normalized(value.status);
    if (USER_FAILURE_RUN_STATUSES.has(status)) {
      return { eligible: false, classification: "user_failure_state", lifecycle: "failed", reason: "user_failure_state" };
    }
    if (FAILED_RUN_STATUSES.has(status)) {
      return { eligible: false, classification: "platform_telemetry", lifecycle: "failed", reason: "platform_failure" };
    }
    if (!SUCCESSFUL_RUN_STATUSES.has(status)) {
      return { eligible: false, classification: "platform_telemetry", lifecycle: "inactive", reason: "inactive" };
    }
    if (
      classification !== "business_evidence" &&
      (containsPlatformFailureText(value.output_json) || containsPlatformFailureText((value as { error_message?: unknown }).error_message))
    ) {
      return { eligible: false, classification: "invalid_evidence", lifecycle: "failed", reason: "invalid_evidence" };
    }
  }

  const sourceData = record(value.source_data_json);
  const sourceSummary = record(value.source_summary);
  const generatedBusinessRecord = Boolean(
    sourceData?.generated_from ||
    sourceData?.generatedFrom ||
    sourceData?.evidence_lineage ||
    sourceSummary?.evidence_lineage ||
    sourceSummary?.evidence_classification
  );

  if (
    generatedBusinessRecord &&
    (
      containsPlatformFailureText(value.source_data_json) ||
      containsPlatformFailureText(value.source_summary) ||
      isPlatformFailureText(value.body_markdown) ||
      isPlatformFailureText(value.analysis_summary)
    )
  ) {
    return { eligible: false, classification: "invalid_evidence", lifecycle: "failed", reason: "invalid_evidence" };
  }

  return { eligible: true, classification: "business_evidence", lifecycle: "active", reason: "eligible" };
}

export function isBusinessEvidenceEligible<T extends object>(
  value: T,
  options?: { sourceKind?: EvidenceSourceKind }
) {
  return classifyEvidenceEligibility(value as EvidenceRecord, options).eligible;
}

export function filterBusinessEvidence<T extends object>(
  values: T[] | null | undefined,
  options?: { sourceKind?: EvidenceSourceKind }
) {
  return (values || []).filter((value) => isBusinessEvidenceEligible(value, options));
}

/**
 * Original evidence is a workspace input, not a product-generated interpretation
 * of that input. Keeping this boundary here prevents reports, runs, and setup
 * placeholders from inflating coverage or feeding Business Health.
 */
export function isOriginalBusinessEvidence<T extends object>(
  value: T,
  { sourceKind = "business_record" }: { sourceKind?: EvidenceSourceKind } = {}
) {
  const recordValue = value as T & EvidenceRecord;
  if (!isBusinessEvidenceEligible(recordValue, { sourceKind })) return false;
  if (sourceKind === "platform_run" || sourceKind === "business_memory") return false;

  const metadata = metadataRecords(recordValue);
  const generatedFrom = normalized(nestedValue(metadata, ["generated_from", "generatedFrom", "generated_by", "generatedBy"]));
  const lineageType = normalized(nestedValue(metadata, ["source_type", "sourceType"]));
  const context = [
    recordValue.title,
    recordValue.name,
    recordValue.category,
    recordValue.description,
    recordValue.root_cause,
    recordValue.notes
  ].filter(Boolean).join(" ").toLowerCase();

  if (recordValue.ai_generated || generatedFrom || ["setup", "bootstrap", "demo", "generated_output", "operations_intelligence", "period_report", "file"].includes(lineageType)) {
    return false;
  }

  // Legacy setup rows predate provenance metadata. These phrases are the
  // explicit setup markers written by the onboarding flow, not inferred risk.
  if (
    /\b(starter|initial) (category|sop|forms?|checklists?|asset)\b/.test(context) ||
    /\b(created|generated) during (workspace )?setup\b/.test(context) ||
    (/\bsetup\b/.test(context) && /\b(starter|customize|generated|configured)\b/.test(context))
  ) {
    return false;
  }

  return true;
}

export function filterOriginalBusinessEvidence<T extends object>(
  values: T[] | null | undefined,
  options?: { sourceKind?: EvidenceSourceKind }
) {
  return (values || []).filter((value) => isOriginalBusinessEvidence(value, options));
}

export function isPlatformFailureText(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return false;

  return [
    /\bvaeroex (?:run|request|generation|analysis) (?:failed|timed out|was unavailable)\b/i,
    /\b(?:api key|request id|rate limit|service configuration)\b.*\b(?:error|failed|missing|unavailable|invalid)\b/i,
    /\b(?:generation|completion|model request) (?:failed|timed out|was unavailable)\b/i,
    /\b(?:generated explanation|generated answer|analysis result) was unavailable\b/i,
    /\b(?:supabase is not configured|network request failed|fetch failed)\b/i
  ].some((pattern) => pattern.test(text));
}

export function sanitizeBusinessEvidenceText(value: string | null | undefined, fallback = "") {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return !text || isPlatformFailureText(text) ? fallback : text;
}

export function evidenceLineageMetadata({
  classification = "business_evidence",
  lifecycle = "active",
  sourceType,
  sourceId
}: {
  classification?: EvidenceClassification;
  lifecycle?: EvidenceLifecycle;
  sourceType: string;
  sourceId?: string | null;
}) {
  return {
    evidence_classification: classification,
    evidence_lifecycle: lifecycle,
    evidence_lineage: {
      source_type: sourceType,
      source_id: sourceId || null
    }
  } satisfies Json;
}
