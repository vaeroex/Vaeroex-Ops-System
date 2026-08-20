import { z } from "zod";

import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  BoundedTextSchema,
  IsoTimestampSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import { ExternalSourceRecordVersionSchema } from "@/lib/integrations/contracts/source-facts";
import {
  EXTERNAL_INTEGRATION_CONTRACT_VERSIONS,
  EXTERNAL_INTEGRATION_LIMITS
} from "@/lib/integrations/contracts/versions";

export const ProviderDataOperationSchema = z.enum([
  "list_entities",
  "list_source_records",
  "get_source_record",
  "get_capabilities"
]);

const providerEnvironmentSchema = z
  .object({
    key: BoundedIdentifierSchema,
    authorizationEndpointClass: z.enum(["sandbox", "production", "private"])
  })
  .strict();

const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

const objectStreamSchema = z
  .object({
    streamKey: BoundedIdentifierSchema,
    domain: BoundedIdentifierSchema,
    mode: z.enum(["snapshot", "incremental", "control_observation"]),
    requiredForActivation: z.boolean()
  })
  .strict();

export const ProviderDescriptorSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.providerAdapter),
    providerKey: ProviderKeySchema,
    displayName: BoundedLabelSchema,
    adapterVersion: BoundedIdentifierSchema,
    authorizationMode: z.enum(["oauth2_confidential", "service_authorization", "customer_managed"]),
    accessMode: z.literal("read_only"),
    environments: z.array(providerEnvironmentSchema).min(1).max(8),
    minimumScopes: uniqueStringArray(BoundedIdentifierSchema, EXTERNAL_INTEGRATION_LIMITS.scopesPerConnection),
    optionalScopes: uniqueStringArray(BoundedIdentifierSchema, EXTERNAL_INTEGRATION_LIMITS.scopesPerConnection),
    readMethodAllowlist: z.array(z.literal("GET")).length(1),
    hostnameAllowlist: uniqueStringArray(hostnameSchema, 32),
    capabilities: z
      .object({
        operations: uniqueStringArray(ProviderDataOperationSchema, EXTERNAL_INTEGRATION_LIMITS.providerCapabilities),
        domains: uniqueStringArray(BoundedIdentifierSchema, EXTERNAL_INTEGRATION_LIMITS.providerCapabilities),
        supportsBackfill: z.boolean()
      })
      .strict(),
    objectStreams: z.array(objectStreamSchema).max(EXTERNAL_INTEGRATION_LIMITS.providerCapabilities),
    webhookMode: z.enum(["none", "change_hints", "verified_events"]),
    incrementalMode: z.enum(["none", "cursor", "change_token", "notification_hint"]),
    rateLimitPolicy: z
      .object({
        observationMode: z.enum(["response_headers", "bounded_default", "hybrid"]),
        maximumConcurrency: z.number().int().positive().max(100).safe(),
        defaultMinimumDelayMs: z.number().int().nonnegative().max(60_000).safe()
      })
      .strict(),
    officialDocumentationLinks: z.array(z.string().url().refine((value) => value.startsWith("https://"))).max(32),
    legalCommercialGateVersion: BoundedIdentifierSchema,
    unsupportedCapabilities: uniqueStringArray(BoundedIdentifierSchema, EXTERNAL_INTEGRATION_LIMITS.providerCapabilities)
  })
  .strict()
  .superRefine((value, context) => {
    const environmentKeys = value.environments.map((environment) => environment.key);
    if (new Set(environmentKeys).size !== environmentKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["environments"], message: "Provider environment keys must be unique" });
    }
    const minimumScopes = new Set(value.minimumScopes);
    if (value.optionalScopes.some((scope) => minimumScopes.has(scope))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["optionalScopes"], message: "Minimum and optional scopes must not overlap" });
    }
    const streamKeys = value.objectStreams.map((stream) => stream.streamKey);
    if (new Set(streamKeys).size !== streamKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["objectStreams"], message: "Provider stream keys must be unique" });
    }
  });

export type ProviderDescriptor = Readonly<z.infer<typeof ProviderDescriptorSchema>>;

