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
  description: "Executive Intelligence is Vaeroex's flagship evidence-backed platform for Business Health, prioritized intelligence, focused explanations, Evidence, and Saved Analyses.",
  path: "/executive-intelligence"
});

const processSteps = [
  ["Connect Your Business", "Bring reports, spreadsheets, documents, KPIs, and relevant business information into one secure workspace."],
  ["Build Trusted Business Understanding", "Vaeroex organizes information with source context so facts remain distinct from interpretation."],
  ["Transform Information into Executive Intelligence", "Deterministic intelligence identifies current conditions, meaningful changes, and leadership priorities."],
  ["Advanced Executive Reasoning", "Supported patterns are explained in clear business language, with uncertainty and limitations kept visible."],
  ["Executive Clarity", "Leadership receives a concise, evidence-backed view of what matters, why it matters, and where to focus next."]
] as const;

const capabilities = [
  { title: "Business Health", body: "The executive summary experience: a concise current-state view with the strongest supported drivers.", icon: Gauge },
  { title: "Intelligence", body: "Prioritized findings, risks, opportunities, and changes ranked for leadership attention.", icon: ScanSearch },
  { title: "Explain Finding", body: "A focused investigation that explains one supported issue, why it matters, and what to examine next.", icon: FileSearch2 },
  { title: "Evidence", body: "The trusted business information behind each conclusion remains clear and available for inspection.", icon: Brain },
  { title: "Saved Analyses", body: "Completed analyses can be preserved for later leadership review without regenerating or rewriting them.", icon: FileText }
] as const;

const evidenceInputs = [
  ["Connected business information", "Bring together supported spreadsheets, documents, images, KPIs, and operating records without losing their business context."],
  ["Clear source accountability", "Supporting information remains connected to its source so leadership can inspect what each conclusion is based on."],
  ["Current and historical perspective", "Freshness and prior periods remain visible so current conditions are not confused with outdated information."]
] as const;

const audience = ["Owners reviewing a growing business", "CEOs and COOs connecting performance across systems", "Operations leaders preparing an evidence-backed review", "Department leaders who need context beyond one report"] as const;
const exclusions = ["A CRM or customer record system", "A task or project-management replacement", "An accounting or ERP platform", "An autonomous operator that acts without human authority"] as const;

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
          <a href="#executive-opening"><span>01</span><strong>Complexity</strong></a>
          <a href="#product-experience"><span>02</span><strong>Command</strong></a>
          <a href="#executive-method"><span>03</span><strong>Clarity</strong></a>
          <a href="#executive-capabilities"><span>04</span><strong>Focus</strong></a>
          <a href="#executive-evidence"><span>05</span><strong>Evidence</strong></a>
          <a href="#executive-control"><span>06</span><strong>Control</strong></a>
          <a href="#executive-context"><span>07</span><strong>Context</strong></a>
          <a href="#executive-close"><span>08</span><strong>Decision</strong></a>
        </nav>

        <section id="executive-opening" className={`${styles.chapter} ${styles.hero}`} data-ei-stage="business-complexity">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.heroContent}`}>
            <p className={styles.eyebrow}>Executive Intelligence · A Vaeroex product</p>
            <h1>Executive Intelligence</h1>
            <p className={styles.heroBody}>Vaeroex&apos;s flagship Executive Intelligence platform helps leaders see what is happening, understand why it matters, and know what deserves attention next.</p>
            <div className={styles.heroActions}>
              <StartWithVaeroexMenu />
              <Link href="#product-experience" className={styles.secondaryAction}>
                See the product experience
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
            <div className={styles.heroCoordinates} aria-label="Executive Intelligence focus">
              <span><small>01</small>Business Health</span>
              <span><small>02</small>Intelligence</span>
              <span><small>03</small>Evidence</span>
            </div>
          </div>
          <div className={styles.nextChapter} aria-hidden="true"><span>02 / Product command</span><ArrowDown /></div>
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
              <StageMarker index="03" label="How it works" />
              <h2>From connected business information to executive clarity.</h2>
              <p>Business facts remain facts. Advanced executive reasoning explains what the supported information means together.</p>
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
                <StageMarker index="04" label="Current product" />
                <h2>The intelligence leadership can review today.</h2>
              </div>
              <p>Business Health · Intelligence · Explain Finding · Evidence · Saved Analyses</p>
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
              <StageMarker index="05" label="Evidence depth" />
              <FileSearch2 className={styles.sectionIcon} aria-hidden="true" />
              <h2>Business information becomes trusted understanding, not unsupported conclusions.</h2>
              <p className={styles.copy}>Executive Intelligence connects supported business information while keeping its source context available for leadership review.</p>
            </div>
            <div className={styles.evidenceLedger}>
              {evidenceInputs.map(([title, body], index) => (
                <article key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="executive-control" className={`${styles.chapter} ${styles.controlChapter}`} data-ei-stage="leadership-control">
          <div className={styles.controlLayout}>
            <div className={styles.controlStatement}>
              <StageMarker index="06" label="Leadership control" />
              <div className={styles.iconFrame}><ShieldCheck aria-hidden="true" /></div>
              <h2>Facts remain facts. Interpretation remains explainable.</h2>
              <p>Vaeroex preserves the distinction between business information, deterministic calculations, and the executive interpretation built from them.</p>
              <div className={styles.controlChecks}>
                {["Supporting sources remain identifiable", "Business facts stay separate from interpretation", "Technical failures never become business conclusions"].map((item) => (
                  <div key={item}><ShieldCheck aria-hidden="true" />{item}</div>
                ))}
              </div>
            </div>

            <div className={styles.controlPrinciples}>
              <article>
                <p>Evidence-backed intelligence</p>
                <h3>Vaeroex shows what it understands—and what it does not.</h3>
                <span>Confidence, freshness, supporting sources, and limitations remain visible. Limited evidence produces limited conclusions, not invented certainty.</span>
              </article>
              <article>
                <p>Advanced executive reasoning</p>
                <h3>Explanation that adds understanding, not new facts.</h3>
                <span>Executive interpretation connects supported patterns, priorities, and limitations without altering the underlying business information.</span>
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
              <StageMarker index="07" label="Leadership environment" />
              <p className={styles.contextStatus}>Designed for</p>
              <h2>Leaders who need one coherent operating view.</h2>
              <ul>
                {audience.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className={styles.contextSecondary}>
              <p className={styles.contextStatus}>Not designed as</p>
              <h2>Another place for teams to manage work.</h2>
              <ul>
                {exclusions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section id="executive-close" className={`${styles.chapter} ${styles.closingChapter}`} data-ei-stage="executive-clarity">
          <div className={styles.closingContent}>
            <StageMarker index="08" label="Executive Intelligence by Vaeroex" />
            <h2>Give leadership a clearer basis for the next decision.</h2>
            <p>Start with one private Executive Intelligence Workspace for Business Health, Intelligence, Explain Finding, Evidence, and Saved Analyses.</p>
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
