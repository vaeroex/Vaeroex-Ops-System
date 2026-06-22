import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const values = [
  "Think independently",
  "Solve difficult problems",
  "Take ownership",
  "Enjoy building",
  "Communicate clearly",
  "Learn continuously",
  "Improve systems",
  "Execute consistently"
] as const;

const interestAreas = [
  ["Engineering", "Software systems, AI, automation, infrastructure, and platform development."],
  ["Operations", "Process design, accountability systems, implementation, execution, and organizational intelligence."],
  ["Product & Design", "User experience, interface design, workflows, information architecture, and product strategy."],
  ["Artificial Intelligence", "Applied AI, decision support, intelligence systems, data interpretation, and predictive systems."],
  ["Industrial Systems", "Equipment, monitoring, infrastructure, sensors, manufacturing, reliability, and industrial intelligence."],
  ["Security & Intelligence", "Risk analysis, situational awareness, intelligence workflows, and information management."],
  ["Business Development", "Strategic partnerships, growth, customer development, and market expansion."],
  ["Research & Analysis", "Pattern recognition, investigation, intelligence gathering, decision support, and analytical thinking."],
  ["Strategic Partnerships", "Industry experts, advisors, operators, consultants, and organizations aligned with the Vaeroex mission."]
] as const;

const introPrompts = [
  "Who you are",
  "What you build",
  "What you're interested in",
  "How you think you could contribute"
] as const;

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Careers at Vaeroex</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Help shape the future of intelligence.</h1>
            <p className="mt-5 text-sm leading-6 text-muted">
              Vaeroex is building intelligence systems designed to help organizations transform information into visibility,
              awareness, prediction, and action.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted">
              As the platform evolves, we are always interested in connecting with exceptional people who share that vision.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={VAEROEX_MAILTO_LINKS.careers} className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Connect with Vaeroex
              </a>
              <Link href="/networking" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Explore Network
              </Link>
            </div>
          </div>

          <ScrollReveal delayMs={120} className="vaeroex-ambient rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Talent Pipeline</p>
            <h2 className="mt-2 text-2xl font-semibold">We are always interested in connecting with exceptional people.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Vaeroex is not a traditional job board. This page is a signal for builders, operators, designers, analysts,
              domain experts, and strategic partners who want to be involved with the company as it grows.
            </p>
          </ScrollReveal>
        </div>

        <section className="mt-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Who We Look For</p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight">We value people who build with ownership and clarity.</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((value, index) => (
              <ScrollReveal key={value} delayMs={index * 45} className="vaeroex-hover-card rounded-lg border border-line bg-white p-4 text-sm font-semibold shadow-sm">
                {value}
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Areas of Interest</p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight">The future of Vaeroex will require many kinds of talent.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {interestAreas.map(([title, description], index) => (
              <ScrollReveal key={title} as="article" delayMs={index * 55} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <ScrollReveal className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Connect With Vaeroex</p>
            <h2 className="mt-2 text-2xl font-semibold">Interested in working together?</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Send a short introduction, resume, portfolio, LinkedIn, project, or background information to{" "}
              <a href={VAEROEX_MAILTO_LINKS.careers} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
                {VAEROEX_CONTACT_EMAILS.careers}
              </a>
              .
            </p>
            <p className="mt-4 text-sm font-semibold">Tell us:</p>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted">
              {introPrompts.map((prompt) => (
                <li key={prompt} className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                  {prompt}
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <ScrollReveal delayMs={120} className="vaeroex-ambient rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">The Advantage of Knowing First.</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">See Further. Understand Faster. Move First.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              If you want to help build intelligence systems that make organizations clearer, faster, and more capable,
              Vaeroex would like to hear from you.
            </p>
          </ScrollReveal>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
