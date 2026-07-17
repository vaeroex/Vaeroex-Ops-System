import "server-only";

import { z } from "zod";
import { validateExecutiveIntelligenceContract } from "@/lib/ai/executive-output";
import type { VaeroexWorkflowKey } from "@/lib/ai/vaeroex-workflows";
import type { Json } from "@/lib/supabase/types";

const confidenceSchema = z.enum(["High", "Medium", "Low", "Insufficient"]);
const genericOutputSchema = z.record(z.unknown()).superRefine((value, context) => {
  const hasReadableOutput = ["direct_answer", "summary", "response_markdown", "title"].some(
    (key) => typeof value[key] === "string" && value[key].trim().length > 0
  );
  const hasStructuredDraft = ["report", "sop", "form", "checklist", "recommended_actions"].some((key) => Boolean(value[key]));
  if (!hasReadableOutput && !hasStructuredDraft) context.addIssue({ code: z.ZodIssueCode.custom, message: "No readable or structured output was returned." });
});
const fileAnalysisOutputSchema = z.object({
  title: z.string().min(1),
  executive_summary: z.string().min(1),
  extraction_status: z.enum(["populated", "blank_template", "unreadable", "unsupported", "technical_failure"]),
  extracted_text: z.string(),
  extracted_findings: z.array(z.unknown()),
  kpis_found: z.array(z.unknown()),
  risks: z.array(z.unknown()),
  operational_issues: z.array(z.unknown()),
  recommended_actions: z.array(z.unknown()),
  opportunities: z.array(z.unknown()),
  unclear_fields: z.array(z.unknown()),
  confidence: z.enum(["High", "Medium", "Low"]),
  response_markdown: z.string().min(1)
}).passthrough().superRefine((value, context) => {
  if (value.extraction_status === "populated" && !value.extracted_text.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["extracted_text"], message: "Populated file analysis requires extracted text." });
  }
});
const kpiOverviewOutputSchema = z.object({
  direct_answer: z.string().min(1),
  recommendation_confidence: confidenceSchema,
  evidence_note: z.string().min(1),
  response_markdown: z.string().min(1)
}).passthrough();

export function validateVaeroexWorkflowContract(workflow: VaeroexWorkflowKey, value: unknown) {
  if (workflow === "executive_intelligence") return validateExecutiveIntelligenceContract(value);

  const parsed = workflow === "file_analysis" ? fileAnalysisOutputSchema.safeParse(value) : genericOutputSchema.safeParse(value);
  return parsed.success
    ? { ok: true as const, value: parsed.data as Json }
    : { ok: false as const, reason: parsed.error.issues[0]?.message || "The response did not match the workflow contract." };
}

export function validateKpiOverviewContract(value: unknown) {
  const parsed = kpiOverviewOutputSchema.safeParse(value);
  return parsed.success
    ? { ok: true as const, value: parsed.data as Json }
    : { ok: false as const, reason: parsed.error.issues[0]?.message || "The KPI response did not match its contract." };
}
