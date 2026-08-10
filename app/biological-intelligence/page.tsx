import type { Metadata } from "next";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Atom,
  BrainCircuit,
  CircleDotDashed,
  Dna,
  FileSearch,
  FlaskConical,
  GitBranch,
  Layers3,
  Microscope,
  Network,
  Radar,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Workflow,
  type LucideIcon
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { BiologicalSpatialBackdrop } from "@/components/marketing/biological/BiologicalSpatialBackdrop";
import { BIOLOGICAL_INTELLIGENCE_SYSTEM } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "./biological-intelligence.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Biological Intelligence | Vaeroex",
  description: "Vaeroex Biological Intelligence transforms genomic, molecular, cellular, experimental, and scientific evidence into structured research intelligence.",
  path: "/biological-intelligence"
});

type Capability = Readonly<{
  title: string;
  body: string;
  icon: LucideIcon;
}>;

const capabilities: readonly Capability[] = [
  {
    title: "BIOLOGICAL EVIDENCE SYNTHESIS",
    body: "Bring experimental results, biological datasets, scientific literature, and internal research into a structured evidence view.",
    icon: FileSearch
  },
  {
    title: "MECHANISM DISCOVERY",
    body: "Identify relationships between genes, proteins, pathways, cellular behavior, and observations that may explain a biological phenomenon.",
    icon: Network
  },
  {
    title: "HYPOTHESIS INTELLIGENCE",
    body: "Organize competing hypotheses, supporting and contradictory evidence, assumptions, and unresolved questions.",
    icon: BrainCircuit
  },
  {
    title: "GENOMIC INTELLIGENCE",
    body: "Evaluate sequences, variation, genomic regions, and related experimental evidence within broader biological context.",
    icon: Dna
  },
  {
    title: "PROTEIN INTELLIGENCE",
    body: "Connect protein sequence, structure, function, interactions, experimental observations, and supporting research.",
    icon: Atom
  },
  {
    title: "PATHWAY INTELLIGENCE",
    body: "Understand how findings may converge across pathways and interacting systems instead of treating each signal in isolation.",
    icon: Workflow
  },
  {
    title: "EXPERIMENT INTELLIGENCE",
    body: "Connect historical experiments with new findings and identify what has been tested, what remains unresolved, and what may matter next.",
    icon: FlaskConical
  },
  {
    title: "KNOWLEDGE GAP DETECTION",
    body: "Surface important unknowns, insufficient evidence, missing measurements, and contradictions that affect interpretation.",
    icon: ScanSearch
  },
  {
    title: "RESEARCH PRIORITIZATION",
    body: "Help teams identify which biological signals, hypotheses, or experiments may deserve further investigation.",
    icon: Radar
  }
] as const;

const applications = [
  ["UNDERSTAND COMPLEX BIOLOGICAL PHENOTYPES", "Connect molecular and experimental evidence to potential biological mechanisms."],
  ["INVESTIGATE GENETIC VARIATION", "Evaluate how genomic changes relate to genes, proteins, pathways, and observations."],
  ["PRIORITIZE RESEARCH HYPOTHESES", "Compare supporting and conflicting evidence before committing laboratory resources."],
  ["CONNECT EXPERIMENTS OVER TIME", "Preserve relationships between historical experiments, new findings, and unresolved questions."],
  ["IDENTIFY KNOWLEDGE GAPS", "Determine where additional evidence may materially improve understanding."],
  ["PLAN HIGH-VALUE FOLLOW-UP RESEARCH", "Surface investigations that may reduce important uncertainty."]
] as const;

const audiences = [
  "Biotechnology research teams",
  "Pharmaceutical research organizations",
  "Academic research laboratories",
  "Genomics and molecular biology teams",
  "Synthetic biology and protein engineering researchers",
  "Translational and life-sciences R&D organizations"
] as const;

