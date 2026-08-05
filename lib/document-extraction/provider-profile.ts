import "server-only";

import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2,
  GOOGLE_DOCUMENT_EXTRACTION_CLIENT_REVISION,
  GOOGLE_DOCUMENT_EXTRACTION_COMPATIBILITY_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_CONFIDENCE_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_LOCATION,
  GOOGLE_DOCUMENT_EXTRACTION_MODEL,
  GOOGLE_DOCUMENT_EXTRACTION_PARSER_REVISION,
  GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_TYPE,
  GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  GOOGLE_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_SELECTION_MARK_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_TABLE_POLICY_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION,
  NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_MODEL,
  NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION
} from "@/lib/document-extraction/contracts";

const PROJECT_NUMBER = /^[1-9][0-9]{5,20}$/;
const PROCESSOR_ID = /^[a-f0-9]{8,64}$/;

export type DocumentExtractionProviderRuntimeContract = {
  parserProvider: string;
  parserModel: string;
  parserRevision: string;
  clientRevision: string;
  providerProfile: string;
  processorType: string | null;
  processorResource: string | null;
  processorLocation: string | null;
  processorVersion: string | null;
  endpointContractVersion: string;
  requestSerializerVersion: string;
  responseValidatorVersion: string;
  providerNormalizationVersion: string;
  compatibilityPolicyVersion: string;
  tablePolicyVersion: string | null;
  confidencePolicyVersion: string | null;
  selectionMarkPolicyVersion: string | null;
  extractionContractVersion: string;
  artifactNormalizationVersion: string;
};

function exact(environment: NodeJS.ProcessEnv, key: string, expected: string) {
  if (environment[key]?.trim() !== expected) {
    throw new Error("document_extraction_provider_contract_mismatch");
  }
}

function googleProcessorResource(projectNumber: string, processorId: string) {
  return [
    `projects/${projectNumber}`,
    `locations/${GOOGLE_DOCUMENT_EXTRACTION_LOCATION}`,
    `processors/${processorId}`,
    `processorVersions/${GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION}`
  ].join("/");
}

export function resolveDocumentExtractionProviderRuntimeContract(
  environment: NodeJS.ProcessEnv = process.env
): DocumentExtractionProviderRuntimeContract {
  const profile = environment.DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE?.trim();
  if (profile === NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) {
    exact(environment, "DOCUMENT_EXTRACTION_NVIDIA_MODEL", NVIDIA_DOCUMENT_EXTRACTION_MODEL);
    exact(
      environment,
      "DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION",
      NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION
    );
    exact(
      environment,
      "DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION",
      NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION
    );
    return {
      parserProvider: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER,
      parserModel: NVIDIA_DOCUMENT_EXTRACTION_MODEL,
      parserRevision: NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION,
      clientRevision: NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION,
      providerProfile: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
      processorType: null,
      processorResource: null,
      processorLocation: null,
      processorVersion: null,
      endpointContractVersion: NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
      requestSerializerVersion: NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
      responseValidatorVersion: NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
      providerNormalizationVersion: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
      compatibilityPolicyVersion: NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION,
      tablePolicyVersion: null,
      confidencePolicyVersion: null,
      selectionMarkPolicyVersion: null,
      extractionContractVersion: DOCUMENT_EXTRACTION_CONTRACT_VERSION,
      artifactNormalizationVersion: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION
    };
  }
  if (profile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) {
    const projectNumber = environment.DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER?.trim() || "";
    const processorId = environment.DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID?.trim() || "";
    if (!PROJECT_NUMBER.test(projectNumber) || !PROCESSOR_ID.test(processorId)) {
      throw new Error("document_extraction_provider_contract_mismatch");
    }
    exact(environment, "DOCUMENT_EXTRACTION_GOOGLE_LOCATION", GOOGLE_DOCUMENT_EXTRACTION_LOCATION);
    exact(
      environment,
      "DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION",
      GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION
    );
    exact(environment, "DOCUMENT_EXTRACTION_GOOGLE_MODEL", GOOGLE_DOCUMENT_EXTRACTION_MODEL);
    exact(
      environment,
      "DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION",
      GOOGLE_DOCUMENT_EXTRACTION_CLIENT_REVISION
    );
    exact(
      environment,
      "DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION",
      GOOGLE_DOCUMENT_EXTRACTION_PARSER_REVISION
    );
    return {
      parserProvider: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER,
      parserModel: GOOGLE_DOCUMENT_EXTRACTION_MODEL,
      parserRevision: GOOGLE_DOCUMENT_EXTRACTION_PARSER_REVISION,
      clientRevision: GOOGLE_DOCUMENT_EXTRACTION_CLIENT_REVISION,
      providerProfile: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
      processorType: GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_TYPE,
      processorResource: googleProcessorResource(projectNumber, processorId),
      processorLocation: GOOGLE_DOCUMENT_EXTRACTION_LOCATION,
      processorVersion: GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION,
      endpointContractVersion: GOOGLE_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
      requestSerializerVersion: GOOGLE_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
      responseValidatorVersion: GOOGLE_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
      providerNormalizationVersion: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
      compatibilityPolicyVersion: GOOGLE_DOCUMENT_EXTRACTION_COMPATIBILITY_POLICY_VERSION,
      tablePolicyVersion: GOOGLE_DOCUMENT_EXTRACTION_TABLE_POLICY_VERSION,
      confidencePolicyVersion: GOOGLE_DOCUMENT_EXTRACTION_CONFIDENCE_POLICY_VERSION,
      selectionMarkPolicyVersion: GOOGLE_DOCUMENT_EXTRACTION_SELECTION_MARK_POLICY_VERSION,
      extractionContractVersion: DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2,
      artifactNormalizationVersion: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2
    };
  }
  throw new Error("document_extraction_provider_profile_not_approved");
}
