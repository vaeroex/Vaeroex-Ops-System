import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowRight, Check, ChevronDown } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { businessProblems, whyVaeroexFaqs } from "@/lib/marketing/why-vaeroex";
import styles from "@/components/marketing/IntelligencePages.module.css";
import draft from "@/components/marketing/WhyVaeroex.module.css";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Why Vaeroex | Clearer Answers, Better Priorities",
  description: "See how VSI, the intelligence behind Vaeroex, helps prevent hallucinated answers, reduce manual comparison, clarify priorities, and keep up with growth.",
  path: "/about/why-vaeroex"
});

const textLink = "inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#8299ff] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8299ff]";

export default function WhyVaeroexPage() {
  return (
    <main className={`${styles.site} ${draft.page} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Why Vaeroex"
        title="Understand what’s happening. Decide what comes next."
        description="Your business produces plenty of information. Finding a useful answer can still take hours. Executive Intelligence brings your available business information together so you can investigate questions, understand what deserves attention, and decide where to focus."
        actions={<a href="#what-we-solve" className={textLink}>See what we solve <ArrowDown className="h-4 w-4" aria-hidden="true" /></a>}
        aside={
          <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr] lg:gap-12">
            <h2 className="text-2xl font-medium leading-snug">VSI—the intelligence behind Vaeroex.</h2>
            <p className="max-w-2xl text-base leading-7 text-slate-300">Vaeroex Super Intelligence is the foundation of Vaeroex. It brings business calculations, evidence, and reasoning together to power analysis, explanations, and conversation across the platform.</p>
          </div>
        }
      />

      <section id="what-we-solve" className="scroll-mt-24 border-y border-white/10 bg-[#0b0e14] px-5 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <PublicSectionHeading eyebrow="What we solve" title="One business question can turn into five problems." />
          <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:gap-16">
            <div className="border-l-2 border-[#8299ff]/60 pl-6">
              <p className="text-2xl font-medium leading-snug text-white sm:text-3xl">Sales are up.<br />Why aren’t profits?</p>
              <p className="mt-4 text-base leading-7 text-slate-300">Your sales report tells one part of the story. Your bookkeeping, staffing costs, and supplier bills tell the rest.</p>
            </div>
            <div className="space-y-4 text-base leading-7 text-slate-300">
              <p>An unreliable answer can send you into hours of comparing reports. Then you have to decide what to do, check whether it worked, and keep up as the business changes.</p>
              <p className="text-white">Solving a problem early can prevent more work later. Wherever you are in that process, Vaeroex helps you move forward.</p>
            </div>
          </div>
          <nav aria-label="Problems Vaeroex helps solve" className="mt-10 border-t border-white/10 pt-6">
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {businessProblems.map((problem, index) => (
                <li key={problem.id}>
                  <a href={`#${problem.id}`} className="flex min-h-14 items-start gap-3 rounded-lg px-3 py-3 text-sm leading-6 text-slate-300 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8299ff]">
                    <span className="font-mono text-[#8299ff]">0{index + 1}</span><span>{problem.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        {businessProblems.map((problem, index) => (
          <section key={problem.id} id={problem.id} aria-labelledby={`${problem.id}-title`} className="scroll-mt-24 border-b border-white/10 py-12 sm:py-16">
            <div className="mb-7 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-[#8299ff]">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#8299ff]/30 font-mono">0{index + 1}</span>
              {problem.order} problem
            </div>
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
              <div>
                <h2 id={`${problem.id}-title`} className="text-3xl font-medium leading-tight sm:text-4xl">{problem.title}</h2>
                <div className="mt-5 space-y-4 text-base leading-7 text-slate-300">{problem.problem.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              </div>
              <div className={draft.solution}>
                <h3 className="flex items-center gap-3 text-lg font-medium text-[#d9e1ff]"><Check className="h-5 w-5 shrink-0 text-[#8299ff]" aria-hidden="true" />The Vaeroex solution</h3>
                <div className="mt-4 space-y-4 text-base leading-7 text-slate-300">{problem.solution.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
                {"takeaway" in problem ? <p className="mt-5 border-t border-[#8299ff]/15 pt-5 text-base font-medium leading-7 text-white">{problem.takeaway}</p> : null}
              </div>
            </div>
            {index === 0 ? (
              <aside className="mt-10 border-l-2 border-slate-600 pl-5 sm:pl-7" aria-label="Federal Reserve research">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Research · Accuracy and business fit matter</p>
                <blockquote className="mt-3 max-w-3xl text-lg leading-8 text-slate-200">“For AI users, the top challenges were accuracy (46%) and adapting tools to meet business needs (43%).”</blockquote>
                <p className="mt-3 text-sm leading-6 text-slate-400">Federal Reserve Banks, <cite className="not-italic">2026 Report on Employer Firms</cite>, based on the 2025 survey of small employer businesses.</p>
                <a href="https://www.fedsmallbusiness.org/survey/2026-report-on-employer-firms" className={textLink}>Read the report <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Useful business intelligence needs both: answers supported by evidence and an understanding of the work you’re trying to do. That’s the purpose behind VSI.</p>
              </aside>
            ) : null}
          </section>
        ))}
      </div>

      <section className="border-b border-white/10 bg-[#0b0e14] px-5 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <PublicSectionHeading eyebrow="Connect the perspectives" title="Your tools know their part. Your decisions need the bigger picture." />
            <div className="mt-5 space-y-4 text-base leading-7 text-slate-300">
              <p>The insights inside your existing tools can be useful. Your accounting system helps explain your finances. Your sales system helps explain transactions. Your scheduling tools help explain staffing.</p>
              <p>But a question like “Why are sales up while margins are down?” can stretch across all three.</p>
              <p>Vaeroex helps connect those perspectives using the data and reports you can connect or share, alongside the context you provide.</p>
              <p>When another tool produces a useful summary, you can bring that into the discussion too. Vaeroex can help examine it alongside other information, while keeping the summary distinct from the underlying evidence.</p>
            </div>
          </div>
          <div>
            <PublicSectionHeading eyebrow="Business Notes" title="Your business notes help explain the numbers." />
            <div className="mt-5 space-y-4 text-base leading-7 text-slate-300">
              <p>A report may show that sales dropped on Thursday. It may not show that you closed early for repairs.</p>
              <p>A cost report may show that ingredients became more expensive. It may not explain that you deliberately changed suppliers to improve quality.</p>
              <p>Business Notes give Vaeroex that context. Record what changed, what you intended, and what you want to understand. Vaeroex can consider those notes alongside your numbers and distinguish your explanation from what the records independently show.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-2 lg:gap-16">
          <PublicSectionHeading eyebrow="Built for your business" title="Business intelligence for businesses without an enterprise budget." />
          <div className="space-y-4 text-base leading-7 text-slate-300">
            <p>You shouldn’t need a large analytics project just to understand what’s happening in your business.</p>
            <p>If your current approach involves exporting reports, maintaining spreadsheets, and comparing systems by hand, the cost includes your time.</p>
            <p>Executive Intelligence brings analysis, explanations, business context, and priorities into one subscription. It’s built for owners and teams who need practical help making sense of their business.</p>
            <Link href="/pricing" className={textLink}>View pricing <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

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
              <div className="pb-5 text-base leading-7 text-slate-300"><p>Visit the Trust Center for information about how Vaeroex handles business information and the controls that apply.</p><Link href="/trust" className={textLink}>Trust Center <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></div>
            </details>
          </div>
        </div>
      </section>
      <PublicCtaBand eyebrow="From your first question to your next decision" title="Get clarity before the work piles up." description="You may need help with one step or all five. Bring your business information together, ask the question that matters, and understand what deserves attention next." primaryHref="/executive-intelligence" primaryLabel="Explore Executive Intelligence" secondaryHref="/pricing" secondaryLabel="View pricing" />
      <PublicFooter />
    </main>
  );
}
