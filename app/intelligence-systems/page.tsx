import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { WorkspaceCapture } from "@/components/marketing/WorkspaceScreenshots";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/Solutions.module.css";
export const metadata: Metadata = publicPageMetadata({
  title: "Intelligence Systems | Vaeroex",
  description:
    "Explore Executive Intelligence, available now, and Vaeroex’s planned intelligence products. Business information, evidence, and human judgment.",
  path: "/intelligence-systems",
});
export default function IntelligenceSystemsPage() {
  return (
    <main className={`vaeroex-public-site ${styles.site}`}>
      <PublicSiteHeader />
      <section className={styles.hero}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Intelligence Systems</p>
          <h1>
            Information with context.
            <br />
            <span>Analysis you can examine.</span>
          </h1>
          <p className={styles.lead}>
            Vaeroex develops intelligence products for working with information.
            Start with Executive Intelligence, our available business product.
          </p>
        </div>
      </section>
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <span className={styles.badge}>Available</span>
            <h2>Executive Intelligence</h2>
            <p className={styles.copy}>
              Bring supported business records, uploaded reports, and Business
              Notes into one workspace. Investigate performance, review findings
              and their evidence, and work through questions with Vaeroex Super
              Intelligence (VSI).
            </p>
            <ul className={styles.list}>
              <li>
                Business Health, KPIs, prioritized findings, and Saved Analyses.
              </li>
              <li>
                Supported plug-ins for Square, QuickBooks Online, Zoho Books,
                and Loyverse.
              </li>
              <li>
                Sources, uncertainty, and missing context remain available for
                review.
              </li>
            </ul>
            <p className={styles.price}>{VAEROEX_PLAN_PRICE_LABEL}</p>
            <div className={styles.actions}>
              <Link
                href="/executive-intelligence"
                className="vx-button vx-button--primary"
              >
                Explore Executive Intelligence
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link href="/checkout/legal" className="vx-text-link">
                Get Executive Intelligence
              </Link>
            </div>
          </div>
          <div className={styles.preview}>
            <WorkspaceCapture view="intelligence" />
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Looking ahead</p>
          <h2>Planned intelligence products.</h2>
          <p className={styles.copy}>
            These offerings are planned and are not available to purchase.
            Capabilities and release dates have not been announced.
          </p>
          <div className={styles.two}>
            {["Biological Intelligence", "Drug Discovery Intelligence"].map(
              (name) => (
                <article className={styles.planned} key={name}>
                  <span>Planned</span>
                  <h3>{name}</h3>
                  <p>
                    Future offering. Further details will be shared when
                    available.
                  </p>
                </article>
              ),
            )}
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.eyebrow}>Our approach</p>
            <h2>
              Evidence, uncertainty,
              <br />
              and human judgment.
            </h2>
            <p className={styles.copy}>
              Useful analysis makes its basis and limits clear. People remain
              responsible for reviewing recommendations and deciding what to do
              next.
            </p>
            <div className={styles.actions}>
              <Link href="/trust" className="vx-text-link">
                Explore the Trust Center
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <ul className={styles.list}>
            <li>
              <strong>Keep evidence visible</strong>Connect supported findings
              to the information behind them.
            </li>
            <li>
              <strong>Respect uncertainty</strong>Distinguish observations from
              interpretation and identify missing context.
            </li>
            <li>
              <strong>Preserve human judgment</strong>Review drafts and
              recommendations before acting.
            </li>
          </ul>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
