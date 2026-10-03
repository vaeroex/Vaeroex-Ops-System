import type { ReactNode } from "react";
import { ClarityEngine, type JourneyVariant } from "./ClarityEngine";
import styles from "./ClarityJourney.module.css";

type JourneyStage = {
  label: string;
  title: ReactNode;
  description: string;
  detail?: string;
};

/** Real document chapters alongside one persistent, progressively revealed scene. */
export function ClarityJourney({
  id,
  variant,
  stages,
  intro,
  compact = false,
}: {
  id: string;
  variant: JourneyVariant;
  stages: JourneyStage[];
  intro?: ReactNode;
  compact?: boolean;
}) {
  const scientific = variant === "drug-discovery" || variant === "biology";
  return (
    <section
      id={id}
      className={`${styles.journey} ${compact ? styles.shortJourney : ""} ${intro ? styles.withIntro : ""} ${scientific ? styles.scientificJourney : ""}`}
      data-clarity-journey
      data-science-journey={scientific ? variant : undefined}
      aria-label={
        variant === "home"
          ? "From fragmented information to clear decisions"
          : "Explore the intelligence approach"
      }
    >
      <div className={styles.visualTrack}>
        <div className={styles.stickyVisual}>
          <ClarityEngine
            journeyId={id}
            variant={variant}
            chapters={stages.map((stage, index) => ({
              label: stage.label,
              id: `${id}-stage-${index}`,
            }))}
          />
          {scientific ? (
            <p className={styles.scienceNote}>
              {variant === "drug-discovery"
                ? "PDB 1AZM / CARBONIC ANHYDRASE I · CONCEPTUAL CHOREOGRAPHY"
                : "GENERIC EUKARYOTIC CELL · CONCEPTUAL PROCESS / NOT TO SCALE"}
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.contentTrack}>
        {stages.map((stage, index) => (
          <section
            key={stage.label}
            id={`${id}-stage-${index}`}
            data-clarity-chapter={index}
            className={`${styles.chapter} ${index === 0 && intro ? styles.introChapter : ""}`}
            aria-label={stage.label}
          >
            {index === 0 && intro ? (
              intro
            ) : (
              <div className={styles.chapterCopy}>
                <p className={styles.chapterLabel}>
                  <span>0{index + 1}</span> {stage.label}
                </p>
                <h2>{stage.title}</h2>
                <p className={styles.description}>{stage.description}</p>
                {stage.detail ? (
                  <p className={styles.detail}>{stage.detail}</p>
                ) : null}
                <div className={styles.chapterRule} aria-hidden="true">
                  <span />
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
      <div className={styles.baseline}>
        <span>
          {scientific
            ? "VAEROEX / SCIENTIFIC VISUAL STUDY"
            : "THE CLARITY ENGINE / CONCEPTUAL JOURNEY"}
        </span>
        <a href={`#${id}-end`}>
          Continue exploring <span aria-hidden="true">↓</span>
        </a>
      </div>
      <div id={`${id}-end`} className={styles.endAnchor} />
    </section>
  );
}
