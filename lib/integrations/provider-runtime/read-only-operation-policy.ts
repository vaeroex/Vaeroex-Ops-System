import "server-only";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  ContractJsonObjectSchema,
  ProviderEnvironmentKeySchema,
  ProviderKeySchema,
  type ContractJsonValue
} from "@/lib/integrations/contracts/primitives";
import {
  ProviderDescriptorSchema,
  type ProviderDescriptor,
  type ProviderReadOnlyPostOperation
} from "@/lib/integrations/contracts/provider-adapter";

export const PROVIDER_READ_ONLY_POST_OPERATION_POLICY_VERSION =
  "provider_read_only_post_operation_policy_v1" as const;

type ContractJsonObject = Readonly<Record<string, ContractJsonValue>>;

export type ProviderReadOnlyPostRequestValidationInput = Readonly<{
  operation: ProviderReadOnlyPostOperation;
  queryParameters: readonly (readonly [string, string])[];
  body: ContractJsonObject;
  rawBodyByteLength: number;
}>;

export type ProviderReadOnlyPostRequestValidationResult = Readonly<{
  normalizedQueryParameters: ContractJsonObject;
  normalizedBody: ContractJsonObject;
}>;

export type ProviderReadOnlyPostRequestValidator = (
  input: ProviderReadOnlyPostRequestValidationInput
) => ProviderReadOnlyPostRequestValidationResult;

export type ProviderReadOnlyPostRequestValidatorRegistry = Readonly<
  Record<string, ProviderReadOnlyPostRequestValidator | undefined>
>;

export type ProviderReadOnlyPostOperationDecision = Readonly<{
  policyVersion: typeof PROVIDER_READ_ONLY_POST_OPERATION_POLICY_VERSION;
  readOnly: true;
  providerKey: string;
  providerEnvironment: string;
  operationKey: string;
  hostname: string;
  path: string;
  method: "POST";
  contentType: "application/json";
  maximumResponseBytes: number;
  timeoutMs: number;
  retryClassification: ProviderReadOnlyPostOperation["retryClassification"];
  redirectPolicy: "manual";
  requestValidatorKey: string;
  requestFingerprint: string;
}>;

export type AssertDeclaredReadOnlyPostOperationInput = Readonly<{
  descriptor: ProviderDescriptor;
  providerKey: string;
  providerEnvironment: string;
  method: string;
  url: string;
  contentType: string;
  body: string | Uint8Array;
  validators: ProviderReadOnlyPostRequestValidatorRegistry;
  retryAttempt?: Readonly<{
    attempt: number;
    priorRetryClassification?: ProviderReadOnlyPostOperation["retryClassification"];
  }>;
}>;

function deny(): never {
  throw new Error("provider_read_only_post_operation_denied");
}

function parseDescriptor(input: ProviderDescriptor) {
  try {
    return ProviderDescriptorSchema.parse(input);
  } catch {
    deny();
  }
}

function parseProviderKey(input: string) {
  try {
    return ProviderKeySchema.parse(input);
  } catch {
    deny();
  }
}

function parseProviderEnvironment(input: string) {
  try {
    return ProviderEnvironmentKeySchema.parse(input);
  } catch {
    deny();
  }
}

export function providerReadOnlyPostValidatorRegistryKey(
  operation: Pick<
    ProviderReadOnlyPostOperation,
    "providerKey" | "providerEnvironment" | "requestValidatorKey"
  >
) {
  return [
    operation.providerKey,
    operation.providerEnvironment,
    operation.requestValidatorKey
  ].join("\u0000");
}

function parseExactUrl(urlText: string) {
  const authorityMatch =
    /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)?/.exec(urlText);
  if (!authorityMatch) deny();
  const [, rawScheme, rawAuthority, rawPath = ""] = authorityMatch;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    deny();
  }
  const path = rawPath === "" ? "/" : rawPath;
  if (
    rawScheme.toLowerCase() !== "https" ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    rawAuthority.includes("@") ||
    rawAuthority.includes(":")
  ) {
    deny();
  }
  if (rawAuthority.toLowerCase() !== url.hostname || url.hostname.length === 0) {
    deny();
  }
  if (
    path.includes("%") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    deny();
  }
  return {
    hostname: url.hostname,
    path,
    pathname: url.pathname,
    queryParameters: Array.from(url.searchParams.entries()).map(
      ([key, value]) => [key, value] as const
    )
  } as const;
}

