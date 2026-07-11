const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { VAEROEX_ANSWER_BENCHMARK_FIXTURES } = require("../lib/ai/answer-quality-benchmark-fixtures.ts");
const { planVaeroexQuery } = require("../lib/ai/query-depth-planner.ts");
const { resolveVaeroexModel } = require("../lib/ai/model-routing.ts");
const { estimateTokenCount, estimatedCostCents } = require("../lib/ai/usage.ts");

const live = process.env.VAEROEX_BENCHMARK_LIVE === "1";

function extractText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text.trim();
    }
  }

  return "";
}

function firstSentence(answer) {
  return answer.trim().split(/(?<=[.!?])\s+/)[0] || "";
}

function numericClaims(value) {
  return new Set((value.match(/\b\d+(?:\.\d+)?\b/g) || []).map((item) => item.replace(/^0+/, "") || "0"));
}

function qualityScores(fixture, answer) {
  const normalized = answer.toLowerCase();
  const first = firstSentence(answer);
  const qualifyingStart = /^(based on|the available evidence|there is limited|confidence|leadership should|evidence indicates)/i.test(first);
  const relevantTerms = fixture.relevanceTerms.filter((term) => normalized.includes(term.toLowerCase())).length;
  const supportedNumbers = numericClaims(fixture.evidence.join(" "));
  const answerNumbers = numericClaims(answer);
  const unsupportedNumbers = [...answerNumbers].filter((number) => !supportedNumbers.has(number));
  const jargon = (answer.match(/\b(retrieval|vector|embedding|workspace snapshot|pipeline execution|orchestration|synergy|leverage)\b/gi) || []).length;
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const communicatesUncertainty = /\b(not enough|cannot|uncertain|limited|does not show|cannot be reconciled|directional)\b/i.test(answer);
  const unsupportedActions = /\b(assign an owner|create (a )?task|build a workflow|set a due date|create a crm record)\b/i.test(answer);

  return {
    direct_answer: qualifyingStart ? 2 : first.length >= 12 ? 5 : 3,
    relevant_evidence: relevantTerms >= Math.min(3, fixture.relevanceTerms.length) ? 5 : relevantTerms >= 1 ? 3 : 1,
    unsupported_claims: unsupportedNumbers.length ? 1 : 5,
    plain_language: jargon ? Math.max(1, 5 - jargon * 2) : 5,
    concise: words <= 120 ? 5 : words <= 180 ? 4 : words <= 260 ? 3 : 1,
    uncertainty: fixture.lowEvidence || fixture.id === "contradictory-evidence" ? (communicatesUncertainty ? 5 : 1) : 5,
    supported_next_considerations: unsupportedActions ? 1 : 5
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function modelCandidates(route) {
  const configured = (process.env.VAEROEX_BENCHMARK_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidate = process.env.VAEROEX_BENCHMARK_CANDIDATE_MODEL?.trim();
  return Array.from(new Set([resolveVaeroexModel(route), candidate, ...configured].filter(Boolean)));
}

async function runModel(fixture, plan, model) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for a live benchmark.");

  const requestBody = {
    model,
    temperature: 0.1,
    max_output_tokens: plan.tier === 3 ? 900 : 550,
    input: [
      {
        role: "system",
        content:
          "You are Vaeroex, an Operations Intelligence advisor. Answer the exact question in the first sentence. Use only the supplied safe benchmark evidence. Do not invent facts, numbers, causes, or recommendations. Use plain business language and state meaningful uncertainty."
      },
      {
        role: "user",
        content: JSON.stringify({
          question: fixture.prompt,
          execution_path: plan.classification,
          evidence: fixture.evidence,
          answer_contract: ["Direct answer", "Brief evidence note", "Meaningful limitation only when needed"]
        })
      }
    ]
  };
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(plan.timeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    throw new Error(`OpenAI benchmark request failed with status ${response.status}.`);
  }

  const answer = extractText(payload);
  if (!answer) throw new Error("OpenAI benchmark returned an empty answer.");
  const inputTokens = payload.usage?.input_tokens || estimateTokenCount(JSON.stringify(requestBody));
  const outputTokens = payload.usage?.output_tokens || estimateTokenCount(answer);

  return {
    answer,
    latencyMs,
    inputTokens,
    outputTokens,
    estimatedCostCents: estimatedCostCents({ inputTokens, outputTokens, model })
  };
}

async function main() {
  const results = [];
  let routingMatches = 0;
  const routingStartedAt = performance.now();

  for (const fixture of VAEROEX_ANSWER_BENCHMARK_FIXTURES) {
    const planStartedAt = performance.now();
    const plan = planVaeroexQuery({
      query: fixture.prompt,
      contextType: fixture.contextType,
      hasSelectedContext: fixture.hasSelectedContext
    });
    const plannerLatencyMs = performance.now() - planStartedAt;
    const routeMatched = plan.classification === fixture.expectedClass;
    const domainsMatched = fixture.expectedDomains.every((domain) => plan.domains.includes(domain));
    if (routeMatched && domainsMatched) routingMatches += 1;

    const fallbackScores = qualityScores(fixture, fixture.deterministicAnswer);
    results.push({
      fixture: fixture.name,
      path: plan.classification,
      model: "deterministic-fallback",
      routeMatched,
      domainsMatched,
      plannerLatencyMs,
      latencyMs: plannerLatencyMs,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostCents: 0,
      failed: false,
      quality: average(Object.values(fallbackScores)),
      scores: fallbackScores
    });

    if (live && plan.requiresOpenAI) {
      const route = plan.tier === 3 ? "cross_business_reasoning" : "focused_explanation";

      for (const model of modelCandidates(route)) {
        try {
          const modelResult = await runModel(fixture, plan, model);
          const scores = qualityScores(fixture, modelResult.answer);
          results.push({
            fixture: fixture.name,
            path: plan.classification,
            model,
            routeMatched,
            domainsMatched,
            plannerLatencyMs,
            ...modelResult,
            failed: false,
            quality: average(Object.values(scores)),
            scores
          });
        } catch (error) {
          results.push({
            fixture: fixture.name,
            path: plan.classification,
            model,
            routeMatched,
            domainsMatched,
            plannerLatencyMs,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostCents: 0,
            failed: true,
            error: error instanceof Error ? error.message : String(error),
            quality: 0
          });
        }
      }
    }
  }

  const routingMs = performance.now() - routingStartedAt;
  const summaries = Object.values(
    results.reduce((groups, result) => {
      const key = `${result.model}:${result.path}`;
      groups[key] ||= { model: result.model, path: result.path, runs: 0, failures: 0, latency: [], quality: [], inputTokens: 0, outputTokens: 0, costCents: 0 };
      groups[key].runs += 1;
      groups[key].failures += result.failed ? 1 : 0;
      groups[key].latency.push(result.latencyMs);
      groups[key].quality.push(result.quality);
      groups[key].inputTokens += result.inputTokens;
      groups[key].outputTokens += result.outputTokens;
      groups[key].costCents += result.estimatedCostCents;
      return groups;
    }, {})
  ).map((group) => ({
    model: group.model,
    path: group.path,
    runs: group.runs,
    failures: group.failures,
    averageLatencyMs: Number(average(group.latency).toFixed(2)),
    averageQuality: Number(average(group.quality).toFixed(2)),
    inputTokens: group.inputTokens,
    outputTokens: group.outputTokens,
    estimatedCostCents: group.costCents
  }));

  console.log(JSON.stringify({
    mode: live ? "live-safe-demo" : "offline-routing-and-fallback",
    liveModelBenchmarkSkipped: !live,
    routing: {
      matched: routingMatches,
      total: VAEROEX_ANSWER_BENCHMARK_FIXTURES.length,
      totalLatencyMs: Number(routingMs.toFixed(2))
    },
    summaries,
    results
  }, null, 2));

  if (routingMatches !== VAEROEX_ANSWER_BENCHMARK_FIXTURES.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
