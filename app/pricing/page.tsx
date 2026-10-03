import Link from "next/link";
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
  title: "Vaeroex Intelligence Pricing",
  description:
    "Executive Intelligence is available through the current Vaeroex subscription. Review pricing, included capabilities, and the availability of our research environments.",
  path: "/pricing",
});

const executiveInclusions = [
  "Private business workspace",
  "Business Health and View Analysis",
  "KPIs and performance context",
  "Prioritized Intelligence and Explain Finding",
  "Evidence and trusted business context",
  "Saved Analyses and document analysis",
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
            A clearer view.
            <br />
            <em>One subscription.</em>
          </h1>
          <div className={styles.heroGrid}>
            <p className={styles.heroLead}>
              Executive Intelligence brings performance, evidence, and what
              deserves attention into one private business workspace.
            </p>
            <div className={styles.heroSide}>
              <strong>For the decisions leadership makes.</strong>
              <p>
                Built for owners, executives, and operations leaders who need to
                connect the information their business already produces.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="intelligence-pricing"
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
                    Renews monthly unless canceled through Manage billing.
                    Cancellation takes effect at the end of the current paid
                    billing period and prevents the next renewal. Payments are
                    final and non-refundable except where required by applicable
                    law.
                  </p>
                </div>
              </article>
            ) : null,
          )}
          <p className={styles.caption}>
            Start with Vaeroex to review the required legal terms before
            checkout.
          </p>
          <div className={styles.futurePrice}>
            {PUBLIC_SYSTEMS.map((system) =>
              system.availability === "under_development" ? (
                <article key={system.id} data-pricing-system={system.id}>
                  <span className={`${styles.status} ${styles.development}`}>
                    {system.statusLabel}
                  </span>
                  <h2>{system.name}</h2>
                  <p>{system.description}</p>
                  <strong className={styles.statusLabel}>
                    {system.pricing.display}
                  </strong>
                  <p className={styles.caption}>
                    This environment is not currently available for purchase or
                    subscription activation.
                  </p>
                  <span className={styles.caption} aria-disabled="true">
                    {system.pricing.ctaLabel}
                  </span>
                  <div>
                    <Link href={system.route} className={styles.textLink}>
                      Explore the research direction
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ) : null,
            )}
          </div>
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
                All purchases and subscription payments are final and
                non-refundable, except where a refund is required by applicable
                law. Cancellation does not provide a prorated refund or credit
                for unused time. Review the{" "}
                <Link href="/refund-policy">Vaeroex Refund Policy</Link> for
                details.
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
      <PublicFooter />
    </main>
  );
}
