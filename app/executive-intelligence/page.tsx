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

const capabilities = [
  { title: "Business Health and KPIs", body: "See a quick view of current business conditions, the measures behind it, how performance is moving, and where targets are being met or missed.", icon: Gauge },
  { title: "Intelligence", body: "See findings, risks, opportunities, and meaningful changes in one prioritized view.", icon: ScanSearch },
  { title: "Explain Finding", body: "Take a closer look at one supported issue, why it may matter, and what leadership should investigate next.", icon: FileSearch2 },
  { title: "Evidence", body: "See what an insight is based on and trace important numbers and findings back to the supporting business information.", icon: Brain },
  { title: "Briefings and Saved Analyses", body: "Generate eligible Weekly and Monthly Intelligence Briefings, then preserve useful briefings and analyses for later review.", icon: FileText }
] as const;

type DisclosureItem = readonly [title: string, summary: string, detail: string];

const informationDisclosures: readonly DisclosureItem[] = [
  [
    "What can I give Vaeroex?",
    "Spreadsheets, PDFs, reports, screenshots, exports, photos, paper records, handwritten notes, and other supported business information.",
    "You do not need to rebuild your business around one perfect reporting system first. Vaeroex brings supported information into a clearer intelligence picture while keeping its source context available."
  ],
  [
    "Still working with paper records or handwritten notes?",
    "Take a photo. Vaeroex can decipher handwritten business information with high accuracy and bring it into the broader intelligence picture.",
    "Paper logs, photographed records, and handwritten business notes do not have to remain trapped offline. Upload a clear image alongside your spreadsheets, PDFs, reports, and screenshots. Results still remain reviewable rather than being treated as perfect or guaranteed recognition."
  ],
  [
    "What can Vaeroex help me notice?",
    "KPI movement, missed targets, meaningful changes, risks, opportunities, developing problems, and areas that may deserve attention.",
    "Executive Intelligence helps keep your KPIs organized, preserves the targets and meaning confirmed by your business, and connects important movement with broader findings and supporting information. It can help you investigate whether sales are improving while margins weaken, costs are rising, targets are being missed, or separate records point toward the same developing issue."
  ],
  [
    "What are generated intelligence briefings?",
    "Stay informed without manually comparing every new report, spreadsheet, file, and note.",
    "When enough supported business information is available, you can generate a Weekly Intelligence Briefing for the rolling last 7 days or a Monthly Intelligence Briefing for the rolling last 30 days. Briefings may surface supported changes, KPI movement, risks, opportunities, findings, and evidence limits. They are generated on demand; an upload does not automatically create one."
  ]
] as const;

const trustDisclosures: readonly DisclosureItem[] = [
  [
    "See what an insight is based on",
    "Review the supporting information, sources, freshness, confidence, and limitations behind important insights.",
    "Important conclusions remain connected to supporting business information instead of being hidden behind a confident-sounding answer."
  ],
  [
    "Understand the explanation",
    "Vaeroex can add context and interpretation without changing the underlying business facts.",
    "Executive Intelligence can connect supported patterns, priorities, and limitations while leaving your original business information intact."
  ],
  [
    "You stay in control",
    "Vaeroex informs decisions. Leadership remains in control. Recommendations are there for review—not actions Vaeroex takes on its own.",
    "Leadership decides what to investigate and what to do next. Vaeroex does not autonomously change customer systems or business records."
  ]
] as const;

