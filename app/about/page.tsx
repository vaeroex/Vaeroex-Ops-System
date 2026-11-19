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
  title: "About Vaeroex | AI Tools, Software & Our Founder",
  description: "Meet Vaeroex and founder Isaac Vizcarra. Explore software templates, intelligence systems, VSI AI tools, custom business software, and websites.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <main className={`${styles.site} vaeroex-public-site`}>
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="About Vaeroex"
        title="Practical software. Built around business."
        description="Vaeroex develops software templates, intelligence systems, its own AI tools, custom business software, and websites. Start with an available solution, commission a tailored build, or add new capabilities to the software and website your business already uses."
        actions={<Link href="/#solutions" className={styles.primary}>Explore Solutions<ArrowRight size={17} aria-hidden="true" /></Link>}
      />

      <section className={styles.section} aria-labelledby="founder-title">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>The founder</p>
            <h2 id="founder-title" className={story.headline}>Isaac Vizcarra</h2>
            <p className={story.founderRole}>Founder &amp; CEO</p>
          </div>
          <div className={story.prose}>
            <p className={story.lead}>Isaac founded Vaeroex to help businesses make better use of information and build tools around the way they work. That focus spans intelligence systems, AI tools, custom software, and websites—with an emphasis on connecting useful technology to practical business needs.</p>
            <p>His background includes operational leadership in hospital and emergency medical services settings, business operations, and U.S. Air Force service. Those experiences shaped his interest in making complex information easier to understand and act on.</p>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="vaeroex-name">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div>
            <p className={styles.sectionLabel}>Our name. Our philosophy.</p>
            <h2 id="vaeroex-name" className={story.headline}>Vaeroex</h2>
            <p className={story.founderRole}>Pronounced VAIR-oh-ex</p>
            <dl className="mt-8 grid gap-6 border-t border-white/10 pt-6 sm:grid-cols-2">
              <div><dt className="text-xl font-medium text-[color:var(--public-blue)]">Vaero</dt><dd className="mt-2 text-base leading-7 text-[#aeb7c8]">Inspired by the Latin root <em>ver-</em>, meaning “true.”</dd></div>
              <div><dt className="text-xl font-medium text-[color:var(--public-blue)]">Ex</dt><dd className="mt-2 text-base leading-7 text-[#aeb7c8]">Drawn from “executive.”</dd></div>
            </dl>
          </div>
          <div className={story.prose}>
            <p className={story.lead}>A name inspired by truth and executive thinking.</p>
            <p>We believe useful technology should have a clear purpose. Whether it helps someone investigate information, manage a workflow, or connect with customers, it should make the next step easier to understand.</p>
            <p>That belief shapes how we develop our products and approach commissioned work: understand the need, define the requirements, and build something people can use.</p>
          </div>
        </div>
      </section>

      <section id="vsi" className={`${styles.section} ${story.vsi} scroll-mt-28`} aria-labelledby="vsi-foundation">
        <div className={`${styles.container} ${story.vsiLayout}`}>
          <div><p className={styles.sectionLabel}>Vaeroex Super Intelligence</p><h2 id="vsi-foundation" className={story.headline}>VSI—the AI behind Vaeroex.</h2></div>
          <div className={story.prose}>
            <p>Vaeroex develops AI tools, software templates, and custom systems. VSI—Vaeroex Super Intelligence—connects intelligent capabilities across that work, from focused tools to complex software implementations.</p>
            <p>Conversation is one way users interact with VSI. Its capabilities can also be integrated into software interfaces, document workflows, knowledge search, and automation, with information access and functionality tailored to each implementation.</p>
            <p>We combine Vaeroex-developed software and workflows with models, tools, and technologies from providers including OpenAI and NVIDIA. Our software templates offer a starting point, while custom development brings those capabilities into the systems your business needs.</p>
            <h3 className="text-xl font-medium text-white">Useful intelligence. Clear limits.</h3>
            <p>Our approach emphasizes relevant context, supporting evidence, and reviewable outputs. Depending on the implementation, this includes grounding answers in approved information, checking calculations, showing sources, and identifying uncertainty to help reduce unsupported conclusions.</p>
            <p>Speech and transcription are project-scoped development options, rather than generally available product features.</p>
            <p>AI outputs can still be incorrect. Important results require human review.</p>
            <Link href="/about/why-vaeroex" className={styles.textLink}>Explore Why Vaeroex<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="purpose-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div><p className={styles.sectionLabel}>Why we build</p><h2 id="purpose-title">Build around the work that needs doing.</h2></div>
          <div className={story.prose}>
            <p>Some businesses need a ready-to-use solution. Others need a workflow their current software doesn’t support, a better website, or a way to connect tools that operate separately.</p>
            <p>Vaeroex works across those needs. We develop software templates and intelligence systems, build custom applications and websites, and enhance existing tools with features, integrations, automation, and AI.</p>
            <p>Each custom project begins with understanding the problem, checking what is technically possible, and agreeing on the scope and ongoing support.</p>
            <Link href="/#solutions" className={styles.textLink}>Explore Solutions<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="development-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div><p className={styles.sectionLabel}>Ongoing development</p><h2 id="development-title">Continuously developed.<br />Carefully tested.</h2></div>
          <p className={styles.copy}>We continue to develop Vaeroex’s software templates, intelligence systems, and AI tools, refine existing capabilities, and explore new applications. Custom systems and websites can evolve through agreed enhancements and ongoing support. New product capabilities become available as they are tested and released.</p>
        </div>
      </section>

      <PublicCtaBand eyebrow="Build with Vaeroex" title="What does your business need next?" description="Explore our available solutions or tell us what you want to build, connect, or improve." primaryHref="/#solutions" primaryLabel="Explore Solutions" secondaryHref="/contact?inquiry=custom-business-systems" secondaryLabel="Discuss Your Project" />
      <PublicFooter />
    </main>
  );
}
