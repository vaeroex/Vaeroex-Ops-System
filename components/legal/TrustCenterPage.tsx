import Link from "next/link";
import { Database, FileLock2, ShieldCheck, UserRoundCheck } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { trustSections } from "@/lib/legal/content";

const trustGroups = [
  {
    title: "Workspace and file protection",
    summary: "How customer workspaces, records, and private source files are separated.",
    icon: FileLock2,
    items: [trustSections[0], trustSections[1], trustSections[7]]
  },
  {
    title: "Evidence and Vaeroex outputs",
    summary: "How relevant evidence is retrieved and kept distinct from generated analysis.",
    icon: Database,
    items: [trustSections[2], trustSections[3], trustSections[4]]
  },
  {
    title: "Actions, permissions, and audit records",
    summary: "How model-influenced actions are validated, confirmed, and recorded.",
    icon: ShieldCheck,
    items: [trustSections[5], trustSections[6], trustSections[8]]
  },
  {
    title: "Current boundaries and customer responsibility",
    summary: "What Vaeroex does not claim and where customer judgment remains required.",
    icon: UserRoundCheck,
    items: [trustSections[9], trustSections[10], trustSections[11], trustSections[12], trustSections[13]]
  }
] as const;

function TrustContent({ inApp }: { inApp: boolean }) {
  return (
    <div className="space-y-4">
      {inApp ? (
        <header className="border-b border-line/80 pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Trust Center</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">How Vaeroex handles evidence, access, and human review.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">A factual view of the current platform posture, including the protections in place and the boundaries customers should understand.</p>
        </header>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {trustGroups.map((group, index) => {
          const Icon = group.icon;
          return (
            <details key={group.title} open={index === 0} className={`group rounded-lg border p-4 ${inApp ? "border-line bg-white" : "border-white/10 bg-white/[0.035]"}`}>
              <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                <span className={`mt-0.5 rounded-md border p-2 ${inApp ? "border-vaeroex-blue/20 bg-vaeroex-soft text-vaeroex-blue" : "border-cyan-300/20 bg-cyan-950/25 text-cyan-100"}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-semibold ${inApp ? "text-ink" : "text-white"}`}>{group.title}</span>
                  <span className={`mt-1 block text-sm leading-5 ${inApp ? "text-muted" : "text-slate-400"}`}>{group.summary}</span>
                </span>
                <span className={`shrink-0 text-xs font-semibold ${inApp ? "text-vaeroex-blue" : "text-cyan-200"}`}>
                  <span className="group-open:hidden">Open</span>
                  <span className="hidden group-open:inline">Close</span>
                </span>
              </summary>
              <div className={`mt-4 divide-y border-t pt-1 ${inApp ? "divide-line border-line" : "divide-white/10 border-white/10"}`}>
                {group.items.map(([title, body]) => (
                  <div key={title} className="py-4">
                    <h2 className={`text-sm font-semibold ${inApp ? "text-ink" : "text-slate-100"}`}>{title}</h2>
                    <p className={`mt-1 text-sm leading-6 ${inApp ? "text-muted" : "text-slate-400"}`}>{body}</p>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <section className={`rounded-lg border p-5 ${inApp ? "border-line bg-white" : "border-amber-300/20 bg-amber-950/10"}`}>
        <h2 className={`text-base font-semibold ${inApp ? "text-ink" : "text-white"}`}>Important trust notes</h2>
        <ul className={`mt-3 grid gap-2 text-sm leading-6 ${inApp ? "text-muted" : "text-slate-400"}`}>
          <li>Vaeroex does not currently claim HIPAA compliance, SOC 2 certification, GDPR compliance certification, or enterprise compliance certification.</li>
          <li>Supported upload types are allowlisted, but Vaeroex does not currently claim malware scanning, DLP scanning, file sandboxing, or regulated-data detection.</li>
          <li>No online service can guarantee absolute security. Customers remain responsible for account access, workspace roles, and the data they enter.</li>
          <li>Vaeroex outputs may be incomplete or inaccurate and require human review before important business action.</li>
          <li>Vaeroex is not intended for unrestricted regulated sensitive data unless appropriate legal, security, and compliance controls are in place.</li>
        </ul>
        {inApp ? (
          <Link href="/app/support" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Contact Support</Link>
        ) : (
          <p className="mt-4 text-sm text-slate-300">Security, privacy, or trust questions: <a href={VAEROEX_MAILTO_LINKS.support} className="font-semibold text-cyan-200 hover:text-white">{VAEROEX_CONTACT_EMAILS.support}</a></p>
        )}
      </section>
    </div>
  );
}

export function TrustCenterPage({ inApp = false }: { inApp?: boolean }) {
  if (inApp) {
    return <TrustContent inApp />;
  }

  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Trust at Vaeroex Intelligence Systems"
        title="Trustworthy intelligence starts with clear boundaries."
        description="See how Operations Intelligence separates workspaces, preserves evidence lineage, distinguishes original evidence from derived analysis, and excludes archived or deleted records from current intelligence."
      />
      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <TrustContent inApp={false} />
        </div>
      </section>
      <PublicCtaBand
        eyebrow="Questions about trust or security?"
        title="Get a direct answer from Vaeroex."
        description="Contact the Vaeroex support team for current platform, privacy, security, or responsible-use questions."
        primaryHref="/support"
        primaryLabel="Contact support"
        secondaryHref="/privacy"
        secondaryLabel="Read the Privacy Policy"
      />
      <PublicFooter />
    </main>
  );
}
