import {
  RERANK_RESULT_VERSION,
  type EvidenceCandidate,
  type EvidenceReranker,
  type RerankResult
} from "@/lib/ai/evidence-engine/contracts";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";
import { EvidenceDecisionTrace } from "@/lib/ai/evidence-engine/tracing";

export class DeterministicNoopReranker implements EvidenceReranker {
  readonly id = "deterministic_noop";
  readonly version = "deterministic_noop_v1";
  readonly provider = "deterministic" as const;
  readonly model = "deterministic";

  async rerank({ candidates, mode }: { queryText: string; candidates: readonly EvidenceCandidate[]; mode: "shadow" | "active" }) {
    return deepFreeze({
      version: RERANK_RESULT_VERSION,
      adapterId: this.id,
      adapterVersion: this.version,
      provider: this.provider,
      model: this.model,
      mode,
      status: "success" as const,
      rankings: candidates.map((candidate, index) => ({
        candidateOrdinal: index,
        rank: index + 1,
        score: candidate.retrieval.score
      })),
      inputCount: candidates.length,
      inputTokens: null,
      inputTokensEstimated: false,
      latencyMs: 0,
      failureCode: null
    });
  }
}

export function applyRerankResult(
  candidates: readonly EvidenceCandidate[],
  result: RerankResult
) {
  if (result.status !== "success") return [...candidates];
  const ordinals = result.rankings.map((ranking) => ranking.candidateOrdinal);
  const validOrdinals = ordinals.length === candidates.length &&
    new Set(ordinals).size === candidates.length &&
    ordinals.every((ordinal) => Number.isInteger(ordinal) && ordinal >= 0 && ordinal < candidates.length);
  if (!validOrdinals) return [...candidates];
  const byOrdinal = new Map(candidates.map((candidate, index) => [index, candidate]));
  const ordered = result.rankings.map((ranking) => byOrdinal.get(ranking.candidateOrdinal));
  if (ordered.some((candidate) => !candidate) || ordered.length !== candidates.length) return [...candidates];
  return ordered as EvidenceCandidate[];
}

export async function runEvidenceRerankerShadow({
  queryText,
  candidates,
  reranker,
  trace
}: {
  queryText: string;
  candidates: readonly EvidenceCandidate[];
  reranker: EvidenceReranker;
  trace?: EvidenceDecisionTrace;
}) {
  const startedAt = Date.now();
  try {
    const result = await reranker.rerank({ queryText, candidates, mode: "shadow" });
    trace?.add({
      stage: "rerank",
      status: result.status === "success" ? "success" : result.status,
      durationMs: result.latencyMs,
      inputCount: candidates.length,
      outputCount: result.rankings.length,
      provider: result.provider,
      model: result.model,
      reasonCode: result.failureCode
    });
    return deepFreeze({ activeCandidates: [...candidates], shadowResult: result });
  } catch {
    const latencyMs = Date.now() - startedAt;
    trace?.add({
      stage: "rerank",
      status: "fallback",
      durationMs: latencyMs,
      inputCount: candidates.length,
      outputCount: candidates.length,
      provider: reranker.provider,
      model: reranker.model,
      reasonCode: "transport_failure"
    });
    return deepFreeze({ activeCandidates: [...candidates], shadowResult: null });
  }
}
