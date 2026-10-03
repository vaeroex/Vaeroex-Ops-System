import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ClarityJourney } from "@/components/marketing/clarity/ClarityJourney";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Intelligence Systems | Vaeroex",
  description:
    "Discover how Vaeroex turns complex information into visibility, awareness, prediction, and action across specialized intelligence domains.",
  path: "/intelligence-systems",
});

const intelligencePath = [
  {
    label: "Information",
    title: "A useful relationship with information.",
    description:
      "Begin with the records, observations, and context an environment produces. A number becomes more useful when you can see what surrounds it. Keep the origins and limitations of the evidence visible.",
    detail:
      "A conceptual intelligence path, not a diagram of Vaeroex’s private technical architecture.",
  },
  {
    label: "Visibility",
    title: "A shared standard. Distinct domains.",
    description:
      "Bring important conditions, relationships, and changes into view so they can be examined together. Each intelligence environment is shaped around the evidence, constraints, and expertise its domain requires.",
    detail: "Executive · Drug Discovery · Biological Intelligence",
  },
  {
    label: "Awareness & prediction",
    title: "See a signal in its wider context.",
    description:
      "Understand why a signal may matter and what remains uncertain. Recognize supported patterns and possible outcomes. A possibility stays distinct from an established fact.",
    detail: "Context · Supported patterns · Explicit uncertainty",
  },
  {
    label: "Action",
    title: "Make room for an informed decision.",
    description:
      "Give people a clearer basis for attention, investigation, prioritization, and decisions. A recommendation earns attention when its limits are clear and its supporting evidence can be reviewed.",
    detail: "Review · Prioritization · Human judgment",
  },
];

export default function IntelligenceSystemsPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <section id="intelligence-systems" className={styles.hero}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>The Vaeroex philosophy</p>
          <h1>
            Information is everywhere.
            <br />
            <em>Intelligence is not.</em>
          </h1>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.heroLead}>
                Intelligence connects what you know with what you need to
                understand.
              </p>
              <div className={styles.actions}>
                <a href="#specialized-intelligence" className={styles.primary}>
                  Explore our intelligence areas
                  <ArrowRight aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className={styles.heroSide}>
              <strong>From complexity to a clearer decision.</strong>
              <p>
                Vaeroex Intelligence Systems transforms complex information into
                visibility, awareness, prediction, and action through
                environments shaped around distinct domains.
              </p>
            </div>
          </div>
        </div>
      </section>

      <ClarityJourney
        id="intelligence-path"
        variant="systems"
        compact
        stages={intelligencePath}
      />

      <section id="specialized-intelligence" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.sectionLabel}>
                <span>02</span>One identity. Distinct domains.
              </p>
              <h2>
                Intelligence shaped
                <br />
                by its purpose.
              </h2>
            </div>
            <p className={styles.copy}>
              Different decisions depend on different evidence, constraints, and
              expertise. Each environment respects those differences.
            </p>
          </div>
          {PUBLIC_SYSTEMS.map((system, index) => (
            <article className={styles.systemRow} key={system.id}>
              <span>0{index + 1}</span>
              <div>
                <span
                  className={`${styles.status} ${system.availability === "under_development" ? styles.development : ""}`}
                >
                  {system.statusLabel}
                </span>
                <h3>{system.name}</h3>
              </div>
              <div>
                <p>{system.description}</p>
                <Link href={system.route} className={styles.textLink}>
                  {system.detailCta}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>
              <span>03</span>A consistent standard
            </p>
            <h2>
              Understanding that
              <br />
              can be inspected.
            </h2>
            <p className={styles.copy}>
              Specialization changes the context. It does not change the
              importance of evidence, uncertainty, or human judgment.
            </p>
          </div>
          <ol className={styles.method}>
            <li>
              <span>01</span>
              <div>
                <h3>Preserve the source</h3>
                <p>
                  Keep supporting information available, so important
                  conclusions can be traced and reviewed.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Respect uncertainty</h3>
                <p>
                  Separate established observations from interpretation,
                  possibilities, and unresolved questions.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Support human authority</h3>
                <p>
                  Present drafts and recommendations for confirmation. Leave
                  consequential decisions with the people responsible for them.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className={styles.closing}>
        <div className={`${styles.container} ${styles.closingLayout}`}>
          <div>
            <p className={styles.sectionLabel}>Available today</p>
            <h2>
              Start with a clearer
              <br />
              view of your business.
            </h2>
          </div>
          <div className={styles.actions}>
            <Link href="/executive-intelligence" className={styles.primary}>
              Explore Executive Intelligence
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
