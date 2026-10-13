import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "@/components/marketing/IntelligencePages.module.css";
import story from "@/components/marketing/ExecutiveStory.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "About Vaeroex | Isaac Vizcarra, Founder & CEO",
  description: "Meet Isaac Vizcarra, Founder & CEO of Vaeroex, and learn why Vaeroex helps businesses turn scattered information into clearer operational understanding.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="About Vaeroex"
        title="Information is everywhere. Understanding is not."
        description="Vaeroex helps business owners turn scattered records and everyday context into a clearer view of their operations—and a better starting point for decisions."
        actions={<Link href="/executive-intelligence" className={styles.primary}>Explore Executive Intelligence<ArrowRight size={17} aria-hidden="true" /></Link>}
      />

      <section className={styles.section} aria-labelledby="founder-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>The founder</p>
            <h2 id="founder-title" className={story.headline}>Isaac Vizcarra</h2>
            <p className={story.founderRole}>Founder &amp; CEO</p>
          </div>
          <div className={story.prose}>
            <p className={story.lead}>Isaac founded Vaeroex to help businesses turn scattered information into a clearer understanding of their operations. His goal is to reduce the time teams spend gathering and interpreting data, helping them make informed decisions while automating routine analysis wherever practical.</p>
            <p>His background includes operational leadership in hospital and emergency medical services settings, business operations, and U.S. Air Force service. Those experiences shaped his interest in making complex information easier to understand and act on.</p>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="purpose-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div><p className={styles.sectionLabel}>Why we build</p><h2 id="purpose-title">Make information<br />useful to the people<br />running the business.</h2></div>
          <div className={story.prose}>
            <p>Restaurant, brewery, and retail teams work across payment records, accounting reports, spreadsheets, and conversations. Vaeroex brings supported information into a workspace where people can investigate performance and explore the context behind a finding.</p>
            <p>That focus also serves other businesses with complex information to understand. Vaeroex-developed software, data connections, and analysis workflows support the process. Evidence, uncertainty, and human judgment stay part of the decision.</p>
            <Link href="/intelligence-systems" className={styles.textLink}>The Vaeroex approach<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="development-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div><p className={styles.sectionLabel}>Ongoing development</p><h2 id="development-title">Continuously developed.<br />Carefully tested.</h2></div>
          <p className={styles.copy}>We continue to refine Vaeroex’s intelligence tools, test their performance, and expand how businesses can connect and understand their information. Executive Intelligence is available today; new capabilities are described as available only when they are ready.</p>
        </div>
      </section>

      <PublicCtaBand title="The advantage of knowing first" description="Explore Executive Intelligence and see how your business information can become a clearer starting point." primaryHref="/executive-intelligence" primaryLabel="Explore Executive Intelligence" />
      <PublicFooter />
    </main>
  );
}
