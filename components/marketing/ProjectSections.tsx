import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PROJECT_STEPS } from "@/lib/marketing/solutions";
import styles from "./Solutions.module.css";

export function ProjectProcess() {
  return (
    <section className={styles.section} aria-labelledby="project-process-title">
      <div className={styles.container}>
        <p className={styles.eyebrow}>From a problem to a working solution</p>
        <h2 id="project-process-title">A clear process, together.</h2>
        <ol className={styles.process}>
          {PROJECT_STEPS.map(([title, description], index) => (
            <li key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ProjectPricing({ website = false }: { website?: boolean }) {
  return (
    <div className={styles.projectPrice}>
      <p className={styles.eyebrow}>Quoted per project</p>
      <h3>
        {website
          ? "Website Development & Enhancement"
          : "Custom Business Systems"}
      </h3>
      <p className={styles.copy}>
        A one-time development fee with an upfront deposit, followed by a scoped
        monthly maintenance and support plan.
      </p>
      <p className={styles.copy}>
        Quotes depend on scope, complexity, integrations, expected users, usage,
        and support requirements. Hosting and third-party usage costs are
        specified in the proposal.
      </p>
      <p className={styles.copy}>
        Maintenance covers only the agreed services. New features and
        substantial scope changes are quoted separately. Custom project
        proposals are separate from the Executive Intelligence subscription.
      </p>
      <div className={styles.actions}>
        <Link
          href={
            website
              ? "/contact?inquiry=website-development"
              : "/contact?inquiry=custom-business-systems"
          }
          className="vx-text-link"
        >
          {website ? "Discuss Your Website" : "Discuss Your Project"}
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function ProjectCta({ website = false }: { website?: boolean }) {
  return (
    <section className={styles.closing}>
      <div className={styles.container}>
        <p className={styles.eyebrow}>Start a conversation</p>
        <h2>
          {website
            ? "What should your website do for your business?"
            : "What would make your business easier to run?"}
        </h2>
        <p className={styles.copy}>
          Tell us what you need, what you use today, and where you want to go.
          We’ll start with the problem and explore a practical scope.
        </p>
        <div className={styles.actions}>
          <Link
            href={
              website
                ? "/contact?inquiry=website-development"
                : "/contact?inquiry=custom-business-systems"
            }
            className="vx-button vx-button--primary"
          >
            {website ? "Discuss Your Website" : "Discuss Your Project"}
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
