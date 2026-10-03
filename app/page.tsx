import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  FileText,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ClarityEngine } from "@/components/marketing/clarity/ClarityEngine";
import { SignalSequence } from "@/components/marketing/SignalSequence";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import styles from "./public-home.module.css";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex | Complexity, made clear.",
  description:
    "Turn fragmented business information into a clearer view of performance, risks, and what deserves your attention. Explore Vaeroex Executive Intelligence.",
  path: "/",
});

export default function HomePage() {
  return (
    <main className={`vaeroex-public-site ${styles.home}`}>
      <PublicSiteHeader />
      <section
        id="main-content"
        className={styles.hero}
        aria-labelledby="home-title"
      >
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.signalDot} /> THE ADVANTAGE OF KNOWING
              FIRST
            </p>
            <h1 id="home-title">
              Complexity,
              <br />
              <span>made clear.</span>
            </h1>
            <p className={styles.lede}>
              Your business has the information.
              <br />
              Vaeroex helps you see what it means.
            </p>
            <p className={styles.heroDescription}>
              Bring scattered records, performance, and evidence into one
              clearer view of your business—and what deserves your attention.
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
          </div>
          <div className={styles.heroVisual}>
            <ClarityEngine className={styles.engine} />
          </div>
        </div>
        <div className={styles.heroBaseline}>
          <span>
            <i /> THE CLARITY ENGINE <em>/ CONCEPT STUDY 01</em>
          </span>
          <a href="#the-signal">
            From information to intelligence{" "}
            <ArrowDown size={14} aria-hidden="true" />
          </a>
        </div>
      </section>

      <div className={styles.progression} aria-label="The Vaeroex approach">
        {[
          ["01", "Bring it together", "Your business information"],
          ["02", "See what matters", "Evidence in context"],
          ["03", "Decide with clarity", "Your judgment, better informed"],
        ].map(([n, title, text]) => (
          <div key={n}>
            <span>{n}</span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
            <ArrowUpRight size={19} aria-hidden="true" />
          </div>
        ))}
      </div>

      <section id="the-signal" className={styles.story}>
        <div className={styles.sectionLabel}>
          <span>01 / THE SIGNAL IN THE NOISE</span>
          <span>DESIGNED FOR A CLEARER PERSPECTIVE</span>
        </div>
        <div className={styles.storyIntro}>
          <h2>
            More information.
            <br />
            <span>Less uncertainty.</span>
          </h2>
          <div>
            <p>
              A spreadsheet tells one story. A report tells another. The
              important questions live between them.
            </p>
            <p>
              Vaeroex brings supported business information into context, so you
              can understand changes, investigate risks, and focus your
              attention where it matters.
            </p>
          </div>
        </div>
        <SignalSequence />
      </section>

      <section className={styles.product} aria-labelledby="product-title">
        <div className={styles.productIntro}>
          <p className={styles.eyebrow}>02 / EXECUTIVE INTELLIGENCE</p>
          <h2 id="product-title">
            A wider view.
            <br />A sharper focus.
          </h2>
          <p>
            Built for the people responsible for the business. One inspectable
            environment for its condition, its performance, and its next
            questions.
          </p>
          <Link href="/executive-intelligence" className="vx-text-link">
            Meet Executive Intelligence
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <span className={styles.available}>
            <span className={styles.signalDot} /> AVAILABLE NOW
          </span>
        </div>
        <div className={styles.featureRows}>
          {[
            [
              "01",
              "Know where you stand.",
              "Business Health & Performance",
              "Understand current business conditions, KPI movement, and the targets your team has confirmed.",
            ],
            [
              "02",
              "Find what needs attention.",
              "Intelligence & Explain Finding",
              "Explore prioritized findings, supported risks, and opportunities. See why a change may matter.",
            ],
            [
              "03",
              "Keep the context.",
              "Evidence & Saved Analyses",
              "Trace important findings to their sources. Return to useful analyses and eligible intelligence briefings.",
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
        <Image
          src="/brand/clarity-material.webp"
          alt="Conceptual material study: precision graphite layers brought into alignment by a narrow blue seam"
          fill
          sizes="100vw"
          className={styles.materialImage}
        />
        <div className={styles.materialShade} />
        <div className={styles.materialCopy}>
          <p className={styles.eyebrow}>03 / BUILT TO BE INSPECTED</p>
          <h2 id="trust-title">
            Clarity you can
            <br />
            look into.
          </h2>
          <p>
            An answer is only as useful as the context behind it. Keep sources,
            interpretation, and important limitations in view.
          </p>
          <Link href="/trust" className="vx-text-link">
            Explore the Trust Center
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <span className={styles.materialCaption}>
          MATERIAL STUDY 02 / CONCEPTUAL ILLUSTRATION
        </span>
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
          <span>04 / SPECIALIZED INTELLIGENCE</span>
          <Link href="/intelligence-systems">
            Explore our approach
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <h2 id="domains-title">
          One philosophy.
          <br />
          <span>Distinct perspectives.</span>
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
          Executive Intelligence is available today. Research environments
          remain in development, with pricing not yet announced.
        </p>
      </section>

      <section className={styles.closing}>
        <p className={styles.eyebrow}>YOUR NEXT CHAPTER</p>
        <h2>
          See your business
          <br />
          <span>with fresh clarity.</span>
        </h2>
        <div className={styles.actions}>
          <Link href="/pricing" className="vx-button vx-button--primary">
            Find your starting point
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <Link href="/contact" className="vx-text-link">
            Let’s talk
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>
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
