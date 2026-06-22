import Link from "next/link";
import type { Route } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { legalDocuments } from "@/lib/legal/content";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupportCard = {
  title: string;
  description: string;
  links: Array<{ label: string; href: Route } | { label: string; href: `mailto:${string}`; external: true }>;
};

const supportCards: SupportCard[] = [
  {
    title: "Account Access",
    description: "Sign in, create an account, reset your password, or return to your workspace.",
    links: [
      { label: "Login", href: "/login" },
      { label: "Create Account", href: "/signup" },
      { label: "Reset Password", href: "/forgot-password" }
    ]
  },
  {
    title: "Billing & Subscriptions",
    description: "Review pricing, subscription terms, refund policy, or contact Vaeroex billing.",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Subscription Terms", href: "/subscription-billing-terms" },
      { label: "Refund Policy", href: "/refund-policy" },
      { label: "Email Billing", href: VAEROEX_MAILTO_LINKS.billing, external: true }
    ]
  },
  {
    title: "Support Requests",
    description: "Ask for help with account access, workspace setup, billing, or product questions.",
    links: [
      { label: "Open Support Request", href: "/support" },
      { label: "Email Support", href: VAEROEX_MAILTO_LINKS.support, external: true },
      { label: "Contact Vaeroex", href: "/contact" }
    ]
  },
  {
    title: "Trust & Legal",
    description: "Review trust posture, sensitive data guidance, human review notices, and policies.",
    links: [
      { label: "Trust Center", href: "/trust" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Sensitive Data Policy", href: "/sensitive-data-policy" }
    ]
  }
];

const contactChannels = [
  ["General questions", VAEROEX_CONTACT_EMAILS.general, VAEROEX_MAILTO_LINKS.general],
  ["Support", VAEROEX_CONTACT_EMAILS.support, VAEROEX_MAILTO_LINKS.support],
  ["Billing", VAEROEX_CONTACT_EMAILS.billing, VAEROEX_MAILTO_LINKS.billing],
  ["Partnerships", VAEROEX_CONTACT_EMAILS.partners, VAEROEX_MAILTO_LINKS.partners]
] as const;

async function getLoggedIn() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return Boolean(user);
}

export default async function PublicHelpPage() {
  const loggedIn = await getLoggedIn();
  const policyCards = Object.values(legalDocuments).slice(0, 8);

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Vaeroex Support</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">How can we help?</h1>
            <p className="mt-4 text-sm leading-6 text-muted">
              Find account access, billing, subscription, trust, legal, and support resources for Vaeroex.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/support" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Submit Support Request
              </Link>
              {loggedIn ? (
                <Link href="/app/help" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                  Open App Documentation
                </Link>
              ) : (
                <Link href="/login" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                  Login
                </Link>
              )}
            </div>
          </div>

          <ScrollReveal delayMs={120} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Direct Contact</p>
            <div className="mt-4 grid gap-2 text-sm">
              {contactChannels.map(([label, email, href]) => (
                <a key={email} href={href} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 px-3 py-2 font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                  <span>{label}</span>
                  <span className="text-muted">{email}</span>
                </a>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">
              Please do not send patient data, Social Security numbers, payment card numbers, government IDs, or regulated sensitive data in support requests.
            </p>
          </ScrollReveal>
        </div>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {supportCards.map((card, index) => (
            <ScrollReveal key={card.title} as="article" delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{card.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {card.links.map((link) =>
                  "external" in link ? (
                    <a key={link.label} href={link.href} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                      {link.label}
                    </a>
                  ) : (
                    <Link key={link.label} href={link.href} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                      {link.label}
                    </Link>
                  )
                )}
              </div>
            </ScrollReveal>
          ))}
        </section>

        <section className="mt-10 rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Legal Resources</p>
              <h2 className="mt-1 text-2xl font-semibold">Policies and customer notices</h2>
            </div>
            <Link href="/trust" className="text-sm font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              Visit Trust Center
            </Link>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {policyCards.map((document) => (
              <Link key={document.id} href={document.href} className="rounded-lg border border-line bg-slate-50 p-4 hover:border-vaeroex-blue">
                <p className="text-sm font-semibold text-ink">{document.title}</p>
                <p className="mt-2 text-xs leading-5 text-muted">{document.summary}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Product Documentation</p>
          <h2 className="mt-2 text-2xl font-semibold">Operations Intelligence guides live inside the app.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            Detailed workspace guides and product documentation are available after login so they can stay close to the tools they support.
          </p>
          <Link href={loggedIn ? "/app/help" : "/login"} className="mt-5 inline-flex rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
            {loggedIn ? "Open App Documentation" : "Login for Documentation"}
          </Link>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
