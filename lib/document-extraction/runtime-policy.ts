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

export type DocumentExtractionRuntimeEnvironment = "production" | "preview" | "development";

export type DocumentExtractionExecutionPolicy = {
  environment: DocumentExtractionRuntimeEnvironment;
  brokerEnabled: boolean;
  providerExecutionEnabled: boolean;
  syntheticQualificationEnabled: boolean;
  productionApprovalValid: boolean;
};

export function resolveVercelDocumentExtractionRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): DocumentExtractionRuntimeEnvironment {
  return environment.VERCEL_ENV === "production"
    ? "production"
    : environment.VERCEL_ENV === "preview"
      ? "preview"
      : "development";
}

export function resolveBrokerDocumentExtractionRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): Exclude<DocumentExtractionRuntimeEnvironment, "development"> {
  const value = environment.DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT?.trim().toLowerCase();
  if (value !== "preview" && value !== "production") {
    throw new Error("document_extraction_broker_environment_invalid");
  }
  return value;
}

export function resolveDocumentExtractionExecutionPolicy(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeEnvironment: DocumentExtractionRuntimeEnvironment = resolveVercelDocumentExtractionRuntimeEnvironment(
    environment
  )
): DocumentExtractionExecutionPolicy {
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
  environment: NodeJS.ProcessEnv = process.env,
  runtimeEnvironment?: DocumentExtractionRuntimeEnvironment
) {
  const policy = resolveDocumentExtractionExecutionPolicy(environment, runtimeEnvironment);
  if (!policy.brokerEnabled) {
    throw new Error("document_extraction_broker_disabled");
  }
  return policy;
}

export function assertDocumentExtractionProviderDispatchEnabled(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeEnvironment?: DocumentExtractionRuntimeEnvironment
) {
  const policy = assertDocumentExtractionProviderGateEnabled(environment, runtimeEnvironment);
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
  environment: NodeJS.ProcessEnv = process.env,
  runtimeEnvironment?: DocumentExtractionRuntimeEnvironment
) {
  const policy = assertDocumentExtractionBrokerEnabled(environment, runtimeEnvironment);
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
