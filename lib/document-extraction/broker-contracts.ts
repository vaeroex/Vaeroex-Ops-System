import { z } from "zod";
import {
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
} from "@/lib/document-extraction/contracts";

const uuid = z.string().uuid();
const leaseCapability = z.string().min(80).max(2_000);
const providerProfile = z.enum([
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
]);
const stage = z.enum([
  "leased",
  "preparing",
  "dispatching",
  "provider_dispatched",
  "extracting",
  "normalizing",
  "validating",
  "encrypting"
]);

const telemetry = z.object({
  requestId: uuid,
  latencyMs: z.number().int().min(0).max(300_000).nullable(),
  validationResult: z.string().regex(/^[a-z0-9._:-]{1,100}$/).nullable(),
  encryptionResult: z.string().regex(/^[a-z0-9._:-]{1,100}$/).nullable(),
  cacheResult: z.string().regex(/^[a-z0-9._:-]{1,100}$/).nullable()
}).strict();

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const localQualificationItem = z.object({
  fixtureIndex: z.number().int().min(1).max(12),
  sourceSha256: sha256,
  fixtureIdentityFingerprint: sha256,
  pageIdentityFingerprints: z.array(sha256).min(1).max(2),
  providerEligible: z.literal(false),
  localRejectionReason: z.enum([
    "google_fixture_unsupported_screenshot",
    "google_fixture_unsupported_handwriting",
    "synthetic_fixture_locally_invalid"
  ]),
  documentClass: z.null()
}).strict();
const eligibleQualificationItem = z.object({
  fixtureIndex: z.number().int().min(1).max(12),
  sourceSha256: sha256,
  fixtureIdentityFingerprint: sha256,
  pageIdentityFingerprints: z.array(sha256).min(1).max(2),
  providerEligible: z.literal(true),
  localRejectionReason: z.null(),
  documentClass: z.enum([
    "digital_pdf", "scanned_pdf", "image_only_pdf", "printed_document_photo"
  ])
}).strict();
const qualificationItem = z.discriminatedUnion("providerEligible", [
  eligibleQualificationItem,
  localQualificationItem
]);

export const documentExtractionBrokerRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("health")
  }).strict(),
  z.object({
    operation: z.literal("claim"),
    providerProfile,
    leaseSeconds: z.number().int().min(30).max(300).default(120)
  }).strict(),
  z.object({
    operation: z.literal("qualification_prepare"),
    requestId: uuid,
    benchmarkProfileFingerprint: sha256,
    items: z.array(qualificationItem).length(12)
  }).strict(),
  z.object({
    operation: z.literal("qualification_enqueue_next"),
    runId: uuid,
    requestId: uuid
  }).strict(),
  z.object({
    operation: z.literal("qualification_status"),
    runId: uuid
  }).strict(),
  z.object({
    operation: z.literal("qualification_finish_item"),
    runId: uuid,
    jobId: uuid
  }).strict(),
  z.object({
    operation: z.literal("qualification_stop"),
    runId: uuid,
    reason: z.string().regex(/^[a-z][a-z0-9_]{0,119}$/)
  }).strict(),
  z.object({
    operation: z.literal("qualification_complete"),
    runId: uuid
  }).strict(),
  z.object({
    operation: z.literal("qualification_cleanup"),
    runId: uuid,
    confirmation: z.literal("cleanup-google-frozen-corpus-controller-v1")
  }).strict(),
  z.object({
    operation: z.literal("heartbeat"),
    leaseCapability,
    leaseSeconds: z.number().int().min(30).max(300).default(120)
  }).strict(),
  z.object({
    operation: z.literal("issue_file_access"),
    leaseCapability,
    ttlSeconds: z.number().int().min(15).max(120).default(60)
  }).strict(),
  z.object({
    operation: z.literal("advance_stage"),
    leaseCapability,
    requestId: uuid,
    expectedStage: stage,
    nextStage: stage
  }).strict(),
  z.object({
    operation: z.literal("authorize_dispatch"),
    leaseCapability,
    dispatchRequestId: uuid
  }).strict(),
  z.object({
    operation: z.literal("check_provider_boundary"),
    leaseCapability,
    boundary: z.enum(["asset_create", "asset_upload", "inference"]),
    qualificationPageIndex: z.number().int().min(1).max(2).optional(),
    qualificationReservationRequestId: uuid.optional(),
    qualificationDispatchRequestId: uuid.optional()
  }).strict(),
  z.object({
    operation: z.literal("qualification_page_outcome"),
    leaseCapability,
    reservationId: uuid,
    succeeded: z.boolean(),
    resultClass: z.enum([
      "success", "transport", "timeout", "rate_limit", "provider",
      "malformed_output", "validation", "authorization",
      "ambiguous_dispatch", "privacy", "provenance", "authority", "internal"
    ]),
    providerRequestStarted: z.boolean()
  }).strict(),
  z.object({
    operation: z.literal("provider_outcome"),
    leaseCapability,
    dispatchRequestId: uuid,
    resultClass: z.enum([
      "success",
      "transport",
      "timeout",
      "rate_limit",
      "provider",
      "malformed_output",
      "validation",
      "ambiguous_dispatch"
    ]),
    latencyMs: z.number().int().min(0).max(180_000)
  }).strict(),
  z.object({
    operation: z.literal("authorize_retry"),
    leaseCapability,
    priorDispatchRequestId: uuid,
    nextDispatchRequestId: uuid
  }).strict(),
  z.object({
    operation: z.literal("complete"),
    leaseCapability,
    artifact: z.unknown(),
    telemetry
  }).strict(),
  z.object({
    operation: z.literal("fail"),
    leaseCapability,
    failureCode: z.string().regex(/^[a-z0-9._:-]{1,100}$/),
    failureClass: z.enum([
      "pre_provider",
      "transport",
      "timeout",
      "rate_limit",
      "provider",
      "validation",
      "encryption",
      "authorization",
      "quota",
      "unsupported_input",
      "ambiguous_dispatch",
      "internal"
    ]),
    telemetry
  }).strict()
]);

export type DocumentExtractionBrokerRequest = z.infer<typeof documentExtractionBrokerRequestSchema>;
