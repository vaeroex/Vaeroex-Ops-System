import Link from "next/link";
import type { Metadata } from "next";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Check,
  CircleDashed,
  Eye,
  GitBranch,
  Radar,
  Route
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { IntelligenceSystemsSpatialBackdrop } from "@/components/marketing/intelligence-systems/IntelligenceSystemsSpatialBackdrop";
import {
  BIOLOGICAL_INTELLIGENCE_SYSTEM,
  DRUG_DISCOVERY_INTELLIGENCE_SYSTEM,
  EXECUTIVE_INTELLIGENCE_SYSTEM
} from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "./intelligence-systems.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Intelligence Systems | Vaeroex",
  description: "Discover how Vaeroex transforms complex information into visibility, awareness, prediction, and action across specialized intelligence domains.",
  path: "/intelligence-systems"
});

function StageMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className={styles.stageMarker} aria-hidden="true">
      <span>{index}</span>
      <span>{label}</span>
    </div>
  );
}

function DevelopmentStatus() {
  return (
    <p className={`${styles.systemStatus} ${styles.systemStatusDevelopment}`} role="status">
      <Activity aria-hidden="true" />
      In Development
    </p>
  );
}

export default function IntelligenceSystemsPage() {
  const executive = EXECUTIVE_INTELLIGENCE_SYSTEM;
  const drugDiscovery = DRUG_DISCOVERY_INTELLIGENCE_SYSTEM;
  const biological = BIOLOGICAL_INTELLIGENCE_SYSTEM;

  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />

      <div className={styles.journey} data-intelligence-systems-journey>
        <IntelligenceSystemsSpatialBackdrop />
        <div className={styles.atmosphere} aria-hidden="true" />

        <nav className={styles.journeyIndex} aria-label="Intelligence Systems chapters">
          <a href="#intelligence-systems"><span>01</span><strong>Complexity</strong></a>
          <a href="#visibility"><span>02</span><strong>Visibility</strong></a>
          <a href="#awareness"><span>03</span><strong>Awareness</strong></a>
          <a href="#prediction"><span>04</span><strong>Prediction</strong></a>
          <a href="#action"><span>05</span><strong>Action</strong></a>
          <a href="#intelligence"><span>06</span><strong>Intelligence</strong></a>
          <a href="#specialized-intelligence"><span>07</span><strong>Specialization</strong></a>
          <a href="#vaeroex-intelligence-systems"><span>08</span><strong>Vaeroex</strong></a>
        </nav>

        <section id="intelligence-systems" className={`${styles.chapter} ${styles.hero}`} data-is-stage="raw-complexity">
          <div className={`${styles.content} ${styles.contentLeft}`}>
            <p className={styles.eyebrow}>VAEROEX</p>
            <h1>INTELLIGENCE SYSTEMS</h1>
            <p className={styles.heroThesis}>Information is everywhere. Intelligence is not.</p>
            <p className={styles.heroBody}>Vaeroex Intelligence Systems transforms complex information into visibility, awareness, prediction, and action through specialized intelligence environments for distinct domains.</p>
            <div className={styles.heroActions}>
              <a href="#visibility" className={styles.primaryAction}>
                Enter the intelligence journey
                <ArrowRight aria-hidden="true" />
              </a>
              <Link href="/about" className={styles.secondaryAction}>Why Vaeroex</Link>
            </div>
          </div>
          <div className={styles.nextChapter} aria-hidden="true"><span>02 / Visibility</span><ArrowDown /></div>
        </section>

        <section id="visibility" className={`${styles.chapter} ${styles.visibilityChapter}`} data-is-stage="visibility">
          <div className={`${styles.content} ${styles.contentRight} ${styles.contentNarrow}`}>
            <StageMarker index="02" label="Visibility" />
            <p className={styles.kicker}>Structure emerges</p>
            <h2>Make important conditions observable.</h2>
            <p className={styles.copy}>More information does not create clarity on its own. Visibility separates important conditions from the surrounding complexity so people can see what exists and what has changed.</p>
            <p className={styles.conceptBoundary}>This is a public conceptual progression, not a diagram of Vaeroex&apos;s private technical architecture.</p>
          </div>
        </section>

        <section id="awareness" className={`${styles.chapter} ${styles.awarenessChapter}`} data-is-stage="awareness">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.contentNarrow}`}>
            <StageMarker index="03" label="Awareness" />
            <p className={styles.kicker}>Context and relationships</p>
            <h2>See how conditions connect and why they matter.</h2>
            <p className={styles.copy}>Awareness adds context to visibility. Separate observations become more useful when their relationships, constraints, evidence, and surrounding conditions remain visible together.</p>
            <div className={styles.conceptRail} aria-label="Awareness progression">
              <span><Eye aria-hidden="true" />Observe</span>
              <span><GitBranch aria-hidden="true" />Relate</span>
              <span><Radar aria-hidden="true" />Understand</span>
            </div>
          </div>
        </section>

        <section id="prediction" className={`${styles.chapter} ${styles.predictionChapter}`} data-is-stage="prediction">
          <div className={`${styles.content} ${styles.contentRight} ${styles.contentNarrow}`}>
            <StageMarker index="04" label="Prediction" />
            <p className={styles.kicker}>Possible future conditions</p>
            <h2>Surface emerging patterns without pretending certainty.</h2>
            <p className={styles.copy}>Supported relationships can reveal possible trajectories, developing risks, and potential opportunities. Multiple futures can remain visible, including uncertainty and the evidence limits behind each one.</p>
            <p className={styles.uncertaintyNote}><CircleDashed aria-hidden="true" />Possible outcomes, not guaranteed outcomes.</p>
          </div>
        </section>

        <section id="action" className={`${styles.chapter} ${styles.actionChapter}`} data-is-stage="action">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.contentNarrow}`}>
            <StageMarker index="05" label="Action" />
            <p className={styles.kicker}>Clarity after complexity</p>
            <h2>Focus human attention where it can matter.</h2>
            <p className={styles.copy}>Intelligence becomes useful when it improves what people examine, prioritize, decide, or do. Vaeroex supports judgment with clearer direction while leaving authority with the humans responsible for acting.</p>
          </div>
        </section>

        <section id="intelligence" className={`${styles.chapter} ${styles.revealChapter}`} data-is-stage="intelligence-reveal">
          <div className={styles.revealContent}>
            <StageMarker index="06" label="Intelligence" />
            <p className={styles.kicker}>Information transformed</p>
            <h2>This is intelligence.</h2>
            <p>Not simply more information, but information made useful through visibility, context, supported possibilities, and clearer direction.</p>
            <ol className={styles.intelligenceSequence} aria-label="Conceptual intelligence sequence">
              <li><span>01</span>Visibility</li>
              <li><span>02</span>Awareness</li>
              <li><span>03</span>Prediction</li>
              <li><span>04</span>Action</li>
            </ol>
          </div>
        </section>

        <section id="specialized-intelligence" className={`${styles.chapter} ${styles.specializationChapter}`} data-is-stage="specialization">
          <div className={`${styles.content} ${styles.contentRight}`}>
            <StageMarker index="07" label="Specialized intelligence" />
            <p className={styles.kicker}>Different domains. Different demands.</p>
            <h2>One generic environment should not flatten every complex problem.</h2>
            <p className={styles.copy}>Executive, drug-discovery, and biological domains contain different information, relationships, uncertainty, evidence, constraints, and objectives. Vaeroex gives each one a specialized intelligence environment within a shared company-level philosophy.</p>
          </div>
        </section>

        <section id="executive-intelligence" className={`${styles.chapter} ${styles.destinationChapter} ${styles.executiveChapter}`} data-is-stage="executive-destination">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.systemContent}`}>
            <StageMarker index="08" label="Specialized destination" />
            <div className={styles.systemHeading}>
              <div>
                <p className={styles.kicker}>Operational and decision-oriented</p>
                <h2>{executive.name}</h2>
              </div>
              <p className={`${styles.systemStatus} ${styles.systemStatusAvailable}`} role="status"><Check aria-hidden="true" />Available</p>
            </div>
            <p className={styles.systemDescription}>{executive.description}</p>
            <ul className={styles.systemCapabilities} aria-label="Executive Intelligence capabilities">
              {executive.capabilities.map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
            <Link href={executive.route} className={styles.primaryAction}>Explore Executive Intelligence<ArrowRight aria-hidden="true" /></Link>
          </div>
        </section>

        <section id="drug-discovery-intelligence" className={`${styles.chapter} ${styles.destinationChapter} ${styles.drugChapter}`} data-is-stage="drug-discovery-destination">
          <div className={`${styles.content} ${styles.contentRight} ${styles.systemContent}`}>
            <StageMarker index="09" label="Specialized destination" />
            <div className={styles.systemHeading}>
              <div>
                <p className={styles.kicker}>Computational discovery research</p>
                <h2>{drugDiscovery.name}</h2>
              </div>
              <DevelopmentStatus />
            </div>
            <p className={styles.systemDescription}>Drug Discovery Intelligence is being developed as a specialized Vaeroex environment for computational candidate exploration, molecular and protein-related analysis, research evidence, and complex discovery workflows.</p>
            <ul className={styles.systemCapabilities} aria-label="Intended Drug Discovery Intelligence areas">
              {drugDiscovery.capabilities.slice(0, 4).map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
            <p className={styles.developmentAction} aria-disabled="true">Under Development</p>
            <p className={styles.illustrativeNote}>Illustrative computational-science environment. No clinical or therapeutic claims.</p>
          </div>
        </section>

        <section id="biological-intelligence" className={`${styles.chapter} ${styles.destinationChapter} ${styles.biologicalChapter}`} data-is-stage="biological-destination">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.systemContent}`}>
            <StageMarker index="10" label="Specialized destination" />
            <div className={styles.systemHeading}>
              <div>
                <p className={styles.kicker}>Complex biological systems</p>
                <h2>{biological.name}</h2>
              </div>
              <DevelopmentStatus />
            </div>
            <p className={styles.systemDescription}>Biological Intelligence is being developed as a specialized Vaeroex environment for understanding complex biological information, relationships, systems, and computational analysis across multiple scales.</p>
            <ul className={styles.systemCapabilities} aria-label="Intended Biological Intelligence areas">
              {biological.capabilities.slice(0, 4).map((capability) => <li key={capability}>{capability}</li>)}
            </ul>
            <p className={styles.developmentAction} aria-disabled="true">Under Development</p>
            <p className={styles.illustrativeNote}>Illustrative biological systems environment. No diagnosis, treatment, or patient-care capability.</p>
          </div>
        </section>

        <section id="vaeroex-intelligence-systems" className={`${styles.chapter} ${styles.closingChapter}`} data-is-stage="vaeroex-closing">
          <div className={styles.closingContent}>
            <StageMarker index="11" label="Vaeroex Intelligence Systems" />
            <p className={styles.eyebrow}>VAEROEX</p>
            <h2>Transforming information into visibility, awareness, prediction, and action.</h2>
            <p>Specialized intelligence for complex domains, built to strengthen human understanding rather than replace human judgment.</p>
            <div className={styles.closingActions}>
              <Link href="/about" className={styles.primaryAction}>Explore Vaeroex<ArrowRight aria-hidden="true" /></Link>
              <Link href="/contact" className={styles.secondaryAction}>Contact Vaeroex</Link>
            </div>
          </div>
        </section>
      </div>

      <PublicFooter />
    </main>
  );
}
