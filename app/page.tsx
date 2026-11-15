import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Workflow,
  PanelsTopLeft,
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { WorkspaceCapture } from "@/components/marketing/WorkspaceScreenshots";
import {
  ProjectProcess,
  ProjectCta,
} from "@/components/marketing/ProjectSections";
import { SOLUTIONS } from "@/lib/marketing/solutions";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import { HomeJourney } from "@/components/marketing/journey/HomeJourney";
import journeyStyles from "@/components/marketing/journey/HomeJourney.module.css";
import { VeteranOwned } from "@/components/marketing/VeteranOwned";
import styles from "@/components/marketing/Solutions.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex | Intelligence, Custom Software & Websites",
  description:
    "Explore intelligence products, build custom software and websites, or enhance existing tools with features, integrations, automation, and AI.",
  path: "/",
});
const icons = [ChartNoAxesCombined, Workflow, PanelsTopLeft];
export default function HomePage() {
  return (
    <main className={`vaeroex-public-site ${styles.site}`}>
      <PublicSiteHeader />
      <div id="home-connected-journey" className={journeyStyles.root}>
        <HomeJourney />
        <section id="home-opening" className={`${styles.hero} ${journeyStyles.hero}`}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>
              Intelligence products · Custom software · Websites
            </p>
            <h1>
              Intelligence and software <span>built around your business.</span>
            </h1>
            <p className={styles.lead}>
              Vaeroex develops intelligence products, custom business software,
              and websites. Explore our intelligence systems, bring a new idea to life,
              or enhance the tools you already use with custom features,
              integrations, and AI.
            </p>
            <div className={styles.actions}>
              <Link href="#solutions" className="vx-button vx-button--primary">
                Explore Solutions
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link href="/contact" className="vx-text-link">
                Discuss a Project
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
        <section id="solutions" className={`${styles.section} ${journeyStyles.overview}`}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Three ways to work with Vaeroex</p>
            <h2>Start with what your business needs.</h2>
            <div className={styles.grid}>
              {SOLUTIONS.map((solution, index) => {
                const Icon = icons[index];
                return (
                  <article
                    className={styles.card}
                    data-kind={solution.kind}
                    key={solution.route}
                  >
                    <span className={styles.eyebrow}>{solution.label}</span>
                    <div className={styles.icon}>
                      <Icon size={30} strokeWidth={1.3} aria-hidden="true" />
                    </div>
                    <h3>{solution.name}</h3>
                    <p>{solution.description}</p>
                    <Link
                      href={solution.route}
                      className="vx-text-link"
                      aria-label={`Explore ${solution.name}`}
                    >
                      Explore offering
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </Link>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className={`${styles.section} ${journeyStyles.chapter}`} aria-labelledby="featured-product">
          <div className={`${styles.container} ${styles.split}`}>
            <div>
              <span className={styles.badge}>Available now</span>
              <p className={styles.eyebrow}>
                Featured product / Executive Intelligence
              </p>
              <h2 id="featured-product">
                A clearer view of your business information.
              </h2>
              <p className={styles.copy}>
                Bring supported records, reports, and Business Notes into one
                workspace. Investigate performance, ask follow-up questions with
                VSI, and review the evidence behind supported findings.
              </p>
              <p className={styles.price}>{VAEROEX_PLAN_PRICE_LABEL}</p>
              <div className={styles.actions}>
                <Link href="/executive-intelligence" className="vx-text-link">
                  Explore Executive Intelligence
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
                <Link
                  href="/checkout/legal"
                  className="vx-button vx-button--primary"
                >
                  Get Executive Intelligence
                </Link>
              </div>
              <div className={styles.actions}>
                <Link href="/pricing" className="vx-text-link">
                  Subscription details
                </Link>
              </div>
            </div>
            <div className={styles.preview}>
              <WorkspaceCapture view="intelligence" />
            </div>
          </div>
        </section>
        <section className={`${styles.section} ${journeyStyles.chapter}`}>
          <div className={`${styles.container} ${styles.split}`}>
            <div>
              <p className={styles.eyebrow}>Custom Business Systems</p>
              <h2 id="home-custom">Software for the work between your tools.</h2>
              <p className={styles.copy}>
                Equipment tracked in a spreadsheet. Requests buried in email.
                Reports assembled by hand. Build a new system around your business,
                or enhance the software you already use with custom features,
                integrations, automation, and AI.
              </p>
              <div className={styles.actions}>
                <Link href="/custom-business-systems" className="vx-text-link">
                  Explore Custom Business Systems
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </div>
            </div>
            <ul className={styles.list}>
              <li>
                <strong>Track day-to-day operations</strong>Equipment checkout,
                inventory, tasks, and requests.
              </li>
              <li>
                <strong>Give people a shared place to work</strong>Customer and
                employee portals, dashboards, and reporting.
              </li>
              <li>
                <strong>Connect supported tools</strong>Integrations, automation,
                document search, and AI-assisted workflows with review where
                appropriate.
              </li>
              <li>
                Illustrative capabilities. Scope and feasibility are established
                during discovery.
              </li>
            </ul>
          </div>
        </section>
        <section className={`${styles.section} ${journeyStyles.chapter}`}>
          <div className={`${styles.container} ${styles.split}`}>
            <div>
              <p className={styles.eyebrow}>
                Website Development &amp; Enhancement
              </p>
              <h2 id="home-websites">A useful home for your business online.</h2>
              <p className={styles.copy}>
                Build a new business website or improve an existing one. Make
                information easier to find, help visitors get in touch, and
                connect the site to the tools your team uses.
              </p>
              <div className={styles.actions}>
                <Link href="/website-development" className="vx-text-link">
                  Explore Website Development &amp; Enhancement
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </div>
            </div>
            <ul className={styles.list}>
              <li>
                <strong>Build a new website</strong>Business websites and focused
                landing pages.
              </li>
              <li>
                <strong>Improve an existing website</strong>Custom features,
                AI-assisted inquiries, knowledge search, and connected business tools.
              </li>
              <li>
                <strong>Keep it working</strong>Booking integrations,
                business-tool connections, and scoped maintenance.
              </li>
            </ul>
          </div>
        </section>
        <div className={journeyStyles.process}>
          <ProjectProcess />
        </div>
        <section
          className={`${styles.container} ${journeyStyles.credentials}`}
          aria-label="NVIDIA Inception membership and company credentials"
        >
          <div className={styles.credibility}>
            <div>
              <VeteranOwned />
              <div className={styles.actions}>
                <Link href="/about" className="vx-text-link">
                  Meet Vaeroex
                </Link>
                <Link href="/trust" className="vx-text-link">
                  Trust Center
                </Link>
              </div>
            </div>
            <div>
              <p>Vaeroex is a member of the NVIDIA Inception program.</p>
              <Image
                src="/brand/nvidia-inception-program-badge.svg"
                alt="NVIDIA Inception Program badge"
                width={190}
                height={60}
                unoptimized
              />
              <small>
                © 2025 NVIDIA, the NVIDIA logo, and NVIDIA Inception are
                trademarks and/or registered trademarks of NVIDIA Corporation in
                the U.S. and other countries.
              </small>
            </div>
          </div>
        </section>
        <div id="home-finish" className={journeyStyles.finish}>
          <ProjectCta />
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
