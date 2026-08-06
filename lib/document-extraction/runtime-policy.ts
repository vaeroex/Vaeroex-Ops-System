import "server-only";

import {
  DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PREVIEW_APPROVAL_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
} from "@/lib/document-extraction/contracts";
import { resolveDocumentExtractionProviderRuntimeContract } from "@/lib/document-extraction/provider-profile";

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

const GOOGLE_FROZEN_QUALIFICATION_CONTROLLER_CONFIRMATION =
  "google_frozen_corpus_controller_v1";

export type DocumentExtractionRuntimeEnvironment = "production" | "preview" | "development";

export type DocumentExtractionExecutionPolicy = {
  environment: DocumentExtractionRuntimeEnvironment;
  brokerEnabled: boolean;
  providerExecutionEnabled: boolean;
  syntheticQualificationEnabled: boolean;
  googleFrozenQualificationControllerEnabled: boolean;
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
  const isGoogle = environment.DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE?.trim()
    === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE;
  const productionApprovalValid = runtimeEnvironment !== "production"
    || (
      environment.DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL?.trim()
        === DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION
      && (!isGoogle || environment.DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL?.trim()
        === GOOGLE_DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION)
    );
  const providerProfileApprovalValid = !isGoogle
    || runtimeEnvironment === "development"
    || (
      runtimeEnvironment === "preview"
      && environment.DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL?.trim()
        === GOOGLE_DOCUMENT_EXTRACTION_PREVIEW_APPROVAL_VERSION
    )
    || (
      runtimeEnvironment === "production"
      && environment.DOCUMENT_EXTRACTION_GOOGLE_PRODUCTION_APPROVAL?.trim()
        === GOOGLE_DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION
    );
  const brokerEnabled = enabled(environment.DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED);
  const providerExecutionEnabled = brokerEnabled
    && enabled(environment.DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED)
    && productionApprovalValid
    && providerProfileApprovalValid;
  const syntheticQualificationEnabled = runtimeEnvironment !== "production"
    && providerExecutionEnabled
    && enabled(environment.DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED)
    && enabled(environment.DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED);
  const googleFrozenQualificationControllerEnabled = runtimeEnvironment === "preview"
    && syntheticQualificationEnabled
    && isGoogle
    && enabled(environment.DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_ENABLED)
    && environment.DOCUMENT_EXTRACTION_GOOGLE_FROZEN_CONTROLLER_CONFIRMATION?.trim()
      === GOOGLE_FROZEN_QUALIFICATION_CONTROLLER_CONFIRMATION;
  return {
    environment: runtimeEnvironment,
    brokerEnabled,
    providerExecutionEnabled,
    syntheticQualificationEnabled,
    googleFrozenQualificationControllerEnabled,
    productionApprovalValid
  };
}

export function assertGoogleFrozenQualificationControllerEnabled(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeEnvironment?: DocumentExtractionRuntimeEnvironment
) {
  const policy = assertDocumentExtractionProviderDispatchEnabled(environment, runtimeEnvironment);
  if (!policy.googleFrozenQualificationControllerEnabled) {
    throw new Error("document_extraction_google_frozen_controller_disabled");
  }
  return policy;
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
  resolveDocumentExtractionProviderRuntimeContract(environment);
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
  syntheticProviderCallsEnabled: false,
  googleFrozenQualificationControllerEnabled: false
});
