import Link from "next/link";
import type { Metadata } from "next";
import type { Route } from "next";
import { ArrowRight, LifeBuoy, Mail } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Help",
  description: "Find direct help for Vaeroex account access, workspaces, evidence, Business Health, Business Memory, billing, privacy, and support.",
  path: "/help"
});

type HelpLink = { label: string; href: Route };
type HelpCategory = { title: string; description: string; links: HelpLink[] };

async function getLoggedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user);
}

export default async function PublicHelpPage() {
  const loggedIn = await getLoggedIn();
  const workspaceHref = (loggedIn ? "/app/help" : "/login") as Route;
  const categories: HelpCategory[] = [
    { title: "Getting started", description: "Understand the current product, pricing, and first workspace steps.", links: [{ label: "Explore Operations Intelligence", href: "/operations-intelligence" }, { label: "View pricing", href: "/pricing" }, { label: loggedIn ? "Open workspace guides" : "Login for workspace guides", href: workspaceHref }] },
    { title: "Account and workspace", description: "Sign in, create an account, reset access, or return to workspace guidance.", links: [{ label: "Login", href: "/login" }, { label: "Create account", href: "/signup" }, { label: "Reset password", href: "/forgot-password" }] },
    { title: "Sources and evidence", description: "Learn how to add files, import structured data, and understand source status.", links: [{ label: loggedIn ? "Open evidence guides" : "Login for evidence guides", href: workspaceHref }, { label: "Review Trust Center", href: "/trust" }] },
    { title: "Business Health", description: "Understand score availability, historical trends, and insufficient-evidence states.", links: [{ label: loggedIn ? "Open Business Health guide" : "Login for product guides", href: workspaceHref }, { label: "See the product", href: "/operations-intelligence" }] },
    { title: "Business Memory", description: "Learn how organizational context, provenance, confidence, archive, and deletion work.", links: [{ label: loggedIn ? "Open Business Memory guide" : "Login for product guides", href: workspaceHref }, { label: "Evidence and AI boundaries", href: "/trust" }] },
    { title: "Billing", description: "Review pricing, subscription terms, refunds, or ask a billing question.", links: [{ label: "Pricing", href: "/pricing" }, { label: "Subscription terms", href: "/subscription-billing-terms" }, { label: "Refund policy", href: "/refund-policy" }] },
    { title: "Privacy and trust", description: "Review current platform protections, data boundaries, and customer responsibilities.", links: [{ label: "Trust Center", href: "/trust" }, { label: "Privacy Policy", href: "/privacy" }, { label: "Sensitive Data Policy", href: "/sensitive-data-policy" }] },
    { title: "Contact support", description: "Send an account, workspace, product, or technical support request.", links: [{ label: "Open support request", href: "/support" }, { label: "Contact Vaeroex", href: "/contact" }] }
  ];

  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Vaeroex Help"
        title="Find the answer or reach the right team."
        description="Choose the area that matches what you are trying to do. Product-specific guidance stays close to the authenticated workspace, while public billing, privacy, and trust resources remain available here."
        actions={
          <>
            <Link href="/support" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Submit a support request
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={workspaceHref} className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">{loggedIn ? "Open app guidance" : "Login"}</Link>
          </>
        }
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading eyebrow="Help by task" title="Start with what you need to accomplish." />
          <div className="mt-7 grid gap-3 md:grid-cols-2">
            {categories.map((category) => (
              <details key={category.title} className="group rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                  <span>
                    <span className="block font-semibold text-white">{category.title}</span>
                    <span className="mt-1 block text-sm leading-5 text-slate-400">{category.description}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-cyan-200 group-open:hidden">Open</span>
                  <span className="hidden shrink-0 text-xs font-semibold text-cyan-200 group-open:block">Close</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                  {category.links.map((link) => (
                    <Link key={`${category.title}-${link.label}`} href={link.href} className="inline-flex min-h-11 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">{link.label}</Link>
                  ))}
                </div>
              </details>
            ))}
          </div>

          <div className="mt-10 grid gap-6 border-t border-white/10 pt-10 lg:grid-cols-2">
            <div className="flex gap-3">
              <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-white">Need product or account help?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Use the support request form, or email <a href={VAEROEX_MAILTO_LINKS.support} className="font-semibold text-cyan-200 hover:text-white">{VAEROEX_CONTACT_EMAILS.support}</a>.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-white">Have a billing question?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">Email <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-cyan-200 hover:text-white">{VAEROEX_CONTACT_EMAILS.billing}</a>. Do not send regulated or highly sensitive data in support messages.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
