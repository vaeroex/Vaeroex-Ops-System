const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      path.join(root, request.slice(2)),
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
  canonicalFactFingerprint,
  contractSha256
} = require("../lib/integrations/contracts/canonical.ts");
const {
  CanonicalBusinessFactVersionSchema
} = require("../lib/integrations/contracts/source-facts.ts");
const deterministic = require("../lib/integrations/deterministic/index.ts");
const { addCanonicalDecimals } = require("../lib/integrations/deterministic/decimal.ts");
const { Phase8bDatabase } = require("../services/external-integrations-qbo-sandbox/src/database.ts");
const phase8b = require("../lib/integrations/provider-runtime/qbo/index.ts");
const {
  PROVIDER_CURRENT_VALID_SOURCE_READ_CONTRACT_VERSION,
  PROVIDER_PENDING_SOURCE_READ_CONTRACT_VERSION,
  PROVIDER_SOURCE_VALIDATION_CONTRACT_VERSION,
  readCurrentValidProviderExternalSourceRecordVersions,
  readPendingProviderExternalSourceRecordVersions,
  validateProviderExternalSourceRecordVersion
} = require("../lib/integrations/persistence/provider-validation-repository.ts");
const {
  commitCanonicalBusinessFactVersion,
  commitContributionFamilyVersion,
  commitFactContributionBatch,
  commitReconciliationCase,
  commitSourceAuthorityPolicyVersion,
  readFactContributionAggregate
} = require("../lib/integrations/persistence/repository.ts");
const {
  beginDeterministicChangeSet,
  coalesceDependencyDirtyNodes,
  finalizeDeterministicChangeSet,
  readCurrentContributionState,
  readCurrentDeterministicState
} = require("../lib/integrations/persistence/deterministic-repository.ts");

const CONFIRMATION = "vaeroex-phase8b-qbo-sandbox-disposable-only";
const POLICY_VERSION = "qbo_phase_8b_reconciliation_v1";
const REGISTRY_VERSION = deterministic.PHASE_3_DEPENDENCY_REGISTRY.registryVersion;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`phase8b_live_configuration_missing:${name}`);
  return value;
}

function uuidFor(value) {
  const bytes = crypto.createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeTimestamp() {
  return new Date().toISOString();
}

function decision(at) {
  return {
    authority: "deterministic_policy",
    policyVersion: POLICY_VERSION,
    actorId: null,
    decidedAt: at,
    reasonCodes: ["qbo_sandbox_deterministic_reconciliation"]
  };
}

function sourceAuthorityPolicy(scope, at) {
  const draft = {
    contractVersion: "source_authority_policy_v1",
    id: uuidFor(`${scope.connectionId}:source-authority-policy`),
    workspaceId: scope.workspaceId,
    businessEntityId: scope.businessEntityId,
    domainKey: "posted_revenue",
    policyKey: "qbo_sandbox_posted_revenue_authority",
    immutableVersion: 1,
    supersedesPolicyVersionId: null,
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    effectiveThrough: null,
    conflictBehavior: "allow_authoritative_and_flag",
    fallbackMode: "review_required",
    rules: [
      {
        sourceKind: "provider",
        providerKey: "quickbooks_online",
        sourceClass: "transaction_detail",
        authorityRole: "authoritative",
        authorityRank: 1,
        contributionMode: "additive_transaction"
      },
      {
        sourceKind: "provider",
        providerKey: "quickbooks_online",
        sourceClass: "report_control",
        authorityRole: "control_only",
        authorityRank: 2,
        contributionMode: "non_additive_control"
      }
    ],
    decision: {
      authority: "operator",
      policyVersion: null,
      actorId: scope.actorId,
      decidedAt: at,
      reasonCodes: ["phase8b_sandbox_verification_authorized"]
    }
  };
  return {
    ...draft,
    policyFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_source_authority_policy",
      fingerprintVersion: "phase8b_qbo_source_authority_policy_v1",
      payload: draft
    })
  };
}