function normalizeContentType(contentType: string) {
  const [mediaType, ...parameterParts] = contentType.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json") deny();
  for (const rawParameter of parameterParts) {
    const parameter = rawParameter.trim();
    if (parameter === "") deny();
    const equalsIndex = parameter.indexOf("=");
    if (
      equalsIndex <= 0 ||
      equalsIndex !== parameter.lastIndexOf("=")
    ) {
      deny();
    }
    const key = parameter.slice(0, equalsIndex).trim().toLowerCase();
    const rawValue = parameter.slice(equalsIndex + 1).trim();
    if (
      (rawValue.startsWith("\"") && !rawValue.endsWith("\"")) ||
      (!rawValue.startsWith("\"") && rawValue.endsWith("\""))
    ) {
      deny();
    }
    const value = rawValue.replace(/^"|"$/g, "").toLowerCase();
    if (key !== "charset" || (value !== "utf-8" && value !== "utf8")) {
      deny();
    }
  }
  return "application/json" as const;
}

function parseJsonObjectBody(body: string | Uint8Array, maximumRequestBodyBytes: number) {
  const rawBodyByteLength =
    typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
  if (rawBodyByteLength <= 0 || rawBodyByteLength > maximumRequestBodyBytes) {
    deny();
  }
  const bodyText =
    typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    deny();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    deny();
  }
  try {
    return {
      rawBodyByteLength,
      body: ContractJsonObjectSchema.parse(parsed)
    } as const;
  } catch {
    deny();
  }
}

function parseContractJsonObject(value: unknown) {
  try {
    return ContractJsonObjectSchema.parse(value);
  } catch {
    deny();
  }
}

function matchingReadOnlyPostOperation(input: {
  descriptor: ProviderDescriptor;
  providerEnvironment: string;
  hostname: string;
  path: string;
}) {
  return (input.descriptor.readOnlyPostOperations ?? []).find(
    (operation) =>
      operation.providerEnvironment === input.providerEnvironment &&
      operation.hostname === input.hostname &&
      operation.path === input.path &&
      operation.method === "POST"
  );
}

export function assertDeclaredReadOnlyPostOperation(
  input: AssertDeclaredReadOnlyPostOperationInput
): ProviderReadOnlyPostOperationDecision {
  const descriptor = parseDescriptor(input.descriptor);
  const providerKey = parseProviderKey(input.providerKey);
  const providerEnvironment = parseProviderEnvironment(input.providerEnvironment);
  if (
    providerKey !== descriptor.providerKey ||
    input.method.toUpperCase() !== "POST"
  ) {
    deny();
  }

  const parsedUrl = parseExactUrl(input.url);
  const operation = matchingReadOnlyPostOperation({
    descriptor,
    providerEnvironment,
    hostname: parsedUrl.hostname,
    path: parsedUrl.path
  });
  if (!operation || parsedUrl.pathname !== operation.path) {
    deny();
  }
  const contentType = normalizeContentType(input.contentType);
  if (contentType !== operation.contentType) deny();

  const { body, rawBodyByteLength } = parseJsonObjectBody(
    input.body,
    operation.maximumRequestBodyBytes
  );
  const validator =
    input.validators[providerReadOnlyPostValidatorRegistryKey(operation)];
  if (!validator) deny();

  let validationResult: ProviderReadOnlyPostRequestValidationResult;
  try {
    validationResult = validator({
      operation,
      queryParameters: parsedUrl.queryParameters,
      body,
      rawBodyByteLength
    });
  } catch {
    deny();
  }
  const normalizedQueryParameters = parseContractJsonObject(
    validationResult.normalizedQueryParameters
  );
  const normalizedBody = parseContractJsonObject(validationResult.normalizedBody);

  return {
    policyVersion: PROVIDER_READ_ONLY_POST_OPERATION_POLICY_VERSION,
    readOnly: true,
    providerKey,
    providerEnvironment,
    operationKey: operation.operationKey,
    hostname: operation.hostname,
    path: operation.path,
    method: "POST",
    contentType,
    maximumResponseBytes: operation.maximumResponseBytes,
    timeoutMs: operation.timeoutMs,
    retryClassification: operation.retryClassification,
    redirectPolicy: "manual",
    requestValidatorKey: operation.requestValidatorKey,
    requestFingerprint: contractSha256({
      fingerprintPurpose: "provider_read_only_post_request",
      fingerprintVersion: "provider_read_only_post_request_fingerprint_v1",
      payload: {
        providerKey,
        providerEnvironment,
        operationKey: operation.operationKey,
        hostname: operation.hostname,
        path: operation.path,
        method: operation.method,
        rawBodyByteLength,
        normalizedQueryParameters,
        normalizedBody
      }
    })
  };
}
