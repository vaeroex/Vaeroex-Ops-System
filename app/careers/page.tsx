import type { Metadata } from "next";
import { ArrowRight, Code2, Lightbulb, Waypoints } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Careers at Vaeroex",
  description: "Vaeroex is not currently listing open roles. Qualified builders, operators, and intelligence specialists may share future interest.",
  path: "/careers"
});

const futureAreas = [
  { title: "Engineering & product", body: "Secure, evidence-aware software systems and calm executive experiences.", icon: Code2 },
  { title: "Operations & intelligence", body: "Practical judgment about business evidence, performance, and leadership decisions.", icon: Lightbulb },
  { title: "Strategic relationships", body: "Credible domain expertise and relationships aligned with the Vaeroex direction.", icon: Waypoints }
] as const;

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Careers at Vaeroex"
        title="We are not currently listing open positions."
        description="Vaeroex is building Operations Intelligence carefully. As the company grows, future work may require engineers, product thinkers, operators, and domain specialists who value clarity, evidence, and responsible execution."
        actions={
          <a href={VAEROEX_MAILTO_LINKS.careers} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            Share future interest
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        }
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="Future areas"
            title="The people who fit Vaeroex tend to think clearly and build deliberately."
            description="There is no active hiring process through this page. These areas describe capabilities Vaeroex may need as the company develops."
          />
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-3">
            {futureAreas.map((area) => {
              const Icon = area.icon;
              return (
                <article key={area.title} className="bg-[#07111f] p-5">
                  <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <h2 className="mt-4 text-lg font-semibold text-white">{area.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{area.body}</p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 grid gap-8 border-t border-white/10 pt-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold text-white">What to send</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">A concise introduction, the kind of work you do, relevant experience, and why the Vaeroex direction matters to you. A resume, portfolio, LinkedIn profile, or relevant project is useful when available.</p>
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">What to expect</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">Future-interest messages are retained for possible later review. Sending one does not create an application, guarantee a response, or imply that a role is open.</p>
              <a href={VAEROEX_MAILTO_LINKS.careers} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">{VAEROEX_CONTACT_EMAILS.careers}</a>
            </div>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
