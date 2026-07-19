const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
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

const {
  EVIDENCE_CANDIDATE_VERSION,
  EVIDENCE_MANIFEST_VERSION
} = require("../lib/ai/evidence-engine/contracts.ts");
const { buildSourceRegistry } = require("../lib/ai/evidence-engine/source-registry.ts");
const { buildEvidenceManifest } = require("../lib/ai/evidence-engine/manifest.ts");
const {
  CONTINUOUS_INTELLIGENCE_TELEMETRY_VERSION,
  CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION
} = require("../lib/ai/continuous-intelligence/contracts.ts");
const {
  contentFreeContinuousIntelligenceLog
} = require("../lib/ai/continuous-intelligence/telemetry.ts");
const {
  KPI_SUMMARY_V1_VERSION,
  runKpiSummaryV1
} = require("../lib/ai/continuous-intelligence/kpi-summary-v1.ts");
const {
  BUSINESS_HEALTH_DRIVERS_V1_VERSION,
  runBusinessHealthDriversV1
} = require("../lib/ai/continuous-intelligence/business-health-drivers-v1.ts");
const {
  EVIDENCE_CHANGE_SUMMARY_V1_VERSION,
  runEvidenceChangeSummaryV1
} = require("../lib/ai/continuous-intelligence/evidence-change-summary-v1.ts");

function candidate(id, overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-a";
  const evidenceRole = overrides.evidenceRole || "original";
  const sourceKey = overrides.sourceKey || `file:${id}`;
  const independentSourceKey = overrides.independentSourceKey || sourceKey;
  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId: id,
    workspaceId,
    domain: overrides.domain || "finance",
    recordType: overrides.recordType || "metric",
    title: overrides.title || id,
    excerpt: overrides.excerpt || `${id} eligible evidence`,
    summary: overrides.summary || null,
    evidenceRole,
    source: {
      sourceType: overrides.sourceType || "source_file",
      sourceId: overrides.sourceId || sourceKey,
      sourceFileId: overrides.sourceFileId || sourceKey,
      parentSourceId: overrides.parentSourceId || sourceKey,
      canonicalSourceKey: `${workspaceId}:${sourceKey}`,
      independentSourceKey: evidenceRole === "original" ? `${workspaceId}:${independentSourceKey}` : null
    },
    provenance: {
      recordId: overrides.recordId || id,
      indexedAt: overrides.indexedAt || "2026-07-19T00:00:00.000Z",
      recordedAt: overrides.recordedAt || "2026-07-01T00:00:00.000Z",
      lineageVersion: overrides.lineageVersion || "test_lineage_v1"
    },
    eligibility: {
      eligible: overrides.eligible !== false,
      lifecycleState: overrides.lifecycleState || "active",
      originalEvidenceEligible: overrides.originalEvidenceEligible ?? evidenceRole === "original",
      decisionVersion: overrides.decisionVersion || "test_eligibility_v1"
    },
    quality: overrides.quality || "high",
    confidenceScore: overrides.confidenceScore ?? 80,
    retrieval: {
      mode: "structured",
      baseRank: overrides.baseRank || 1,
      score: overrides.score ?? 0.8,
      embeddingVersion: null
    }
  };
}

function manifestFor(candidates, overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-a";
  const registry = buildSourceRegistry({ workspaceId, candidates });
  return buildEvidenceManifest({
    workspaceId,
    queryText: overrides.queryText || "continuous intelligence scope",
    candidates,
    sourceRegistry: registry,
    generatedAt: overrides.generatedAt || "2026-07-19T01:00:00.000Z",
    candidateRetrieverVersion: "retriever-v1",
    embeddingVersion: "embedding-v1",
    rerankerVersion: "deterministic-noop-v1",
    signalPlannerVersion: "signal-planner-v1"
  });
}

function contextFor(manifest, authorizedWorkspaceId = manifest.workspaceId) {
  return {
    authorizedWorkspaceId,
    manifest,
    sourceRegistry: manifest.sourceRegistry
  };
}

