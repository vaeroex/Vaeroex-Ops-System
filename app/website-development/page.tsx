import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import {
  ProjectProcess,
  ProjectPricing,
  ProjectCta,
} from "@/components/marketing/ProjectSections";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/Solutions.module.css";
export const metadata: Metadata = publicPageMetadata({
  title: "Website Development & Enhancement | Vaeroex",
  description:
    "Build a new business website or improve an existing one, with mobile usability, contact forms, supported integrations, and agreed maintenance.",
  path: "/website-development",
});
export default function ServicePage() {
  return (
    <main className={`vaeroex-public-site ${styles.site}`}>
      <PublicSiteHeader />
      <section className={styles.hero} data-offering="websites">
        <div className={styles.container}>
          <p className={styles.eyebrow}>
            Website Development &amp; Enhancement
          </p>
          <h1>
            A website that fits <span>your business.</span>
          </h1>
          <p className={styles.lead}>
            Give visitors a clear way to understand your business and take the
            next step. Build a new website or improve the one you have, with
            practical connections to the way your team works.
          </p>
          <div className={styles.actions}>
            <Link
              href="/contact?inquiry=website-development"
              className="vx-button vx-button--primary"
            >
              Discuss Your Website
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Two starting points</p>
          <h2>New foundation or a thoughtful update.</h2>
          <div className={styles.two}>
            <article className={styles.card} data-kind="websites">
              <span className={styles.eyebrow}>01 / Start fresh</span>
              <h3>Build a new website</h3>
              <p>
                Business websites and landing pages with a clear structure,
                readable content, mobile layouts, and a straightforward path to
                contact your team.
              </p>
            </article>
            <article className={styles.card} data-kind="systems">
              <span className={styles.eyebrow}>02 / Build on what exists</span>
              <h3>Improve an existing website</h3>
              <p>
                Redesign pages, simplify navigation, improve mobile usability,
                and refine forms or integrations while retaining the parts that
                work for your business.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.eyebrow}>Beyond the page</p>
            <h2>
              Help visitors connect.
              <br />
              Help your team respond.
            </h2>
            <p className={styles.copy}>
              The scope starts with what visitors need to do and how your team
              handles the next step. Existing platform constraints and
              integration feasibility are reviewed during discovery.
            </p>
          </div>
          <ul className={styles.list}>
            <li>
              <strong>Contact and lead capture</strong>Approachable contact
              forms, useful inquiry details, and clear submission feedback.
            </li>
            <li>
              <strong>Booking integrations</strong>Connect supported booking
              tools so visitors can find the right next step.
            </li>
            <li>
              <strong>Business-tool connections</strong>Connections to supported
              business tools or custom systems where appropriate.
            </li>
            <li>
              <strong>Maintenance and updates</strong>Agreed upkeep and updates
              under a scoped monthly plan.
            </li>
          </ul>
        </div>
      </section>
      <ProjectProcess />
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.eyebrow}>Project pricing</p>
            <h2>
              Plan the build.
              <br />
              Plan the upkeep.
            </h2>
            <p className={styles.copy}>
              Development and maintenance are scoped for your project. An
              individual written project agreement defines hosting, third-party
              costs, and additional development before work begins.
            </p>
          </div>
          <ProjectPricing website />
        </div>
      </section>
      <ProjectCta website />
      <PublicFooter />
    </main>
  );
}
