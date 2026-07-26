import type { WorkspaceAgreementSnapshot } from "@/lib/legal/workspace-agreement";

function formatSignedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function WorkspaceAgreementDocument({
  snapshot,
  immutableHash
}: {
  snapshot: WorkspaceAgreementSnapshot;
  immutableHash: string;
}) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 text-ink shadow-panel sm:p-7 print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-line pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Vaeroex</p>
        <h1 className="mt-2 text-2xl font-semibold">Workspace Agreement</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Electronically signed agreement for an Executive Intelligence Workspace.</p>
      </header>

      <dl className="grid gap-x-8 gap-y-4 border-b border-line py-6 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Organization</dt><dd className="mt-1 font-semibold">{snapshot.organizationName}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Business type</dt><dd className="mt-1 font-semibold">{snapshot.businessType}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Workspace owner</dt><dd className="mt-1 font-semibold">{snapshot.owner.legalName}</dd><dd className="text-muted">{snapshot.owner.jobTitle}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Business email</dt><dd className="mt-1 break-all font-semibold">{snapshot.owner.businessEmail}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Team size</dt><dd className="mt-1">{snapshot.teamSize || "Not provided"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Number of locations</dt><dd className="mt-1">{snapshot.numberOfLocations || "Not provided"}</dd></div>
      </dl>

      <section className="py-6">
        <h2 className="text-lg font-semibold">Agreement</h2>
        <div className="mt-5 space-y-6">
          {snapshot.sections.map((section, index) => (
            <section key={section.id}>
              <h3 className="text-sm font-semibold">{index + 1}. {section.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{section.text}</p>
              {section.details.length ? (
                <ul className="mt-2 space-y-1 pl-5 text-sm leading-6 text-muted">
                  {section.details.map((detail) => <li key={detail} className="list-disc">{detail}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </section>

      <section className="border-t border-line py-6">
        <h2 className="text-lg font-semibold">Electronic Signature</h2>
        <p className="mt-3 text-sm leading-6 text-muted">{snapshot.signatureIntent}</p>
        <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Typed signature</dt><dd className="mt-1 font-semibold">{snapshot.typedSignature}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Signed at (UTC)</dt><dd className="mt-1 font-semibold">{formatSignedAt(snapshot.signedAt)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Agreement version</dt><dd className="mt-1">{snapshot.agreementVersion}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted">Terms / Privacy versions</dt><dd className="mt-1">{snapshot.termsVersion} / {snapshot.privacyVersion}</dd></div>
        </dl>
      </section>

      <footer className="border-t border-line pt-6 text-xs leading-5 text-muted">
        <p><span className="font-semibold text-ink">Agreement ID:</span> {snapshot.agreementId}</p>
        <p><span className="font-semibold text-ink">Workspace ID:</span> {snapshot.workspaceId}</p>
        <p className="break-all"><span className="font-semibold text-ink">Immutable SHA-256 hash:</span> {immutableHash}</p>
        <p className="mt-3">This is an immutable legal record. It is not business evidence and is excluded from Vaeroex intelligence and retrieval systems.</p>
      </footer>
    </article>
  );
}
