import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { OperationsIntelligenceEngineDemo } from "@/components/motion/OperationsIntelligenceEngineDemo";
import {
  operationsIntelligenceJsonLd,
  publicPageMetadata,
} from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Executive Intelligence | Vaeroex",
  description:
    "Turn fragmented business information into a clearer view of Business Health, performance, risks, opportunities, and what deserves leadership attention.",
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
    "Supported spreadsheets, PDFs, reports, screenshots, exports, photos, paper records, and handwritten business notes. Clear images can help bring offline information into the workspace. Recognition and analysis remain reviewable, with no guarantee that every source can be interpreted perfectly.",
  ],
  [
    "What can Vaeroex help me notice?",
    "KPI movement, missed targets, meaningful changes, risks, opportunities, and developing issues. For example, it can help investigate whether sales are improving while margins weaken, or whether separate records point toward the same operational problem.",
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
                Your numbers, reports, and business context. Connected into a
                clearer view of performance, risk, and what deserves your
                attention.
              </p>
              <div className={styles.actions}>
                <StartWithVaeroexMenu
                  className={styles.primary}
                  label="Start Executive Intelligence"
                />
                <a href="#product-experience" className={styles.textLink}>
                  Explore the experience
                  <ArrowRight aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className={styles.heroSide}>
              <strong>A second set of eyes on your business.</strong>
              <p>
                Vaeroex&apos;s flagship Executive Intelligence platform helps
                owners and operations leaders make sense of information they
                already have. Supporting evidence stays available for review.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="product-experience" className={styles.sectionTight}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>01</span>The product experience
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
                <span>02</span>A connected leadership view
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
              <span>03</span>Start with what you have
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

      <section id="executive-control" className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>
              <span>04</span>Leadership remains in control
            </p>
            <h2>
              Your numbers
              <br />
              stay your numbers.
            </h2>
            <p className={styles.copy}>
              Business facts remain separate from explanation and
              interpretation. Recommendations are there for your review, with
              the context needed to assess them.
            </p>
            <div className={styles.actions}>
              <Link href="/trust" className={styles.textLink}>
                Explore the Trust Center
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
          <ol className={styles.method}>
            <li>
              <span>01</span>
              <div>
                <h3>Inspect the basis</h3>
                <p>
                  Return to supporting sources, freshness, and evidence limits
                  behind important conclusions.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Understand the interpretation</h3>
                <p>
                  See context around supported patterns without treating
                  generated reasoning as a new business fact.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Decide what happens next</h3>
                <p>
                  Confirm any proposed record creation or change. Consequential
                  decisions remain with the people responsible for them.
                </p>
              </div>
            </li>
          </ol>
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