function remapCitationReferences(value, fromManifest, toManifest) {
  const candidateByCitation = new Map(fromManifest.evidence.map((entry) => [entry.citationId, entry.candidateId]));
  const citationByCandidate = new Map(toManifest.evidence.map((entry) => [entry.candidateId, entry.citationId]));

  function remap(child) {
    if (Array.isArray(child)) return child.map(remap);
    if (!child || typeof child !== "object") return child;
    return Object.fromEntries(Object.entries(child).map(([key, nested]) => {
      if (key === "citationIds" && Array.isArray(nested)) {
        return [key, nested
          .map((citationId) => citationByCandidate.get(candidateByCitation.get(citationId)))
          .filter((citationId) => Number.isInteger(citationId))];
      }
      return [key, remap(nested)];
    }));
  }

  return remap(value);
}

function inputForManifest(input, fromManifest, toManifest) {
  const { evidenceContext: _evidenceContext, ...contractInput } = input;
  return {
    ...remapCitationReferences(contractInput, fromManifest, toManifest),
    evidenceContext: contextFor(toManifest)
  };
}

function kpiRecord(overrides = {}) {
  return {
    recordId: overrides.recordId || "revenue-june",
    metricKey: overrides.metricKey || "revenue",
    name: overrides.name || "Revenue",
    actualValue: overrides.actualValue ?? 100,
    target: overrides.target ?? null,
    metricDate: overrides.metricDate || "2026-06-30",
    updatedAt: overrides.updatedAt || "2026-07-01T00:00:00.000Z",
    citationIds: overrides.citationIds || [1]
  };
}

function healthDriver(overrides = {}) {
  return {
    driverId: overrides.driverId || "revenue",
    name: overrides.name || "Revenue",
    value: overrides.value ?? 100,
    direction: overrides.direction || "unfavorable",
    weight: overrides.weight ?? 0.8,
    scoreContribution: overrides.scoreContribution ?? -12,
    period: overrides.period || "June 2026",
    freshness: overrides.freshness || "current",
    agreement: overrides.agreement || "aligned",
    citationIds: overrides.citationIds || [1]
  };
}

function evidenceChange(overrides = {}) {
  return {
    changeId: overrides.changeId || "revenue-change",
    recordName: overrides.recordName || "Revenue",
    previousValue: overrides.previousValue ?? 110,
    currentValue: overrides.currentValue ?? 100,
    direction: overrides.direction || "decreased",
    magnitude: overrides.magnitude ?? -10,
    unit: overrides.unit || null,
    period: overrides.period || "June 2026",
    material: overrides.material ?? true,
    rank: overrides.rank ?? 1,
    freshness: overrides.freshness || "current",
    updatedAt: overrides.updatedAt || "2026-07-01T00:00:00.000Z",
    citationIds: overrides.citationIds || [1]
  };
}

function withoutTiming(telemetry) {
  return { ...telemetry, executionMs: 0 };
}

function assertContentFreeTelemetry(telemetry) {
  const serialized = contentFreeContinuousIntelligenceLog(telemetry);
  for (const forbidden of [
    "workspace-a",
    "source-a",
    "Retail Performance workbook",
    "Revenue was 100",
    "customer evidence"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `Telemetry leaked ${forbidden}`);
  }
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    "candidateCount",
    "contractId",
    "contractVersion",
    "deterministicFallback",
    "evidenceManifestVersion",
    "executionMs",
    "fingerprint",
    "freshness",
    "independentSourceCount",
    "outcome",
    "provider",
    "reasonCodes",
    "sourceCount",
    "telemetryVersion",
    "validationOutcome",
    "validatorVersion"
  ].sort());
}

