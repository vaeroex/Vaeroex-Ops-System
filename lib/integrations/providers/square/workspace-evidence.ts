import { z } from "zod";

const count = z.number().int().min(0).max(20000);
const time = z.string().datetime({ offset: true });
export const SquareWorkspaceEvidenceSchema = z.object({
  version: z.literal("square_workspace_evidence_v1"), source: z.literal("Square Sandbox"),
  status: z.literal("verified_non_economic"), policy: z.literal("square_canonical_interpretation_v1"),
  counts: z.object({ payment: count, refund: count, order: count, catalog: count, inventory: count }).strict(),
  relationships: z.object({ unresolvedLocation: count, conflict: count, idMatch: count, otherUncertain: count }).strict(),
  historical: z.literal("unknown"), economic: z.literal("blocked"),
  checkpointRevision: z.number().int().positive().safe(), interpretedAt: time,
  lastObservedAt: time, checkedAt: time, syncStatus: z.literal("unknown"),
  provenance: z.array(z.object({ kind: z.enum(["payment", "refund", "order", "catalog", "inventory"]),
    sourceVersion: z.number().int().positive().safe(), observedAt: time,
    scope: z.enum(["seller_with_location_applicability", "mapped_location_or_explicitly_unresolved"])
  }).strict()).min(1).max(13)
}).strict().superRefine((value, ctx) => {
  const total = Object.values(value.counts).reduce((a, b) => a + b, 0);
  if (total !== value.provenance.length || Object.entries(value.counts).some(([kind, n]) =>
    value.provenance.filter(item => item.kind === kind).length !== n) ||
    Date.parse(value.interpretedAt) > Date.parse(value.checkedAt) ||
    Date.parse(value.lastObservedAt) > Date.parse(value.checkedAt) ||
    value.provenance.some(item => Date.parse(item.observedAt) > Date.parse(value.lastObservedAt))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid_evidence" });
  }
});
export type SquareWorkspaceEvidence = z.infer<typeof SquareWorkspaceEvidenceSchema>;

/** Display contract only; database authentication is mandatory before parsing. */
export function parseSquareWorkspaceEvidence(value: unknown): SquareWorkspaceEvidence | null {
  const parsed = SquareWorkspaceEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
