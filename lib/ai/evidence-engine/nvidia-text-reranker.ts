import "server-only";

import {
  RERANK_RESULT_VERSION,
  type EvidenceCandidate,
  type EvidenceReranker,
  type RerankResult
} from "@/lib/ai/evidence-engine/contracts";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

export const NVIDIA_TEXT_RERANKER_MODEL = "nvidia/llama-nemotron-rerank-1b-v2";
export const NVIDIA_TEXT_RERANKER_ADAPTER_VERSION = "nvidia_text_reranker_v1";
const DEFAULT_NVIDIA_RERANK_BASE_URL = "https://integrate.api.nvidia.com/v1";
const MAX_SHADOW_CANDIDATES = 48;
const MAX_PASSAGE_CHARACTERS = 1_800;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type NvidiaRankingPayload = {
  rankings?: Array<{ index?: number; logit?: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

function endpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/ranking") ? normalized : `${normalized}/ranking`;
}

function boundedPassage(candidate: EvidenceCandidate) {
  return [candidate.title, candidate.summary, candidate.excerpt]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PASSAGE_CHARACTERS);
}

export function buildNvidiaTextRerankRequest({
  queryText,
  candidates
}: {
  queryText: string;
  candidates: readonly EvidenceCandidate[];
}) {
  return {
    model: NVIDIA_TEXT_RERANKER_MODEL,
    query: { text: queryText.slice(0, 4_000) },
    passages: candidates.slice(0, MAX_SHADOW_CANDIDATES).map((candidate) => ({ text: boundedPassage(candidate) })),
    truncate: "END" as const
  };
}

function failureResult({
  mode,
  inputCount,
  inputTokens = null,
  latencyMs,
  failureCode
}: {
  mode: "shadow" | "active";
  inputCount: number;
  inputTokens?: number | null;
  latencyMs: number;
  failureCode: NonNullable<RerankResult["failureCode"]>;
}): RerankResult {
  return deepFreeze({
    version: RERANK_RESULT_VERSION,
    adapterId: "nvidia_text_reranker",
    adapterVersion: NVIDIA_TEXT_RERANKER_ADAPTER_VERSION,
    provider: "nvidia",
    model: NVIDIA_TEXT_RERANKER_MODEL,
    mode,
    status: failureCode === "disabled" || failureCode === "missing_credentials" ? "skipped" : "failed",
    rankings: [],
    inputCount,
    inputTokens,
    inputTokensEstimated: inputTokens !== null,
    latencyMs,
    failureCode
  });
}

function transportFailureCode(error: unknown): NonNullable<RerankResult["failureCode"]> {
  const value = `${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : ""}`;
  return /abort|timeout|timed out/i.test(value) ? "timeout" : "transport_failure";
}

export class NvidiaTextReranker implements EvidenceReranker {
  readonly id = "nvidia_text_reranker";
  readonly version = NVIDIA_TEXT_RERANKER_ADAPTER_VERSION;
  readonly provider = "nvidia" as const;
  readonly model = NVIDIA_TEXT_RERANKER_MODEL;

  constructor(private readonly options: {
    apiKey?: string;
    baseUrl?: string;
    fetchImpl?: FetchLike;
  } = {}) {}

  async rerank({
    queryText,
    candidates,
    mode,
    timeoutMs = 3_000
  }: {
    queryText: string;
    candidates: readonly EvidenceCandidate[];
    mode: "shadow" | "active";
    timeoutMs?: number;
  }): Promise<RerankResult> {
    const boundedCandidates = candidates.slice(0, MAX_SHADOW_CANDIDATES);
    const requestBody = buildNvidiaTextRerankRequest({ queryText, candidates: boundedCandidates });
    const estimatedInputTokens = Math.max(
      1,
      Math.ceil((requestBody.query.text.length + requestBody.passages.reduce((sum, passage) => sum + passage.text.length, 0)) / 4)
    );
    const apiKey = this.options.apiKey || process.env.NVIDIA_RERANK_API_KEY || process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return failureResult({ mode, inputCount: boundedCandidates.length, latencyMs: 0, failureCode: "missing_credentials" });
    }
    if (!boundedCandidates.length) {
      return deepFreeze({
        version: RERANK_RESULT_VERSION,
        adapterId: this.id,
        adapterVersion: this.version,
        provider: this.provider,
        model: this.model,
        mode,
        status: "success" as const,
        rankings: [],
        inputCount: 0,
        inputTokens: 0,
        inputTokensEstimated: false,
        latencyMs: 0,
        failureCode: null
      });
    }

    const fetchImpl = this.options.fetchImpl || fetch;
    const controller = new AbortController();
    const safeTimeoutMs = Math.min(Math.max(timeoutMs, 250), 10_000);
    const timeout = setTimeout(() => controller.abort(), safeTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(endpoint(this.options.baseUrl || process.env.NVIDIA_RERANK_BASE_URL || DEFAULT_NVIDIA_RERANK_BASE_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      const responseText = await response.text();
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        const failureCode = response.status === 429
          ? "rate_limit"
          : response.status >= 500
            ? "unavailable"
            : "transport_failure";
        return failureResult({ mode, inputCount: boundedCandidates.length, inputTokens: estimatedInputTokens, latencyMs, failureCode });
      }

      let payload: NvidiaRankingPayload;
      try {
        payload = JSON.parse(responseText) as NvidiaRankingPayload;
      } catch {
        return failureResult({ mode, inputCount: boundedCandidates.length, inputTokens: estimatedInputTokens, latencyMs, failureCode: "malformed_response" });
      }

      const rankings = Array.isArray(payload.rankings) ? payload.rankings : [];
      const indexes = rankings.map((ranking) => ranking.index);
      const complete = rankings.length === boundedCandidates.length && indexes.every(
        (index): index is number => Number.isInteger(index) && Number(index) >= 0 && Number(index) < boundedCandidates.length
      ) && new Set(indexes).size === boundedCandidates.length;
      const validScores = rankings.every((ranking) => typeof ranking.logit === "number" && Number.isFinite(ranking.logit));
      if (!complete || !validScores) {
        return failureResult({ mode, inputCount: boundedCandidates.length, inputTokens: estimatedInputTokens, latencyMs, failureCode: "malformed_response" });
      }

      return deepFreeze({
        version: RERANK_RESULT_VERSION,
        adapterId: this.id,
        adapterVersion: this.version,
        provider: this.provider,
        model: this.model,
        mode,
        status: "success" as const,
        rankings: rankings.map((ranking, index) => ({
          candidateOrdinal: ranking.index as number,
          rank: index + 1,
          score: ranking.logit as number
        })),
        inputCount: boundedCandidates.length,
        inputTokens: payload.usage?.prompt_tokens ?? payload.usage?.total_tokens ?? estimatedInputTokens,
        inputTokensEstimated: payload.usage?.prompt_tokens === undefined && payload.usage?.total_tokens === undefined,
        latencyMs,
        failureCode: null
      });
    } catch (error) {
      return failureResult({
        mode,
        inputCount: boundedCandidates.length,
        inputTokens: estimatedInputTokens,
        latencyMs: Date.now() - startedAt,
        failureCode: transportFailureCode(error)
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function nvidiaTextRerankerShadowEnabled() {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.VAEROEX_NVIDIA_RERANK_SHADOW === "true" &&
    process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM === "preview";
}