const rigorPrinciples: readonly Capability[] = [
  { title: "EVIDENCE LINEAGE", body: "Keep observations connected to their originating datasets, experiments, and scientific sources.", icon: GitBranch },
  { title: "SOURCE ATTRIBUTION", body: "Make the basis for a biological interpretation available for researcher inspection.", icon: FileSearch },
  { title: "UNCERTAINTY VISIBILITY", body: "Represent evidence limits and unresolved questions instead of smoothing them away.", icon: CircleDotDashed },
  { title: "CONFLICTING EVIDENCE", body: "Keep contradictory observations visible and separate from supporting evidence.", icon: Layers3 },
  { title: "EXPERIMENTAL PROVENANCE", body: "Preserve the relationship between conditions, measurements, findings, and later interpretation.", icon: TestTube2 },
  { title: "HUMAN RESEARCHER REVIEW", body: "Keep scientific judgment with the researchers responsible for interpreting and acting on the evidence.", icon: ShieldCheck }
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

function BiologicalSystemAnalysis() {
  return (
    <div className={styles.analysisSurface} aria-label="Illustrative Biological Intelligence analysis">
      <div className={styles.analysisHeader}>
        <div>
          <p>BIOLOGICAL SYSTEM ANALYSIS</p>
          <strong>Pathway disruption identified</strong>
        </div>
        <span>ILLUSTRATIVE</span>
      </div>

      <div className={styles.analysisMetrics}>
        {[
          ["Supporting genes", "23"],
          ["Relevant proteins", "8"],
          ["Supporting experiments", "4"],
          ["Contradictory findings", "2"],
          ["Evidence strength", "STRONG"]
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className={styles.analysisBody}>
        <div className={styles.hypothesisPanel}>
          <p>MECHANISTIC HYPOTHESIS</p>
          <strong>Observed expression changes and protein-level evidence suggest a potential relationship between Gene A, Protein B, and downstream Pathway C.</strong>
          <div className={styles.mechanismPath} aria-label="Illustrative mechanism relationship">
            <span>GENE A</span><i /><span>PROTEIN B</span><i /><span>PATHWAY C</span>
          </div>
        </div>
        <div className={styles.uncertaintyPanel}>
          <p>KEY UNCERTAINTY</p>
          <strong>Protein B activity has not yet been directly measured under the experimental condition.</strong>
          <p className={styles.priorityLabel}>PRIORITY INVESTIGATION</p>
          <span>Measure Protein B activity following the same perturbation to determine whether the proposed pathway mechanism is supported.</span>
        </div>
      </div>
    </div>
  );
}

export default function BiologicalIntelligencePage() {
  const system = BIOLOGICAL_INTELLIGENCE_SYSTEM;

  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />

      <div className={styles.journey} data-biological-journey>
        <BiologicalSpatialBackdrop />
        <div className={styles.atmosphere} aria-hidden="true" />

        <nav className={styles.journeyIndex} aria-label="Biological Intelligence chapters">
          <a href="#biological-sequence"><span>01</span><strong>Sequence</strong></a>
          <a href="#biological-structure"><span>02</span><strong>Structure</strong></a>
          <a href="#biological-system"><span>03</span><strong>System</strong></a>
          <a href="#biological-intelligence"><span>04</span><strong>Intelligence</strong></a>
          <a href="#biological-rigor"><span>05</span><strong>Rigor</strong></a>
        </nav>

        <section className={`${styles.chapter} ${styles.hero}`} data-bi-stage="genomic-scale">
          <div className={`${styles.content} ${styles.contentLeft}`}>
            <p className={styles.eyebrow}>VAEROEX</p>
            <h1>{system.name}</h1>
            <p className={styles.heroStatement}>Understand the system behind the signal.</p>
            <p className={styles.heroBody}>Biological Intelligence transforms genomic, molecular, cellular, experimental, and scientific evidence into structured intelligence — helping research teams uncover mechanisms, evaluate hypotheses, identify knowledge gaps, and determine what deserves investigation next.</p>
            <p className={styles.descriptor}>Research intelligence for complex biological systems.</p>
            <div className={styles.heroActions}>
              <AvailabilityStatus />
              <a href="#biological-sequence" className={styles.exploreLink}>Explore Biological Intelligence<ArrowRight aria-hidden="true" /></a>
            </div>
          </div>
          <div className={styles.nextChapter} aria-hidden="true"><span>Genomic scale</span><ArrowDown /></div>
        </section>

        <section id="biological-sequence" className={`${styles.chapter} ${styles.sequenceChapter}`} data-bi-stage="sequence-variation">
          <div className={`${styles.content} ${styles.contentRight} ${styles.contentNarrow}`}>
            <StageMarker index="01" label="DNA / Genomic scale" />
            <p className={styles.kicker}>Sequence → Variation → Biological consequence</p>
            <h2>Move from a sequence change toward the biological context it may affect.</h2>
            <p className={styles.copy}>A selected genomic region remains connected to the surrounding sequence as variation, regulatory context, and expression evidence come into view. The relationship is inspectable; consequence is evaluated, not assumed.</p>
            <p className={styles.visualBoundary}>Conceptual scientific visualization · Representative sequence</p>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.regulatoryChapter}`} data-bi-stage="gene-regulatory">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.contentNarrow}`}>
            <StageMarker index="01.1" label="Gene / Regulatory scale" />
            <p className={styles.kicker}>Context around the sequence</p>
            <h2>See coding regions, regulatory elements, variation, and expression as related evidence.</h2>
            <p className={styles.copy}>Biological Intelligence is being designed to organize the evidence surrounding a region without reducing it to a single score or a generic genome-browser view.</p>
            <div className={styles.evidenceRail} aria-label="Genomic evidence sequence">
              {[
                ["01", "Sequence"],
                ["02", "Regulation"],
                ["03", "Expression"],
                ["04", "Observation"]
              ].map(([index, label]) => <span key={label}><small>{index}</small>{label}</span>)}
            </div>
          </div>
        </section>

        <section id="biological-structure" className={`${styles.chapter} ${styles.proteinChapter}`} data-bi-stage="protein-scale">
          <div className={`${styles.content} ${styles.contentRight} ${styles.contentNarrow}`}>
            <StageMarker index="02" label="Protein scale" />
            <p className={styles.kicker}>From sequence toward structure and function</p>
            <h2>A biological signal gains meaning through the structures and interactions around it.</h2>
            <p className={styles.copy}>Sequence evidence can be connected to folded domains, functional regions, interaction sites, variant locations, and experimental observations while preserving the difference between measured and interpreted information.</p>
            <p className={styles.visualBoundary}>Ribbon structure · Functional-region emphasis</p>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.cellChapter}`} data-bi-stage="cellular-scale">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.contentNarrow}`}>
            <StageMarker index="03" label="Cellular scale" />
            <p className={styles.kicker}>Molecular change in a living system</p>
            <h2>Connect molecular events to the cellular behavior they may influence.</h2>
            <p className={styles.copy}>A biological observation rarely exists alone. Proteins interact, signals move through cellular contexts, and perturbations may propagate through several levels of organization before a phenotype becomes visible.</p>
            <div className={styles.transformationLine} aria-label="Biological scale progression">
              <span>Sequence</span><i /><span>Protein</span><i /><span>Cell</span><i /><span>Phenotype</span>
            </div>
          </div>
        </section>

        <section id="biological-system" className={`${styles.chapter} ${styles.systemChapter}`} data-bi-stage="system-scale">
          <div className={`${styles.content} ${styles.contentRight} ${styles.contentNarrow}`}>
            <StageMarker index="04" label="Pathway / System scale" />
            <p className={styles.kicker}>Evidence → Relationships → Mechanism → Hypothesis</p>
            <h2>Understand how findings may converge across an interacting biological system.</h2>
            <p className={styles.copy}>Genes, proteins, pathways, phenotypes, and experiments become an evidence-linked system. Relationships can support a mechanism, contradict it, or reveal where the evidence remains too incomplete to decide.</p>
            <div className={styles.systemLegend} aria-label="Biological relationship types">
              {[[Dna, "Genes"], [Atom, "Proteins"], [Workflow, "Pathways"], [Microscope, "Findings"]].map(([Icon, label]) => (
                <span key={String(label)}><Icon aria-hidden="true" />{String(label)}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="biological-intelligence" className={`${styles.chapter} ${styles.intelligenceChapter}`} data-bi-stage="intelligence-layer">
          <div className={styles.wideContent}>
            <div className={styles.sectionIntro}>
              <StageMarker index="05" label="Intelligence layer" />
              <p className={styles.kicker}>Structured, inspectable research intelligence</p>
              <h2>Turn biological evidence into clearer mechanisms, hypotheses, gaps, and research priorities.</h2>
              <p>Vaeroex is not merely visualizing biological structures. Biological Intelligence is being designed to organize what the evidence supports, preserve what it does not establish, and help researchers determine what deserves investigation next.</p>
            </div>
            <div className={styles.intelligenceSignals} aria-label="Illustrative Biological Intelligence findings">
              {[
                "MECHANISM IDENTIFIED",
                "CONFLICTING EVIDENCE",
                "EVIDENCE GAP",
                "HYPOTHESIS STRENGTH",
                "EXPERIMENTAL SUPPORT",
                "NEXT INVESTIGATION"
              ].map((signal, index) => <span key={signal} data-signal={index + 1}>{signal}</span>)}
            </div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.capabilitiesChapter}`} data-bi-stage="capability-field">
          <div className={styles.wideContent}>
            <div className={styles.sectionIntro}>
              <StageMarker index="06" label="Product capabilities" />
              <p className={styles.kicker}>One biological research environment</p>
              <h2>Follow the evidence across biological scale without losing its origin or uncertainty.</h2>
            </div>
            <div className={styles.capabilityGrid}>
              {capabilities.map(({ title, body, icon: Icon }, index) => (
                <article key={title} className={styles.capability}>
                  <span>0{index + 1}</span>
                  <Icon aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.analysisChapter}`} data-bi-stage="analysis-experience">
          <div className={styles.analysisLayout}>
            <div>
              <StageMarker index="07" label="Example intelligence" />
              <p className={styles.kicker}>From evidence toward the next question</p>
              <h2>Preserve the mechanism, the contradiction, and the missing measurement.</h2>
              <p className={styles.copy}>An intelligence view can bring related findings into one inspectable research context without presenting an illustrative mechanism as established scientific truth.</p>
            </div>
            <BiologicalSystemAnalysis />
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.useCaseChapter}`} data-bi-stage="research-priorities">
          <div className={styles.wideContent}>
            <div className={styles.sectionIntro}>
              <StageMarker index="08" label="Research applications" />
              <p className={styles.kicker}>Built around serious biological questions</p>
              <h2>Support the teams investigating complex biological systems.</h2>
            </div>
            <div className={styles.applicationGrid}>
              {applications.map(([title, body]) => <article key={title}><h3>{title}</h3><p>{body}</p></article>)}
            </div>
            <div className={styles.audienceRail} aria-label="Biological Intelligence research audiences">
              {audiences.map((audience) => <span key={audience}>{audience}</span>)}
            </div>
          </div>
        </section>

        <section id="biological-rigor" className={`${styles.chapter} ${styles.rigorChapter}`} data-bi-stage="evidence-rigor">
          <div className={styles.wideContent}>
            <div className={styles.sectionIntro}>
              <StageMarker index="09" label="Research trust" />
              <p className={styles.kicker}>Built for evidence, not confident guessing</p>
              <h2>Biology is complex, incomplete, and often contradictory. The intelligence layer should preserve that reality.</h2>
              <p>Biological Intelligence is being designed to separate observation from interpretation, surface competing evidence, and make uncertainty visible instead of hiding it behind a single generated answer.</p>
            </div>
            <div className={styles.rigorGrid}>
              {rigorPrinciples.map(({ title, body, icon: Icon }) => (
                <article key={title}><Icon aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.boundaryChapter}`} data-bi-stage="research-boundary">
          <div className={`${styles.content} ${styles.contentLeft} ${styles.contentNarrow}`}>
            <StageMarker index="10" label="Research-only boundary" />
            <p className={styles.kicker}>Scientific research and research decision-support</p>
            <h2>Support investigation without pretending to replace scientific or clinical judgment.</h2>
            <p className={styles.copy}>Biological Intelligence is being developed for scientific research and research decision-support. It is not intended to provide medical diagnosis, patient-specific treatment recommendations, or autonomous clinical decision-making.</p>
            <div className={styles.boundaryStatement}><ShieldCheck aria-hidden="true" /><span>Human researchers remain responsible for scientific interpretation, experimental validation, and consequential decisions.</span></div>
          </div>
        </section>

        <section className={`${styles.chapter} ${styles.closingChapter}`} data-bi-stage="evidence-close">
          <div className={styles.closingContent}>
            <Sparkles aria-hidden="true" />
            <p className={styles.kicker}>VAEROEX INTELLIGENCE SYSTEM</p>
            <h2>{system.name}</h2>
            <p>Biological Intelligence is being developed as a specialized environment within the broader Vaeroex Intelligence Systems identity.</p>
            <p>We are building a research environment designed to connect biological evidence, mechanisms, hypotheses, uncertainty, and experimental direction within one intelligence system.</p>
            <AvailabilityStatus />
          </div>
        </section>
      </div>

      <PublicFooter />
    </main>
  );
}
