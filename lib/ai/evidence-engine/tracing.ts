import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

export type EvidenceTraceStage =
  | "candidate_retrieval"
  | "eligibility_filter"
  | "source_registry"
  | "rerank"
  | "signal_plan"
  | "manifest"
  | "citation_verification";

export type EvidenceTraceEvent = Readonly<{
  stage: EvidenceTraceStage;
  status: "started" | "success" | "skipped" | "failed" | "fallback";
  durationMs: number | null;
  inputCount: number | null;
  outputCount: number | null;
  provider: "deterministic" | "nvidia" | null;
  model: string | null;
  reasonCode: string | null;
}>;

const ALLOWED_TRACE_KEYS = new Set([
  "stage",
  "status",
  "durationMs",
  "inputCount",
  "outputCount",
  "provider",
  "model",
  "reasonCode"
]);

export class EvidenceDecisionTrace {
  readonly version = "evidence_decision_trace_v1" as const;
  private readonly events: EvidenceTraceEvent[] = [];

  add(event: EvidenceTraceEvent) {
    const keys = Object.keys(event);
    if (keys.some((key) => !ALLOWED_TRACE_KEYS.has(key))) {
      throw new Error("Evidence decision traces may contain only content-free fields.");
    }
    this.events.push(deepFreeze({ ...event }));
  }

  snapshot() {
    return deepFreeze({ version: this.version, events: [...this.events] });
  }
}
