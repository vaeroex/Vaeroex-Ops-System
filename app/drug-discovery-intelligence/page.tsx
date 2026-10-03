import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ClarityJourney } from "@/components/marketing/clarity/ClarityJourney";
import { DRUG_DISCOVERY_INTELLIGENCE_SYSTEM } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Drug Discovery Intelligence | Vaeroex",
  description:
    "Explore the research direction of Vaeroex Drug Discovery Intelligence, an environment in development for traceable computational discovery, candidate comparison, and research evidence.",
  path: "/drug-discovery-intelligence",
});

const scientificCapabilities = [
  [
    "Protein structure",
    "Explore predicted three-dimensional biological structures and prepare targets for downstream computational analysis.",
  ],
  [
    "Molecular generation",
    "Explore candidate molecular structures under researcher-defined constraints.",
  ],
  [
    "Molecular docking",
    "Evaluate predicted interactions and binding configurations between candidate molecules and biological targets.",
  ],
  [
    "Protein & binder design",
    "Explore computational protein and binder designs across structured experimental workflows.",
  ],
  [
    "Candidate intelligence",
    "Compare computational and experimental evidence, apply explicit requirements, surface conflicts, and prioritize directions for further research.",
  ],
] as const;

const researchPrinciples = [
  [
    "Evidence lineage",
    "Keep the origin of structures, scores, predictions, measurements, and interpretations available for inspection.",
  ],
  [
    "Explicit comparison",
    "Evaluate candidates against project requirements and compare results across multiple computational and experimental dimensions.",
  ],
  [
    "Preserved experiment history",
    "Connect inputs, parameters, runs, outcomes, candidate relationships, and researcher decisions over time.",
  ],
  [
    "Visible disagreement",
    "Surface conflicts between computational predictions and laboratory observations. Generated reasoning does not become experimental fact.",
  ],
] as const;

const discoveryJourney = [
  {
    label: "The molecular landscape",
    title: "Enter the structure.",
    description:
      "A folded protein becomes a landscape of ribbons, cavities, and molecular surfaces. Travel into human carbonic anhydrase I, using coordinates from the experimentally determined 1AZM structure.",
    detail: "Structural reference · PDB 1AZM · X-ray crystallography, 2.00 Å",
  },
  {
    label: "The binding pocket",
    title: "Find the relevant detail.",
    description:
      "The backbone gives way to an atom-derived surface, opening a view toward the zinc-containing pocket. Changing representations makes the same structural evidence easier to inspect.",
    detail:
      "Illustrative surface · Backbone and pocket share deposited coordinates",
  },
  {
    label: "Candidate chemistry",
    title: "Explore the differences.",
    description:
      "Acetazolamide, methazolamide, and ethoxzolamide enter as connected molecular structures. Their distinct rings and substituents provide a concrete starting point for comparison.",
    detail: "Reference structures · AZM / MZM / EZL · No ranking implied",
  },
  {
    label: "An illustrative interaction",
    title: "Bring target and compound together.",
    description:
      "Acetazolamide approaches, aligns, and settles into the position observed in the deposited complex. The approach is authored choreography; it is not a docking calculation, simulation, or demonstration of therapeutic effect.",
    detail: "Observed endpoint · Conceptual approach · No interaction scores",
  },
  {
    label: "Research intelligence",
    title: "Keep the evidence connected.",
    description:
      "Candidates separate for comparison. Vaeroex’s planned research environment connects structural references, computational experiments, conflicting findings, and researcher decisions—so every next step has an inspectable basis.",
    detail: "In development · Planned workflow · Scientific review required",
  },
];

export default function DrugDiscoveryIntelligencePage() {
  const system = DRUG_DISCOVERY_INTELLIGENCE_SYSTEM;
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <section className={styles.hero}>
        <div className={`${styles.container} ${styles.researchHero}`}>
          <div>
            <p className={styles.eyebrow}>{system.name}</p>
            <h1>
              Discovery, with
              <br />
              its <em>evidence intact.</em>
            </h1>
            <p className={styles.heroLead}>
              A research environment being developed to connect targets,
              candidates, computational experiments, and the evidence behind
              each decision.
            </p>
            <p>
              Explore a planned approach to traceable discovery. This
              environment is not currently available for purchase or
              subscription activation.
            </p>
            <div className={styles.actions}>
              <span className={`${styles.status} ${styles.development}`}>
                {system.statusLabel}
              </span>
              <a href="#discovery-capabilities" className={styles.textLink}>
                Explore the direction
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
          <figure className={styles.researchVisual}>
            {/* A still from this page’s actual interactive geometry. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/science/drug-discovery-poster.webp"
              alt="Carbonic anhydrase I structure with a folded protein backbone"
              width="680"
              height="680"
            />
            <figcaption>
              PDB 1AZM · Carbonic anhydrase I · Conceptual molecular journey
            </figcaption>
          </figure>
        </div>
      </section>

      <ClarityJourney
        id="discovery-continuity"
        variant="drug-discovery"
        compact
        stages={discoveryJourney}
      />
      <p className={styles.scientificReference}>
        Structural source:{" "}
        <a
          href="https://www.rcsb.org/structure/1AZM"
          target="_blank"
          rel="noreferrer"
        >
          RCSB PDB 1AZM
        </a>{" "}
        and its Chemical Component Dictionary. Molecular surfaces are
        approximations derived from atomic coordinates. Camera paths and
        compound approaches are conceptual illustrations.
      </p>

      <section id="discovery-capabilities" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>02</span>Planned scientific capabilities
              </p>
              <h2>
                From a biological target
                <br />
                to a better research question.
              </h2>
            </div>
            <p className={styles.copy}>
              These capabilities describe the intended product direction.
              Computational outputs still require scientific review and
              experimental validation.
            </p>
          </div>
          <div className={styles.capabilities}>
            {scientificCapabilities.map(([title, body], index) => (
              <article className={styles.capability} key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className={styles.note}>
            A computational prediction is a research input. It is not proof of
            efficacy, safety, or a successful experimental outcome.
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>03</span>Research intelligence
              </p>
              <h2>
                The result matters.
                <br />
                So does its provenance.
              </h2>
            </div>
            <p className={styles.copy}>
              The environment is being designed to preserve the context needed
              to question, compare, and revisit a result.
            </p>
          </div>
          <div className={styles.researchGrid}>
            {researchPrinciples.map(([title, body], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>
              <span>04</span>Research audiences
            </p>
            <h2>
              Built around
              <br />
              discovery teams.
            </h2>
            <p className={styles.copy}>
              The intended environment is for biotechnology companies,
              pharmaceutical R&amp;D teams, contract research organizations, and
              academic research laboratories.
            </p>
          </div>
          <div>
            <p className={styles.sectionLabel}>Research-only boundary</p>
            <h2>
              Researchers remain
              <br />
              responsible.
            </h2>
            <p className={styles.copy}>
              Drug Discovery Intelligence is being developed for scientific
              research and research decision-support. It is not a clinical
              diagnostic system, a source of patient-specific treatment
              recommendations, or a substitute for laboratory validation.
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
