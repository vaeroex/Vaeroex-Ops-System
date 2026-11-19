import Link from "next/link";
import { ProjectPricing } from "@/components/marketing/ProjectSections";
import solutions from "@/components/marketing/Solutions.module.css";
import type { Metadata } from "next";
import { ArrowRight, Check } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import {
  VAEROEX_CONTACT_EMAILS,
  VAEROEX_MAILTO_LINKS,
} from "@/lib/contact/emails";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Product Access & Pricing | Vaeroex",
  description:
    "Explore the free Drug Discovery sample or request private access. Review Executive Intelligence subscription pricing and how Vaeroex quotes custom software.",
  path: "/pricing",
});

const executiveInclusions = [
  "Private business workspace",
  "Business Health and View Analysis",
  "KPIs and performance context",
  "Prioritized Intelligence and Explain Finding",
  "Evidence and trusted business context",
  "Saved Analyses and document analysis",
  "Vaeroex Super Intelligence (VSI)",
  "File uploads, Business Notes, and plug-ins for Square, QuickBooks Online, Zoho Books, and Loyverse",
] as const;

type PricingPageProps = {
  searchParams?: Promise<{ checkout?: string; checkout_error?: string }>;
};

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = await searchParams;
  const checkoutError = params?.checkout_error;
  const checkoutCancelled = params?.checkout === "cancelled";

  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <section className={`${styles.hero} ${styles.pricingHero}`}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>Pricing &amp; availability</p>
          <h1>
            Product access
            <br />
            <em>and pricing.</em>
          </h1>
          <div className={styles.heroGrid}>
            <p className={styles.heroLead}>
              Explore Drug Discovery with public sample compounds, or request a private research walkthrough. Executive Intelligence has a separate monthly subscription.
            </p>
            <div className={styles.heroSide}>
              <strong>Commissioned projects</strong>
              <p>
                Custom software and websites are quoted against an agreed scope and support plan.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        className={styles.sectionTight}
        aria-label="Vaeroex intelligence availability and pricing"
      >
        <div className={styles.container}>
          {checkoutError ? (
            <div role="alert" className={styles.feedback}>
              {checkoutError}
            </div>
          ) : null}
          {checkoutCancelled ? (
            <div role="status" className={styles.feedback}>
              Checkout was cancelled. You can restart when you are ready.
            </div>
          ) : null}
          {PUBLIC_SYSTEMS.map((system) =>
            system.availability === "available" ? (
              <article
                id="intelligence-pricing"
                key={system.id}
                data-pricing-system={system.id}
                className={styles.priceGrid}
              >
                <div className={styles.priceOverview}>
                  <span className={styles.status}>{system.statusLabel}</span>
                  <h2>{system.name}</h2>
                  <p className={styles.priceDescription}>{system.tagline}</p>
                  <p className={styles.price}>{VAEROEX_PLAN_PRICE_LABEL}</p>
                  <p className={styles.pricePeriod}>Monthly subscription</p>
                  <div className={styles.actions}>
                    <StartWithVaeroexMenu
                      className={styles.primary}
                      label="Start Executive Intelligence"
                    />
                  </div>
                  <div className={styles.actions}>
                    <Link href={system.route} className={styles.textLink}>
                      Explore the product
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </div>
                </div>
                <div className={styles.priceInclusions}>
                  <h3>What&apos;s included</h3>
                  <ul>
                    {executiveInclusions.map((item) => (
                      <li key={item}>
                        <Check aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.billingFine}>
                    Each workspace includes 15 GB of uploaded-file storage and 500 file slots.
                    Optional capacity packs are $5/month each for another 10 GB and 500 slots,
                    purchased explicitly in Settings → Usage &amp; Storage. No automatic overage charges.
                  </p>
                  <p className={styles.billingFine}>
                    Renews monthly unless canceled through Manage billing.
                    Cancellation takes effect at the end of the current paid
                    billing period and prevents the next renewal. Payments are
                    final and non-refundable except where required by applicable
                    law.
                  </p>
                </div>
              </article>
            ) : (
              <article key={system.id} data-pricing-system={system.id} className={styles.priceGrid}>
                <div className={styles.priceOverview}>
                  <span className={styles.status}>{system.statusLabel}</span>
                  <h2>{system.name}</h2>
                  <p className={styles.priceDescription}>{system.description}</p>
                  <div className={styles.actions}>
                    <Link href="/drug-discovery-intelligence/demo" className={styles.primary}>Explore sample compounds <ArrowRight aria-hidden="true" /></Link>
                    <Link href="/contact?inquiry=drug-discovery" className={styles.textLink}>{system.pricing.ctaLabel}</Link>
                  </div>
                </div>
                <div className={styles.priceInclusions}>
                  <h3>What you can try</h3>
                  <p className={styles.copy}>The public demo is free and opens without an account. Inspect two published structures, shortlist a compound, and download a sample CSV. Private project access is by invitation. Launch pricing has not been announced.</p>
                </div>
              </article>
            ),
          )}
          <p className={styles.caption}>
            Starting an Executive Intelligence subscription opens the required legal terms before checkout.
          </p>

        </div>
      </section>

      <section className={styles.section}>
        <div className={`${styles.container} ${styles.split}`}>
          <div>
            <p className={styles.sectionLabel}>Subscription details</p>
            <h2>
              Clear terms.
              <br />
              Straight answers.
            </h2>
            <p className={styles.copy}>
              Review the billing policies or contact the Vaeroex team with a
              question before you begin.
            </p>
            <div className={styles.actions}>
              <a
                href={VAEROEX_MAILTO_LINKS.billing}
                className={styles.textLink}
              >
                Billing questions
                <ArrowRight aria-hidden="true" />
              </a>
            </div>
          </div>
          <div>
            <details className={styles.disclosure}>
              <summary>Does the subscription renew automatically?</summary>
              <p>
                Yes. Vaeroex subscriptions renew monthly unless cancellation is
                scheduled through Manage billing. Cancellation prevents the next
                renewal, while access continues through the end of the current
                paid billing period. Review the{" "}
                <Link href="/subscription-billing-terms">
                  Subscription Billing Terms
                </Link>{" "}
                for details.
              </p>
            </details>
            <details className={styles.disclosure}>
              <summary>How are refunds handled?</summary>
              <p>
                Executive Intelligence subscription payments follow the existing <Link href="/subscription-billing-terms">Subscription and Billing Terms</Link> and <Link href="/refund-policy">Refund Policy</Link>. Optional workspace capacity payments follow the <Link href="/workspace-capacity-terms">Workspace Capacity Terms</Link> and applicable Refund Policy provisions. Commissioned-project payment, cancellation, and refund terms are defined in the individual written project agreement.
              </p>
            </details>
            <details className={styles.disclosure}>
              <summary>Can pricing change?</summary>
              <p>
                Your subscription price will not increase while your
                subscription remains continuously active. If Vaeroex lowers the
                applicable subscription price, active subscribers will receive
                the lower price for future renewals. If you cancel and later
                resubscribe, your new subscription will use the pricing
                available when you resubscribe. Price reductions do not provide
                retroactive refunds or credits for billing periods already paid.
              </p>
            </details>
            <details className={styles.disclosure}>
              <summary>Who can help with billing?</summary>
              <p>
                Contact{" "}
                <a href={VAEROEX_MAILTO_LINKS.billing}>
                  {VAEROEX_CONTACT_EMAILS.billing}
                </a>{" "}
                for subscription or payment questions.
              </p>
            </details>
          </div>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="project-pricing"><div className={styles.container}><p className={styles.sectionLabel}>Custom projects</p><h2 id="project-pricing">Development and ongoing support.</h2><p className={styles.copy}>Every project begins with a written agreement defining the scope, pricing, deliverables, and ongoing support. The subscription details above describe Executive Intelligence.</p><div className={solutions.two}><ProjectPricing /><ProjectPricing website showAgreementDetails={false} /></div></div></section>
      <PublicFooter />
    </main>
  );
}
