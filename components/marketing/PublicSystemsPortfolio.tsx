import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import styles from "./PublicSystemsPortfolio.module.css";

const availabilityLabel = {
  available: "Available",
  under_development: "Under development"
} as const;

export function PublicSystemsPortfolio() {
  return (
    <div className={styles.portfolio} aria-label="Vaeroex Intelligence Systems">
      {PUBLIC_SYSTEMS.map((system) => (
        <article
          className={styles.system}
          data-availability={system.availability}
          key={system.id}
          style={{ "--system-accent": system.visual.accent } as React.CSSProperties}
        >
          <p className={styles.relationship}>{system.relationship}</p>
          <h3 className={styles.name}>{system.name}</h3>
          <p className={styles.tagline}>{system.tagline}</p>
          <p className={styles.description}>{system.description}</p>
          <p className={styles.status}>{availabilityLabel[system.availability]}</p>
          <Link className={styles.link} href={system.route}>
            {system.cta}
            <ArrowRight aria-hidden="true" />
          </Link>
        </article>
      ))}
    </div>
  );
}
