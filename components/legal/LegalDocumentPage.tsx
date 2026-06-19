import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { legalDocuments, legalLinks, type LegalDocumentId } from "@/lib/legal/content";

export function LegalDocumentPage({ documentId }: { documentId: LegalDocumentId }) {
  const document = legalDocuments[documentId];

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/" className="text-sm font-semibold text-vaeroex-blue">Vaeroex</Link>
        <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Legal Center</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{document.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted">{document.summary}</p>
        <p className="mt-3 text-xs font-semibold text-muted">Version: {document.updated}</p>

        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          These policies are drafted for plain-English customer education and product safety. Customers remain responsible for reviewing their own legal,
          compliance, security, and business obligations.
        </div>

        <div className="mt-8 space-y-4">
          {document.sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-line bg-white p-5 shadow-panel">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-8 rounded-lg border border-line bg-white p-5 shadow-panel">
          <h2 className="text-base font-semibold">Related policies</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                {link.label}
              </Link>
            ))}
          </div>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
