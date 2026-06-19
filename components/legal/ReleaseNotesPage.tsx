import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { releaseNotes } from "@/lib/legal/content";

export function ReleaseNotesPage({ inApp = false }: { inApp?: boolean }) {
  const content = (
    <div className="space-y-6">
      <section className="rounded-lg border border-vaeroex-silver/80 bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Release Notes</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Vaeroex product updates</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Customer-friendly updates about features, improvements, security updates, and bug fixes. Internal commit hashes are intentionally not shown.
        </p>
      </section>

      <section className="space-y-3">
        {releaseNotes.map((note) => (
          <article key={`${note.date}-${note.title}`} className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">{note.type}</p>
                <h2 className="mt-1 text-base font-semibold text-ink">{note.title}</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{note.date}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">{note.body}</p>
          </article>
        ))}
      </section>
    </div>
  );

  if (inApp) {
    return content;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <nav className="border-b border-slate-800 bg-vaeroex-navy px-6 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold">Vaeroex</Link>
          <Link href="/support" className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold">
            Contact Support
          </Link>
        </div>
      </nav>
      <section className="mx-auto max-w-5xl px-6 py-10">{content}</section>
      <PublicFooter />
    </main>
  );
}
