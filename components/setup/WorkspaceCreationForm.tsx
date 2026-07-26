"use client";

import Link from "next/link";
import { Building2, CheckCircle2, FileSignature, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { createWorkspaceWithAgreementAction } from "@/app/app/setup/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import {
  BUSINESS_TYPE_SUGGESTIONS,
  WORKSPACE_AGREEMENT_POLICY_VERSIONS,
  WORKSPACE_AGREEMENT_SECTIONS,
  WORKSPACE_AGREEMENT_SIGNATURE_INTENT,
  WORKSPACE_AGREEMENT_VERSION,
  signatureReasonablyMatches
} from "@/lib/legal/workspace-agreement";

type WorkspaceCreationFormProps = {
  defaultOwnerName: string;
  defaultOwnerEmail: string;
  error?: string;
};

const fieldClass =
  "mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-slate-400 focus:border-vaeroex-blue focus:ring-2 focus:ring-vaeroex-blue/15";

export function WorkspaceCreationForm({
  defaultOwnerName,
  defaultOwnerEmail,
  error
}: WorkspaceCreationFormProps) {
  const [organizationName, setOrganizationName] = useState("");
  const [ownerLegalName, setOwnerLegalName] = useState(defaultOwnerName);
  const [ownerJobTitle, setOwnerJobTitle] = useState("");
  const [ownerBusinessEmail, setOwnerBusinessEmail] = useState(defaultOwnerEmail);
  const [businessType, setBusinessType] = useState("");
  const [typedSignature, setTypedSignature] = useState("");
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [signatureIntentAccepted, setSignatureIntentAccepted] = useState(false);
  const signatureMatches = signatureReasonablyMatches(ownerLegalName, typedSignature);
  const businessEmailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerBusinessEmail.trim());
  const agreementGenerated = Boolean(
    WORKSPACE_AGREEMENT_VERSION &&
      WORKSPACE_AGREEMENT_POLICY_VERSIONS.terms &&
      WORKSPACE_AGREEMENT_POLICY_VERSIONS.privacy &&
      WORKSPACE_AGREEMENT_SECTIONS.length === 5
  );
  const allAgreementSectionsAccepted = WORKSPACE_AGREEMENT_SECTIONS.every((section) => accepted[section.id]);
  const ready = useMemo(
    () =>
      Boolean(
        organizationName.trim() &&
          ownerLegalName.trim() &&
          ownerJobTitle.trim() &&
          businessEmailIsValid &&
          businessType.trim() &&
          allAgreementSectionsAccepted &&
          signatureIntentAccepted &&
          signatureMatches &&
          agreementGenerated
      ),
    [
      agreementGenerated,
      allAgreementSectionsAccepted,
      businessType,
      businessEmailIsValid,
      organizationName,
      ownerJobTitle,
      ownerLegalName,
      signatureIntentAccepted,
      signatureMatches
    ]
  );

  return (
    <form action={createWorkspaceWithAgreementAction} className="space-y-6" noValidate>
      <ErrorNotice message={error} />

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-vaeroex-soft text-vaeroex-blue">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink">Workspace information</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Set the organization and accountable workspace owner. Vaeroex will learn the business from Evidence and Business Notes.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-medium text-ink md:col-span-2">
            Organization Name
            <input
              required
              autoComplete="organization"
              name="organization_name"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            Workspace Owner Full Legal Name
            <input
              required
              autoComplete="name"
              name="owner_legal_name"
              value={ownerLegalName}
              onChange={(event) => setOwnerLegalName(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            Workspace Owner Job Title
            <input
              required
              autoComplete="organization-title"
              name="owner_job_title"
              value={ownerJobTitle}
              onChange={(event) => setOwnerJobTitle(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            Workspace Owner Business Email
            <input
              required
              type="email"
              autoComplete="email"
              name="owner_business_email"
              value={ownerBusinessEmail}
              onChange={(event) => setOwnerBusinessEmail(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            What type of business is this workspace for?
            <input
              required
              list="business-type-suggestions"
              name="business_type"
              value={businessType}
              onChange={(event) => setBusinessType(event.target.value)}
              placeholder="Search or enter a custom business type"
              className={fieldClass}
            />
            <datalist id="business-type-suggestions">
              {BUSINESS_TYPE_SUGGESTIONS.map((suggestion) => <option key={suggestion} value={suggestion} />)}
            </datalist>
          </label>
          <label className="block text-sm font-medium text-ink">
            Team Size <span className="font-normal text-muted">(Optional)</span>
            <input name="team_size" placeholder="Example: 25-50" className={fieldClass} />
          </label>
          <label className="block text-sm font-medium text-ink">
            Number of Locations <span className="font-normal text-muted">(Optional)</span>
            <input name="number_of_locations" inputMode="numeric" placeholder="Example: 3" className={fieldClass} />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-vaeroex-soft text-vaeroex-blue">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink">Workspace Agreement</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Review and accept every section. Nothing is accepted automatically.</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {WORKSPACE_AGREEMENT_SECTIONS.map((section) => (
            <label key={section.id} className="flex cursor-pointer gap-3 rounded-lg border border-line p-4 text-sm leading-6 text-ink">
              <input
                required
                type="checkbox"
                name={`accept_${section.id}`}
                checked={Boolean(accepted[section.id])}
                onChange={(event) => setAccepted((current) => ({ ...current, [section.id]: event.target.checked }))}
                className="mt-1 h-4 w-4 shrink-0 accent-vaeroex-blue"
              />
              <span>
                <span className="block font-semibold">{section.title}</span>
                <span className="mt-1 block text-muted">{section.text}</span>
                {section.details.length ? (
                  <span className="mt-2 block">
                    {section.details.map((detail) => <span key={detail} className="block text-xs text-muted">- {detail}</span>)}
                  </span>
                ) : null}
                {section.id === "terms" ? (
                  <span className="mt-2 flex flex-wrap gap-3">
                    <Link href="/terms" target="_blank" className="font-semibold text-vaeroex-blue underline underline-offset-2">Terms of Service</Link>
                    <Link href="/privacy" target="_blank" className="font-semibold text-vaeroex-blue underline underline-offset-2">Privacy Policy</Link>
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Agreement {WORKSPACE_AGREEMENT_VERSION} generated with Terms {WORKSPACE_AGREEMENT_POLICY_VERSIONS.terms} and Privacy {WORKSPACE_AGREEMENT_POLICY_VERSIONS.privacy}.
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-vaeroex-soft text-vaeroex-blue">
            <FileSignature className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink">Electronic signature</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Type the workspace owner&apos;s legal name exactly as shown above.</p>
          </div>
        </div>

        <label className="mt-6 block max-w-xl text-sm font-medium text-ink">
          Typed Legal Name
          <input
            required
            name="typed_signature"
            value={typedSignature}
            onChange={(event) => setTypedSignature(event.target.value)}
            autoComplete="off"
            className={fieldClass}
            aria-describedby="signature-match-status"
          />
        </label>
        <p id="signature-match-status" className={`mt-2 text-xs ${typedSignature && !signatureMatches ? "text-red-700" : "text-muted"}`}>
          {typedSignature && !signatureMatches ? "Typed signature must match the workspace owner legal name." : "Case, punctuation, and extra spacing do not affect matching."}
        </p>

        <label className="mt-5 flex cursor-pointer gap-3 rounded-lg border border-line p-4 text-sm leading-6 text-ink">
          <input
            required
            type="checkbox"
            name="accept_signature_intent"
            checked={signatureIntentAccepted}
            onChange={(event) => setSignatureIntentAccepted(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-vaeroex-blue"
          />
          <span>{WORKSPACE_AGREEMENT_SIGNATURE_INTENT}</span>
        </label>

        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-muted">Creating the workspace stores an immutable legal record and a private PDF copy for both the workspace and Vaeroex.</p>
          <PendingSubmitButton
            disabled={!ready}
            pendingLabel="Creating workspace and signing agreement..."
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-vaeroex-blue px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Create Workspace
          </PendingSubmitButton>
        </div>
      </section>
    </form>
  );
}
