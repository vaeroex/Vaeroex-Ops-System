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
    label: "A cellular environment",
    title: "Begin with the living system.",
    description:
      "Approach a community of cells, each shaped by membranes, internal structures, and its surrounding environment. This generic eukaryotic cell is an authored scientific illustration, with scale and timing composed for clarity.",
    detail: "Conceptual cellular environment · Not to scale",
  },
  {
    label: "The membrane",
    title: "Cross a selective boundary.",
    description:
      "A cutaway opens the membrane, revealing a phospholipid bilayer and embedded protein forms. The camera follows the boundary inward, connecting the cell’s exterior with the organization beneath it.",
    detail: "Illustrative membrane · Lipid bilayer · Embedded proteins",
  },
  {
    label: "The interior",
    title: "Discover an organized world.",
    description:
      "A nucleus, folded membranes, mitochondria, vesicles, and structural filaments emerge in a coherent interior. Their arrangement illustrates cellular organization without claiming a measured cell or a specific biological state.",
    detail: "Nucleus · Endoplasmic reticulum · Golgi · Mitochondria",
  },
  {
    label: "Protein-scale detail",
    title: "Follow a possible connection.",
    description:
      "Move toward a membrane-spanning protein and an illustrative intracellular relay. Coordinated motion connects scales; these generic forms and signals do not represent an established pathway or a simulated mechanism.",
    detail: "Generic receptor · Conceptual process · No validated mechanism",
  },
  {
    label: "Biological intelligence",
    title: "Reconnect the wider picture.",
    description:
      "Pull back from molecular detail to the cell and its neighbors. Vaeroex is being developed to connect evidence across these scales—preserving supporting observations, contradictions, and unanswered questions for researchers.",
    detail: "In development · Connected evidence · Researcher interpretation",
  },
];

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
          <figure className={styles.researchVisual}>
            {/* A still from this page’s actual interactive geometry. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/science/biology-poster.webp"
              alt="Conceptual eukaryotic cell with membrane detail and organized internal structures"
              width="680"
              height="680"
            />
            <figcaption>
              Generic eukaryotic cell · Conceptual illustration · Not to scale
            </figcaption>
          </figure>
        </div>
      </section>

      <ClarityJourney
        id="biological-context"
        variant="biology"
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
