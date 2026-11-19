import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { WorkspaceCapture } from "@/components/marketing/WorkspaceScreenshots";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import { DRUG_DISCOVERY_SYSTEM } from "@/lib/marketing/public-systems";
import styles from "@/components/marketing/Solutions.module.css";
export const metadata: Metadata = publicPageMetadata({
  title: "Intelligence Systems | Vaeroex",
  description:
    "Explore Drug Discovery Intelligence for compound review and Executive Intelligence for business evidence, reporting and VSI Chat.",
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
            Choose your workspace.
            <br />
            <span>Inspect the evidence.</span>
          </h1>
          <p className={styles.lead}>
            Research teams review compounds for their next experiment. Business teams use a separate workspace to understand changes in operating performance.
          </p>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="discovery-product">
        <div className={styles.container}>
          <p className={styles.eyebrow}>Flagship research product</p>
          <h2 id="discovery-product">{DRUG_DISCOVERY_SYSTEM.name}</h2>
          <p className={styles.copy}>Inspect a compound on a saved protein chain, check its measured assay against the source, and record why it belongs in a test batch. Approving the batch preserves the decisions and evidence in an exportable snapshot.</p>
          <div className={styles.actions}>
            <Link href="/drug-discovery-intelligence/demo" className="vx-button vx-button--primary">Explore sample compounds <ArrowUpRight size={17} aria-hidden="true" /></Link>
            <Link href="/drug-discovery-intelligence" className="vx-text-link">Explore the private workflow</Link>
          </div>
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
              and their evidence, and work through questions with VSI Chat, the conversational interface for Vaeroex Super Intelligence.
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
      <PublicFooter />
    </main>
  );
}
