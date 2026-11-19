import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";
import story from "@/components/marketing/ExecutiveStory.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "About Vaeroex | Research Software, Founder & VSI",
  description: "Meet founder Isaac Vizcarra and learn how Vaeroex helps researchers trace a compound decision back to its evidence.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero eyebrow="About Vaeroex" title="Research decisions that a colleague can trace."
        description="Vaeroex builds Drug Discovery Intelligence so researchers can review compound evidence together, record their reasoning, and hand an approved batch to the next team."
        actions={<Link href="/drug-discovery-intelligence/demo" className={styles.primary}>Explore sample compounds <ArrowRight size={17} aria-hidden="true" /></Link>}
      />
      <section className={styles.section} aria-labelledby="founder-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>The founder</p>
            <h2 id="founder-title" className={story.headline}>Isaac Vizcarra</h2>
            <p className={story.founderRole}>Founder &amp; CEO</p>
          </div>
          <div className={story.prose}>
            <p className={story.lead}>Isaac founded Vaeroex. His background includes leadership in hospital and emergency medical services operations, business operations, and U.S. Air Force service.</p>
            <p>That experience shaped the question behind Drug Discovery Intelligence. When a team hands over a decision, can the next person find the records and reasoning that led to it?</p>
            <Link href="/contact" className={styles.textLink}>Contact the Vaeroex team <ArrowRight size={16} aria-hidden="true" /></Link>
            <a href="https://github.com/vaeroex" className={styles.textLink}>Vaeroex on GitHub <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
        </div>
      </section>
      <section id="vsi" className={`${styles.section} ${story.vsi} scroll-mt-28`} aria-labelledby="vsi-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>Vaeroex Super Intelligence</p>
            <h2 id="vsi-title" className={story.headline}>VSI in research</h2>
          </div>
          <div className={story.prose}>
            <p>VSI Chat for Drug Discovery is planned. A researcher could ask why a compound was shortlisted and check the cited assay, the experimental structure, and the reviewer’s reason.</p>
            <Link href="/drug-discovery-intelligence#vsi" className={styles.textLink}>Explore the illustrative research question <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