function contributionFamily(scope, kind, at) {
  const control = kind === "non_additive_control";
  const draft = {
    contractVersion: "contribution_family_v1",
    id: uuidFor(`${scope.connectionId}:family:${kind}`),
    workspaceId: scope.workspaceId,
    businessEntityId: scope.businessEntityId,
    familyKey: control
      ? phase8b.QBO_REPORT_CONTROL_FAMILY_KEY
      : phase8b.QBO_RECOGNIZED_REVENUE_FAMILY_KEY,
    immutableVersion: 1,
    supersedesFamilyVersionId: null,
    domainKey: "posted_revenue",
    measureKey: "recognized_revenue",
    aggregateKey: "recognized_revenue_actual",
    contributionMode: kind,
    allowedFactKinds: [control ? "recognized_revenue_control" : "recognized_revenue"],
    registryVersion: REGISTRY_VERSION,
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    decision: decision(at)
  };
  return {
    ...draft,
    familyFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_contribution_family",
      fingerprintVersion: "phase8b_qbo_contribution_family_v1",
      payload: draft
    })
  };
}

function member(candidate, memberRole, authorityRank, additiveCandidate) {
  return {
    factVersionId: candidate.fact.id,
    sourceRecordVersionId: candidate.representation.sourceRecordVersionId,
    sourceFingerprint: candidate.representation.sourceVersionFingerprint,
    economicIdentityFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_economic_identity",
      fingerprintVersion: "phase8b_qbo_economic_identity_v1",
      payload: candidate.representation.economicIdentity
    }),
    memberRole,
    authorityRank,
    additiveCandidate,
    canonicalValue: candidate.representation.value
  };
}

function reconciliationCase(input) {
  const values = input.members.map((value) => value.canonicalValue);
  const draft = {
    contractVersion: "reconciliation_case_v1",
    id: uuidFor(`${input.scope.connectionId}:case:${input.caseKey}`),
    workspaceId: input.scope.workspaceId,
    businessEntityId: input.scope.businessEntityId,
    sourceAuthorityPolicyVersionId: input.policy.id,
    supersedesCaseId: null,
    evaluatedAt: input.at,
    effectiveAt: input.at,
    matchRuleVersion: POLICY_VERSION,
    matchTier: input.matchTier,
    classification: input.classification,
    caseState: "resolved",
    winningFactVersionId: input.winningFactVersionId,
    deterministicFeatures: {
      sourceIdentityMatch: input.classification === "same_fact_represented_twice",
      explicitLineageMatch: false,
      economicIdentityMatch: input.classification === "same_fact_represented_twice",
      valueMatch: new Set(values).size === 1,
      accountingBasisMatch: true,
      currencyMatch: true,
      periodMatch: input.classification === "control_observation_vs_additive_detail",
      dimensionsMatch: false,
      fuzzyProposalOnly: false,
      ...input.featureOverrides
    },
    decision: decision(input.at),
    members: input.members
  };
  return {
    ...draft,
    caseFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_reconciliation_case",
      fingerprintVersion: "phase8b_qbo_reconciliation_case_v1",
      payload: draft
    })
  };
}

function contributionEvent(candidate, kind, family, caseValue, at) {
  const representation = candidate.representation;
  const economicIdentityFingerprint = contractSha256({
    fingerprintPurpose: "phase8b_qbo_economic_identity",
    fingerprintVersion: "phase8b_qbo_economic_identity_v1",
    payload: representation.economicIdentity
  });
  const draft = {
    contractVersion: "fact_contribution_event_v1",
    id: uuidFor(`${caseValue.id}:event:${kind}:${candidate.fact.id}`),
    eventKind: kind,
    factVersionId: candidate.fact.id,
    targetContributionEventId: null,
    contributionIdentityFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_contribution_identity",
      fingerprintVersion: "phase8b_qbo_contribution_identity_v1",
      familyVersionId: family.id,
      factKind: candidate.fact.factKind,
      factKey: candidate.fact.factKey,
      economicIdentityFingerprint
    }),
    economicIdentityFingerprint,
    effectiveAt: representation.economicIdentity.effectiveTime.effectiveAt,
    periodStart: representation.economicIdentity.effectiveTime.periodStart,
    periodEnd: representation.economicIdentity.effectiveTime.periodEnd,
    dimensions: representation.economicIdentity.dimensions,
    accountingBasis: representation.economicIdentity.accountingBasis,
    currency: representation.economicIdentity.currency,
    valueCanonical: representation.value,
    registryVersion: REGISTRY_VERSION
  };
  return {
    ...draft,
    eventFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_contribution_event",
      fingerprintVersion: "phase8b_qbo_contribution_event_v1",
      payload: draft,
      observedAt: at
    })
  };
}

