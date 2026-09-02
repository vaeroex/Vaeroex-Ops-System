import {
  ProviderDescriptorSchema,
  type ProviderDescriptor
} from "@/lib/integrations/contracts/provider-adapter";
import {
  createProviderDescriptorRegistry,
  SYNTHETIC_PROVIDER_DESCRIPTOR
} from "@/lib/integrations/control-plane/provider-registry";
import {
  QBO_PROVIDER_ADAPTER_VERSION,
  QBO_PROVIDER_KEY,
  QBO_REPORT_TYPES,
  QBO_TRANSACTION_RECORD_TYPES,
  QBO_V1_UNSUPPORTED_OR_DEFERRED_OBJECTS
} from "@/lib/integrations/providers/qbo/contracts";
import { QBO_OFFICIAL_DOCUMENTATION_LINKS } from "@/lib/integrations/providers/qbo/documentation-register";

export const QBO_PROVIDER_DESCRIPTOR: ProviderDescriptor = ProviderDescriptorSchema.parse({
  contractVersion: "provider_adapter_v1",
  providerKey: QBO_PROVIDER_KEY,
  displayName: "QuickBooks Online",
  adapterVersion: QBO_PROVIDER_ADAPTER_VERSION,
  authorizationMode: "oauth2_confidential",
  accessMode: "read_only",
  environments: [
    { key: "sandbox", authorizationEndpointClass: "sandbox" },
    { key: "production", authorizationEndpointClass: "production" }
  ],
  minimumScopes: ["com.intuit.quickbooks.accounting"],
  optionalScopes: [],
  readMethodAllowlist: ["GET"],
  hostnameAllowlist: [
    "quickbooks.api.intuit.com",
    "sandbox-quickbooks.api.intuit.com"
  ],
  capabilities: {
    operations: [
      "get_capabilities",
      "list_entities",
      "list_source_records",
      "get_source_record"
    ],
    domains: [
      "company_configuration",
      "master_records",
      "financial_transactions",
      "report_control_observations",
      "change_hints"
    ],
    supportsBackfill: true
  },
  objectStreams: [
    { streamKey: "company_info", domain: "company_configuration", mode: "snapshot", requiredForActivation: true },
    { streamKey: "preferences", domain: "company_configuration", mode: "snapshot", requiredForActivation: true },
    { streamKey: "accounts", domain: "master_records", mode: "incremental", requiredForActivation: true },
    { streamKey: "customers_minimized", domain: "master_records", mode: "incremental", requiredForActivation: false },
    { streamKey: "vendors_minimized", domain: "master_records", mode: "incremental", requiredForActivation: false },
    { streamKey: "items_minimized", domain: "master_records", mode: "incremental", requiredForActivation: false },
    ...QBO_TRANSACTION_RECORD_TYPES.map((recordType) => ({
      streamKey: `qbo_${recordType.toLowerCase()}`,
      domain: "financial_transactions",
      mode: "incremental" as const,
      requiredForActivation: true
    })),
    ...QBO_REPORT_TYPES.map((reportType) => ({
      streamKey: `qbo_${reportType.toLowerCase()}`,
      domain: "report_control_observations",
      mode: "control_observation" as const,
      requiredForActivation: true
    }))
  ],
  webhookMode: "change_hints",
  incrementalMode: "cursor",
  rateLimitPolicy: {
    observationMode: "hybrid",
    maximumConcurrency: 2,
    defaultMinimumDelayMs: 250
  },
  officialDocumentationLinks: [...QBO_OFFICIAL_DOCUMENTATION_LINKS],
  legalCommercialGateVersion: "qbo_production_read_only_v1",
  unsupportedCapabilities: [
    "accounting_writes",
    "batch_writes",
    "quickbooks_desktop",
    "web_connector",
    "customer_hosted_agent",
    "payroll",
    "bank_feeds",
    "attachments",
    "ai_mapping",
    "kpi_promotion",
    ...QBO_V1_UNSUPPORTED_OR_DEFERRED_OBJECTS.map((value) => `deferred_${value.toLowerCase()}`)
  ]
});

export const QBO_PHASE_7_PROVIDER_REGISTRY = createProviderDescriptorRegistry([
  SYNTHETIC_PROVIDER_DESCRIPTOR,
  QBO_PROVIDER_DESCRIPTOR
]);
