import { ProviderDescriptorSchema } from "@/lib/integrations/contracts/provider-adapter";

import {
  SQUARE_DORMANT_GATE_VERSION,
  SQUARE_ENVIRONMENTS,
  SQUARE_MINIMUM_READ_SCOPES,
  SQUARE_OFFICIAL_DOCUMENTATION_LINKS,
  SQUARE_OPTIONAL_READ_SCOPES,
  SQUARE_PROVIDER_ADAPTER_VERSION,
  SQUARE_PROVIDER_DISPLAY_NAME,
  SQUARE_PROVIDER_KEY,
  SQUARE_READ_ONLY_POST_OPERATIONS
} from "@/lib/integrations/providers/square/contracts";

export const SQUARE_PROVIDER_DESCRIPTOR = ProviderDescriptorSchema.parse({
  contractVersion: "provider_adapter_v1",
  providerKey: SQUARE_PROVIDER_KEY,
  displayName: SQUARE_PROVIDER_DISPLAY_NAME,
  adapterVersion: SQUARE_PROVIDER_ADAPTER_VERSION,
  authorizationMode: "oauth2_confidential",
  accessMode: "read_only",
  environments: [
    {
      key: SQUARE_ENVIRONMENTS.sandbox.key,
      authorizationEndpointClass:
        SQUARE_ENVIRONMENTS.sandbox.authorizationEndpointClass
    },
    {
      key: SQUARE_ENVIRONMENTS.production.key,
      authorizationEndpointClass:
        SQUARE_ENVIRONMENTS.production.authorizationEndpointClass
    }
  ],
  minimumScopes: [...SQUARE_MINIMUM_READ_SCOPES],
  optionalScopes: [...SQUARE_OPTIONAL_READ_SCOPES],
  readMethodAllowlist: ["GET"],
  readOnlyPostOperations: [...SQUARE_READ_ONLY_POST_OPERATIONS],
  hostnameAllowlist: [
    SQUARE_ENVIRONMENTS.production.hostname,
    SQUARE_ENVIRONMENTS.sandbox.hostname
  ],
  capabilities: {
    operations: [
      "get_capabilities",
      "list_entities",
      "list_source_records",
      "get_source_record"
    ],
    domains: [
      "merchant_profile",
      "locations",
      "orders",
      "payments",
      "refunds",
      "catalog",
      "inventory_counts",
      "inventory_changes"
    ],
    supportsBackfill: true
  },
  objectStreams: [
    {
      streamKey: "square_merchant",
      domain: "merchant_profile",
      mode: "snapshot",
      requiredForActivation: true
    },
    {
      streamKey: "square_locations",
      domain: "locations",
      mode: "snapshot",
      requiredForActivation: true
    },
    {
      streamKey: "square_orders",
      domain: "orders",
      mode: "incremental",
      requiredForActivation: true
    },
    {
      streamKey: "square_payments",
      domain: "payments",
      mode: "incremental",
      requiredForActivation: true
    },
    {
      streamKey: "square_refunds",
      domain: "refunds",
      mode: "incremental",
      requiredForActivation: true
    },
    {
      streamKey: "square_catalog",
      domain: "catalog",
      mode: "incremental",
      requiredForActivation: true
    },
    {
      streamKey: "square_inventory_counts",
      domain: "inventory_counts",
      mode: "incremental",
      requiredForActivation: false
    },
    {
      streamKey: "square_inventory_changes",
      domain: "inventory_changes",
      mode: "incremental",
      requiredForActivation: false
    }
  ],
  webhookMode: "none",
  incrementalMode: "cursor",
  rateLimitPolicy: {
    observationMode: "bounded_default",
    maximumConcurrency: 2,
    defaultMinimumDelayMs: 500
  },
  officialDocumentationLinks: [...SQUARE_OFFICIAL_DOCUMENTATION_LINKS],
  legalCommercialGateVersion: SQUARE_DORMANT_GATE_VERSION,
  unsupportedCapabilities: [
    "production_configuration",
    "database_registration",
    "oauth_policy_registration",
    "oauth_routes",
    "credential_storage",
    "live_provider_access",
    "runtime_service",
    "webhooks",
    "queues",
    "scheduled_sync",
    "source_fact_persistence",
    "canonical_mapping",
    "response_domain_minimizers",
    "customer_domain",
    "loyalty_domain",
    "employee_domain",
    "labor_domain",
    "gift_card_domain",
    "card_detail_collection",
    "payments_write",
    "orders_write",
    "catalog_write",
    "inventory_write",
    "refund_write",
    "model_calls"
  ]
});
