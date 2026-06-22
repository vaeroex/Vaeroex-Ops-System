import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { trustSections } from "@/lib/legal/content";

export function TrustCenterPage({ inApp = false }: { inApp?: boolean }) {
  const content = (
    <div className="space-y-6">
      <ScrollReveal as="section" disabled={inApp} className="vaeroex-hover-card rounded-lg border border-vaeroex-silver/80 bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Trust Center</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Trust is foundational to intelligence.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Vaeroex is designed to help organizations work with information responsibly, securely, and with human oversight.
          This page explains the current trust posture without unsupported compliance or security claims.
        </p>
      </ScrollReveal>

      <section className="grid gap-4 md:grid-cols-2">
        {trustSections.map(([title, body], index) => (
          <ScrollReveal key={title} as="article" disabled={inApp} delayMs={(index % 6) * 55} className="vaeroex-trust-card vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-panel">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </ScrollReveal>
        ))}
      </section>

      <ScrollReveal as="section" disabled={inApp} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-panel">
        <h2 className="text-base font-semibold">Important trust notes</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
          <li>Vaeroex does not currently claim HIPAA compliance, SOC 2 certification, GDPR compliance certification, or enterprise compliance certification.</li>
          <li>No online service can guarantee absolute security. Customers remain responsible for account access, workspace roles, and data they enter.</li>
          <li>Vaeroex outputs may be incomplete or inaccurate and require human review before customers rely on recommendations or save generated records.</li>
          <li>Vaeroex is not intended for unrestricted regulated sensitive data unless appropriate legal, security, and compliance controls are in place.</li>
          <li>
            Security, privacy, or trust questions can be sent to{" "}
            <a href={VAEROEX_MAILTO_LINKS.support} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              {VAEROEX_CONTACT_EMAILS.support}
            </a>
            .
          </li>
        </ul>
        <Link href={inApp ? "/app/support" : "/support"} className="mt-4 inline-flex rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
          Contact Support
        </Link>
      </ScrollReveal>
    </div>
  );

  if (inApp) {
    return content;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto max-w-6xl px-6 py-10">{content}</section>
      <PublicFooter />
    </main>
  );
}
