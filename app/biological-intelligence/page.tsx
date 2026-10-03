import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ClarityJourney } from "@/components/marketing/clarity/ClarityJourney";
import { BIOLOGICAL_INTELLIGENCE_SYSTEM } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Biological Intelligence | Vaeroex",
  description:
    "Explore Vaeroex Biological Intelligence, a research environment in development for connecting genomic, molecular, cellular, experimental, and scientific evidence.",
  path: "/biological-intelligence",
});

const capabilities = [
  [
    "Biological evidence synthesis",
    "Bring experimental results, biological datasets, scientific literature, and internal research into a structured evidence view.",
  ],
  [
    "Mechanism discovery",
    "Investigate relationships between genes, proteins, pathways, cellular behavior, and observations that may help explain a biological phenomenon.",
  ],
  [
    "Hypothesis intelligence",
    "Organize competing hypotheses, supporting and contradictory evidence, assumptions, and unresolved questions.",
  ],
  [
    "Genomic intelligence",
    "Evaluate sequences, variation, genomic regions, and related experimental evidence within broader biological context.",
  ],
  [
    "Protein intelligence",
    "Connect protein sequence, structure, function, interactions, experimental observations, and supporting research.",
  ],
  [
    "Pathway intelligence",
    "Understand how findings may converge across pathways and interacting systems while retaining the origin of each signal.",
  ],
  [
    "Experiment intelligence",
    "Connect historical experiments with new findings. Identify what has been tested and what remains unresolved.",
  ],
  [
    "Knowledge gap detection",
    "Surface missing measurements, insufficient evidence, contradictions, and unknowns that affect interpretation.",
  ],
  [
    "Research prioritization",
    "Help researchers identify signals, hypotheses, or experiments that may deserve further investigation.",
  ],
] as const;

const biologicalJourney = [
  {
    label: "Sequence & context",
    title: "A signal is the beginning of a question.",
    description:
      "The intended environment connects genomic, molecular, cellular, experimental, and scientific evidence. Begin with variation, regulatory context, expression, and relevant observations. Evaluate consequence instead of assuming it.",
    detail: "Planned research direction · Genomic context · Observations",
  },
  {
    label: "Structure & system",
    title: "Follow relationships across scale.",
    description:
      "Consider proteins, pathways, and cellular behavior as related sources of evidence while preserving their distinct meanings. A possible mechanism remains a hypothesis until the evidence supports it.",
    detail:
      "Planned research direction · Protein · Pathway · Cellular behavior",
  },
  {
    label: "Hypothesis & investigation",
    title: "Keep the unresolved question visible.",
    description:
      "Bring support, contradiction, and missing measurements into view before choosing the next research direction. Researchers assess what has been tested, what remains uncertain, and which investigation could add useful evidence.",
    detail: "Planned research direction · Contradictions · Evidence gaps",
  },
];

function BiologicalDiagram() {
  return (
    <figure className={styles.researchVisual}>
      <svg
        viewBox="0 0 420 420"
        role="img"
        aria-labelledby="biological-diagram-title biological-diagram-desc"
      >
        <title id="biological-diagram-title">
          Conceptual biological evidence map
        </title>
        <desc id="biological-diagram-desc">
          Genomic, protein, and experimental observations connect around a
          proposed mechanism, with an unresolved evidence gap remaining visible.
        </desc>
        <defs>
          <pattern
            id="biological-grid"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M28 0H0V28"
              fill="none"
              stroke="#263044"
              strokeWidth=".5"
            />
          </pattern>
        </defs>
        <rect
          width="420"
          height="420"
          fill="url(#biological-grid)"
          opacity=".65"
        />
        <g fill="none" stroke="#293c62">
          <ellipse cx="210" cy="210" rx="144" ry="144" />
          <ellipse cx="210" cy="210" rx="99" ry="99" strokeDasharray="2 6" />
          <path d="M30 210H390M210 30V390" />
        </g>
        <g fill="none" stroke="#738bd9" strokeWidth="1.2">
          <path d="M210 70L210 184M73 262L187 223M348 262L232 223M103 110L190 191" />
          <path d="M210 237V348" strokeDasharray="4 6" />
        </g>
        <g fill="#0e182b" stroke="#6684e5">
          <path d="M210 178L238 194V226L210 242L182 226V194Z" />
          <circle cx="210" cy="70" r="13" />
          <circle cx="73" cy="262" r="13" />
          <circle cx="348" cy="262" r="13" />
          <circle cx="103" cy="110" r="7" />
        </g>
        <circle cx="210" cy="210" r="7" fill="#8da6ff" />
        <circle
          cx="210"
          cy="348"
          r="16"
          fill="#0d1119"
          stroke="#a0abc2"
          strokeDasharray="3 4"
        />
        <g
          fill="#b7c4e3"
          fontFamily="monospace"
          fontSize="9"
          textAnchor="middle"
          letterSpacing="1"
        >
          <text x="210" y="42">
            GENOMIC CONTEXT
          </text>
          <text x="70" y="295">
            PROTEIN
          </text>
          <text x="345" y="295">
            EXPERIMENT
          </text>
          <text x="210" y="270">
            PROPOSED MECHANISM
          </text>
          <text x="210" y="386">
            EVIDENCE GAP
          </text>
        </g>
        <text
          x="210"
          y="353"
          fill="#c0cadf"
          fontFamily="monospace"
          fontSize="14"
          textAnchor="middle"
        >
          ?
        </text>
      </svg>
      <figcaption>
        Conceptual evidence map · Not an established biological finding
      </figcaption>
    </figure>
  );
}

