import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { WorkspaceCapture } from "@/components/marketing/WorkspaceScreenshots";
import { HomepageScene } from "@/components/marketing/assembly/HomepageScene";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "./public-home.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex | The advantage of knowing first",
  description:
    "Executive Intelligence for restaurants, breweries, retailers, and other businesses. Connect records, upload reports, add business context, and explore what matters with Vaeroex.",
  path: "/",
});

export default function HomePage() {
  return (
    <main className={`vaeroex-public-site ${styles.home}`}>
      <PublicSiteHeader />
      <div id="home-information-journey" className={styles.informationJourney}>
        <HomepageScene />
        <section className={styles.assemblyHero} aria-labelledby="home-title">
          <div className={`${styles.heroCopy} ${styles.journeyHero}`}>
            <p className={styles.eyebrow}>
              <span className={styles.signalDot} /> EXECUTIVE INTELLIGENCE
            </p>
            <h1 id="home-title">
              The advantage <br />
              <span>of knowing first</span>
            </h1>
            <p className={styles.lede}>
              You wear every hat. Get support for every perspective.
            </p>
            <p className={styles.heroDescription}>
              Vaeroex Executive Intelligence brings a CEO’s strategic
              perspective, a CFO’s financial lens, a COO’s operational focus,
              and a CMO’s market perspective into one conversational workspace.
            </p>
            <div className={styles.actions}>
              <Link
                href="/executive-intelligence"
                className="vx-button vx-button--primary"
              >
                Explore Executive Intelligence
                <ArrowUpRight size={17} aria-hidden="true" />
              </Link>
              <Link href="/contact" className="vx-text-link">
                Talk to us
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <p className={styles.heroDescription}>
              $250/month · Less time piecing information together. More time for
              what matters.
            </p>
          </div>
        </section>

        <section className={styles.product} aria-labelledby="product-title">
          <div className={styles.productIntro}>
            <p className={styles.eyebrow}>02 / EXECUTIVE INTELLIGENCE</p>
            <h2 id="product-title">
              Your business is connected.
              <br />
              Your intelligence should be, too.
            </h2>
            <p className={styles.connectedStory}>
              A change in sales can affect staffing. Staffing can affect
              service. Service can affect repeat business. And growth can put
              pressure on margins.
            </p>
            <p>
              VSI—Vaeroex Super Intelligence—helps you reason across those
              connections using what you connect, upload, and tell it. More
              relevant context means a more informed conversation.
            </p>
            <p>
              Built for the people running cafés, restaurants, breweries, retail
              stores, warehouses, and growing businesses.
            </p>
            <Link href="/executive-intelligence" className="vx-text-link">
              Meet Executive Intelligence
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.featureRows} id="business-context">
            {[
              [
                "01",
                "Everyday conversation. Business-depth reasoning.",
                "VSI",
                "Ask anything from “What should I eat for breakfast?” to “Why did sales rise while profit fell?” Move from everyday help to complex business analysis in the same workspace.",
              ],
              [
                "02",
                "Bring the context behind the numbers.",
                "Business Notes & Uploads",
                "Connect supported systems, upload reports, and share your goals. Capture meeting takeaways in Business Notes, or upload photos of a presentation so Vaeroex can extract useful information for business context. Review and approve it before it becomes business evidence.",
              ],
              [
                "03",
                "Short on time? Get a brief.",
                "Business Health & Executive Analysis",
                "Get a quick assessment without starting a conversation. Save the analysis for later when you’re between meetings or on the go.",
              ],
            ].map(([n, title, label, copy]) => (
              <div key={n}>
                <span>{n}</span>
                <div>
                  <small>{label}</small>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.material} aria-labelledby="trust-title">
          <div className={styles.materialCopy}>
            <p className={styles.eyebrow}>03 / BUILT TO BE INSPECTED</p>
            <h2 id="trust-title">
              Clarity you can
              <br />
              look into.
            </h2>
            <p>
              <strong>Grounded answers. Not confident guesses.</strong>
            </p>
            <p>
              Source citations and confidence indicators make the evidence
              behind supported business findings clear and help guard against AI
              hallucinations. When evidence is insufficient, Vaeroex holds back
              unsupported conclusions and identifies the additional context
              needed.
            </p>
            <p>
              Get clear insights, with supporting citations ready whenever you
              want a closer look.
            </p>
            <Link href="/trust" className="vx-text-link">
              Explore the Trust Center
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.evidenceVisual}>
            <WorkspaceCapture view="evidence" />
          </div>
        </section>
        <section
          className={styles.trustPrinciples}
          aria-label="Our approach to trust"
        >
          {[
            [
              FileText,
              "Connected to evidence",
              "Important findings remain connected to the business information that supports them.",
            ],
            [
              ScanLine,
              "Clear about its limits",
              "Freshness, uncertainty, and missing context remain part of the picture.",
            ],
            [
              ShieldCheck,
              "Led by your judgment",
              "Recommendations are drafts for review. You confirm before records are created or changed.",
            ],
          ].map(([Icon, title, text]) => (
            <div key={String(title)}>
              <Icon size={23} aria-hidden="true" />
              <h3>{String(title)}</h3>
              <p>{String(text)}</p>
            </div>
          ))}
        </section>

        <section className={styles.domains} aria-labelledby="domains-title">
          <div className={styles.sectionLabel}>
            <span>04 / CONTINUOUS DEVELOPMENT</span>
            <Link href="/intelligence-systems">
              Explore our approach
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <h2 id="domains-title">
            Continuously developed.
            <br />
            <span>Carefully tested.</span>
          </h2>
          <div className={styles.domainList}>
            {PUBLIC_SYSTEMS.map((system, index) => (
              <Link
                key={system.id}
                href={system.route}
                className={styles.domainRow}
              >
                <span className={styles.domainNumber}>0{index + 1}</span>
                <h3>{system.name}</h3>
                <span
                  className={
                    system.availability === "available"
                      ? styles.statusAvailable
                      : styles.status
                  }
                >
                  {system.statusLabel}
                </span>
                <ArrowUpRight aria-hidden="true" size={24} />
              </Link>
            ))}
          </div>
          <p className={styles.domainNote}>
            We continue to refine Vaeroex’s intelligence tools, test their
            performance, and expand how businesses can connect and understand
            their information.
          </p>
        </section>

        <section className={styles.closing}>
          <p className={styles.eyebrow}>EXECUTIVE INTELLIGENCE · $250/MONTH</p>
          <h2 id="closing-title">
            Executive perspectives.
            <br />
            <span>An owner’s budget.</span>
          </h2>
          <p className={styles.closingCopy}>
            For $250 per month, bring conversational intelligence, business
            analysis, and useful context into one workspace—helping reduce the
            time and cost of preparing analysis, so you can put more resources
            toward running and growing your business.
          </p>
          <div className={styles.actions}>
            <Link
              href="/checkout/legal"
              className="vx-button vx-button--primary"
            >
              Get Executive Intelligence
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/contact" className="vx-text-link">
              Talk to us
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <p className={styles.ownership}>Veteran owned and operated</p>
        </section>
      </div>
      <section
        className={styles.membership}
        aria-label="NVIDIA Inception membership"
      >
        <p>
          Vaeroex is a member of the
          <br />
          <strong>NVIDIA Inception program.</strong>
        </p>
        <Image
          src="/brand/nvidia-inception-program-badge.svg"
          alt="NVIDIA Inception Program badge"
          width={190}
          height={60}
          unoptimized
        />
        <small>
          © 2025 NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks
          and/or registered trademarks of NVIDIA Corporation in the U.S. and
          other countries.
        </small>
      </section>
      <PublicFooter />
    </main>
  );
}
