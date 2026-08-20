export const EXTERNAL_INTEGRATION_CONTRACT_VERSIONS = {
  businessEntity: "business_entity_v1",
  connection: "integration_connection_v1",
  sourceRecord: "external_source_record_version_v1",
  canonicalFact: "canonical_business_fact_version_v2",
  providerAdapter: "provider_adapter_v1",
  freshness: "integration_freshness_v1",
  businessStateDelta: "business_state_delta_v2",
  fingerprint: "external_integration_fingerprint_v1"
} as const;

export const EXTERNAL_INTEGRATION_DECIMAL_LIMITS = {
  persistedFact: { precision: 30, scale: 9 },
  persistedExchangeRate: { precision: 30, scale: 12 }
} as const;

export const EXTERNAL_INTEGRATION_LIMITS = {
  boundedIdentifier: 128,
  boundedLabel: 200,
  boundedText: 4_000,
  dimensionsPerFact: 32,
  evidenceReferencesPerItem: 64,
  freshnessDomainsPerDelta: 64,
  issuesPerRecord: 100,
  providerCapabilities: 64,
  scopesPerConnection: 64,
  sourceFactsPerDelta: 500,
  sourceReferencesPerFact: 100,
  signalsPerDelta: 100
} as const;
