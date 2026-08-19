import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowDown,
  ArrowRight,
  Brain,
  FileSearch2,
  FileText,
  Gauge,
  ScanSearch,
  ShieldCheck
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { ExecutiveIntelligenceSpatialBackdrop } from "@/components/marketing/executive-intelligence/ExecutiveIntelligenceSpatialBackdrop";
import { OperationsIntelligenceEngineDemo } from "@/components/motion/OperationsIntelligenceEngineDemo";
import { operationsIntelligenceJsonLd, publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "./executive-intelligence.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Executive Intelligence | Vaeroex",
  description: "Executive Intelligence helps businesses turn scattered information into a clearer view of performance, KPIs, changes, risks, opportunities, and what deserves attention.",
  path: "/executive-intelligence"
});

const processSteps = [
  ["Start with what you already have", "Bring in supported spreadsheets, PDFs, reports, screenshots, exported records, images, and business notes."],
  ["Bring paper into the picture", "Photos of paper records and handwritten notes can join the same workspace as your digital information."],
  ["Build a clearer KPI picture", "Identify relevant measures, track movement over time, and compare performance with the targets that matter to you."],
  ["See what may be changing", "Surface supported trends, risks, opportunities, emerging problems, and areas that deserve a closer look."],
  ["Keep leadership informed", "Review Business Health, findings, evidence, and eligible briefings as new information becomes available."]
] as const;

const capabilities = [
  { title: "Business Health and KPIs", body: "See a quick view of current business conditions, the measures behind it, how performance is moving, and where targets are being met or missed.", icon: Gauge },
  { title: "Intelligence", body: "Bring supported findings, risks, opportunities, and meaningful changes into one prioritized view of what deserves attention.", icon: ScanSearch },
  { title: "Explain Finding", body: "Take a closer look at one supported issue, why it may matter, and what leadership should investigate next.", icon: FileSearch2 },
  { title: "Evidence", body: "See what an insight is based on and trace important numbers and findings back to the supporting business information.", icon: Brain },
  { title: "Briefings and Saved Analyses", body: "Generate eligible Weekly and Monthly Intelligence Briefings, then preserve useful briefings and analyses for later review.", icon: FileText }
] as const;

const evidenceInputs = [
  [
    "What can I give Vaeroex?",
    "Spreadsheets, PDFs, reports, screenshots, exports, images, and other supported business information.",
    "Bring supported information together without first rebuilding your business around one perfect reporting system. Vaeroex organizes it into a clearer intelligence picture while keeping its source context available."
  ],
  [
    "Still working with paper records or handwritten notes?",
    "Take a photo. Vaeroex can decipher handwritten business information with high accuracy and bring it into the broader picture.",
    "Paper logs, photographed records, and handwritten business notes do not have to remain trapped offline. Upload a clear image alongside your spreadsheets, PDFs, reports, and screenshots. Results still remain reviewable rather than being treated as perfect or guaranteed recognition."
  ],
  [
    "What can Executive Intelligence help reveal?",
    "KPI movement, changes, risks, opportunities, missing targets, and areas that may need attention.",
    "It can help investigate questions such as whether sales are improving while margins weaken, which KPIs are moving in the wrong direction, whether costs are rising, where targets are being missed, or whether separate records point toward the same developing issue."
  ],
  [
    "How are KPIs created and tracked?",
    "Build relevant measures from supported information, set your targets, and understand performance over time.",
    "Executive Intelligence helps organize canonical KPIs, preserve the targets and meaning confirmed by your business, and connect important movement with broader findings and supporting evidence."
  ],
  [
    "What are generated intelligence briefings?",
    "Stay informed about important changes without manually comparing every new report, spreadsheet, file, and note.",
    "When eligible evidence is available, you can generate a Weekly Intelligence Briefing for the rolling last 7 days or a Monthly Intelligence Briefing for the rolling last 30 days. Briefings may surface supported changes, KPI movement, risks, opportunities, findings, and evidence limits. They are generated on demand; an upload does not automatically create one."
  ]
] as const;

const audience = [
  "Growing businesses where the owner can no longer keep every important number in their head",
  "Businesses with information spread across spreadsheets, reports, screenshots, files, and paperwork",
  "Businesses still using paper records or handwritten notes",
  "Teams tracking KPIs but struggling to connect the numbers with what is happening operationally"
] as const;
const ongoingValue = [
  "Add supported business information as the business evolves",
  "Follow KPI movement, targets, findings, risks, and opportunities over time",
  "Generate Weekly or Monthly Intelligence Briefings when evidence requirements are met",
  "Return to saved briefings, analyses, and supporting evidence without starting from scratch"
] as const;