export default function BiologicalIntelligencePage() {
  const system = BIOLOGICAL_INTELLIGENCE_SYSTEM;
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <section className={styles.hero}>
        <div className={`${styles.container} ${styles.researchHero}`}>
          <div>
            <p className={styles.eyebrow}>{system.name}</p>
            <h1>
              The system
              <br />
              behind <em>the signal.</em>
            </h1>
            <p className={styles.heroLead}>
              A research environment being developed to connect biological
              evidence, explore mechanisms, evaluate hypotheses, and identify
              what deserves investigation next.
            </p>
            <p>
              Research intelligence for complex biological systems. This
              environment is not currently available for purchase or
              subscription activation.
            </p>
            <div className={styles.actions}>
              <span className={`${styles.status} ${styles.development}`}>
                {system.statusLabel}
              </span>
              <a href="#biological-capabilities" className={styles.textLink}>
                Explore the direction
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
          <BiologicalDiagram />
        </div>
      </section>

      <ClarityJourney
        id="biological-context"
        variant="research"
        compact
        stages={biologicalJourney}
      />

      <section id="biological-capabilities" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>02</span>Planned capabilities
              </p>
              <h2>
                Follow the evidence.
                <br />
                Preserve the uncertainty.
              </h2>
            </div>
            <p className={styles.copy}>
              The following describes the intended research direction of
              Biological Intelligence, which remains in development.
            </p>
          </div>
          <div className={styles.researchGrid}>
            {capabilities.map(([title, body], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="biological-rigor" className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>
              <span>03</span>Scientific rigor
            </p>
            <h2>
              Keep the contradiction
              <br />
              in the picture.
            </h2>
            <p className={styles.copy}>
              Biology can be incomplete, complex, and contradictory. Biological
              Intelligence is being designed to preserve that reality, with
              source attribution, experimental provenance, and visible evidence
              limits.
            </p>
          </div>
          <div>
            <p className={styles.sectionLabel}>
              An illustrative research question
            </p>
            <h3 className={styles.exampleHeading}>
              A proposed mechanism connects a gene, a protein, and a pathway.
              But the protein&apos;s activity has not been measured.
            </h3>
            <p className={styles.copy}>
              A useful research view would preserve the supporting observations,
              make that missing measurement explicit, and help a researcher
              consider whether a follow-up experiment could reduce the
              uncertainty.
            </p>
            <p className={styles.caption}>
              Conceptual example only. This is not an established finding,
              product result, or scientific claim.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>
              <span>04</span>Intended research audiences
            </p>
            <h2>
              For teams asking
              <br />
              complex biological questions.
            </h2>
            <ul className={styles.list}>
              <li>Biotechnology and pharmaceutical research teams</li>
              <li>Academic research laboratories</li>
              <li>Genomics and molecular biology teams</li>
              <li>Synthetic biology and protein engineering researchers</li>
              <li>Translational and life-sciences R&amp;D organizations</li>
            </ul>
          </div>
          <div>
            <p className={styles.sectionLabel}>Research-only boundary</p>
            <h2>
              Support investigation.
              <br />
              Respect human judgment.
            </h2>
            <p className={styles.copy}>
              Biological Intelligence is being developed for scientific research
              and research decision-support. It is not intended for medical
              diagnosis, patient-specific treatment recommendations, or
              autonomous clinical decision-making. Researchers remain
              responsible for interpretation, experimental validation, and
              consequential decisions.
            </p>
            <div className={styles.note}>
              Do not submit patient data, PHI, ePHI, medical record numbers,
              insurance IDs, or other regulated healthcare data.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.closing}>
        <div className={`${styles.container} ${styles.closingLayout}`}>
          <div>
            <p className={styles.sectionLabel}>
              A specialized Vaeroex intelligence environment
            </p>
            <h2>{system.name}</h2>
            <p className={styles.copy}>
              In development. {system.pricing.display}. Explore the wider
              Vaeroex intelligence direction and the Executive Intelligence
              environment available today.
            </p>
          </div>
          <div className={styles.actions}>
            <Link href="/intelligence-systems" className={styles.secondary}>
              Explore Intelligence Systems
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
