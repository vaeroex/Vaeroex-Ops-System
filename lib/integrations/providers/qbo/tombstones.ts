import { z } from "zod";
import { BoundedIdentifierSchema, IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { QBO_REPORT_TYPES, QboProviderMetadataSchema, QboSupportedObjectTypeSchema } from "./contracts";

const cdcRecordType = QboSupportedObjectTypeSchema.exclude([...QBO_REPORT_TYPES, "CompanyInfo", "Preferences"]);
// Intuit's sparse CDC example has status Deleted, domain QBO, Id and LastUpdatedTime.
// https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture.html
const rawDeleted = z.object({
  Id: BoundedIdentifierSchema.max(128),
  status: z.literal("Deleted"),
  domain: z.literal("QBO").optional(),
  sparse: z.boolean().optional(),
  SyncToken: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  MetaData: z.object({ LastUpdatedTime: IsoTimestampSchema, CreateTime: IsoTimestampSchema.optional() }).strict()
}).strict();

export const QboCdcTombstoneSchema = z.object({
  kind: z.literal("deleted"),
  recordType: cdcRecordType,
  id: BoundedIdentifierSchema.max(128),
  provider: QboProviderMetadataSchema,
  providerCreatedAt: IsoTimestampSchema.nullable(),
  providerUpdatedAt: IsoTimestampSchema,
  providerVersionReference: BoundedIdentifierSchema,
  evidence: z.object({
    taskId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    providerResultEvidenceId: UuidSchema,
    providerRequestFingerprint: Sha256FingerprintSchema
  }).strict()
}).strict();
export type QboCdcTombstone = z.infer<typeof QboCdcTombstoneSchema>;

/** Only an explicit provider CDC deletion is a tombstone, never an absent row. */
export function parseQboCdcTombstone(input: {
  raw: unknown;
  recordType: string;
  provider: QboCdcTombstone["provider"];
  evidence: QboCdcTombstone["evidence"];
}): QboCdcTombstone | null {
  if (!input.raw || typeof input.raw !== "object" || Array.isArray(input.raw) ||
      !("status" in input.raw) || input.raw.status !== "Deleted") return null;
  const raw = rawDeleted.parse(input.raw);
  const updated = new Date(raw.MetaData.LastUpdatedTime).toISOString();
  return QboCdcTombstoneSchema.parse({
    kind: "deleted", recordType: input.recordType, id: raw.Id, provider: input.provider,
    providerCreatedAt: raw.MetaData.CreateTime ?? null,
    providerUpdatedAt: updated, providerVersionReference: raw.SyncToken ?? updated,
    evidence: input.evidence
  });
}