function contributionBatch(input) {
  const draft = {
    contractVersion: "fact_contribution_batch_v1",
    id: uuidFor(`${input.caseValue.id}:batch:${input.batchKey}`),
    workspaceId: input.scope.workspaceId,
    businessEntityId: input.scope.businessEntityId,
    reconciliationCaseId: input.caseValue.id,
    sourceAuthorityPolicyVersionId: input.policy.id,
    contributionFamilyVersionId: input.family.id,
    decision: input.caseValue.decision,
    events: input.events
  };
  return {
    ...draft,
    batchFingerprint: contractSha256({
      fingerprintPurpose: "phase8b_qbo_contribution_batch",
      fingerprintVersion: "phase8b_qbo_contribution_batch_v1",
      payload: draft
    })
  };
}

function chunksWithMinimumTwo(values, maximum) {
  const chunks = [];
  for (let index = 0; index < values.length; index += maximum) {
    chunks.push(values.slice(index, index + maximum));
  }
  if (chunks.length > 1 && chunks.at(-1).length === 1) {
    chunks.at(-1).unshift(chunks.at(-2).pop());
  }
  return chunks.filter((chunk) => chunk.length >= 2);
}

function independentCandidateGroups(candidates) {
  return chunksWithMinimumTwo(
    [...candidates].sort((left, right) =>
      left.fact.factKey.localeCompare(right.fact.factKey)
    ),
    2
  ).map((members, index) => ({
    key: contractSha256({
      fingerprintPurpose: "phase8b_independent_revenue_group",
      fingerprintVersion: "phase8b_independent_revenue_group_v1",
      ordinal: index + 1,
      factKeys: members.map((candidate) => candidate.fact.factKey)
    }),
    members
  }));
}

