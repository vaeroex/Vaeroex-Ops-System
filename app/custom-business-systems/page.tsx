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
    "Build a new business system or enhance existing software with custom features, integrations, automation, and AI. Scope and feasibility are defined through discovery.",
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
            Build a new system around the way your business works, or extend the
            software you already use with custom features, integrations,
            automation, and AI. Start with the people, information, and workflow
            you want to support.
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
        <div className={styles.container}>
          <p className={styles.eyebrow}>Two starting points</p>
          <h2>A new system or a better-connected one.</h2>
          <div className={styles.two}>
            <article className={styles.card} data-kind="systems">
              <span className={styles.eyebrow}>01 / Build new</span>
              <h3>Build around your business</h3>
              <p>
                Create internal tools for equipment checkout, inventory, tasks,
                and request management. Give customers or employees a portal for
                documents, status updates, and shared work.
              </p>
            </article>
            <article className={styles.card} data-kind="intelligence">
              <span className={styles.eyebrow}>02 / Extend what works</span>
              <h3>Enhance existing software</h3>
              <p>
                Add missing features, reporting, integrations, automation, or AI
                to the tools your team already uses. Keep the useful parts and
                focus the project on what needs to work better.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Features &amp; connections</p>
          <h2>Already have a system? Build on it.</h2>
          <p className={styles.copy}>
            Extend the software your business already uses with custom features,
            connected workflows, and AI capabilities tailored to your operations.
          </p>
          <div className={styles.two}>
            <ul className={styles.list}>
              <li>
                <strong>AI assistants</strong>Help employees find information,
                draft content, and complete supported tasks using relevant business context.
              </li>
              <li>
                <strong>Document recognition &amp; extraction</strong>Turn scanned
                documents, receipts, and images into searchable text and structured
                information for review.
              </li>
              <li>
                <strong>Company knowledge search</strong>Help teams find answers
                across approved company documents, with references to supporting
                material where available.
              </li>
              <li>
                <strong>Speech &amp; transcription</strong>Convert audio into text,
                summarize conversations, and add voice interactions to supported workflows.
              </li>
            </ul>
            <ul className={styles.list}>
              <li>
                <strong>Image &amp; video analysis</strong>Extract useful information
                from images and video for defined business tasks.
              </li>
              <li>
                <strong>Workflow automation</strong>Connect steps across tools,
                route requests, and reduce repetitive manual work.
              </li>
              <li>
                <strong>Custom integrations</strong>Connect supported software
                and APIs so information can move between systems.
              </li>
              <li>
                <strong>Custom features &amp; dashboards</strong>Add reporting,
                interfaces, and functionality that existing tools are missing.
              </li>
            </ul>
          </div>
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
