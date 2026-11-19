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
  description: "Meet founder Isaac Vizcarra and learn how Vaeroex builds Drug Discovery Intelligence, Executive Intelligence with VSI Chat, and custom software.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero eyebrow="About Vaeroex" title="Software for decisions someone else needs to understand."
        description="Vaeroex builds Drug Discovery Intelligence for research teams, Executive Intelligence for business teams, and custom software for organizations with a workflow of their own."
        actions={<Link href="/drug-discovery-intelligence" className={styles.primary}>Explore Drug Discovery Intelligence <ArrowRight size={17} aria-hidden="true" /></Link>}
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
            <p>That experience shaped the question behind the company’s products. When a team hands over a decision, can the next person find the records and reasoning that led to it?</p>
            <Link href="/contact" className={styles.textLink}>Contact the Vaeroex team <ArrowRight size={16} aria-hidden="true" /></Link>
            <a href="https://github.com/vaeroex" className={styles.textLink}>Vaeroex on GitHub <ArrowRight size={16} aria-hidden="true" /></a>
          </div>
        </div>
      </section>
      <section id="vsi" className={`${styles.section} ${story.vsi} scroll-mt-28`} aria-labelledby="vsi-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div><p className={styles.sectionLabel}>Vaeroex Super Intelligence</p><h2 id="vsi-title" className={story.headline}>Where VSI works today</h2></div>
          <div className={story.prose}>
            <h3>Executive Intelligence</h3>
            <p>VSI Chat is the conversational interface in the business workspace. For supported questions, it uses evidence the user can access, links findings to source records, and shows gaps in the available information. A business owner can inspect a source before relying on an answer.</p>
            <Link href="/executive-intelligence#vsi" className={styles.textLink}>See VSI Chat in Executive Intelligence <ArrowRight size={16} aria-hidden="true" /></Link>
            <h3>Drug Discovery Intelligence · planned</h3>
            <p>The research workspace already records published measurements, model outputs, and reviewer reasons separately. A future VSI integration is intended to answer questions about those records, cite the evidence, and flag missing or conflicting information. Cross-product reasoning is also planned.</p>
            <Link href="/trust" className={styles.textLink}>Review evidence and access safeguards <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="custom-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div><p className={styles.sectionLabel}>Custom software</p><h2 id="custom-title">When the next step needs a tool of its own</h2></div>
          <div className={story.prose}>
            <p>Vaeroex also scopes internal research tools, dashboards, data integrations, and workflow software across industries. A written proposal defines who needs access, which systems will connect, and what the team will receive.</p>
            <Link href="/contact?inquiry=custom-business-systems" className={styles.textLink}>Discuss a project <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