function periodDetailAggregateCandidate(input) {
  const control = input.controlCandidate;
  const reportPeriod = control.representation.economicIdentity.effectiveTime;
  const details = input.revenueCandidates.filter((candidate) => {
    const postingDate = candidate.representation.economicIdentity.effectiveTime.postingDate;
    return Boolean(
      postingDate &&
      reportPeriod.periodStart &&
      reportPeriod.periodEnd &&
      postingDate >= reportPeriod.periodStart &&
      postingDate <= reportPeriod.periodEnd
    );
  });
  if (details.length === 0) return null;
  const sources = [];
  const sourceIds = new Set();
  for (const detail of details) {
    for (const source of detail.fact.sources) {
      if (sourceIds.has(source.sourceRecordVersionId)) continue;
      sourceIds.add(source.sourceRecordVersionId);
      sources.push({ ...source, sourceRole: "primary", contributionWeight: null });
    }
  }
  if (sources.length === 0 || sources.length > 100) return null;
  const total = addCanonicalDecimals(details.map((candidate) => candidate.representation.value));
  const sourceObservedAt = details
    .map((candidate) => candidate.fact.sourceObservedAt)
    .sort()
    .at(-1);
  if (!sourceObservedAt || !reportPeriod.periodStart || !reportPeriod.periodEnd) return null;
  const factKey = [
    "qbo_recognized_revenue_period",
    reportPeriod.periodStart,
    reportPeriod.periodEnd,
    control.representation.economicIdentity.accountingBasis
  ].join(":");
  const draft = CanonicalBusinessFactVersionSchema.parse({
    contractVersion: "canonical_business_fact_version_v2",
    id: uuidFor(`${input.scope.connectionId}:fact:${factKey}:v1`),
    workspaceId: input.scope.workspaceId,
    businessEntityId: input.scope.businessEntityId,
    immutableVersion: 1,
    factKind: "recognized_revenue",
    factKey,
    dimensions: [],
    temporal: {
      effectiveAt: null,
      postingDate: null,
      periodStart: reportPeriod.periodStart,
      periodEnd: reportPeriod.periodEnd,
      fiscalYear: null,
      fiscalPeriod: null,
      sourceTimeZone: null,
      closedPeriod: false
    },
    accounting: {
      basis: control.representation.economicIdentity.accountingBasis,
      sourceCurrency: control.representation.economicIdentity.currency,
      reportingCurrency: control.representation.economicIdentity.currency,
      exchangeRate: null,
      exchangeRateSource: null
    },
    value: {
      kind: "money",
      amount: total,
      currency: control.representation.economicIdentity.currency
    },
    reconciliationState: "accepted",
    validationState: "valid",
    sources,
    decision: {
      authority: "deterministic_policy",
      policyVersion: "qbo_phase_8b_period_detail_aggregate_v1",
      actorId: null,
      decidedAt: input.at,
      reasonCodes: ["qbo_exact_period_detail_aggregate"]
    },
    normalizationVersion: "qbo_phase_8b_period_detail_aggregate_v1",
    transformationVersion: "qbo_phase_8b_period_detail_aggregate_v1",
    sourceObservedAt,
    createdAt: input.at,
    factFingerprint: undefined
  });
  const fact = CanonicalBusinessFactVersionSchema.parse({
    ...draft,
    factFingerprint: canonicalFactFingerprint(draft)
  });
  const primary = details[0].representation;
  return {
    fact,
    representation: {
      representationId: uuidFor(`${input.scope.connectionId}:representation:${factKey}:v1`),
      workspaceId: fact.workspaceId,
      businessEntityId: fact.businessEntityId,
      canonicalFactVersionId: fact.id,
      canonicalFactFingerprint: fact.factFingerprint,
      factKind: fact.factKind,
      factKey: fact.factKey,
      sourceRecordVersionId: primary.sourceRecordVersionId,
      sourceVersionFingerprint: primary.sourceVersionFingerprint,
      sourceIdentityFingerprint: primary.sourceIdentityFingerprint,
      sourceImmutableVersion: primary.sourceImmutableVersion,
      sourceClass: "connected_system",
      sourceAuthorityKey: "quickbooks_online",
      economicIdentity: {
        domain: "posted_revenue",
        contributionFamilyKey: phase8b.QBO_RECOGNIZED_REVENUE_FAMILY_KEY,
        contributionFamilyKind: "additive_transaction",
        measureKey: "recognized_revenue",
        aggregateKey: "recognized_revenue_actual",
        transactionIdentity: null,
        effectiveTime: reportPeriod,
        dimensions: [],
        accountingBasis: control.representation.economicIdentity.accountingBasis,
        currency: control.representation.economicIdentity.currency
      },
      value: total,
      validationState: "valid",
      reconciliationState: "accepted",
      lineage: { kind: "none" },
      similarityHints: []
    },
    detailCount: details.length,
    detailTotal: total
  };
}

function addedMutations(prior, next) {
  const priorIds = new Set(prior.map((value) => value.id));
  return next
    .filter((value) => !priorIds.has(value.id))
    .map((value) => ({
      mutationKey: `phase8b_add_${value.id}`,
      prior: null,
      next: value,
      causeContributionEventIds: [value.id]
    }));
}

