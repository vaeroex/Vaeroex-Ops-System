import type { Metadata } from "next";
import {
  Activity,
  ArrowDown,
  Beaker,
  Box,
  CircleDot,
  GitBranch,
  History,
  Layers3,
  Network,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { DrugDiscoverySpatialBackdrop } from "@/components/marketing/drug-discovery/DrugDiscoverySpatialBackdrop";
import { DRUG_DISCOVERY_INTELLIGENCE_SYSTEM } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "./drug-discovery.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Drug Discovery Intelligence | Vaeroex",
  description: "Vaeroex Drug Discovery Intelligence turns computational discovery into traceable research intelligence across targets, candidates, experiments, evidence, and scientific decisions.",
  path: "/drug-discovery-intelligence"
});

type Capability = Readonly<{
  title: string;
  body: string;
  icon: LucideIcon;
}>;

const scientificCapabilities: readonly Capability[] = [
  {
    title: "PROTEIN STRUCTURE",
    body: "Explore predicted three-dimensional biological structures and prepare targets for downstream computational analysis.",
    icon: Layers3
  },
  {
    title: "MOLECULAR GENERATION",
    body: "Generate and explore candidate molecular structures under researcher-defined constraints.",
    icon: Sparkles
  },
  {
    title: "MOLECULAR DOCKING",
    body: "Evaluate predicted interactions and binding configurations between candidate molecules and biological targets.",
    icon: Target
  },
  {
    title: "PROTEIN & BINDER DESIGN",
    body: "Explore computational protein and binder designs across structured experimental workflows.",
    icon: Box
  },
  {
    title: "CANDIDATE INTELLIGENCE",
    body: "Compare candidates across computational and experimental evidence, apply explicit requirements, surface conflicts, and prioritize promising directions.",
    icon: ScanSearch
  }
] as const;

const experimentationCapabilities = [
  "Run supported scientific workflows",
  "Modify experimental constraints",
  "Generate new candidate molecules",
  "Evaluate predicted interactions",
  "Compare computational approaches",
  "Repeat and compare experiments",
  "Preserve promising candidates",
  "Incorporate laboratory results as new evidence"
] as const;

const pipeline = [
  "TARGET",
  "STRUCTURE",
  "GENERATE",
  "DOCK",
  "FILTER",
  "COMPARE",
  "PRIORITIZE",
  "LABORATORY EVALUATION"
] as const;

const intelligencePillars: readonly Capability[] = [
  {
    title: "EVIDENCE LINEAGE",
    body: "Know where every structure, score, prediction, measurement, and conclusion originated.",
    icon: Network
  },
  {
    title: "CANDIDATE COMPARISON",
    body: "Evaluate promising candidates across multiple computational and experimental dimensions.",
    icon: CircleDot
  },
  {
    title: "DETERMINISTIC FILTERING",
    body: "Apply explicit project requirements before candidates advance to higher-level reasoning.",
    icon: SlidersHorizontal
  },
  {
    title: "EXPERIMENT HISTORY",
    body: "Preserve prior runs, parameters, outcomes, and researcher decisions.",
    icon: History
  },
  {
    title: "CONFLICTING EVIDENCE",
    body: "Surface disagreements between computational outputs and experimental observations instead of hiding uncertainty.",
    icon: GitBranch
  },
  {
    title: "BOUNDED RESEARCH REASONING",
    body: "Use AI-assisted reasoning to synthesize validated research evidence without presenting generated reasoning as experimental fact.",
    icon: ShieldCheck
  }
] as const;

const researchRecord = [
  "Candidate",
  "Generation Run",
  "Structural Prediction",
  "Docking Result",
  "Filter Outcome",
  "Researcher Review",
  "Laboratory Result",
  "Updated Evidence State"
] as const;

const preservedContext = [
  "Experiment inputs and parameters",
  "Run identity and outputs",
  "Candidate relationships",
  "Supporting and contradictory evidence",
  "Researcher decisions",
  "Later experimental results"
] as const;

const audiences = [
  ["BIOTECHNOLOGY COMPANIES", "Manage discovery programs, candidate evaluation, experimental progression, and research evidence in one intelligence environment."],
  ["PHARMACEUTICAL R&D TEAMS", "Connect computational experiments, candidate comparisons, and research decisions across larger discovery programs."],
  ["CONTRACT RESEARCH ORGANIZATIONS", "Coordinate complex research workflows, preserve project history, and maintain traceable evidence across client programs."],
  ["ACADEMIC RESEARCH LABORATORIES", "Run structured computational discovery workflows and preserve experimental intelligence without building the entire orchestration infrastructure internally."]
] as const;

function StageMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className={styles.stageMarker} aria-hidden="true">
      <span>{index}</span>
      <span>{label}</span>
    </div>
  );
}

