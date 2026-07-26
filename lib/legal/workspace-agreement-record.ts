import "server-only";

import { createHash } from "crypto";
import {
  WORKSPACE_AGREEMENT_ELIGIBILITY,
  WORKSPACE_AGREEMENT_POLICY_VERSIONS,
  WORKSPACE_AGREEMENT_RECORD_CLASS,
  WORKSPACE_AGREEMENT_SECTIONS,
  WORKSPACE_AGREEMENT_SIGNATURE_INTENT,
  WORKSPACE_AGREEMENT_VERSION,
  workspaceAgreementExactText,
  type WorkspaceAgreementSnapshot
} from "@/lib/legal/workspace-agreement";
import type { WorkspaceAgreementFormInput } from "@/lib/legal/workspace-agreement-schema";

function applicationVersion() {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.npm_package_version || "development";
}

export function buildWorkspaceAgreementSnapshot({
  agreementId,
  workspaceId,
  authenticatedUserId,
  signedAt,
  input
}: {
  agreementId: string;
  workspaceId: string;
  authenticatedUserId: string;
  signedAt: string;
  input: WorkspaceAgreementFormInput;
}): WorkspaceAgreementSnapshot {
  return {
    agreementId,
    workspaceId,
    agreementVersion: WORKSPACE_AGREEMENT_VERSION,
    termsVersion: WORKSPACE_AGREEMENT_POLICY_VERSIONS.terms,
    privacyVersion: WORKSPACE_AGREEMENT_POLICY_VERSIONS.privacy,
    organizationName: input.organizationName,
    owner: {
      legalName: input.ownerLegalName,
      jobTitle: input.ownerJobTitle,
      businessEmail: input.ownerBusinessEmail.toLocaleLowerCase("en-US")
    },
    businessType: input.businessType,
    teamSize: input.teamSize,
    numberOfLocations: input.numberOfLocations,
    agreementText: workspaceAgreementExactText(),
    sections: WORKSPACE_AGREEMENT_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      text: section.text,
      details: [...section.details]
    })),
    signatureIntent: WORKSPACE_AGREEMENT_SIGNATURE_INTENT,
    typedSignature: input.typedSignature,
    signedAt,
    authenticatedUserId,
    applicationVersion: applicationVersion(),
    recordClass: WORKSPACE_AGREEMENT_RECORD_CLASS,
    eligibility: WORKSPACE_AGREEMENT_ELIGIBILITY
  };
}

export function hashWorkspaceAgreement(snapshot: WorkspaceAgreementSnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}
