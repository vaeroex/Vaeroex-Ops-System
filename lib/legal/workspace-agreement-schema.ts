import { z } from "zod";
import { signatureReasonablyMatches } from "@/lib/legal/workspace-agreement";

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((value) => value || null);

export const workspaceAgreementFormSchema = z
  .object({
    organizationName: requiredText("Organization name", 160),
    ownerLegalName: requiredText("Workspace owner legal name", 160),
    ownerJobTitle: requiredText("Workspace owner job title", 120),
    ownerBusinessEmail: z.string().trim().email("Enter a valid business email.").max(320),
    businessType: requiredText("Business type", 160),
    teamSize: optionalText(80),
    numberOfLocations: optionalText(80),
    authorityAccepted: z.literal(true, { errorMap: () => ({ message: "Authority confirmation is required." }) }),
    informationProcessingAccepted: z.literal(true, {
      errorMap: () => ({ message: "Information Processing confirmation is required." })
    }),
    aiDecisionSupportAccepted: z.literal(true, {
      errorMap: () => ({ message: "AI Decision Support confirmation is required." })
    }),
    businessResponsibilityAccepted: z.literal(true, {
      errorMap: () => ({ message: "Business Responsibility confirmation is required." })
    }),
    termsAccepted: z.literal(true, { errorMap: () => ({ message: "Terms confirmation is required." }) }),
    signatureIntentAccepted: z.literal(true, {
      errorMap: () => ({ message: "Electronic signature confirmation is required." })
    }),
    typedSignature: requiredText("Typed signature", 160)
  })
  .superRefine((input, context) => {
    if (!signatureReasonablyMatches(input.ownerLegalName, input.typedSignature)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Typed signature must match the workspace owner legal name.",
        path: ["typedSignature"]
      });
    }
  });

export type WorkspaceAgreementFormInput = z.infer<typeof workspaceAgreementFormSchema>;

export const workspaceAgreementSnapshotSchema = z.object({
  agreementId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  agreementVersion: z.string().min(1),
  termsVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
  organizationName: z.string().min(1),
  owner: z.object({
    legalName: z.string().min(1),
    jobTitle: z.string().min(1),
    businessEmail: z.string().email()
  }).strict(),
  businessType: z.string().min(1),
  teamSize: z.string().nullable(),
  numberOfLocations: z.string().nullable(),
  agreementText: z.string().min(1),
  sections: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    text: z.string().min(1),
    details: z.array(z.string())
  }).strict()).length(5),
  signatureIntent: z.string().min(1),
  typedSignature: z.string().min(1),
  signedAt: z.string().datetime(),
  authenticatedUserId: z.string().uuid(),
  applicationVersion: z.string().min(1),
  recordClass: z.literal("legal_agreement"),
  eligibility: z.object({
    business_memory_eligible: z.literal(false),
    evidence_eligible: z.literal(false),
    embedding_eligible: z.literal(false),
    executive_intelligence_eligible: z.literal(false),
    retrieval_eligible: z.literal(false)
  }).strict()
}).strict();

export function parseWorkspaceAgreementSnapshot(value: unknown) {
  return workspaceAgreementSnapshotSchema.safeParse(value);
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export function workspaceAgreementInputFromFormData(formData: FormData) {
  const text = (key: string) => String(formData.get(key) || "").trim();

  return {
    organizationName: text("organization_name"),
    ownerLegalName: text("owner_legal_name"),
    ownerJobTitle: text("owner_job_title"),
    ownerBusinessEmail: text("owner_business_email"),
    businessType: text("business_type"),
    teamSize: text("team_size"),
    numberOfLocations: text("number_of_locations"),
    authorityAccepted: checked(formData, "accept_authority"),
    informationProcessingAccepted: checked(formData, "accept_information_processing"),
    aiDecisionSupportAccepted: checked(formData, "accept_ai_decision_support"),
    businessResponsibilityAccepted: checked(formData, "accept_business_responsibility"),
    termsAccepted: checked(formData, "accept_terms"),
    signatureIntentAccepted: checked(formData, "accept_signature_intent"),
    typedSignature: text("typed_signature")
  };
}
