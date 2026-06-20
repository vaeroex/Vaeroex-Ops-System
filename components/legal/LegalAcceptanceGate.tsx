import Link from "next/link";
import { acceptLegalPoliciesAction } from "@/app/app/legal/actions";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal/content";

export function LegalAcceptanceGate({
  userEmail,
  workspaceName
}: {
  userEmail?: string | null;
  workspaceName?: string | null;
}) {
  return (
    <section className="rounded-lg border border-vaeroex-silver/80 bg-white p-6 shadow-panel">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Required Review</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Review Vaeroex policies before continuing.</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
        Vaeroex is an Intelligence Platform with the Operations Intelligence Suite as its current product. Before normal workspace access, please confirm that you understand the customer responsibilities,
        human-review requirement, and sensitive-data policy.
      </p>
      <div className="mt-4 rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        <p><span className="font-semibold text-ink">Account:</span> {userEmail || "Signed-in user"}</p>
        <p><span className="font-semibold text-ink">Workspace:</span> {workspaceName || "No workspace selected yet"}</p>
        <p className="mt-2 text-xs text-muted">
          Versions: Terms {LEGAL_DOCUMENT_VERSIONS.terms}, Privacy {LEGAL_DOCUMENT_VERSIONS.privacy}, Vaeroex Disclaimer {LEGAL_DOCUMENT_VERSIONS.aiDisclaimer}, Sensitive Data {LEGAL_DOCUMENT_VERSIONS.sensitiveData}
        </p>
      </div>
      <form action={acceptLegalPoliciesAction} className="mt-5 space-y-3">
        {[
          ["accept_terms", "I accept the Terms of Service."],
          ["accept_privacy", "I accept the Privacy Policy."],
          ["accept_ai", "I understand Vaeroex recommendations are advisory and require human review."],
          ["accept_sensitive", "I understand Vaeroex is for operational business records and should not be used for prohibited sensitive data unless proper controls exist."]
        ].map(([name, label]) => (
          <label key={name} className="flex gap-3 rounded-lg border border-line p-3 text-sm leading-6">
            <input name={name} type="checkbox" required className="mt-1 h-4 w-4 shrink-0" />
            <span>{label}</span>
          </label>
        ))}
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/terms" className="font-semibold text-vaeroex-blue">Terms</Link>
          <Link href="/privacy" className="font-semibold text-vaeroex-blue">Privacy</Link>
          <Link href="/ai-disclaimer" className="font-semibold text-vaeroex-blue">Vaeroex Disclaimer</Link>
          <Link href="/sensitive-data-policy" className="font-semibold text-vaeroex-blue">Sensitive Data Policy</Link>
        </div>
        <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
          Accept and continue
        </button>
      </form>
    </section>
  );
}