async function persistShadow(input) {
  const result = deterministic.runIncrementalFullEquivalence({
    prior: input.prior,
    contributions: input.contributions,
    mutations: input.mutations,
    registry: deterministic.PHASE_3_DEPENDENCY_REGISTRY,
    asOfDate: input.asOfDate
  });
  assert.equal(result.status, "completed", "incremental and clean truth must match");
  assert.equal(result.modelCallCount, 0, "deterministic synchronization cannot call a model");
  const watermark = result.safeSnapshot.watermark;
  const incrementalFingerprint = result.incremental.snapshot.watermark?.stateFingerprint;
  const cleanFingerprint = result.clean.snapshot.watermark?.stateFingerprint;
  if (!watermark || !incrementalFingerprint || !cleanFingerprint) {
    throw new Error("phase8b_deterministic_watermark_missing");
  }
  const changeSetId = uuidFor(`${input.scope.connectionId}:change-set:${input.label}:${result.changeSetFingerprint}`);
  const requestedAt = safeTimestamp();
  const client = input.database.role("deterministic_calculation_authority");
  const began = await beginDeterministicChangeSet(
    {
      contractVersion: "deterministic_change_set_v1",
      id: changeSetId,
      workspaceId: input.scope.workspaceId,
      businessEntityId: input.scope.businessEntityId,
      executionMode: "incremental",
      inputContributionFingerprint: watermark.inputContributionFingerprint,
      dependencyRegistryVersion: deterministic.PHASE_3_DEPENDENCY_REGISTRY.registryVersion,
      dependencyRegistryFingerprint: deterministic.PHASE_3_DEPENDENCY_REGISTRY.registryFingerprint,
      calculationPolicyVersion: deterministic.PHASE_3_DEPENDENCY_REGISTRY.calculationPolicyVersion,
      priorDeterministicWatermark: input.prior.watermark?.watermarkFingerprint ?? null,
      priorStateFingerprint: input.prior.watermark?.stateFingerprint ?? null,
      changeSetFingerprint: result.changeSetFingerprint,
      requestedAt
    },
    `phase8b_changeset_${input.label}`,
    "phase8b_qbo_deterministic_runtime",
    client
  );
  if (result.incremental.dirtyNodes.length > 0) {
    await coalesceDependencyDirtyNodes(
      result.incremental.dirtyNodes.map((node) => ({ ...node, changeSetId })),
      `phase8b_dirty_${input.label}`,
      "phase8b_qbo_deterministic_runtime",
      client
    );
  }
  const finalized = await finalizeDeterministicChangeSet(
    {
      changeSetId,
      expectedRowVersion: began.rowVersion,
      inputContributionFingerprint: watermark.inputContributionFingerprint,
      resultWatermark: watermark.watermarkFingerprint,
      resultStateFingerprint: watermark.stateFingerprint,
      incrementalStateFingerprint: incrementalFingerprint,
      cleanStateFingerprint: cleanFingerprint,
      equivalenceStatus: "matched",
      failureCode: null,
      failureFingerprint: null,
      completedAt: safeTimestamp(),
      states: result.safeSnapshot.states
    },
    `phase8b_finalize_${input.label}`,
    "phase8b_qbo_deterministic_runtime",
    client
  );
  assert.equal(finalized.state, "completed");
  return {
    result,
    changeSetId,
    dirtyNodeCount: result.incremental.dirtyNodes.length,
    nodesRecalculated: result.incremental.metrics.nodesRecalculated
  };
}