function AvailabilityStatus() {
  return (
    <p className={styles.availability} role="status">
      <Activity aria-hidden="true" />
      UNDER DEVELOPMENT
    </p>
  );
}

function ExperimentWorkspace() {
  return (
    <div className={styles.experimentWorkspace} aria-label="Illustrative computational experimentation workspace">
      <div className={styles.experimentBar}>
        <span>Research workspace / Candidate branch</span>
        <span>Iteration 03</span>
      </div>
      <div className={styles.experimentBody}>
        <div className={styles.parameterColumn}>
          <p>EXPERIMENT PARAMETERS</p>
          {[
            ["Target region", "Pocket 02"],
            ["Constraint set", "Selective"],
            ["Candidate family", "Branch C"],
            ["Evidence threshold", "Explicit"]
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className={styles.branchColumn}>
          <div className={styles.branchHeader}>
            <span>EXPERIMENT LINEAGE</span>
            <span>Prior runs preserved</span>
          </div>
          <div className={styles.branchMap} aria-hidden="true">
            <span data-run="01" />
            <span data-run="02" />
            <span data-run="03" />
            <i />
            <i />
            <i />
          </div>
          <div className={styles.runRows}>
            <div><span>RUN 01</span><strong>Baseline candidate field</strong><small>Preserved</small></div>
            <div><span>RUN 02</span><strong>Constraint-adjusted branch</strong><small>Compared</small></div>
            <div><span>RUN 03</span><strong>Current candidate convergence</strong><small>Active</small></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DrugDiscoveryIntelligencePage() {
  const system = DRUG_DISCOVERY_INTELLIGENCE_SYSTEM;

  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />

      <div className={styles.journey} data-drug-discovery-journey>
        <DrugDiscoverySpatialBackdrop />
        <div className={styles.atmosphere} aria-hidden="true" />

        <nav className={styles.journeyIndex} aria-label="Drug Discovery Intelligence chapters">
          <a href="#drug-discovery-target"><span>01</span><strong>Target</strong></a>
          <a href="#scientific-intelligence"><span>02</span><strong>Possibility</strong></a>
          <a href="#discovery-pipeline"><span>03</span><strong>Pipeline</strong></a>
          <a href="#research-intelligence"><span>04</span><strong>Evidence</strong></a>
          <a href="#research-use"><span>05</span><strong>Boundary</strong></a>
        </nav>

        <section id="drug-discovery-target" className={`${styles.chapter} ${styles.hero}`} data-ddi-stage="biological-target">
          <div className={`${styles.content} ${styles.contentLeft}`}>
            <p className={styles.eyebrow}>VAEROEX INTELLIGENCE SYSTEMS</p>
            <h1>{system.name}</h1>
            <p className={styles.heroStatement}>{system.tagline}</p>
            <div className={styles.heroBody}>
              <p>Vaeroex Drug Discovery Intelligence brings biological targets, molecular candidates, computational experiments, research evidence, and scientific decisions into one intelligence system.</p>
              <p>Researchers can explore targets, generate and evaluate candidate molecules, compare computational results, preserve evidence across experiments, and prioritize the most promising directions for further investigation.</p>
            </div>
            <AvailabilityStatus />
          </div>
          <div className={styles.nextChapter} aria-hidden="true">
            <span>Biological target</span>
            <ArrowDown />
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.targetChapter}`} data-ddi-stage="interaction-region">
          <div className={`${styles.content} ${styles.contentRight} ${styles.contentNarrow}`}>
            <StageMarker index="01.1" label="Interaction region" />
            <p className={styles.kicker}>From target to structural context</p>
            <h2>Move from the whole structure toward the region under evaluation.</h2>
            <p className={styles.copy}>A representative biological target resolves into a focused computational region. Structural context remains connected as candidate possibilities begin to form around it.</p>
            <p className={styles.visualBoundary}>Scientific visualization · Representative structure</p>
          </div>
        </section>

        <section id="scientific-intelligence" className={`${styles.chapter} ${styles.capabilityChapter}`} data-ddi-stage="molecular-possibility">
          <div className={styles.wideContent}>
            <StageMarker index="02" label="Scientific workflows" />
            <div className={styles.sectionIntro}>
              <p className={styles.kicker}>Computational discovery</p>
              <h2>Specialized scientific intelligence. One environment.</h2>
              <p>Run advanced computational discovery workflows directly within Vaeroex while preserving the context, evidence, parameters, and history behind every experiment.</p>
            </div>
            <div className={styles.capabilityGrid}>
              {scientificCapabilities.map((capability, index) => {
                const Icon = capability.icon;
                return (
                  <article key={capability.title} className={styles.capability}>
                    <span>0{index + 1}</span>
                    <Icon aria-hidden="true" />
                    <h3>{capability.title}</h3>
                    <p>{capability.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.experimentChapter}`} data-ddi-stage="computational-experimentation">
          <div className={styles.experimentLayout}>
            <div>
              <StageMarker index="02.1" label="Active experimentation" />
              <p className={styles.kicker}>Research workspace</p>
              <h2>Built for active experimentation.</h2>
              <p className={styles.copy}>Drug Discovery Intelligence gives researchers a controlled environment to explore computational possibilities, compare outcomes, and preserve the intelligence generated across every iteration.</p>
              <ul className={styles.experimentList}>
                {experimentationCapabilities.map((capability) => (
                  <li key={capability}><Workflow aria-hidden="true" />{capability}</li>
                ))}
              </ul>
            </div>
            <ExperimentWorkspace />
          </div>
        </section>

        <section id="discovery-pipeline" className={`${styles.chapter} ${styles.pipelineChapter}`} data-ddi-stage="docking-filtering">
          <div className={styles.wideContent}>
            <StageMarker index="03" label="Discovery sequence" />
            <div className={styles.sectionIntro}>
              <p className={styles.kicker}>From possibility to priority</p>
              <h2>A continuous computational discovery path.</h2>
              <p>The environment expands into molecular possibility, evaluates interactions, removes candidates that do not meet explicit requirements, and organizes survivors for researcher review.</p>
            </div>
            <ol className={styles.pipeline} aria-label="Drug discovery intelligence pipeline">
              {pipeline.map((step, index) => (
                <li key={step} data-external={step === "LABORATORY EVALUATION" ? "true" : undefined}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                </li>
              ))}
            </ol>
            <p className={styles.pipelineBoundary}><Beaker aria-hidden="true" />Laboratory evaluation remains the external experimental boundary where computational predictions must be tested.</p>
          </div>
        </section>

        <section id="research-intelligence" className={`${styles.chapter} ${styles.intelligenceChapter}`} data-ddi-stage="candidate-comparison-evidence">
          <div className={styles.wideContent}>
            <StageMarker index="04" label="Intelligence layer" />
            <div className={styles.sectionIntro}>
              <p className={styles.kicker}>Traceable research intelligence</p>
              <h2>Models produce results. Vaeroex builds intelligence.</h2>
              <p>Drug discovery generates fragmented computational outputs, experimental measurements, candidate histories, and research decisions. Vaeroex connects them into a structured intelligence layer so the reasoning behind each research direction remains traceable.</p>
            </div>
            <div className={styles.pillarGrid}>
              {intelligencePillars.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <article key={pillar.title}>
                    <Icon aria-hidden="true" />
                    <h3>{pillar.title}</h3>
                    <p>{pillar.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.recordChapter}`} data-ddi-stage="experiment-history">
          <div className={styles.recordLayout}>
            <div>
              <StageMarker index="04.1" label="Research record" />
              <p className={styles.kicker}>Candidate traceability</p>
              <h2>One candidate. Every experiment that shaped its importance.</h2>
              <p className={styles.copy}>Prior branches remain visible as new predictions, reviews, and laboratory observations update the evidence state. Promising does not become proven; it becomes better supported, contradicted, or deprioritized.</p>
              <div className={styles.preservedList}>
                {preservedContext.map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
            <ol className={styles.recordTimeline}>
              {researchRecord.map((item, index) => (
                <li key={item}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item}</strong>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.audienceChapter}`} data-ddi-stage="candidate-convergence">
          <div className={styles.wideContent}>
            <StageMarker index="04.2" label="Research teams" />
            <div className={styles.sectionIntro}>
              <p className={styles.kicker}>Designed for discovery programs</p>
              <h2>Built for computational discovery teams.</h2>
            </div>
            <div className={styles.audienceGrid}>
              {audiences.map(([title, body]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="research-use" className={`${styles.chapter} ${styles.boundaryChapter}`} data-ddi-stage="laboratory-boundary">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.contentNarrow}`}>
            <StageMarker index="05" label="Research boundary" />
            <div className={styles.researchUse}>
              <p>RESEARCH USE</p>
              <h2>Computational intelligence supports investigation. Experimental evidence establishes what comes next.</h2>
              <p>Vaeroex Drug Discovery Intelligence is designed as a computational research and decision-support environment. Computational predictions require appropriate experimental validation and do not independently establish the safety, efficacy, clinical suitability, or therapeutic value of a candidate.</p>
            </div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.closingChapter}`} data-ddi-stage="evidence-close">
          <div className={styles.closing}>
            <StageMarker index="06" label="Drug Discovery Intelligence" />
            <p className={styles.kicker}>A Vaeroex Intelligence System</p>
            <h2>From possibility to evidence.</h2>
            <p>A unified intelligence system for computational drug discovery.</p>
            <AvailabilityStatus />
          </div>
        </section>
      </div>

      <PublicFooter />
    </main>
  );
}
