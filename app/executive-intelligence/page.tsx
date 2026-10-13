import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { OperationsIntelligenceEngineDemo } from "@/components/motion/OperationsIntelligenceEngineDemo";
import story from "@/components/marketing/ExecutiveStory.module.css";
import { ClarityJourney } from "@/components/marketing/clarity/ClarityJourney";
import {
  operationsIntelligenceJsonLd,
  publicPageMetadata,
} from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Executive Intelligence | Vaeroex",
  description:
    "Executive Intelligence for restaurants, breweries, retailers, and other businesses. Explore connected records, uploads, Business Notes, and Vaeroex Super Intelligence (VSI).",
  path: "/executive-intelligence",
});

const capabilities = [
  ["Business Health & KPIs", "See performance against confirmed targets and changes that deserve attention."],
  ["Intelligence & Evidence", "Explore prioritized findings with Explain Finding. Review sources, freshness, uncertainty, and missing context."],
  ["Briefings & Saved Analyses", "Generate eligible Weekly and Monthly Intelligence Briefings on demand. Reopen saved briefings and analyses when you need them."],
] as const;

const evidenceJourney = [
  {
    label: "Operational activity",
    title: "Begin with the business in motion.",
    description:
      "Sales records, operating costs, reports, and business notes each reveal part of the picture. Bring supported information into one private workspace.",
    detail:
      "Conceptual visualization of business information and relationships. No customer data.",
  },
  {
    label: "Financial relationships",
    title: "Read the relationships.",
    description:
      "Revenue can improve while margins weaken. Review related measures together, with the context and targets your business has confirmed.",
    detail: "Business Health · KPI movement · Confirmed targets",
  },
  {
    label: "Emerging risks",
    title: "Bring what matters into focus.",
    description:
      "Surface supported risks, meaningful changes, and opportunities. A prioritized view helps you decide which questions deserve a closer look.",
    detail:
      "Prioritized Intelligence · Supported findings · Visible uncertainty",
  },
  {
    label: "Explain the finding",
    title: "Follow the evidence.",
    description:
      "Examine why a change may matter. Separate the underlying business facts from interpretation, and review the sources and limits behind a conclusion.",
    detail: "Explain Finding · Evidence · Source freshness and limitations",
  },
  {
    label: "Executive priorities",
    title: "Set the agenda. Keep the judgment.",
    description:
      "Return to useful analyses and generate eligible intelligence briefings on demand. Decide what to investigate, what to prioritize, and what to do next.",
    detail: "Saved Analyses · Weekly and Monthly Briefings · Human review",
  },
];

