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
  title: "Custom Business Systems | Vaeroex",
  description:
    "Commission software tailored to your operations, portals, reporting, integrations, and AI-assisted workflows. Scope and pricing are agreed through discovery.",
  path: "/custom-business-systems",
});
export default function ServicePage() {
  return (
    <main className={`vaeroex-public-site ${styles.site}`}>
      <PublicSiteHeader />
      <section className={styles.hero} data-offering="systems">
        <div className={styles.container}>
          <p className={styles.eyebrow}>Custom Business Systems</p>
          <h1>
            Built for the way <span>your business works.</span>
          </h1>
          <p className={styles.lead}>
            When spreadsheets, email, and separate tools make a workflow hard to
            manage, a custom system can give it a clear home. Vaeroex builds
            software around the people, information, and steps involved.
          </p>
          <div className={styles.actions}>
            <Link
              href="/contact?inquiry=custom-business-systems"
              className="vx-button vx-button--primary"
            >
              Discuss Your Project
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.eyebrow}>Start with a specific problem</p>
            <h2>What does your team keep working around?</h2>
            <p className={styles.copy}>
              A shared inbox that loses requests. Equipment with no clear
              checkout record. Customers asking for updates that live in several
              places. Start with the workflow you want to improve.
            </p>
            <p className={styles.copy}>
              These are illustrative capabilities, subject to discovery and
              feasibility. The proposal defines what will be built and which
              tools can be connected.
            </p>
          </div>
          <ul className={styles.list}>
            <li>
              <strong>Internal operations</strong>Equipment checkout, inventory
              tracking, task management, and request tracking.
            </li>
            <li>
              <strong>Customer and employee portals</strong>Documents, requests,
              status updates, and access permissions appropriate to each role.
            </li>
            <li>
              <strong>Dashboards and reporting</strong>Centralized metrics and
              automated reports based on agreed data sources.
            </li>
            <li>
              <strong>Integrations and automation</strong>Connect supported
              tools and reduce repetitive data entry.
            </li>
            <li>
              <strong>AI-powered systems</strong>Company document search,
              internal assistants, and AI-assisted workflows with review where
              appropriate.
            </li>
          </ul>
        </div>
      </section>
      <ProjectProcess />
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.eyebrow}>Development &amp; ongoing care</p>
            <h2>
              A defined scope.
              <br />A clear proposal.
            </h2>
            <p className={styles.copy}>
              We establish the users, workflows, integrations, and support needs
              before quoting the work. An individual written project agreement
              defines the development fee, payment schedule, and maintenance scope.
            </p>
          </div>
          <ProjectPricing />
        </div>
      </section>
      <ProjectCta />
      <PublicFooter />
    </main>
  );
}
