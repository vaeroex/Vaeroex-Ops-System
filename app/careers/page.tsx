import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const connectionGroups = [
  ["Engineers", "People who care about reliable systems, data products, security, automation, and practical software for real organizations."],
  ["Operators", "People who understand how work moves through teams, departments, customer workflows, and business processes."],
  ["Designers", "People who can make complex information feel clear, trusted, calm, and useful for decision-makers."],
  ["Customer & Support Leaders", "People who know how to help customers onboard, learn, troubleshoot, and get measurable value."],
  ["Strategic Partners", "People and organizations aligned with Vaeroex's long-term intelligence platform vision."]
] as const;

const inquiryNotes = [
  "What kind of work, collaboration, or relationship interests you",
  "Relevant experience, portfolio, background, or company information",
  "How you think you could help Vaeroex or Vaeroex customers",
  "The best way for Vaeroex to follow up"
] as const;

export default function CareersPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Careers & Collaboration</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Build with Vaeroex.</h1>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex is a growing intelligence platform company. We are always interested in connecting with talented people who care about
              visibility, awareness, execution, and practical systems that help organizations make better decisions.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={VAEROEX_MAILTO_LINKS.general} className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Contact {VAEROEX_CONTACT_EMAILS.general}
              </a>
              <Link href="/networking" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Explore Network
              </Link>
            </div>
          </div>

          <ScrollReveal delayMs={120} className="vaeroex-hover-card rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Current Status</p>
            <h2 className="mt-2 text-2xl font-semibold">We are not posting active roles here today.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              This page is a way for interested candidates, collaborators, engineers, operators, designers, advisors, and strategic partners to start a conversation with Vaeroex.
              Reaching out does not guarantee a role, interview, partnership, or engagement.
            </p>
          </ScrollReveal>
        </div>

        <section className="mt-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Who We Like To Meet</p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight">People who can help turn information into useful intelligence.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {connectionGroups.map(([title, description], index) => (
              <ScrollReveal key={title} as="article" delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <ScrollReveal className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">How To Reach Out</p>
            <h2 className="mt-2 text-2xl font-semibold">Send a concise note to Vaeroex.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Use{" "}
              <a href={VAEROEX_MAILTO_LINKS.general} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
                {VAEROEX_CONTACT_EMAILS.general}
              </a>{" "}
              for career, collaborator, or general company inquiries.
            </p>
            <ul className="mt-4 grid gap-2 text-sm leading-6 text-muted">
              {inquiryNotes.map((note) => (
                <li key={note} className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                  {note}
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <ScrollReveal delayMs={120} className="vaeroex-ambient rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Vaeroex Direction</p>
            <h2 className="mt-2 text-2xl font-semibold">Intelligence should make organizations clearer, faster, and more accountable.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              If that kind of work interests you, Vaeroex is open to thoughtful introductions and serious conversations.
            </p>
          </ScrollReveal>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