function main() {
  assert.equal(CONTINUOUS_INTELLIGENCE_TELEMETRY_VERSION, "continuous_intelligence_telemetry_v1");
  assert.equal(CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION, "continuous_intelligence_validator_v1");
  assert.equal(KPI_SUMMARY_V1_VERSION, 1);
  assert.equal(BUSINESS_HEALTH_DRIVERS_V1_VERSION, 1);
  assert.equal(EVIDENCE_CHANGE_SUMMARY_V1_VERSION, 1);

  const baseCandidates = [
    candidate("revenue-june", {
      sourceKey: "file:retail",
      independentSourceKey: "file:retail",
      sourceId: "source-a",
      sourceFileId: "source-a",
      title: "Retail Performance workbook",
      excerpt: "Revenue was 100 in June 2026."
    }),
    candidate("revenue-may", {
      sourceKey: "file:retail",
      independentSourceKey: "file:retail",
      sourceId: "source-a",
      sourceFileId: "source-a",
      title: "Retail Performance workbook",
      excerpt: "Revenue was 110 in May 2026."
    }),
    candidate("rating-june", {
      sourceKey: "file:customer",
      independentSourceKey: "file:customer",
      sourceId: "source-b",
      sourceFileId: "source-b",
      domain: "customer",
      title: "Customer Feedback workbook",
      excerpt: "Customer Rating was 4.2 in June 2026."
    })
  ];
  const manifest = manifestFor(baseCandidates);
  assert.equal(manifest.version, EVIDENCE_MANIFEST_VERSION);
  const kpiInput = {
    evidenceContext: contextFor(manifest),
    asOf: "2026-07-19T00:00:00.000Z",
    records: [
      kpiRecord({ citationIds: [1] }),
      kpiRecord({ recordId: "revenue-may", actualValue: 110, metricDate: "2026-05-31", citationIds: [2] }),
      kpiRecord({
        recordId: "rating-june",
        metricKey: "customer-rating",
        name: "Customer Rating",
        actualValue: 4.2,
        metricDate: "2026-06-30",
        citationIds: [3]
      })
    ],
    settings: [
      { metricKey: "revenue", target: 120, direction: "higher", weight: 2, sortOrder: 1 },
      { metricKey: "customer-rating", direction: "higher", weight: 1, sortOrder: 2 },
      { metricKey: "unrelated-hidden-setting", target: 999, visible: false }
    ]
  };
  let capturedTelemetry;
  const kpiResult = runKpiSummaryV1({ ...kpiInput, onTelemetry: (telemetry) => { capturedTelemetry = telemetry; } });
  assert.equal(kpiResult.output.contract, "kpi_summary_v1");
  assert.equal(kpiResult.output.attribution.provider, "deterministic");
  assert.equal(kpiResult.output.metrics.length, 2);
  assert.equal(kpiResult.output.metrics[0].name, "Revenue");
  assert.equal(kpiResult.output.metrics[0].movement, "decreased");
  assert.equal(kpiResult.output.metrics[0].performanceStatus, "needs_attention");
  assert.equal(kpiResult.output.metrics[0].changePercent, -9.09);
  assert.deepEqual(kpiResult.output.metrics[0].citationIds, [1, 2]);
  assert.equal(kpiResult.output.evidence.independentSourceCount, 2);
  assert.equal(kpiResult.output.confidence, "Medium", "missing history on one metric must preserve a conservative ceiling");
  assert.equal(kpiResult.telemetry.validationOutcome, "valid");
  assert.equal(kpiResult.telemetry.provider, "deterministic");
  assert.equal(kpiResult.telemetry.candidateCount, 3);
  assert.equal(Object.isFrozen(kpiResult.output), true);
  assertContentFreeTelemetry(capturedTelemetry);

  const repeatedKpi = runKpiSummaryV1(kpiInput);
  assert.deepEqual(repeatedKpi.output, kpiResult.output, "deterministic output must repeat exactly");
  assert.deepEqual(withoutTiming(repeatedKpi.telemetry), withoutTiming(kpiResult.telemetry));

  const regeneratedManifest = manifestFor(baseCandidates, { generatedAt: "2026-07-19T03:00:00.000Z" });
  const regenerated = runKpiSummaryV1({ ...kpiInput, evidenceContext: contextFor(regeneratedManifest) });
  assert.equal(regenerated.output.fingerprint, kpiResult.output.fingerprint, "generated_at must not invalidate a fingerprint");

  const unrelatedCandidate = candidate("inventory-unrelated", {
    sourceKey: "file:inventory",
    independentSourceKey: "file:inventory",
    title: "Inventory workbook",
    excerpt: "Inventory evidence outside this KPI scope."
  });
  const expandedManifest = manifestFor([...baseCandidates, unrelatedCandidate]);
  const expanded = runKpiSummaryV1({
    ...kpiInput,
    evidenceContext: contextFor(expandedManifest),
    settings: [...kpiInput.settings, { metricKey: "inventory", target: 500, direction: "lower" }]
  });
  assert.equal(expanded.output.fingerprint, kpiResult.output.fingerprint, "unrelated evidence and settings must not churn a scoped fingerprint");

  const secondUnrelatedCandidate = candidate("orders-unrelated", {
    sourceKey: "file:orders",
    independentSourceKey: "file:orders",
    title: "Orders workbook",
    excerpt: "Orders evidence outside this KPI scope."
  });
  const unrelatedBeforeManifest = manifestFor([unrelatedCandidate, ...baseCandidates]);
  const unrelatedBefore = runKpiSummaryV1(inputForManifest(kpiInput, manifest, unrelatedBeforeManifest));
  assert.equal(
    unrelatedBefore.output.fingerprint,
    kpiResult.output.fingerprint,
    "adding unrelated evidence before relevant evidence must not churn the fingerprint"
  );
  const reorderedUnrelatedManifest = manifestFor([secondUnrelatedCandidate, unrelatedCandidate, ...baseCandidates]);
  const reversedUnrelatedManifest = manifestFor([unrelatedCandidate, ...baseCandidates, secondUnrelatedCandidate]);
  const reorderedUnrelated = runKpiSummaryV1(inputForManifest(kpiInput, manifest, reorderedUnrelatedManifest));
  const reversedUnrelated = runKpiSummaryV1(inputForManifest(kpiInput, manifest, reversedUnrelatedManifest));
  assert.equal(reorderedUnrelated.output.fingerprint, kpiResult.output.fingerprint);
  assert.equal(reversedUnrelated.output.fingerprint, kpiResult.output.fingerprint);
  assert.equal(
    reorderedUnrelated.output.fingerprint,
    reversedUnrelated.output.fingerprint,
    "unrelated source and citation ordinal renumbering must not affect the fingerprint"
  );

  const relevantContentChangedManifest = manifestFor([
    { ...baseCandidates[0], excerpt: "Revenue was revised to 101 in June 2026." },
    ...baseCandidates.slice(1)
  ]);
  const relevantContentChanged = runKpiSummaryV1(inputForManifest(kpiInput, manifest, relevantContentChangedManifest));
  assert.notEqual(
    relevantContentChanged.output.fingerprint,
    kpiResult.output.fingerprint,
    "a relevant evidence content change must invalidate the fingerprint"
  );

  const relevantLineageChangedManifest = manifestFor([
    {
      ...baseCandidates[0],
      provenance: { ...baseCandidates[0].provenance, lineageVersion: "test_lineage_v2" }
    },
    ...baseCandidates.slice(1)
  ]);
  const relevantLineageChanged = runKpiSummaryV1(inputForManifest(kpiInput, manifest, relevantLineageChangedManifest));
  assert.notEqual(
    relevantLineageChanged.output.fingerprint,
    kpiResult.output.fingerprint,
    "a relevant source-lineage change must invalidate the fingerprint"
  );

  const relevantSourceInactiveManifest = manifestFor([baseCandidates[2]]);
  const relevantSourceInactive = runKpiSummaryV1(inputForManifest(kpiInput, manifest, relevantSourceInactiveManifest));
  assert.notEqual(
    relevantSourceInactive.output.fingerprint,
    kpiResult.output.fingerprint,
    "removing an inactive relevant source from the eligible manifest must invalidate the fingerprint"
  );

  const changedTarget = runKpiSummaryV1({
    ...kpiInput,
    settings: kpiInput.settings.map((setting) => setting.metricKey === "revenue" ? { ...setting, target: 130 } : setting)
  });
  assert.notEqual(changedTarget.output.fingerprint, kpiResult.output.fingerprint, "a relevant setting must invalidate the fingerprint");
  assert.equal(changedTarget.output.metrics[0].target, 130);
  assert.throws(
    () => runKpiSummaryV1({
      ...kpiInput,
      settings: [...kpiInput.settings, { metricKey: "REVENUE", target: 120 }]
    }),
    /settings must be unique/
  );

  const hiddenKpi = runKpiSummaryV1({
    ...kpiInput,
    settings: kpiInput.settings.map((setting) => setting.metricKey === "customer-rating" ? { ...setting, visible: false } : setting)
  });
  assert.deepEqual(hiddenKpi.output.metrics.map((metric) => metric.metricKey), ["revenue"]);

  const staleKpi = runKpiSummaryV1({ ...kpiInput, asOf: "2027-07-19T00:00:00.000Z" });
  assert.equal(staleKpi.output.freshness, "stale");
  assert.equal(staleKpi.output.confidence, "Low");
  assert.ok(staleKpi.output.limitations.includes("stale_evidence"));

  const sparseManifest = manifestFor([baseCandidates[0]]);
  const sparseKpi = runKpiSummaryV1({
    evidenceContext: contextFor(sparseManifest),
    asOf: kpiInput.asOf,
    records: [kpiRecord()],
    settings: []
  });
  assert.equal(sparseKpi.output.metrics[0].movement, "not_enough_history");
  assert.equal(sparseKpi.output.metrics[0].performanceStatus, "missing_target");
  assert.ok(sparseKpi.output.limitations.includes("missing_history"));
  assert.ok(sparseKpi.output.limitations.includes("missing_target"));
  assert.ok(sparseKpi.output.limitations.includes("single_independent_source"));

  const dependentManifest = manifestFor([
    baseCandidates[0],
    candidate("dependent-row", {
      sourceKey: "file:retail",
      independentSourceKey: "file:retail",
      sourceId: "source-a",
      sourceFileId: "source-a"
    })
  ]);
  const dependentKpi = runKpiSummaryV1({
    evidenceContext: contextFor(dependentManifest),
    asOf: kpiInput.asOf,
    records: [
      kpiRecord({ citationIds: [1] }),
      kpiRecord({ recordId: "dependent-row", metricKey: "orders", name: "Orders", citationIds: [2] })
    ]
  });
  assert.equal(dependentKpi.output.evidence.sourceCount, 1);
  assert.equal(dependentKpi.output.evidence.independentSourceCount, 1, "dependent rows must not become independent sources");

  const derivedManifest = manifestFor([
    candidate("derived-report", {
      evidenceRole: "derived",
      originalEvidenceEligible: false,
      sourceKey: "report:derived",
      title: "Generated report"
    })
  ]);
  const derivedKpi = runKpiSummaryV1({
    evidenceContext: contextFor(derivedManifest),
    asOf: kpiInput.asOf,
    records: [kpiRecord()]
  });
  assert.equal(derivedKpi.output.metrics.length, 0);
  assert.equal(derivedKpi.telemetry.outcome, "insufficient_evidence");
  assert.ok(derivedKpi.telemetry.reasonCodes.includes("derived_evidence_excluded"));

  const unknownCitation = runKpiSummaryV1({
    evidenceContext: contextFor(sparseManifest),
    asOf: kpiInput.asOf,
    records: [kpiRecord({ citationIds: [999] })]
  });
  assert.equal(unknownCitation.output.metrics.length, 0);
  assert.ok(unknownCitation.telemetry.reasonCodes.includes("citation_verification_failed"));

  assert.throws(
    () => runKpiSummaryV1({ ...kpiInput, evidenceContext: contextFor(manifest, "workspace-b") }),
    /authorized workspace/
  );
  const deserializedRegistry = JSON.parse(JSON.stringify(manifest.sourceRegistry));
  assert.equal(runKpiSummaryV1({
    ...kpiInput,
    evidenceContext: { ...contextFor(manifest), sourceRegistry: deserializedRegistry }
  }).output.metrics.length, 2);
  assert.throws(
    () => runKpiSummaryV1({
      ...kpiInput,
      evidenceContext: {
        ...contextFor(manifest),
        sourceRegistry: { ...deserializedRegistry, independentOriginalSourceCount: 99 }
      }
    }),
    /embedded/
  );
  assert.throws(
    () => buildSourceRegistry({
      workspaceId: "workspace-a",
      candidates: [candidate("deleted-parent", { eligible: false, lifecycleState: "deleted" })]
    }),
    /active eligible/
  );
  assert.throws(
    () => buildSourceRegistry({
      workspaceId: "workspace-a",
      candidates: [candidate("archived-parent", { eligible: false, lifecycleState: "archived" })]
    }),
    /active eligible/
  );

  const healthResult = runBusinessHealthDriversV1({
    evidenceContext: contextFor(manifest),
    score: 22,
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    drivers: [
      healthDriver({ citationIds: [1, 2] }),
      healthDriver({
        driverId: "customer-rating",
        name: "Customer Rating",
        value: 4.2,
        direction: "favorable",
        weight: 0.6,
        scoreContribution: 5,
        citationIds: [3]
      })
    ]
  });
  assert.equal(healthResult.output.score, 22);
  assert.equal(healthResult.output.drivers.length, 2);
  assert.match(healthResult.output.explanation, /Business Health is 22/);
  assert.match(healthResult.output.explanation, /Revenue/);
  assert.equal(healthResult.output.confidence, "High");
  assert.equal(healthResult.output.evidence.independentSourceCount, 2);
  assert.equal(healthResult.telemetry.validationOutcome, "valid");
  assert.deepEqual(
    runBusinessHealthDriversV1({
      evidenceContext: contextFor(manifest),
      score: 22,
      confidenceCeiling: "High",
      asOf: kpiInput.asOf,
      drivers: [
        healthDriver({
          driverId: "customer-rating",
          name: "Customer Rating",
          value: 4.2,
          direction: "favorable",
          weight: 0.6,
          scoreContribution: 5,
          citationIds: [3]
        }),
        healthDriver({ citationIds: [1, 2] })
      ]
    }).output,
    healthResult.output,
    "driver input order must not affect deterministic output"
  );
  const healthWithUnrelatedBefore = runBusinessHealthDriversV1(inputForManifest({
    evidenceContext: contextFor(manifest),
    score: 22,
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    drivers: [
      healthDriver({ citationIds: [1, 2] }),
      healthDriver({
        driverId: "customer-rating",
        name: "Customer Rating",
        value: 4.2,
        direction: "favorable",
        weight: 0.6,
        scoreContribution: 5,
        citationIds: [3]
      })
    ]
  }, manifest, unrelatedBeforeManifest));
  assert.equal(
    healthWithUnrelatedBefore.output.fingerprint,
    healthResult.output.fingerprint,
    "Business Health fingerprint must ignore unrelated earlier evidence"
  );

  const duplicateDriverInput = {
    evidenceContext: contextFor(manifest),
    score: 22,
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    settings: { maximumDrivers: 4 },
    drivers: [
      healthDriver({ driverId: "margin-primary", name: "Margin pressure", weight: 1, citationIds: [1] }),
      healthDriver({ driverId: "margin-secondary", name: "  margin   PRESSURE  ", weight: 0.9, citationIds: [2] }),
      healthDriver({ driverId: "margin-tertiary", name: "Margin Pressure", weight: 0.8, direction: "neutral", citationIds: [3] }),
      healthDriver({ driverId: "margin-trend", name: "Margin pressure trend", weight: 0.7, citationIds: [1] })
    ]
  };
  const duplicateDriverHealth = runBusinessHealthDriversV1(duplicateDriverInput);
  assert.equal(duplicateDriverHealth.output.drivers.length, 4, "semantic presentation deduplication must preserve selected drivers");
  assert.deepEqual(
    duplicateDriverHealth.output.drivers.map((driver) => driver.driverId),
    ["margin-primary", "margin-secondary", "margin-tertiary", "margin-trend"]
  );
  assert.equal(
    (duplicateDriverHealth.output.explanation.match(/margin pressure \(/gi) || []).length,
    1,
    "exact, case, and whitespace label variants must render once"
  );
  assert.match(duplicateDriverHealth.output.explanation, /Margin pressure \(unfavorable and neutral\)/);
  assert.match(duplicateDriverHealth.output.explanation, /Margin pressure trend \(unfavorable\)/);
  assert.deepEqual(
    runBusinessHealthDriversV1({
      ...duplicateDriverInput,
      drivers: [...duplicateDriverInput.drivers].reverse()
    }).output,
    duplicateDriverHealth.output,
    "deduplicated explanation ordering must remain deterministic"
  );

  const conflictingHealth = runBusinessHealthDriversV1({
    evidenceContext: contextFor(sparseManifest),
    score: 40,
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    drivers: [healthDriver({ agreement: "conflicting", freshness: "stale" })]
  });
  assert.equal(conflictingHealth.output.confidence, "Low");
  assert.ok(conflictingHealth.output.limitations.includes("conflicting_evidence"));
  assert.ok(conflictingHealth.output.limitations.includes("stale_evidence"));
  assert.ok(conflictingHealth.output.limitations.includes("single_independent_source"));

  const missingHealth = runBusinessHealthDriversV1({
    evidenceContext: contextFor(sparseManifest),
    score: null,
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    drivers: []
  });
  assert.equal(missingHealth.output.confidence, "Insufficient");
  assert.equal(missingHealth.telemetry.outcome, "insufficient_evidence");

  const changesResult = runEvidenceChangeSummaryV1({
    evidenceContext: contextFor(manifest),
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    changes: [
      evidenceChange({ citationIds: [1, 2] }),
      evidenceChange({
        changeId: "rating-change",
        recordName: "Customer Rating",
        previousValue: 4,
        currentValue: 4.2,
        direction: "increased",
        magnitude: 0.2,
        rank: 2,
        citationIds: [3]
      }),
      evidenceChange({
        changeId: "immaterial-change",
        recordName: "Non-material metric",
        material: false,
        rank: 3,
        citationIds: [3]
      })
    ]
  });
  assert.equal(changesResult.output.highlights.length, 2);
  assert.equal(changesResult.output.highlights[0].changeId, "revenue-change");
  assert.equal(changesResult.output.highlights.every((change) => change.material), true);
  assert.equal(changesResult.output.confidence, "High");
  assert.equal(changesResult.telemetry.candidateCount, 3);
  assert.equal(changesResult.telemetry.validationOutcome, "valid");
  assert.deepEqual(
    runEvidenceChangeSummaryV1({
      evidenceContext: contextFor(manifest),
      confidenceCeiling: "High",
      asOf: kpiInput.asOf,
      changes: [
        evidenceChange({
          changeId: "immaterial-change",
          recordName: "Non-material metric",
          material: false,
          rank: 3,
          citationIds: [3]
        }),
        evidenceChange({
          changeId: "rating-change",
          recordName: "Customer Rating",
          previousValue: 4,
          currentValue: 4.2,
          direction: "increased",
          magnitude: 0.2,
          rank: 2,
          citationIds: [3]
        }),
        evidenceChange({ citationIds: [1, 2] })
      ]
    }).output,
    changesResult.output,
    "change input order must not affect deterministic output"
  );
  const changesWithUnrelatedBefore = runEvidenceChangeSummaryV1(inputForManifest({
    evidenceContext: contextFor(manifest),
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    changes: [
      evidenceChange({ citationIds: [1, 2] }),
      evidenceChange({
        changeId: "rating-change",
        recordName: "Customer Rating",
        previousValue: 4,
        currentValue: 4.2,
        direction: "increased",
        magnitude: 0.2,
        rank: 2,
        citationIds: [3]
      }),
      evidenceChange({
        changeId: "immaterial-change",
        recordName: "Non-material metric",
        material: false,
        rank: 3,
        citationIds: [3]
      })
    ]
  }, manifest, unrelatedBeforeManifest));
  assert.equal(
    changesWithUnrelatedBefore.output.fingerprint,
    changesResult.output.fingerprint,
    "evidence-change fingerprint must ignore unrelated earlier evidence"
  );

  const noMaterialChanges = runEvidenceChangeSummaryV1({
    evidenceContext: contextFor(sparseManifest),
    confidenceCeiling: "Medium",
    asOf: kpiInput.asOf,
    changes: [evidenceChange({ material: false })]
  });
  assert.equal(noMaterialChanges.output.highlights.length, 0);
  assert.match(noMaterialChanges.output.summary, /No material evidence changes/);
  assert.ok(noMaterialChanges.output.limitations.includes("no_material_changes"));
  assert.equal(noMaterialChanges.telemetry.outcome, "deterministic", "eligible non-material evidence is not insufficient evidence");

  const conflictingChanges = runEvidenceChangeSummaryV1({
    evidenceContext: contextFor(manifest),
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    changes: [
      evidenceChange({ changeId: "revenue-down", citationIds: [1] }),
      evidenceChange({
        changeId: "revenue-up",
        direction: "increased",
        previousValue: 90,
        currentValue: 100,
        magnitude: 10,
        rank: 2,
        citationIds: [2]
      })
    ]
  });
  assert.ok(conflictingChanges.output.limitations.includes("conflicting_evidence"));

  const staleChanges = runEvidenceChangeSummaryV1({
    evidenceContext: contextFor(sparseManifest),
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    changes: [evidenceChange({ freshness: "stale" })]
  });
  assert.equal(staleChanges.output.freshness, "stale");
  assert.equal(staleChanges.output.confidence, "Low");
  assert.ok(staleChanges.output.limitations.includes("stale_evidence"));

  const repeatedChanges = runEvidenceChangeSummaryV1({
    evidenceContext: contextFor(manifest),
    confidenceCeiling: "High",
    asOf: kpiInput.asOf,
    changes: [
      evidenceChange({ changeId: "duplicate", updatedAt: "2026-06-01T00:00:00.000Z", currentValue: 95, citationIds: [1] }),
      evidenceChange({ changeId: "duplicate", updatedAt: "2026-07-01T00:00:00.000Z", currentValue: 100, citationIds: [2] })
    ]
  });
  assert.equal(repeatedChanges.output.highlights.length, 1);
  assert.equal(repeatedChanges.output.highlights[0].currentValue, 100);

  const allSources = [
    "lib/ai/continuous-intelligence/contracts.ts",
    "lib/ai/continuous-intelligence/evidence-context.ts",
    "lib/ai/continuous-intelligence/fingerprint.ts",
    "lib/ai/continuous-intelligence/telemetry.ts",
    "lib/ai/continuous-intelligence/kpi-summary-v1.ts",
    "lib/ai/continuous-intelligence/business-health-drivers-v1.ts",
    "lib/ai/continuous-intelligence/evidence-change-summary-v1.ts"
  ].map(read).join("\n");
  for (const forbidden of [
    "runStructuredAI",
    "provider-manager",
    "NVIDIA_API_KEY",
    "OPENAI_API_KEY",
    "nemotron",
    "qwen",
    "risk_opportunity_synthesis_v1"
  ]) {
    assert.equal(allSources.includes(forbidden), false, `Deterministic foundation unexpectedly includes ${forbidden}`);
  }
  assert.ok(allSources.includes("verifyEvidenceManifestCitations"), "central citation verification must be used");

  console.log("Continuous Intelligence regression tests passed.");
}

main();
