import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Why Vaeroex | From Compound Evidence to an Approved Test Batch",
  description: "See how researchers inspect evidence, record a reason, and preserve the approved batch that another team will test.",
  path: "/about/why-vaeroex",
});

export default function WhyVaeroexPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero eyebrow="Why Vaeroex" title="Hand over a decision the next researcher can trace."
        description="A shortlist is more useful when the next person can see the measurement, structure, and reasoning behind each compound. Drug Discovery Intelligence keeps those pieces together."
        actions={<Link href="/drug-discovery-intelligence/demo" className={styles.primary}>Explore sample compounds <ArrowRight size={17} aria-hidden="true" /></Link>}
      />
      <section className={styles.section}><div className={`${styles.container} ${styles.split}`}>
        <h2>What was measured?</h2>
        <div><p className={styles.copy}>A medicinal chemist can follow an assay value back to its published table and check its unit. A docking confidence score describes a model’s confidence in a placement. Potency and clinical efficacy require independent evidence.</p>
          <Link href="/drug-discovery-intelligence" className={styles.textLink}>See how compound evidence is reviewed</Link></div>
      </div></section>
      <section className={styles.section}><div className={`${styles.container} ${styles.split}`}>
        <h2>Which structure was used?</h2>
        <div><p className={styles.copy}>A structural biologist can reopen the saved protein chain and check the Protein Data Bank accession, revision, and file checksum. A predicted placement can be overlaid on a reference only when their coordinate frames have been verified.</p>
          <Link href="/drug-discovery-intelligence/demo" className={styles.textLink}>Inspect two experimental binding sites</Link></div>
      </div></section>
      <section className={styles.section}><div className={`${styles.container} ${styles.split}`}>
        <h2>What did the team approve?</h2>
        <div><p className={styles.copy}>A reviewer can mark a compound Test next, Needs review, or Hold and explain why. Approval freezes the selected compounds, their reasons, and available evidence references. A later change to the working shortlist leaves the approved export intact.</p>
          <Link href="/contact?inquiry=drug-discovery" className={styles.textLink}>Request a walkthrough</Link></div>
      </div></section>
      <section className={styles.section}><div className={`${styles.container} ${styles.split}`}>
        <h2>Where does VSI fit?</h2>
        <div><p className={styles.copy}>Scientists can inspect evidence and approve a batch in the private research workspace today. VSI Chat for Drug Discovery is planned. The goal is to let a researcher ask why a compound was advanced and open the sources behind the answer.</p>
          <Link href="/about#vsi" className={styles.textLink}>Explore Vaeroex Super Intelligence</Link></div>
      </div></section>
      <PublicFooter />
    </main>
  );
}
