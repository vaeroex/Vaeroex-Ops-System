import "server-only";

import { z } from "zod";
import { INTELLIGENCE_BRIEFING_SECTION_IDS } from "@/lib/ai/intelligence-briefing/contracts";

export const INTELLIGENCE_BRIEFING_MODEL_OUTPUT_LIMITS = {
  claimText: { min: 20, max: 700 },
  executiveSummaryText: { min: 60, max: 1_200 },
  sectionSummaryText: { min: 30, max: 800 },
  supportRefs: { min: 1, max: 12, itemMin: 1, itemMax: 24 },
  sectionClaims: { min: 1, max: 5 },
  sections: { max: INTELLIGENCE_BRIEFING_SECTION_IDS.length },
  leadershipConsiderations: { min: 1, max: 5 },
  limitationRefs: { max: 12, itemMin: 1, itemMax: 24 }
} as const;

const limits = INTELLIGENCE_BRIEFING_MODEL_OUTPUT_LIMITS;
const supportRefsSchema = z.array(
  z.string().trim().min(limits.supportRefs.itemMin).max(limits.supportRefs.itemMax)
).min(limits.supportRefs.min).max(limits.supportRefs.max);

export const INTELLIGENCE_BRIEFING_CLAIM_SCHEMA = z.object({
  text: z.string().trim().min(limits.claimText.min).max(limits.claimText.max),
  support_refs: supportRefsSchema
}).strict();

export const INTELLIGENCE_BRIEFING_MODEL_OUTPUT_SCHEMA = z.object({
  executive_summary: z.object({
    text: z.string().trim().min(limits.executiveSummaryText.min).max(limits.executiveSummaryText.max),
    support_refs: supportRefsSchema
  }).strict(),
  sections: z.array(z.object({
    section_id: z.enum(INTELLIGENCE_BRIEFING_SECTION_IDS),
    summary: z.string().trim().min(limits.sectionSummaryText.min).max(limits.sectionSummaryText.max),
    support_refs: supportRefsSchema,
    claims: z.array(INTELLIGENCE_BRIEFING_CLAIM_SCHEMA).min(limits.sectionClaims.min).max(limits.sectionClaims.max)
  }).strict()).max(limits.sections.max),
  leadership_considerations: z.array(INTELLIGENCE_BRIEFING_CLAIM_SCHEMA)
    .min(limits.leadershipConsiderations.min)
    .max(limits.leadershipConsiderations.max),
  limitation_refs: z.array(
    z.string().trim().min(limits.limitationRefs.itemMin).max(limits.limitationRefs.itemMax)
  ).max(limits.limitationRefs.max)
}).strict();

const SUPPORT_REFS_JSON_SCHEMA = {
  type: "array",
  minItems: limits.supportRefs.min,
  maxItems: limits.supportRefs.max,
  items: {
    type: "string",
    minLength: limits.supportRefs.itemMin,
    maxLength: limits.supportRefs.itemMax
  }
} as const;

const CLAIM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "support_refs"],
  properties: {
    text: {
      type: "string",
      minLength: limits.claimText.min,
      maxLength: limits.claimText.max
    },
    support_refs: SUPPORT_REFS_JSON_SCHEMA
  }
} as const;

export const INTELLIGENCE_BRIEFING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["executive_summary", "sections", "leadership_considerations", "limitation_refs"],
  properties: {
    executive_summary: {
      type: "object",
      additionalProperties: false,
      required: ["text", "support_refs"],
      properties: {
        text: {
          type: "string",
          minLength: limits.executiveSummaryText.min,
          maxLength: limits.executiveSummaryText.max
        },
        support_refs: SUPPORT_REFS_JSON_SCHEMA
      }
    },
    sections: {
      type: "array",
      maxItems: limits.sections.max,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section_id", "summary", "support_refs", "claims"],
        properties: {
          section_id: { type: "string", enum: INTELLIGENCE_BRIEFING_SECTION_IDS },
          summary: {
            type: "string",
            minLength: limits.sectionSummaryText.min,
            maxLength: limits.sectionSummaryText.max
          },
          support_refs: SUPPORT_REFS_JSON_SCHEMA,
          claims: {
            type: "array",
            minItems: limits.sectionClaims.min,
            maxItems: limits.sectionClaims.max,
            items: CLAIM_JSON_SCHEMA
          }
        }
      }
    },
    leadership_considerations: {
      type: "array",
      minItems: limits.leadershipConsiderations.min,
      maxItems: limits.leadershipConsiderations.max,
      items: CLAIM_JSON_SCHEMA
    },
    limitation_refs: {
      type: "array",
      maxItems: limits.limitationRefs.max,
      items: {
        type: "string",
        minLength: limits.limitationRefs.itemMin,
        maxLength: limits.limitationRefs.itemMax
      }
    }
  }
} as const;