const operationsIntelligenceSchema = JSON.stringify(operationsIntelligenceJsonLd);

function StageMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className={styles.stageMarker} aria-hidden="true">
      <span>{index}</span>
      <span>{label}</span>
    </div>
  );
}

export default function OperationsIntelligencePage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: operationsIntelligenceSchema }} />
      <PublicSiteHeader />

      <div className={styles.journey} data-executive-intelligence-journey>
        <ExecutiveIntelligenceSpatialBackdrop />
        <div className={styles.atmosphere} aria-hidden="true" />

        <nav className={styles.journeyIndex} aria-label="Executive Intelligence chapters">
          <a href="#executive-opening"><span>01</span><strong>Overview</strong></a>
          <a href="#product-experience"><span>02</span><strong>Product</strong></a>
          <a href="#executive-method"><span>03</span><strong>Information</strong></a>
          <a href="#executive-capabilities"><span>04</span><strong>Outcomes</strong></a>
          <a href="#executive-evidence"><span>05</span><strong>Questions</strong></a>
          <a href="#executive-control"><span>06</span><strong>Trust</strong></a>
          <a href="#executive-context"><span>07</span><strong>Ongoing</strong></a>
          <a href="#executive-close"><span>08</span><strong>Next</strong></a>
        </nav>

        <section id="executive-opening" className={`${styles.chapter} ${styles.hero}`} data-ei-stage="business-complexity">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.heroContent}`}>
            <p className={styles.eyebrow}>Executive Intelligence · A Vaeroex product</p>
            <h1>Executive Intelligence</h1>
            <p className={styles.heroBody}>See what&apos;s changing in your business—and what deserves your attention. Vaeroex&apos;s flagship Executive Intelligence platform turns the information you already have into a clearer view of performance, KPIs, trends, risks, opportunities, and emerging problems.</p>
            <div className={styles.heroActions}>
              <StartWithVaeroexMenu />
              <Link href="#product-experience" className={styles.secondaryAction}>
                See the product experience
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className={styles.heroCoordinates} aria-label="Executive Intelligence focus">
              <span><small>01</small>KPIs and targets</span>
              <span><small>02</small>Risks and opportunities</span>
              <span><small>03</small>Briefings and evidence</span>
            </div>
          </div>
          <div className={styles.nextChapter} aria-hidden="true"><span>02 / See it in use</span><ArrowDown /></div>
        </section>

        <section id="product-experience" className={`${styles.chapter} ${styles.productChapter}`} data-ei-stage="command-surface">
          <div className={styles.productLayout}>
            <div className={styles.productIntro}>
              <StageMarker index="02" label="Product experience" />
            </div>
            <div className={styles.productMount} data-executive-product-mount>
              <span className={styles.mountRail} aria-hidden="true" />
              <OperationsIntelligenceEngineDemo />
            </div>
          </div>
        </section>

        <section id="executive-method" className={`${styles.chapter} ${styles.methodChapter}`} data-ei-stage="performance-landscape">
          <div className={styles.wideContent}>
            <div className={styles.sectionIntro}>
              <StageMarker index="03" label="Start with what you have" />
              <h2>Your business information can be messy. Your understanding of it doesn&apos;t have to be.</h2>
              <p>Important information may be spread across spreadsheets, PDFs, reports, screenshots, software exports, filing cabinets, and handwritten notes. Executive Intelligence helps bring supported information into one clearer business picture.</p>
            </div>
            <ol className={styles.processSequence}>
              {processSteps.map(([title, body], index) => (
                <li key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="executive-capabilities" className={`${styles.chapter} ${styles.capabilitiesChapter}`} data-ei-stage="executive-focus">
          <div className={styles.wideContent}>
            <div className={styles.capabilityHeading}>
              <div>
                <StageMarker index="04" label="What you get" />
                <h2>One clearer view of performance and what deserves attention.</h2>
              </div>
              <p>KPIs and targets · Business Health · risks and opportunities · findings · evidence · Weekly and Monthly Intelligence Briefings</p>
            </div>
            <div className={styles.capabilityGrid}>
              {capabilities.map((capability, index) => {
                const Icon = capability.icon;
                return (
                  <article key={capability.title} className={index === 0 ? styles.primaryCapability : undefined}>
                    <div className={styles.capabilityIndex}><span>{String(index + 1).padStart(2, "0")}</span><Icon aria-hidden="true" /></div>
                    <h3>{capability.title}</h3>
                    <p>{capability.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="executive-evidence" className={`${styles.chapter} ${styles.evidenceChapter}`} data-ei-stage="evidence-depth">
          <div className={styles.evidenceLayout}>
            <div>
              <StageMarker index="05" label="Practical intelligence" />
              <FileSearch2 className={styles.sectionIcon} aria-hidden="true" />
              <h2>From scattered paperwork to a clearer business picture.</h2>
              <p className={styles.copy}>Instead of reviewing every file in isolation, Vaeroex brings supported business information together in one intelligence workspace, helping you see connections, changes, and patterns over time.</p>
            </div>
            <div className={styles.evidenceLedger}>
              {evidenceInputs.map(([title, summary, detail], index) => (
                <details key={title} className={styles.disclosure}>
                  <summary>
                    <span className={styles.disclosureIndex}>{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.disclosureLabel}>
                      <strong>{title}</strong>
                      <span>{summary}</span>
                    </span>
                    <span className={styles.disclosureAction} aria-hidden="true">Learn more</span>
                  </summary>
                  <p>{detail}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="executive-control" className={`${styles.chapter} ${styles.controlChapter}`} data-ei-stage="leadership-control">
          <div className={styles.controlLayout}>
            <div className={styles.controlStatement}>
              <StageMarker index="06" label="Clear and reviewable" />
              <div className={styles.iconFrame}><ShieldCheck aria-hidden="true" /></div>
              <h2>Your numbers stay your numbers.</h2>
              <p>Vaeroex keeps business facts and calculations grounded in the information your business provides, while clearly separating those facts from AI-generated explanation and interpretation.</p>
              <div className={styles.controlChecks}>
                {["Trace important insights back to supporting information", "Keep business facts separate from interpretation", "Keep conclusions limited when supporting evidence is limited"].map((item) => (
                  <div key={item}><ShieldCheck aria-hidden="true" />{item}</div>
                ))}
              </div>
            </div>

            <div className={styles.controlPrinciples}>
              <article>
                <p>See what an insight is based on</p>
                <h3>Important conclusions remain connected to supporting information.</h3>
                <span>Sources, freshness, confidence, and limitations stay available for review instead of being hidden behind a confident-sounding answer.</span>
              </article>
              <article>
                <p>Understand what the information may mean</p>
                <h3>Explanation can add context without changing the underlying facts.</h3>
                <span>Executive Intelligence can connect supported patterns, priorities, and limitations while leaving your original business information intact.</span>
              </article>
              <article>
                <p>Human review</p>
                <h3>Vaeroex informs decisions. Leadership remains in control.</h3>
                <span>Recommendations are review-ready intelligence, not autonomous authority to change customer systems or business records.</span>
              </article>
            </div>
          </div>
        </section>

        <section id="executive-context" className={`${styles.chapter} ${styles.contextChapter}`} data-ei-stage="historical-context">
          <div className={styles.contextLayout}>
            <div>
              <StageMarker index="07" label="Built for real businesses" />
              <p className={styles.contextStatus}>Who it helps</p>
              <h2>Businesses that have information—but not always the time or visibility to make sense of all of it.</h2>
              <ul>
                {audience.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className={styles.contextSecondary}>
              <p className={styles.contextStatus}>Ongoing intelligence</p>
              <h2>An ongoing second set of eyes on your business.</h2>
              <ul>
                {ongoingValue.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section id="executive-close" className={`${styles.chapter} ${styles.closingChapter}`} data-ei-stage="executive-clarity">
          <div className={styles.closingContent}>
            <StageMarker index="08" label="Executive Intelligence by Vaeroex" />
            <h2>Start building a clearer intelligence picture of your business.</h2>
            <p>Bring together the information you already have, follow what changes, and give leadership a clearer basis for deciding what deserves attention next.</p>
            <div className={styles.closingActions}>
              <Link href="/pricing" className={styles.primaryAction}>View pricing<ArrowRight aria-hidden="true" /></Link>
              <Link href="/contact" className={styles.secondaryAction}>Talk with Vaeroex</Link>
            </div>
          </div>
        </section>
      </div>

      <PublicFooter />
    </main>
  );
}
