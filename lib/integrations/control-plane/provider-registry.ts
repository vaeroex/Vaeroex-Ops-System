import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  ProviderDescriptorSchema,
  type ProviderDescriptor
} from "@/lib/integrations/contracts/provider-adapter";
import {
  CONTROL_PLANE_CONTRACT_VERSIONS,
  CONTROL_PLANE_REGISTRY_VERSION,
  ProviderDescriptorRegistrySchema,
  SafeCapabilitySnapshotSchema,
  type ProviderDescriptorRegistry
} from "@/lib/integrations/control-plane/contracts";

function descriptorFingerprint(descriptor: ProviderDescriptor) {
  return contractSha256({
    fingerprintPurpose: "provider_descriptor",
    fingerprintVersion: "provider_descriptor_fingerprint_v1",
    payload: descriptor
  });
}

function registryFingerprintInput(
  registry: Omit<ProviderDescriptorRegistry, "registryFingerprint">
) {
  return {
    fingerprintPurpose: "provider_descriptor_registry",
    fingerprintVersion: "provider_descriptor_registry_fingerprint_v1",
    payload: registry
  } as const;
}

export function createProviderDescriptorRegistry(
  descriptors: readonly ProviderDescriptor[]
): ProviderDescriptorRegistry {
  const entries = descriptors
    .map((value) => ProviderDescriptorSchema.parse(value))
    .sort((left, right) => left.providerKey.localeCompare(right.providerKey))
    .map((descriptor) => ({
      descriptor,
      descriptorFingerprint: descriptorFingerprint(descriptor)
    }));
  const draft = {
    contractVersion: CONTROL_PLANE_CONTRACT_VERSIONS.providerRegistry,
    registryVersion: CONTROL_PLANE_REGISTRY_VERSION,
    descriptors: entries
  } as const;
  return ProviderDescriptorRegistrySchema.parse({
    ...draft,
    registryFingerprint: contractSha256(registryFingerprintInput(draft))
  });
}

export function assertProviderDescriptorRegistry(input: unknown) {
  const registry = ProviderDescriptorRegistrySchema.parse(input);
  const keys = registry.descriptors.map((entry) => entry.descriptor.providerKey);
  if (keys.some((key, index) => index > 0 && keys[index - 1] > key)) {
    throw new Error("provider_descriptor_registry_order_invalid");
  }
  for (const entry of registry.descriptors) {
    if (entry.descriptorFingerprint !== descriptorFingerprint(entry.descriptor)) {
      throw new Error("provider_descriptor_fingerprint_mismatch");
    }
  }
  const { registryFingerprint, ...draft } = registry;
  if (registryFingerprint !== contractSha256(registryFingerprintInput(draft))) {
    throw new Error("provider_descriptor_registry_fingerprint_mismatch");
  }
  return registry;
}

export const SYNTHETIC_PROVIDER_DESCRIPTOR = ProviderDescriptorSchema.parse({
  contractVersion: "provider_adapter_v1",
  providerKey: "synthetic",
  displayName: "Synthetic Provider",
  adapterVersion: "synthetic_control_plane_adapter_v1",
  authorizationMode: "customer_managed",
  accessMode: "read_only",
  environments: [
    { key: "test", authorizationEndpointClass: "private" }
  ],
  minimumScopes: ["read_synthetic_business_data"],
  optionalScopes: ["read_synthetic_reference_data"],
  readMethodAllowlist: ["GET"],
  hostnameAllowlist: [],
  capabilities: {
    operations: [
      "get_capabilities",
      "list_entities",
      "list_source_records",
      "get_source_record"
    ],
    domains: ["general_ledger"],
    supportsBackfill: true
  },
  objectStreams: [
    {
      streamKey: "general_ledger",
      domain: "general_ledger",
      mode: "incremental",
      requiredForActivation: true
    }
  ],
  webhookMode: "none",
  incrementalMode: "cursor",
  rateLimitPolicy: {
    observationMode: "bounded_default",
    maximumConcurrency: 2,
    defaultMinimumDelayMs: 1_000
  },
  officialDocumentationLinks: [],
  legalCommercialGateVersion: "synthetic_phase_4_only_v1",
  unsupportedCapabilities: [
    "durable_queue",
    "live_provider_access",
    "oauth",
    "webhooks"
  ]
});

export const PHASE_4_PROVIDER_REGISTRY = createProviderDescriptorRegistry([
  SYNTHETIC_PROVIDER_DESCRIPTOR
]);

export function providerDescriptor(
  providerKey: string,
  providerEnvironment: string,
  registry: ProviderDescriptorRegistry = PHASE_4_PROVIDER_REGISTRY
) {
  const checked = assertProviderDescriptorRegistry(registry);
  const entry = checked.descriptors.find(
    (candidate) => candidate.descriptor.providerKey === providerKey
  );
  if (!entry) throw new Error("provider_descriptor_not_registered");
  if (
    !entry.descriptor.environments.some(
      (environment) => environment.key === providerEnvironment
    )
  ) {
    throw new Error("provider_environment_not_registered");
  }
  return entry;
}

export function safeCapabilitySnapshot(descriptor: ProviderDescriptor) {
  return SafeCapabilitySnapshotSchema.parse({
    operations: [...descriptor.capabilities.operations].sort(),
    domains: [...descriptor.capabilities.domains].sort(),
    requiredStreamKeys: descriptor.objectStreams
      .filter((stream) => stream.requiredForActivation)
      .map((stream) => stream.streamKey)
      .sort(),
    supportsBackfill: descriptor.capabilities.supportsBackfill,
    webhookMode: descriptor.webhookMode,
    incrementalMode: descriptor.incrementalMode
  });
}
