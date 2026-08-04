import "server-only";

import {
  DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION,
  NVIDIA_DOCUMENT_EXTRACTION_MODEL,
  NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION
} from "@/lib/document-extraction/contracts";

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export type DocumentExtractionExecutionPolicy = {
  environment: "production" | "preview" | "development";
  brokerEnabled: boolean;
  providerExecutionEnabled: boolean;
  syntheticQualificationEnabled: boolean;
  productionApprovalValid: boolean;
};

export function resolveDocumentExtractionExecutionPolicy(
  environment: NodeJS.ProcessEnv = process.env
): DocumentExtractionExecutionPolicy {
  const vercelEnvironment = environment.VERCEL_ENV;
  const runtimeEnvironment = vercelEnvironment === "production"
    ? "production"
    : vercelEnvironment === "preview"
      ? "preview"
      : "development";
  const productionApprovalValid = runtimeEnvironment !== "production"
    || environment.DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL?.trim()
      === DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION;
  const brokerEnabled = enabled(environment.DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED);
  const providerExecutionEnabled = brokerEnabled
    && enabled(environment.DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED)
    && productionApprovalValid;
  const syntheticQualificationEnabled = runtimeEnvironment !== "production"
    && providerExecutionEnabled
    && enabled(environment.DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED)
    && enabled(environment.DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED);
  return {
    environment: runtimeEnvironment,
    brokerEnabled,
    providerExecutionEnabled,
    syntheticQualificationEnabled,
    productionApprovalValid
  };
}

export function assertDocumentExtractionBrokerEnabled(
  environment: NodeJS.ProcessEnv = process.env
) {
  const policy = resolveDocumentExtractionExecutionPolicy(environment);
  if (!policy.brokerEnabled) {
    throw new Error("document_extraction_broker_disabled");
  }
  return policy;
}

export function assertDocumentExtractionProviderDispatchEnabled(
  environment: NodeJS.ProcessEnv = process.env
) {
  const policy = assertDocumentExtractionProviderGateEnabled(environment);
  if (
    environment.DOCUMENT_EXTRACTION_NVIDIA_MODEL?.trim() !== NVIDIA_DOCUMENT_EXTRACTION_MODEL
    || environment.DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION?.trim()
      !== NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION
    || environment.DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION?.trim()
      !== NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION
  ) {
    throw new Error("document_extraction_provider_contract_mismatch");
  }
  return policy;
}

export function assertDocumentExtractionProviderGateEnabled(
  environment: NodeJS.ProcessEnv = process.env
) {
  const policy = assertDocumentExtractionBrokerEnabled(environment);
  if (!policy.providerExecutionEnabled) {
    throw new Error("document_extraction_provider_execution_disabled");
  }
  return policy;
}

export const DOCUMENT_EXTRACTION_RUNTIME_DEFAULTS = Object.freeze({
  privateWorkerEnabled: false,
  providerExecutionEnabled: false,
  syntheticQualificationEnabled: false,
  syntheticProviderCallsEnabled: false
});
