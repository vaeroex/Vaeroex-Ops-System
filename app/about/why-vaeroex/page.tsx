import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ChevronDown } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { companyApproach, whyVaeroexFaqs } from "@/lib/marketing/why-vaeroex";
import styles from "@/components/marketing/IntelligencePages.module.css";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Why Vaeroex | Practical Software, AI & Custom Development",
  description: "Start with an available software template or scope custom software, AI tools, integrations, automation, and website improvements around your business needs.",
  path: "/about/why-vaeroex"
});

const textLink = "inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#8299ff] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8299ff]";

export default function WhyVaeroexPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Why Vaeroex"
        title="Start with your needs. Build from there."
        description="Your business may need an available software template, a custom system, or improvements to tools you already rely on. Vaeroex brings intelligence systems, AI tools, custom software, and website development together to help you find a practical path forward."
        actions={<><Link href="/#solutions" className={styles.primary}>Explore Solutions<ArrowRight size={17} aria-hidden="true" /></Link><Link href="/contact?inquiry=custom-business-systems" className={textLink}>Discuss Your Project<ArrowRight size={17} aria-hidden="true" /></Link></>}
        aside={
          <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr] lg:gap-12">
            <h2 className="text-2xl font-medium leading-snug">Prebuilt where it fits. Custom where it matters.</h2>
            <p className="max-w-2xl text-base leading-7 text-slate-300">Start with an available solution when it meets your needs. When your requirements call for something different, we can scope a new system or extend what you already use—including VSI capabilities where appropriate.</p>
          </div>
        }
      />

      <section className="border-y border-white/10 bg-[#0b0e14] px-5 py-10">
        <nav className="mx-auto max-w-6xl" aria-label="The Vaeroex approach"><ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {companyApproach.map((item, index) => <li key={item.id}><a href={`#${item.id}`} className={textLink}><span className="font-mono text-cyan-200">0{index + 1}</span>{item.title}</a></li>)}
        </ol></nav>
      </section>
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        {companyApproach.map((item, index) => (
          <section key={item.id} id={item.id} aria-labelledby={`${item.id}-title`} className="scroll-mt-28 border-b border-white/10 py-12 sm:py-16">
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-14">
              <div><p className="mb-4 font-mono text-sm text-[#8299ff]">0{index + 1}</p><h2 id={`${item.id}-title`} className="text-3xl font-medium leading-tight sm:text-4xl">{item.title}</h2></div>
              <div className="space-y-4 text-base leading-7 text-slate-300">{item.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
            </div>
            {index === 3 ? (
              <aside className="mt-10 border-l-2 border-slate-600 pl-5 sm:pl-7" aria-label="Federal Reserve research">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Research · Accuracy and business fit matter</p>
                <blockquote className="mt-3 max-w-3xl text-lg leading-8 text-slate-200">“For AI users, the top challenges were accuracy (46%) and adapting tools to meet business needs (43%).”</blockquote>
                <p className="mt-3 text-sm leading-6 text-slate-400">Federal Reserve Banks, <cite className="not-italic">2026 Report on Employer Firms</cite>, based on the 2025 survey of small employer businesses.</p>
                <a href="https://www.fedsmallbusiness.org/survey/2026-report-on-employer-firms" className={textLink}>Read the report <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Those challenges shape our approach: develop AI tools around relevant information and defined workflows, with outputs people can review.</p>
              </aside>
            ) : null}
          </section>
        ))}
      </div>

      <section className="px-5 py-14 sm:px-6 sm:py-20" aria-labelledby="questions-title">
        <div className="mx-auto max-w-4xl">
          <p className="text-xs font-medium uppercase tracking-wider text-[#8299ff]">A few more answers</p>
          <h2 id="questions-title" className="mt-3 text-3xl font-medium sm:text-4xl">Questions you may be asking</h2>
          <div className="mt-8 divide-y divide-white/10 border-y border-white/10">
            {whyVaeroexFaqs.map(([question, answer]) => (
              <details key={question} className="group py-2">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 rounded-sm py-4 text-base font-medium leading-7 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8299ff]">
                  {question}<ChevronDown className="h-5 w-5 shrink-0 text-[#8299ff] group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="max-w-3xl pb-5 text-base leading-7 text-slate-300">{answer}</p>
              </details>
            ))}
            <details className="group py-2">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 rounded-sm py-4 text-base font-medium leading-7 text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8299ff]">Where can I learn about security and data handling?<ChevronDown className="h-5 w-5 shrink-0 text-[#8299ff] group-open:rotate-180" aria-hidden="true" /></summary>
              <div className="pb-5 text-base leading-7 text-slate-300"><p>Visit the Trust Center for published product controls and data-handling information. Custom implementation requirements and controls are defined for each project; they may differ from the published product controls.</p><Link href="/trust" className={textLink}>Trust Center <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
            </details>
          </div>
        </div>
      </section>
      <PublicCtaBand eyebrow="Build with Vaeroex" title="What would help your business work better?" description="Explore our available solutions or tell us what you want to build, connect, or improve." primaryHref="/#solutions" primaryLabel="Explore Solutions" secondaryHref="/contact?inquiry=custom-business-systems" secondaryLabel="Discuss Your Project" />
      <PublicFooter />
    </main>
  );
}
