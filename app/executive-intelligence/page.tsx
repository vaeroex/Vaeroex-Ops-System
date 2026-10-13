import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { OperationsIntelligenceEngineDemo } from "@/components/motion/OperationsIntelligenceEngineDemo";
import { GoogleSheetsPilotNotice } from "@/components/integrations/google-sheets/GoogleSheetsPilotNotice";
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
  [
    "Business Health and KPIs",
    "See current business conditions, the measures behind them, and how performance is moving against the targets your business has confirmed.",
  ],
  [
    "Prioritized Intelligence",
    "Bring supported findings, risks, opportunities, and meaningful changes into one prioritized view of what deserves attention.",
  ],
  [
    "Explain Finding",
    "Investigate one finding in depth. Understand why it may matter, review its supporting context, and consider what to investigate next.",
  ],
  [
    "Evidence",
    "Trace important numbers and findings back to their supporting business information. Review sources, freshness, confidence, and limitations.",
  ],
  [
    "Briefings and Saved Analyses",
    "Generate eligible Weekly and Monthly Intelligence Briefings on demand. Preserve useful briefings and analyses for later review.",
  ],
] as const;

const information = [
  [
    "What information can I bring?",
    "Upload PDF or Word (.docx) documents, CSV or Excel (.xlsx) spreadsheets, and PNG/JPG images of business records, including clear photos of paper notes. Add Business Notes for context. Extraction and proposed facts remain subject to review and approval; image recognition can miss details.",
  ],
  [
    "What can Vaeroex help me notice?",
    "KPI movement, missed targets, and changes supported by the information you provide. Investigate a slower sales period or a cost change when those records are available. Missing or stale evidence can limit the answer; a pattern alone does not establish its cause.",
  ],
  [
    "How do intelligence briefings work?",
    "When enough supported business information is available, you can generate a Weekly Intelligence Briefing for the rolling last 7 days or a Monthly Intelligence Briefing for the rolling last 30 days. Briefings are generated on demand; an upload does not automatically create one.",
  ],
  [
    "Does Vaeroex make decisions or change records for me?",
    "Vaeroex provides drafts and recommendations for human review. Leadership decides what to investigate and what to do next. Vaeroex does not autonomously change customer systems or business records.",
  ],
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(operationsIntelligenceJsonLd),
        }}
      />
      <PublicSiteHeader />
      <section id="executive-opening" className={styles.hero}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>
            Executive Intelligence{" "}
            <span className={styles.status}>Available</span>
          </p>
          <h1>
            See the business.
            <br />
            <em>Know what matters.</em>
          </h1>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.heroLead}>
                For restaurants, breweries, retailers, and other businesses ready
                to make more of their information. Explore performance,
                investigate changes, and prepare clearer next steps with evidence you can review.
              </p>
              <div className={styles.actions}>
                <StartWithVaeroexMenu
                  className={styles.primary}
                  label="Start Executive Intelligence"
                />
                <a href="#vsi" className={styles.textLink}>
                  Explore VSI
                  <ArrowRight aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className={styles.heroSide}>
              <strong>Start with the information you already have.</strong>
              <p>
                Connect supported Square or QuickBooks records, upload reports,
                and add Business Notes. Receive performance views, findings,
                on-demand briefings, saved analyses, and a place to ask deeper questions.
              </p>
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

      <section id="vsi" className={`${styles.section} ${story.vsi}`} aria-labelledby="vsi-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>Vaeroex Super Intelligence / VSI</p>
            <h2 id="vsi-title" className={story.headline}>Ask deeper questions.<br /><em>See the bigger picture.</em></h2>
            <p className={story.aside}>A text conversation with room to investigate, imagine, and refine.</p>
          </div>
          <div className={story.prose}>
            <p className={story.lead}>Built with advanced artificial intelligence and Vaeroex-developed technology, VSI turns questions into insights, ideas into strategies, and complex information into clearer next steps—all through natural conversation.</p>
            <p>If you prefer to talk things through, start with a question and let the conversation develop. Explore your business performance, investigate the evidence behind an insight, research market trends, develop marketing ideas, and draft plans, SOPs, or meeting agendas. Ask follow-up questions, work through possibilities, and refine your thinking with relevant business context—without having to fit your questions into a dashboard.</p>
            <p>And when your curiosity goes beyond business, keep asking. From everyday questions and creative writing to brainstorming and learning something new, VSI gives you room to think, explore, and create—all within your Vaeroex workspace.</p>
            <p className={story.reviewNote}>Plans and SOPs are drafts for your review. They do not become approved company policy or change business records automatically. Review supporting evidence and check important answers.</p>
          </div>
        </div>
      </section>

      <section id="business-information" className={styles.section} aria-labelledby="business-information-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div><p className={styles.sectionLabel}>Your business information</p><h2 id="business-information-title">Connect what you use.<br />Bring what you know.</h2></div>
            <p className={styles.copy}>Begin with a supported connection or a few useful files. Add Business Notes to explain your locations, goals, operating hours, meeting decisions, and recent changes.</p>
          </div>
          <div className={story.inputGrid}>
            <article className={story.inputItem}>
              <span>01 / PAYMENTS</span><h3>Square</h3>
              <p>Connect Square and choose a location to bring payment records into your workspace. Refresh payments on request or select a supported historical date range.</p>
              <p>Payment activity alone does not establish inventory, labor costs, or profit. Review the dates and coverage shown with your records.</p>
            </article>
            <article className={story.inputItem}>
              <span>02 / ACCOUNTING</span><h3>QuickBooks Online</h3>
              <p>Connect supported accounting records, including invoices, sales receipts, bills, and payments, along with reports such as Profit and Loss and Balance Sheet.</p>
              <p>After connection, scheduled checks look for transaction changes every 15 minutes and refresh reports hourly. Check freshness and available coverage; a connection does not guarantee complete accounting history.</p>
            </article>
            <article className={story.inputItem}>
              <span>03 / FILES &amp; CONTEXT</span><h3>Uploads &amp; Business Notes</h3>
              <p>Upload PDF and Word (.docx) documents, CSV and Excel (.xlsx) spreadsheets, and PNG/JPG photos of business records. Each file can be up to 25 MiB.</p>
              <p>Add Business Notes for information that does not live in a report. Review and approve proposed information before Vaeroex uses it as business evidence.</p>
            </article>
          </div>
          <p className={story.sourceRule}>For a metric within a reporting scope, Vaeroex uses one authoritative source. Overlapping connected, uploaded, and manually entered values are not automatically consolidated or deduplicated. Source changes require review.</p>
          <GoogleSheetsPilotNotice className="mt-6" />
          <p className={styles.caption}>Additional integrations are in development. Availability will be announced when they are ready.</p>
        </div>
      </section>

      <section id="product-experience" className={styles.sectionTight}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>02</span>The product experience
              </p>
              <h2>
                From an overview
                <br />
                to the evidence behind it.
              </h2>
            </div>
            <p className={styles.copy}>
              Explore how Business Health, prioritized intelligence, and
              supporting information connect.
            </p>
          </div>
          <div className={styles.productCaption}>
            <span>Interactive product walkthrough</span>
            <span>Illustrative sample information · No customer data</span>
          </div>
          <div className={styles.productFrame} data-executive-product-mount>
            <OperationsIntelligenceEngineDemo />
          </div>
          <p className={styles.caption}>
            This walkthrough illustrates the product experience. Example
            findings are not live business results or promises of an outcome.
          </p>
        </div>
      </section>

      <section id="executive-capabilities" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>03</span>A connected leadership view
              </p>
              <h2>
                Clarity at every
                <br />
                level of the decision.
              </h2>
            </div>
            <p className={styles.copy}>
              Start with the condition of the business. Follow what changed.
              Investigate what matters.
            </p>
          </div>
          <div className={styles.capabilities}>
            {capabilities.map(([title, body], index) => (
              <article className={styles.capability} key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="executive-method" className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>
              <span>04</span>Start with what you have
            </p>
            <h2>Business information rarely arrives in perfect order.</h2>
            <p className={styles.copy}>
              Bring supported business information together in one private
              workspace. Keep adding evidence as the business evolves and return
              to the analyses that matter.
            </p>
            <div className={styles.note}>
              Do not upload patient data, PHI, ePHI, Social Security numbers,
              medical record numbers, insurance IDs, or regulated healthcare
              data.
            </div>
            <div className={styles.actions}>
              <Link href="/trust" className={styles.textLink}>
                Explore the Trust Center
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div>
            {information.map(([title, body]) => (
              <details key={title} className={styles.disclosure}>
                <summary>{title}</summary>
                <p>{body}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="executive-close" className={styles.closing}>
        <div className={`${styles.container} ${styles.closingLayout}`}>
          <div>
            <p className={styles.sectionLabel}>
              Executive Intelligence / Available now
            </p>
            <h2>
              Build a clearer picture
              <br />
              of your business.
            </h2>
            <p className={styles.copy}>
              One private workspace for the information, evidence, and decisions
              leadership needs to connect.
            </p>
          </div>
          <div className={styles.actions}>
            <Link href="/pricing" className={styles.primary}>
              View pricing
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/contact" className={styles.secondary}>
              Talk with Vaeroex
            </Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