async function main() {
  if (required("VAEROEX_PHASE8B_CONFIRMATION") !== CONFIRMATION) {
    throw new Error("phase8b_live_confirmation_invalid");
  }
  const scope = {
    workspaceId: required("PHASE8B_WORKSPACE_ID"),
    businessEntityId: required("PHASE8B_BUSINESS_ENTITY_ID"),
    connectionId: required("PHASE8B_CONNECTION_ID"),
    mappingId: required("PHASE8B_MAPPING_ID"),
    actorId: required("PHASE8B_INITIATED_BY")
  };
  const expectedRealmId = required("PHASE8B_SANDBOX_REALM_ID");
  const reportingCurrency = process.env.PHASE8B_REPORTING_CURRENCY || "USD";
  const database = new Phase8bDatabase(required("DATABASE_URL"), [
    "integration_provider_validation_authority",
    "external_integrations_authority",
    "deterministic_calculation_authority"
  ]);
  const validationClient = database.role("integration_provider_validation_authority");
  const factClient = database.role("external_integrations_authority");
  const validated = [];
  try {
    while (true) {
      const pending = await readPendingProviderExternalSourceRecordVersions(
        {
          contractVersion: PROVIDER_PENDING_SOURCE_READ_CONTRACT_VERSION,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          mappingId: scope.mappingId,
          maximumResults: 500
        },
        validationClient
      );
      if (pending.length === 0) break;
      for (const item of pending) {
        const outcome = phase8b.validatePendingQboSourceVersion({
          pendingVersion: item.pendingVersion,
          validatedVersionId: uuidFor(`${item.pendingVersion.id}:validated`),
          expectedRealmId,
          validatedAt: safeTimestamp()
        });
        const persisted = await validateProviderExternalSourceRecordVersion(
          {
            contractVersion: PROVIDER_SOURCE_VALIDATION_CONTRACT_VERSION,
            pendingSourceVersionId: item.pendingVersion.id,
            expectedPendingSourceFingerprint: item.pendingVersion.sourceFingerprint,
            validatedVersion: outcome.version
          },
          `phase8b_validate_${item.pendingVersion.id}`,
          validationClient
        );
        validated.push({
          sourceIdentityFingerprint: item.sourceIdentityFingerprint,
          sourceRecordId: item.sourceRecordId,
          sourceVersion: outcome.version,
          validationState: persisted.validationState
        });
      }
    }

    const revenueCandidates = [];
    const controlCandidates = [];
    let quarantined = 0;
    const currentValidSources =
      await readCurrentValidProviderExternalSourceRecordVersions(
        {
          contractVersion: PROVIDER_CURRENT_VALID_SOURCE_READ_CONTRACT_VERSION,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          mappingId: scope.mappingId,
          maximumResults: 500
        },
        validationClient
      );
    const revenueAuthority = phase8b.deriveQboRevenueMappingAuthority({
      sourceVersions: currentValidSources.map((source) => source.sourceVersion),
      expectedRealmId
    });
    for (const source of validated) {
      if (source.validationState !== "valid") {
        quarantined += 1;
        continue;
      }
      const revenue = phase8b.mapValidatedQboRevenueSource({
        sourceVersion: source.sourceVersion,
        sourceIdentityFingerprint: source.sourceIdentityFingerprint,
        reportingCurrency,
        accountingBasis: "accrual",
        revenueAuthority,
        mappedAt: safeTimestamp(),
        identityForFact: (factKey) => ({
          id: uuidFor(`${scope.connectionId}:fact:${factKey}:v1`),
          immutableVersion: 1,
          priorVersionId: null
        }),
        representationIdForFact: (factKey) =>
          uuidFor(`${scope.connectionId}:representation:${factKey}:v1`)
      });
      if (revenue.disposition === "mapped") {
        for (const candidate of revenue.candidates) {
          await commitCanonicalBusinessFactVersion(
            candidate.fact,
            `phase8b_fact_${candidate.fact.id}`,
            "phase8b_qbo_canonical_mapper",
            factClient
          );
          revenueCandidates.push(candidate);
        }
      } else if (revenue.disposition === "quarantined") {
        quarantined += 1;
      }

      const control = phase8b.mapValidatedQboProfitAndLossControl({
        sourceVersion: source.sourceVersion,
        sourceIdentityFingerprint: source.sourceIdentityFingerprint,
        mappedAt: safeTimestamp(),
        factIdentity: {
          id: uuidFor(`${scope.connectionId}:fact:profit-and-loss:${source.sourceVersion.id}`),
          immutableVersion: 1,
          priorVersionId: null
        },
        representationId: uuidFor(`${scope.connectionId}:representation:profit-and-loss:${source.sourceVersion.id}`)
      });
      if (control.disposition === "mapped" && control.candidate) {
        await commitCanonicalBusinessFactVersion(
          control.candidate.fact,
          `phase8b_fact_${control.candidate.fact.id}`,
          "phase8b_qbo_canonical_mapper",
          factClient
        );
        controlCandidates.push(control.candidate);
      }
    }

    const additiveGroups = independentCandidateGroups(revenueCandidates);
    if (additiveGroups.length < 2) {
      process.stdout.write(`${JSON.stringify({
        contractVersion: "phase8b_qbo_sandbox_live_verification_result_v1",
        validatedSourceVersions: validated.length,
        currentValidSourceVersions: currentValidSources.length,
        quarantinedSourceVersions: quarantined,
        canonicalRevenueFacts: revenueCandidates.length,
        reconciledRevenueFacts: 0,
        unreconciledRevenueFacts: revenueCandidates.length,
        reportControlFacts: controlCandidates.length,
        incrementalQualification:
          "not_exercised_insufficient_suitable_sandbox_records",
        minimumSuitableRevenueFacts: 4,
        promotionAuthorized: false,
        modelCallCount: 0
      })}\n`);
      return;
    }
    const contributedRevenueCandidates = additiveGroups.flatMap((group) => group.members);

    const at = safeTimestamp();
    const policy = sourceAuthorityPolicy(scope, at);
    const additiveFamily = contributionFamily(scope, "additive_transaction", at);
    const controlFamily = contributionFamily(scope, "non_additive_control", at);
    await commitSourceAuthorityPolicyVersion(
      policy,
      "phase8b_qbo_source_authority_policy",
      scope.actorId,
      factClient
    );
    await commitContributionFamilyVersion(
      additiveFamily,
      "phase8b_qbo_additive_family",
      "phase8b_qbo_reconciliation",
      factClient
    );
    await commitContributionFamilyVersion(
      controlFamily,
      "phase8b_qbo_control_family",
      "phase8b_qbo_reconciliation",
      factClient
    );

    const initialGroup = additiveGroups[0];
    const initialCase = reconciliationCase({
      scope,
      policy,
      at,
      caseKey: `independent-revenue-1-${initialGroup.key}`,
      classification: "independent_facts",
      matchTier: "exact_canonical_economic_identity",
      winningFactVersionId: null,
      members: initialGroup.members.map((candidate, index) =>
        member(candidate, "candidate", index + 1, true)
      ),
      featureOverrides: {
        economicIdentityMatch: true,
        periodMatch: true,
        dimensionsMatch: true
      }
    });
    await commitReconciliationCase(
      initialCase,
      "phase8b_qbo_additive_case_1",
      "phase8b_qbo_reconciliation",
      factClient
    );

    const initialEvents = initialGroup.members.map((candidate) =>
      contributionEvent(candidate, "establish", additiveFamily, initialCase, at)
    );
    await commitFactContributionBatch(
      contributionBatch({
        scope,
        policy,
        family: additiveFamily,
        caseValue: initialCase,
        batchKey: "initial",
        events: initialEvents
      }),
      "phase8b_qbo_initial_contribution",
      "phase8b_qbo_reconciliation",
      factClient
    );

    const deterministicClient = database.role("deterministic_calculation_authority");
    const firstContributions = await readCurrentContributionState(
      scope.workspaceId,
      scope.businessEntityId,
      deterministicClient
    );
    const empty = deterministic.emptyDeterministicStateSnapshot({
      workspaceId: scope.workspaceId,
      businessEntityId: scope.businessEntityId
    });
    const asOfDate = new Date().toISOString().slice(0, 10);
    const firstShadow = await persistShadow({
      database,
      scope,
      prior: empty,
      contributions: firstContributions,
      mutations: addedMutations([], firstContributions),
      asOfDate,
      label: "initial"
    });

    for (const [offset, group] of additiveGroups.slice(1).entries()) {
      const ordinal = offset + 2;
      const caseValue = reconciliationCase({
        scope,
        policy,
        at,
        caseKey: `independent-revenue-${ordinal}-${group.key}`,
        classification: "independent_facts",
        matchTier: "exact_canonical_economic_identity",
        winningFactVersionId: null,
        members: group.members.map((candidate, index) =>
          member(candidate, "candidate", index + 1, true)
        ),
        featureOverrides: {
          economicIdentityMatch: true,
          periodMatch: true,
          dimensionsMatch: true
        }
      });
      await commitReconciliationCase(
        caseValue,
        `phase8b_qbo_additive_case_${ordinal}`,
        "phase8b_qbo_reconciliation",
        factClient
      );
      await commitFactContributionBatch(
        contributionBatch({
          scope,
          policy,
          family: additiveFamily,
          caseValue,
          batchKey: `incremental-${ordinal}`,
          events: group.members.map((candidate) =>
            contributionEvent(candidate, "establish", additiveFamily, caseValue, at)
          )
        }),
        `phase8b_qbo_incremental_${ordinal}`,
        "phase8b_qbo_reconciliation",
        factClient
      );
    }
    const allContributions = await readCurrentContributionState(
      scope.workspaceId,
      scope.businessEntityId,
      deterministicClient
    );
    const persistedPrior = await readCurrentDeterministicState(
      scope.workspaceId,
      scope.businessEntityId,
      deterministicClient
    );
    const incrementalShadow = await persistShadow({
      database,
      scope,
      prior: persistedPrior,
      contributions: allContributions,
      mutations: addedMutations(firstContributions, allContributions),
      asOfDate,
      label: "incremental"
    });

    let reportComparison = null;
    if (controlCandidates.length > 0) {
      const controlCandidate = controlCandidates[0];
      const aggregateCandidate = periodDetailAggregateCandidate({
        scope,
        at,
        controlCandidate,
        revenueCandidates: contributedRevenueCandidates
      });
      if (aggregateCandidate) {
        await commitCanonicalBusinessFactVersion(
          aggregateCandidate.fact,
          `phase8b_fact_${aggregateCandidate.fact.id}`,
          "phase8b_qbo_period_aggregate",
          factClient
        );
        const controlCase = reconciliationCase({
        scope,
        policy,
        at,
        caseKey: "profit-and-loss-control",
        classification: "control_observation_vs_additive_detail",
        matchTier: "exact_canonical_economic_identity",
        winningFactVersionId: aggregateCandidate.fact.id,
        members: [
          member(aggregateCandidate, "winner", 1, true),
          member(controlCandidate, "control_observation", 2, false)
        ],
        featureOverrides: {
          economicIdentityMatch: true,
          periodMatch: true,
          dimensionsMatch: true
        }
        });
        await commitReconciliationCase(
          controlCase,
          "phase8b_qbo_control_case",
          "phase8b_qbo_reconciliation",
          factClient
        );
        const controlEvent = contributionEvent(
          controlCandidate,
          "control_observation",
          controlFamily,
          controlCase,
          at
        );
        await commitFactContributionBatch(
          contributionBatch({
            scope,
            policy,
            family: controlFamily,
            caseValue: controlCase,
            batchKey: "control",
            events: [controlEvent]
          }),
          "phase8b_qbo_control_observation",
          "phase8b_qbo_reconciliation",
          factClient
        );
        reportComparison = {
          detailCount: aggregateCandidate.detailCount,
          detailTotal: aggregateCandidate.detailTotal,
          reportControlTotal: controlCandidate.representation.value,
          matches: aggregateCandidate.detailTotal === controlCandidate.representation.value,
          disposition: aggregateCandidate.detailTotal === controlCandidate.representation.value
            ? "matched"
            : "explicit_mismatch_recorded"
        };
      }
    }

    const additiveAggregate = await readFactContributionAggregate(
      scope.workspaceId,
      scope.businessEntityId,
      additiveFamily.id,
      factClient
    );
    const controlAggregate = await readFactContributionAggregate(
      scope.workspaceId,
      scope.businessEntityId,
      controlFamily.id,
      factClient
    );
    assert.equal(controlAggregate.currentTotal, "0", "report control must never add to revenue");
    assert.equal(
      allContributions.length,
      contributedRevenueCandidates.length,
      "every reconciled detail contributes once"
    );
    const revenueState = incrementalShadow.result.safeSnapshot.states.find(
      (state) => state.nodeKey === "revenue"
    );
    if (!revenueState) throw new Error("phase8b_shadow_revenue_state_missing");

    process.stdout.write(`${JSON.stringify({
      contractVersion: "phase8b_qbo_sandbox_live_verification_result_v1",
      validatedSourceVersions: validated.length,
      currentValidSourceVersions: currentValidSources.length,
      quarantinedSourceVersions: quarantined,
      canonicalRevenueFacts: revenueCandidates.length,
      reconciledRevenueFacts: contributedRevenueCandidates.length,
      unreconciledRevenueFacts: revenueCandidates.length - contributedRevenueCandidates.length,
      reportControlFacts: controlCandidates.length,
      additiveContributionCount: allContributions.length,
      additiveContributionTotal: additiveAggregate.currentTotal,
      controlObservationCount: controlAggregate.controlObservationCount,
      controlAggregateTotal: controlAggregate.currentTotal,
      reportComparison,
      initialShadowChangeSetId: firstShadow.changeSetId,
      incrementalShadowChangeSetId: incrementalShadow.changeSetId,
      incrementalDirtyNodeCount: incrementalShadow.dirtyNodeCount,
      incrementalNodesRecalculated: incrementalShadow.nodesRecalculated,
      shadowRevenueValue: revenueState.valueCanonical,
      incrementalFullEquivalent:
        incrementalShadow.result.incremental.snapshot.watermark?.stateFingerprint ===
        incrementalShadow.result.clean.snapshot.watermark?.stateFingerprint,
      dependencyRegistryVersion: deterministic.PHASE_3_DEPENDENCY_REGISTRY.registryVersion,
      dependencyRegistryFingerprint: deterministic.PHASE_3_DEPENDENCY_REGISTRY.registryFingerprint,
      promotionAuthorized: false,
      modelCallCount: 0
    })}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "phase8b_live_verification_failed"}\n`);
  process.exit(1);
});
