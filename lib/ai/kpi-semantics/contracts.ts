import { z } from "zod";
import { KPI_DESIRED_DIRECTIONS, KPI_TARGET_BEHAVIORS } from "@/lib/kpis/semantics";

export const KPI_SEMANTIC_CLASSIFICATION_CONTRACT_ID = "kpi_semantic_classification_v1" as const;

export const KPI_SEMANTIC_CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "canonicalName", "displayName", "unit", "scale", "aggregationBasis", "periodBasis", "desiredDirection",
    "targetBehavior", "theoreticalIdealValue", "metricRole", "aliases", "confidence", "rationale"
  ],
  properties: {
    canonicalName: { type: "string" },
    displayName: { type: "string" },
    unit: { type: ["string", "null"] },
    scale: { type: "number", exclusiveMinimum: 0 },
    aggregationBasis: { type: ["string", "null"] },
    periodBasis: { type: ["string", "null"] },
    desiredDirection: { type: "string", enum: KPI_DESIRED_DIRECTIONS },
    targetBehavior: { type: "string", enum: KPI_TARGET_BEHAVIORS },
    theoreticalIdealValue: { type: ["number", "null"] },
    metricRole: { type: "string", enum: ["actual", "target", "benchmark", "unknown"] },
    aliases: { type: "array", maxItems: 8, items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" }
  }
} as const;

const classificationSchema = z.object({
  canonicalName: z.string().trim().min(1).max(160).regex(/^[a-z0-9_]+$/),
  displayName: z.string().trim().min(1).max(160),
  unit: z.string().trim().max(80).nullable(),
  scale: z.number().positive().max(1_000_000_000),
  aggregationBasis: z.string().trim().max(120).nullable(),
  periodBasis: z.string().trim().max(120).nullable(),
  desiredDirection: z.enum(KPI_DESIRED_DIRECTIONS),
  targetBehavior: z.enum(KPI_TARGET_BEHAVIORS),
  theoreticalIdealValue: z.number().finite().nullable(),
  metricRole: z.enum(["actual", "target", "benchmark", "unknown"]),
  aliases: z.array(z.string().trim().min(1).max(160)).max(8),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(500)
}).strict();

export type KpiSemanticClassificationProposal = z.infer<typeof classificationSchema>;

export function validateKpiSemanticClassification(value: unknown, sourceLabel: string) {
  const parsed = classificationSchema.safeParse(value);
  if (!parsed.success) return { ok: false as const, reason: parsed.error.issues[0]?.message || "Schema validation failed." };
  const proposal = parsed.data;
  const targetLikeLabel = /^(?:target|goal|budget|benchmark)\b/i.test(sourceLabel.trim());
  if (targetLikeLabel && proposal.metricRole === "actual") {
    return { ok: false as const, reason: "A target-like source label cannot be classified as an actual measurement." };
  }
  if (!targetLikeLabel && proposal.metricRole === "target" && !/target|goal|budget|benchmark/i.test(sourceLabel)) {
    return { ok: false as const, reason: "The proposed target role is not supported by the source label." };
  }
  return { ok: true as const, value: proposal };
}