export const ProviderAdapterContextSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    providerTenantReferenceFingerprint: Sha256FingerprintSchema,
    connectionConfigurationVersion: z.number().int().positive().safe(),
    mappingVersion: z.number().int().nonnegative().safe()
  })
  .strict();

export type ProviderAdapterContext = Readonly<z.infer<typeof ProviderAdapterContextSchema>>;

export const ProviderAdapterRequestSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.providerAdapter),
    operation: ProviderDataOperationSchema,
    context: ProviderAdapterContextSchema,
    domain: BoundedIdentifierSchema.nullable(),
    sourceRecordReference: BoundedIdentifierSchema.nullable(),
    cursor: BoundedIdentifierSchema.nullable(),
    changedAfter: IsoTimestampSchema.nullable(),
    pageSize: z.number().int().positive().max(1_000).safe(),
    requestFingerprint: Sha256FingerprintSchema
  })
  .strict();

const providerEntityReferenceSchema = z
  .object({
    providerEntityReference: BoundedIdentifierSchema,
    displayName: BoundedLabelSchema,
    status: z.enum(["active", "inactive", "unknown"])
  })
  .strict();

const providerAdapterPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entities"), items: z.array(providerEntityReferenceSchema).max(1_000) }).strict(),
  z.object({ kind: z.literal("source_records"), items: z.array(ExternalSourceRecordVersionSchema).max(1_000) }).strict(),
  z.object({ kind: z.literal("capabilities"), descriptor: ProviderDescriptorSchema }).strict(),
  z
    .object({
      kind: z.literal("checkpoint"),
      cursor: BoundedIdentifierSchema.nullable(),
      exhausted: z.boolean()
    })
    .strict()
]);

const providerAdapterSuccessSchema = z
  .object({
    outcome: z.literal("success"),
    operation: ProviderDataOperationSchema,
    context: ProviderAdapterContextSchema,
    trust: z.literal("untrusted_external_input"),
    payload: providerAdapterPayloadSchema,
    completedAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    const expectedPayloadKinds: Readonly<Record<z.infer<typeof ProviderDataOperationSchema>, readonly string[]>> = {
      list_entities: ["entities"],
      list_source_records: ["source_records", "checkpoint"],
      get_source_record: ["source_records"],
      get_capabilities: ["capabilities"]
    };
    if (!expectedPayloadKinds[value.operation].includes(value.payload.kind)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "Adapter payload does not match its operation" });
    }
    if (value.payload.kind === "capabilities" && value.payload.descriptor.providerKey !== value.context.providerKey) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", "descriptor", "providerKey"], message: "Capability provider does not match adapter context" });
    }
    if (value.payload.kind === "source_records") {
      for (const [index, source] of value.payload.items.entries()) {
        if (
          source.workspaceId !== value.context.workspaceId ||
          source.businessEntityId !== value.context.businessEntityId ||
          source.connectionId !== value.context.connectionId ||
          source.source.kind !== "provider" ||
          source.source.providerKey !== value.context.providerKey
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["payload", "items", index],
            message: "Adapter source record does not match its bound tenant and provider context"
          });
        }
      }
    }
  });

const providerAdapterFailureSchema = z
  .object({
    outcome: z.literal("failure"),
    operation: ProviderDataOperationSchema,
    context: ProviderAdapterContextSchema,
    trust: z.literal("untrusted_external_input"),
    error: z
      .object({
        code: BoundedIdentifierSchema,
        category: z.enum(["authorization", "rate_limit", "availability", "contract", "data", "unknown"]),
        retryDisposition: z.enum(["do_not_retry", "retry_with_backoff", "reauthorization_required"]),
        safeDetail: BoundedTextSchema
      })
      .strict(),
    failedAt: IsoTimestampSchema
  })
  .strict();

export const ProviderAdapterResultSchema = z.union([providerAdapterSuccessSchema, providerAdapterFailureSchema]);

export type ProviderAdapterRequest = Readonly<z.infer<typeof ProviderAdapterRequestSchema>>;
export type ProviderAdapterResult = Readonly<z.infer<typeof ProviderAdapterResultSchema>>;