const audience = [
  "Growing businesses where the owner can no longer keep every important number in their head",
  "Businesses with information spread across spreadsheets, reports, screenshots, files, and paperwork",
  "Teams tracking performance but struggling to connect the numbers with what is actually happening operationally"
] as const;
const ongoingValue = [
  "Add supported business information as the business evolves",
  "Follow KPI movement and targets, plus findings, risks, and opportunities over time",
  "Generate eligible Weekly and Monthly Intelligence Briefings",
  "Return to saved briefings, analyses, and evidence without starting from scratch"
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

function DisclosureList({ items }: { items: readonly DisclosureItem[] }) {
  return (
    <div className={styles.disclosureList}>
      {items.map(([title, summary, detail], index) => (
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
          <a href="#executive-control"><span>05</span><strong>Ongoing</strong></a>
          <a href="#executive-close"><span>06</span><strong>Next</strong></a>
        </nav>

        <section id="executive-opening" className={`${styles.chapter} ${styles.hero}`} data-ei-stage="business-complexity">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.heroContent}`}>
            <p className={styles.eyebrow}>Executive Intelligence · A Vaeroex product</p>
            <h1>Executive Intelligence</h1>
            <p className={styles.heroBody}>See what&apos;s changing in your business—and what deserves your attention. Vaeroex&apos;s flagship Executive Intelligence platform turns the information you already have into a clearer view of performance, KPIs, trends, risks, opportunities, and emerging problems.</p>
            <p className={styles.heroDefinition}>Executive Intelligence is a business analysis system that helps turn the information you already have into a clearer picture of your business. Think of it as a second set of eyes and a second brain that helps make sense of your business information.</p>
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
          <span id="executive-evidence" className={styles.legacyAnchor} aria-hidden="true" />
          <span className={styles.spatialStageMap} data-ei-preserved-stage="evidence-depth" aria-hidden="true" />
          <div className={styles.informationLayout}>
            <div className={styles.informationIntro}>
              <StageMarker index="03" label="Start with what you have" />
              <FileSearch2 className={styles.sectionIcon} aria-hidden="true" />
              <h2>Your business information can be messy. Your understanding of it doesn&apos;t have to be.</h2>
              <p className={styles.copy}>Business information may be spread across spreadsheets, PDFs, reports, screenshots, exports, photos, paper records, and handwritten notes. Instead of reviewing every file in isolation, Vaeroex brings supported business information together in one intelligence workspace, helping you see connections, changes, and patterns over time.</p>
            </div>
            <DisclosureList items={informationDisclosures} />
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

        <section id="executive-control" className={`${styles.chapter} ${styles.controlChapter}`} data-ei-stage="leadership-control">
          <span id="executive-context" className={styles.legacyAnchor} aria-hidden="true" />
          <span className={styles.spatialStageMap} data-ei-preserved-stage="historical-context" aria-hidden="true" />
          <div className={styles.ongoingTrustLayout}>
            <div className={styles.ongoingStatement}>
              <StageMarker index="05" label="Ongoing intelligence & trust" />
              <p className={styles.contextStatus}>Ongoing intelligence</p>
              <h2>An ongoing second set of eyes on your business.</h2>
              <p className={styles.copy}>Keep adding supported information, follow what changes, and return to the evidence and intelligence that matter over time.</p>
              <ul className={styles.ongoingList}>
                {ongoingValue.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>

            <div className={styles.trustPanel}>
              <div className={styles.iconFrame}><ShieldCheck aria-hidden="true" /></div>
              <h2>Your numbers stay your numbers.</h2>
              <p>Vaeroex keeps business facts and calculations grounded in the information your business provides, while clearly separating those facts from AI-generated explanation and interpretation.</p>
              <DisclosureList items={trustDisclosures} />
            </div>
          </div>
        </section>

        <section id="executive-close" className={`${styles.chapter} ${styles.closingChapter}`} data-ei-stage="executive-clarity">
          <div className={styles.closingLayout}>
            <div className={styles.audiencePanel}>
              <StageMarker index="06" label="Who it helps / next" />
              <p className={styles.contextStatus}>Who it helps</p>
              <h2>Businesses that have information—but not always the time or visibility to make sense of all of it.</h2>
              <ul className={styles.audienceList}>
                {audience.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className={styles.closingContent}>
              <h2>Start building a clearer intelligence picture of your business.</h2>
              <p>Bring together the information you already have, follow what changes, and give leadership a clearer basis for deciding what deserves attention next.</p>
              <div className={styles.closingActions}>
                <Link href="/pricing" className={styles.primaryAction}>View pricing<ArrowRight aria-hidden="true" /></Link>
                <Link href="/contact" className={styles.secondaryAction}>Talk with Vaeroex</Link>
              </div>
            </div>
          </div>
        </section>
      </div>

      <PublicFooter />
    </main>
  );
}
