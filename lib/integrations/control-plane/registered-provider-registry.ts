import { assertProviderDescriptorRegistry } from "@/lib/integrations/control-plane/provider-registry";
import { QBO_PHASE_7_PROVIDER_REGISTRY } from "@/lib/integrations/providers/qbo/descriptor";

// This is the reviewed registry used for new persistence. Historical Phase 4
// registry exports remain unchanged so existing fingerprints stay recognizable.
export const REGISTERED_PROVIDER_REGISTRY = assertProviderDescriptorRegistry(
  QBO_PHASE_7_PROVIDER_REGISTRY
);
