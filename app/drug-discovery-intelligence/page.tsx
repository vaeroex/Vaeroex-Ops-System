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
    label: "Target & constraints",
    title: "Every iteration adds context.",
    description:
      "The planned workflow begins with researcher-defined constraints, target preparation, and supported computational approaches. Inputs and parameters give each experiment an inspectable starting point.",
    detail:
      "Planned workflow · Target context · Researcher-defined constraints",
  },
  {
    label: "Candidates & evidence",
    title: "Compare and investigate.",
    description:
      "Evaluate candidates, predicted interactions, and explicit filter outcomes while retaining the evidence behind them. Candidate branches and comparisons are intended to remain part of a connected research history.",
    detail: "Planned workflow · Candidate comparison · Evidence retained",
  },
  {
    label: "Researcher review",
    title: "Review and validate.",
    description:
      "Keep researcher review in the workflow. Add laboratory findings as new evidence, including results that contradict earlier predictions. Each iteration adds context for the next research decision.",
    detail: "Planned workflow · Laboratory validation · Visible disagreement",
  },
];

function DiscoveryDiagram() {
  return (
    <figure className={styles.researchVisual}>
      <svg
        viewBox="0 0 420 420"
        role="img"
        aria-labelledby="discovery-diagram-title discovery-diagram-desc"
      >
        <title id="discovery-diagram-title">
          Conceptual discovery evidence path
        </title>
        <desc id="discovery-diagram-desc">
          A research target branches into candidate paths. Supporting and
          conflicting evidence are retained before researcher review.
        </desc>
        <defs>
          <pattern
            id="discovery-grid"
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
          fill="url(#discovery-grid)"
          opacity=".65"
        />
        <g fill="none" stroke="#657392" strokeWidth="1">
          <path d="M210 73V108M210 108H70V160M210 108H350V160M210 108V160M70 208V261H210M350 208V261H210M210 208V327" />
          <path d="M70 184H160M350 184H260" strokeDasharray="3 6" />
        </g>
        <g fill="#121a2a" stroke="#597bff">
          <path d="M178 23H242V73H178Z" />
          <path d="M47 160H93V208H47Z" />
          <path d="M187 160H233V208H187Z" />
          <path d="M327 160H373V208H327Z" />
        </g>
        <path d="M198 35L220 48L198 61Z" fill="#90a4ff" />
        <g
          fill="#bac7e9"
          fontFamily="monospace"
          fontSize="12"
          textAnchor="middle"
        >
          <text x="70" y="189">
            A
          </text>
          <text x="210" y="189">
            B
          </text>
          <text x="350" y="189">
            C
          </text>
        </g>
        <path d="M198 250L210 238L222 250L210 262Z" fill="#6e87ec" />
        <rect
          x="125"
          y="327"
          width="170"
          height="49"
          fill="#26395f"
          stroke="#6e87ec"
        />
        <g
          fill="#b2c0de"
          fontFamily="monospace"
          fontSize="10"
          textAnchor="middle"
          letterSpacing="1.2"
        >
          <text x="210" y="96">
            RESEARCH TARGET
          </text>
          <text x="210" y="141">
            CANDIDATE PATHS
          </text>
          <text x="210" y="292">
            EVIDENCE RETAINED
          </text>
          <text x="210" y="356">
            RESEARCHER REVIEW
          </text>
        </g>
        <g fill="#7185b0">
          <circle cx="70" cy="261" r="3" />
          <circle cx="350" cy="261" r="3" />
        </g>
      </svg>
      <figcaption>
        Conceptual workflow illustration · Planned research direction
      </figcaption>
    </figure>
  );
}

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
          <DiscoveryDiagram />
        </div>
      </section>

      <ClarityJourney
        id="discovery-continuity"
        variant="research"
        compact
        stages={discoveryJourney}
      />

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
