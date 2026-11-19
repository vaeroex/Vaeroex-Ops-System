import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { HomeJourney } from "@/components/marketing/journey/HomeJourney";
import { VeteranOwned } from "@/components/marketing/VeteranOwned";
import { assayTable, discoveryDemo, discoveryWalkthrough } from "@/lib/marketing/discovery-evidence";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import journeyStyles from "@/components/marketing/journey/HomeJourney.module.css";
import styles from "@/components/marketing/Solutions.module.css";
import research from "@/components/marketing/discovery/Discovery.module.css";

export const metadata = publicPageMetadata({
  title: "Vaeroex | Drug Discovery Intelligence",
  description: "Inspect experimental compound structures, check published assay evidence, and export a shortlist with your reasons. Explore the free Vaeroex Drug Discovery Intelligence demo.",
  path: "/",
});

export default function HomePage() {
  return (
    <main className={`vaeroex-public-site ${styles.site}`}>
      <PublicSiteHeader />
      <div id="home-connected-journey" className={journeyStyles.root}>
        <HomeJourney />
        <section id="home-opening" className={`${styles.hero} ${journeyStyles.hero}`}>
          <div className={styles.container}>
            <Link className={styles.eyebrow} href="/drug-discovery-intelligence">Drug Discovery Intelligence</Link>
            <h1>Which compounds should your team <span>test next?</span></h1>
            <p className={styles.lead}>Inspect docking poses, compare them with published experimental evidence, and export a shortlist that records why each compound was selected.</p>
            <div className={styles.actions}>
              <Link href={discoveryDemo} className="vx-button vx-button--primary">Explore sample compounds <ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link href={discoveryWalkthrough} className="vx-text-link">Request a walkthrough <ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section id="solutions" className={`${styles.section} ${journeyStyles.overview}`}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Glaucoma controls · Human carbonic anhydrase II</p>
            <h2>Two compounds. Three questions about the same shortlist.</h2>
            <div className={research.roles}>
              <article><p className={research.source}>Medicinal chemistry</p><h3>Where did the inhibition value come from?</h3><p>Check the enzyme, units, and assay table for acetazolamide and dorzolamide before comparing their reported activity.</p></article>
              <article><p className={research.source}>Structural biology</p><h3>Which chain shows the binding site?</h3><p>Inspect each compound in its own crystal structure. Use the catalytic zinc to orient yourself in chain A.</p></article>
              <article><p className={research.source}>R&amp;D leadership</p><h3>Why did the team advance this compound?</h3><p>Open the approved shortlist to see the reviewer’s reason alongside the evidence they had when they made the decision.</p></article>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${journeyStyles.chapter}`} aria-labelledby="featured-product">
          <div className={styles.container}>
            <p className={styles.eyebrow}>Published lab measurement</p>
            <h2 id="featured-product">Start with what the assay measured.</h2>
            <p className={styles.copy}>An inhibition constant (Kᵢ) describes how strongly a compound inhibits an enzyme under the assay conditions. Read the column for the human enzyme you are studying.</p>
            <div className={research.homeEvidence}><span>Acetazolamide · Human carbonic anhydrase II</span><strong>Kᵢ 12 nM</strong><span>nM = nanomoles per liter</span></div>
            <a href={assayTable} className="vx-text-link">Read the published assay table <ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
        </section>

        <section className={`${styles.section} ${journeyStyles.technology}`}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>Vaeroex Super Intelligence (VSI)</p>
            <h2>What evidence supported putting this compound on the shortlist?</h2>
            <p className={styles.copy}>In Executive Intelligence, VSI Chat already helps users investigate supported business records. For Drug Discovery, we’re designing a research answer that links back to the assay, the structure, and the reviewer’s recorded reason.</p>
            <Link href="/drug-discovery-intelligence#vsi" className="vx-text-link">Inspect an illustrative VSI answer <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <section className={`${styles.section} ${journeyStyles.chapter}`} aria-labelledby="home-custom">
          <div className={styles.container}>
            <p className={styles.eyebrow}>Experimental structure · PDB 3HS4</p>
            <h2 id="home-custom">Look at the zinc-bound position.</h2>
            <p className={styles.copy}>This crystal structure shows acetazolamide at the enzyme’s catalytic zinc. A docking pose is a model’s proposed placement. To compare one with experiment, first verify that both structures share the same coordinates.</p>
            <figure className={research.figure}>
              <Image src="/brand/compound-demo/3hs4-site.svg" width={520} height={346} unoptimized alt="Acetazolamide’s observed binding site with a lavender zinc ion and surrounding protein atoms" />
              <figcaption>Acetazolamide · Chain A <a href="https://www.rcsb.org/structure/3HS4">Source at RCSB PDB</a></figcaption>
            </figure>
            <Link href={discoveryDemo} className="vx-text-link">Rotate the experimental structure <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <section className={`${styles.section} ${journeyStyles.chapter}`} aria-labelledby="home-websites">
          <div className={styles.container}>
            <p className={styles.eyebrow}>Researcher decision · Illustrative example</p>
            <h2 id="home-websites">Write the reason your colleague will need.</h2>
            <blockquote className={research.note}>“Test acetazolamide next as a reference control. We can check its published inhibition value and inspect the zinc-bound structure in chain A.”</blockquote>
            <p className={styles.copy}>In the project, a researcher can choose Test next, Needs review, or Hold. The decision records who made it and when. Model scores and measurements retain their own labels.</p>
            <Link href={discoveryDemo} className="vx-text-link">Write your own shortlist reason <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>

        <div className={journeyStyles.process}>
          <section className={styles.section}>
            <div>
              <p className={styles.eyebrow}>Approved test batch</p>
              <h2 id="project-process-title">Give the next team the same evidence you reviewed.</h2>
              <p className={styles.copy}>Review the draft, approve the selected compounds, and download the CSV. The approved snapshot retains each compound ID, reason, and available evidence links even if someone later revises the working shortlist.</p>
              <div className={styles.actions}>
                <Link href={discoveryDemo} className="vx-text-link">Try a sample export <ArrowUpRight size={16} aria-hidden="true" /></Link>
                <Link href="/drug-discovery-intelligence#research" className="vx-text-link">AI in research and development <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </div>
            </div>
          </section>
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
                height={82}
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
          <section className={styles.closing}>
            <div>
              <h2>How would your team review its next batch?</h2>
              <p className={styles.copy}>Explore two published structures on your own, or ask to see how a private research project takes a team from evidence review to an approved export.</p>
              <div className={styles.actions}>
                <Link href={discoveryWalkthrough} className="vx-button vx-button--primary">Request a walkthrough <ArrowUpRight size={16} aria-hidden="true" /></Link>
                <Link href="/drug-discovery-intelligence" className="vx-text-link">Explore Drug Discovery Intelligence</Link>
              </div>
            </div>
          </section>
        </div>
      </div>
      <PublicFooter />
    </main>
  );
}
