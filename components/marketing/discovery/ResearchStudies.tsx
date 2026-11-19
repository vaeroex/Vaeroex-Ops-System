import { ArrowUpRight } from "lucide-react";
import { researchStudies } from "@/lib/marketing/discovery-evidence";
import styles from "./Discovery.module.css";

export function ResearchStudies() {
  return (
    <div className={styles.studies}>
      {researchStudies.map((study) => (
        <article key={study.url}>
          <p className={styles.source}>{study.citation}</p>
          <h3>{study.heading}</h3>
          <p>{study.text}</p>
          <a aria-label={`Read the study by ${study.citation}`} href={study.url} className="vx-text-link">Read the study <ArrowUpRight aria-hidden="true" size={15} /></a>
          {study.openText && <a href={study.openText} className={styles.openText}>Free full text</a>}
        </article>
      ))}
    </div>
  );
}