export default function OperationsIntelligencePage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(operationsIntelligenceJsonLd) }} />
      <PublicSiteHeader />
      <section id="executive-opening" className={styles.hero}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Executive Intelligence <span className={styles.status}>Available</span></p>
          <h1>See the business.<br /><em>Know what matters.</em></h1>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.heroLead}>For restaurants, breweries, retailers, and other businesses. Understand performance, investigate change, and prepare clearer next steps with evidence you can review.</p>
              <div className={styles.actions}>
                <StartWithVaeroexMenu className={styles.primary} label="Start Executive Intelligence" />
                <a href="#product-experience" className={styles.textLink}>Explore the workspace<ArrowRight aria-hidden="true" /></a>
              </div>
            </div>
            <div className={styles.heroSide}>
              <strong>Turn everyday records into useful questions.</strong>
              <p>Ask questions, explore ideas, and work through challenges with VSI—from understanding your business to researching a topic or creating something new—all through natural conversation.</p>
              <a href="#vsi" className={styles.textLink}>Explore included VSI<ArrowRight aria-hidden="true" /></a>
            </div>
          </div>
        </div>
      </section>

      <ClarityJourney
        id="executive-control"
        variant="business"
        compact
        stages={evidenceJourney}
      />

      <section id="product-experience" className={styles.sectionTight} aria-labelledby="product-experience-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionLabel}>Inside Executive Intelligence</p><h2 id="product-experience-title">From the overview<br />to the evidence behind it.</h2></div>
            <p className={styles.copy}>See what changed, investigate what matters, and keep useful analysis in one private workspace.</p>
          </div>
          <div className={styles.productCaption}>
            <span>Interactive product walkthrough</span>
            <span>Illustrative sample information · No customer data</span>
          </div>
          <div className={styles.productFrame} data-executive-product-mount>
            <OperationsIntelligenceEngineDemo />
          </div>
          <p className={styles.caption}>This walkthrough illustrates the product experience. Example findings are not live business results or promises of an outcome.</p>
          <div className={story.featureGrid}>
            {capabilities.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section id="business-information" className={styles.section} aria-labelledby="business-information-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionLabel}>Your business information</p><h2 id="business-information-title">Connect what you use.<br />Bring what you know.</h2></div>
            <p className={styles.copy}>Start with a connection or useful files. Add Business Notes for goals, locations, operating details, and meeting updates.</p>
          </div>
          <div className={story.inputGrid}>
            <article className={story.inputItem}>
              <span>01 / PAYMENTS</span><h3>Square</h3>
              <p>Connect a location’s payment records. Refresh payments on request or choose a supported historical date range.</p>
              <p>Payment activity alone does not establish inventory, labor costs, or profit.</p>
            </article>
            <article className={story.inputItem}>
              <span>02 / ACCOUNTING</span><h3>QuickBooks Online</h3>
              <p>Bring supported invoices, sales receipts, bills, payments, and reports such as Profit and Loss and Balance Sheet.</p>
              <p>Scheduled checks look for transaction changes every 15 minutes and refresh reports hourly. Check freshness and coverage; complete accounting history is not guaranteed.</p>
            </article>
            <article className={story.inputItem}>
              <span>03 / FILES &amp; CONTEXT</span><h3>Uploads &amp; Business Notes</h3>
              <p>Upload PDF and Word (.docx) documents, CSV and Excel (.xlsx) spreadsheets, and PNG/JPG photos of business records—up to 25 MiB per file.</p>
              <p>Add Business Notes for context. Review and approve proposed information before it becomes business evidence; image recognition can miss details.</p>
            </article>
          </div>
          <p className={story.sourceRule}>Each metric uses one authoritative source within a reporting scope. Overlapping connected, uploaded, and manual values are not automatically consolidated or deduplicated. Source changes require review.</p>
          <div className={story.integrationStatus}>
            <Link href="/pricing#google-sheets-availability" className={story.pilotLink}>Google Sheets · Limited pilot<ArrowRight size={15} aria-hidden="true" /></Link>
            <p>Additional integrations are in development.</p>
          </div>
        </div>
      </section>

      <section id="vsi" className={`${styles.section} ${story.vsi}`} aria-labelledby="vsi-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>Vaeroex Super Intelligence / VSI</p>
            <p className={story.included}>Flagship feature included with Executive Intelligence</p>
            <h2 id="vsi-title" className={story.headline}>Ask deeper questions.<br /><em>See the bigger picture.</em></h2>
            <p className={story.aside}>A text conversation with room to investigate, imagine, and refine.</p>
          </div>
          <div className={story.prose}>
            <p className={story.lead}>Built with advanced artificial intelligence and Vaeroex-developed technology, VSI helps turn questions into insights, ideas into strategies, and complex information into clearer next steps—all through natural conversation.</p>
            <p>Explore business performance, investigate the evidence behind an insight, research market trends, develop marketing ideas, and draft plans, SOPs, or meeting agendas. Ask follow-up questions and refine your thinking with relevant business context.</p>
            <p>Go beyond business, too—from everyday questions and learning to creative writing and brainstorming—all within your Vaeroex workspace.</p>
          </div>
        </div>
      </section>

      <section id="executive-close" className={styles.closing} aria-labelledby="getting-started-title">
        <div className={`${styles.container} ${story.gettingStarted}`}>
          <div>
            <p className={styles.sectionLabel}>Getting started</p>
            <h2 id="getting-started-title">Build a clearer picture<br />of your business.</h2>
            <div className={styles.actions}>
              <Link href="/pricing" className={styles.primary}>View pricing<ArrowRight aria-hidden="true" /></Link>
              <Link href="/contact" className={styles.secondary}>Talk with Vaeroex</Link>
            </div>
          </div>
          <ol className={story.steps}>
            <li><span>01</span><div><h3>Bring a starting point.</h3><p>Connect supported records, upload a useful report, or add a Business Note.</p></div></li>
            <li><span>02</span><div><h3>Review your information.</h3><p>Confirm proposed facts and check source dates and coverage.</p></div></li>
            <li><span>03</span><div><h3>Explore what matters.</h3><p>Investigate findings, ask VSI, and save useful analyses for later.</p></div></li>
          </ol>
        </div>
        <div className={`${styles.container} ${story.detailsGrid}`}>
          <details className={styles.disclosure}>
            <summary>How do intelligence briefings work?</summary>
            <p>With enough supported business information, generate a Weekly Intelligence Briefing for the rolling last 7 days or a Monthly Intelligence Briefing for the rolling last 30 days. Briefings are generated on demand; an upload does not automatically create one.</p>
          </details>
          <details className={styles.disclosure}>
            <summary>What information should I keep out?</summary>
            <p>Do not upload patient data, PHI, ePHI, Social Security numbers, medical record numbers, insurance IDs, or regulated healthcare data. Visit the <Link href="/trust">Trust Center</Link> for review requirements, data boundaries, and limitations.</p>
          </details>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
