import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  FileCheck2,
  Gauge,
  Layers3,
  Radar,
  ScanLine,
  ShieldCheck
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicSystemsPortfolio } from "@/components/marketing/PublicSystemsPortfolio";
import { PublicSpatialBackdrop } from "@/components/marketing/spatial/PublicSpatialBackdrop";
import { EXECUTIVE_INTELLIGENCE_SYSTEM, INTELLIGENCE_SYSTEMS_ROUTE } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex | Intelligence Systems",
  description: "Vaeroex transforms complex information into visibility, awareness, prediction, and action across specialized intelligence domains.",
  path: "/"
});

const systemPrinciples = [
  ["Specialized", "Each environment is shaped around the information, relationships, constraints, and objectives of its domain."],
  ["Contextual", "Important signals become more useful when their relationships, uncertainty, and supporting context remain visible."],
  ["Inspectable", "Understanding should remain connected to the information that supports it and open to human review."]
] as const;

const conceptualPath = [
  ["Information", "Complex environments generate more information than people can reasonably interpret in isolation."],
  ["Visibility", "Important conditions, relationships, and changes become easier to see."],
  ["Awareness", "Context helps explain what is happening, how it connects, and why it matters."],
  ["Prediction", "Supported patterns can surface emerging conditions and possible outcomes without presenting uncertainty as certainty."],
  ["Action", "Intelligence becomes useful when it helps people determine what deserves attention, investigation, or action."]
] as const;

function ChapterMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className="vaeroex-public-chapter-marker" aria-hidden="true">
      <span>{index}</span>
      <span>{label}</span>
    </div>
  );
}

function NvidiaInceptionSection() {
  return (
    <section className="vaeroex-public-membership" aria-labelledby="nvidia-inception-heading">
      <div>
        <p>NVIDIA Inception Program</p>
        <h2 id="nvidia-inception-heading">Vaeroex is a member of the NVIDIA Inception program.</h2>
      </div>
      <img src="/brand/nvidia-inception-program-badge.svg" alt="NVIDIA Inception Program badge" />
      <p className="vaeroex-public-membership__legal">© 2025 NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries.</p>
    </section>
  );
}

export default function HomePage() {
  const system = EXECUTIVE_INTELLIGENCE_SYSTEM;

  return (
    <main className="vaeroex-public-site min-h-screen text-white">
      <PublicSiteHeader />

      <div className="vaeroex-public-journey" data-public-spatial-journey>
        <PublicSpatialBackdrop />
        <div className="vaeroex-public-atmosphere" aria-hidden="true" />

        <nav className="vaeroex-journey-index" aria-label="Homepage chapters">
          <a href="#vaeroex">01<span>Vaeroex</span></a>
          <a href="#intelligence-systems">02<span>Systems</span></a>
          <a href="#from-information-to-intelligence">03<span>Intelligence</span></a>
          <a href="#trust-and-evidence">04<span>Trust</span></a>
          <a href="#explore">05<span>Explore</span></a>
        </nav>

        <section id="vaeroex" className="vaeroex-public-chapter vaeroex-public-chapter--hero">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--left">
            <div className="vaeroex-public-hero-brand">
              <h1>VAEROEX</h1>
              <p className="vaeroex-public-hero-category">Intelligence Systems</p>
            </div>
            <p className="vaeroex-public-lede">Transforming information into visibility, awareness, prediction, and action.</p>
            <p className="vaeroex-public-copy">Vaeroex transforms complex information into usable intelligence through specialized environments for distinct domains.</p>
            <div className="vaeroex-public-actions">
              <Link href={INTELLIGENCE_SYSTEMS_ROUTE} className="vaeroex-button vaeroex-button--primary">
                Explore Vaeroex intelligence
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link href={system.route} className="vaeroex-button vaeroex-button--quiet">Explore Executive Intelligence</Link>
            </div>
            <div className="vaeroex-hero-coordinate" aria-label="Vaeroex company principles">
              <span>Complex information</span>
              <i aria-hidden="true" />
              <span>Usable intelligence</span>
            </div>
          </div>
          <a className="vaeroex-scroll-cue" href="#intelligence-systems">
            <span>Continue</span>
            <span aria-hidden="true" />
          </a>
        </section>

        <section id="intelligence-systems" className="vaeroex-public-chapter vaeroex-public-chapter--company">
          <span className="vaeroex-next-chapter-label" aria-hidden="true">02 / Intelligence</span>
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--right">
            <ChapterMarker index="02" label="Why intelligence matters" />
            <p className="vaeroex-public-kicker">Information is everywhere. Intelligence is not.</p>
            <h2>Information tells you what exists. Intelligence helps you understand what it means.</h2>
            <p className="vaeroex-public-copy">The problem is not simply access to information. It is seeing what matters, understanding how it connects, recognizing what may be changing, and deciding where attention should go.</p>
            <div className="vaeroex-principle-stack">
              {systemPrinciples.map(([title, description]) => (
                <div key={title}>
                  <strong>{title}</strong>
                  <p>{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="vaeroex-public-chapter vaeroex-public-chapter--definition">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--left vaeroex-public-chapter__content--narrow">
            <ChapterMarker index="02.1" label="The intelligence path" />
            <p className="vaeroex-public-kicker">Information to action</p>
            <h2>Not more information. A more useful relationship with it.</h2>
            <p className="vaeroex-public-copy">Vaeroex brings relevant information into coherent, inspectable views and helps people reason over it with greater precision. It supports judgment without replacing human authority.</p>
            <div className="vaeroex-transformation-line" aria-label="Vaeroex transformation philosophy">
              {[
                ["01", "Information"],
                ["02", "Visibility"],
                ["03", "Awareness"],
                ["04", "Prediction"],
                ["05", "Action"]
              ].map(([index, label]) => (
                <span key={label}><small>{index}</small>{label}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="vaeroex-public-chapter vaeroex-public-chapter--portfolio" aria-labelledby="vaeroex-product-family-heading">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--center">
            <ChapterMarker index="02.2" label="Specialized intelligence" />
            <p className="vaeroex-public-kicker">One system. Distinct domains.</p>
            <h2 id="vaeroex-product-family-heading">Specialized intelligence for distinct decision environments.</h2>
            <p className="vaeroex-public-lede vaeroex-public-lede--center">Different domains contain different evidence, relationships, constraints, uncertainties, and objectives. Vaeroex applies specialized intelligence without treating every problem as the same generic conversation.</p>
            <PublicSystemsPortfolio />
          </div>
        </section>

        <section id="from-information-to-intelligence" className="vaeroex-public-chapter vaeroex-public-chapter--arrival">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--center">
            <ChapterMarker index="03" label="From information to intelligence" />
            <p className="vaeroex-public-kicker">Visibility. Awareness. Prediction. Action.</p>
            <h2>Intelligence makes complex information more useful.</h2>
            <p className="vaeroex-public-lede vaeroex-public-lede--center">See important conditions and relationships. Understand context and why it matters. Recognize supported patterns and possible outcomes without implying certainty. Turn that understanding into clearer attention, investigation, prioritization, and decision support.</p>
          </div>
        </section>

        <section id="intelligence-path" className="vaeroex-public-chapter vaeroex-public-chapter--method">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--right vaeroex-public-chapter__content--wide">
            <ChapterMarker index="03.1" label="Company intelligence path" />
            <p className="vaeroex-public-kicker">How intelligence becomes useful</p>
            <h2>From information to action.</h2>
            <ol className="vaeroex-method-list">
              {conceptualPath.map(([title, description], index) => (
                <li key={title}>
                  <span>0{index + 1}</span>
                  <div><strong>{title}</strong><p>{description}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="trust-and-evidence" className="vaeroex-public-chapter vaeroex-public-chapter--trust">
          <div className="vaeroex-public-trust-layout">
            <div>
              <ChapterMarker index="04" label="Trust and precision" />
              <p className="vaeroex-public-kicker">Inspectable intelligence</p>
              <h2>Facts remain facts. Interpretation remains visible as interpretation.</h2>
              <p className="vaeroex-public-copy">Vaeroex keeps supporting information available for review, makes important limitations visible, and leaves consequential decisions with the people responsible for them.</p>
              <Link href="/trust" className="vaeroex-text-link">Review the Trust Center<ArrowRight aria-hidden="true" /></Link>
            </div>
            <div className="vaeroex-trust-ledger">
              {[
                [FileCheck2, "Evidence", "Supporting information remains connected and inspectable."],
                [ScanLine, "Interpretation", "Reasoning is presented as decision support, not a new business fact."],
                [ShieldCheck, "Leadership control", "Review, context, and judgment remain part of every important decision."]
              ].map(([Icon, title, description]) => (
                <div key={String(title)}>
                  <Icon aria-hidden="true" />
                  <strong>{String(title)}</strong>
                  <p>{String(description)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="vaeroex-public-chapter vaeroex-public-chapter--principles">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--left vaeroex-public-chapter__content--wide">
            <ChapterMarker index="04.1" label="Company principles" />
            <div className="vaeroex-public-principle-grid">
              {[
                [Radar, "Clarity before automation", "Vaeroex is designed to strengthen judgment, not operate the business autonomously."],
                [Layers3, "Systems, not features", "Each system is designed around a specialized environment and a coherent decision purpose."],
                [Gauge, "Precision with restraint", "Confidence, freshness, supporting context, and limitations remain visible."],
                [ShieldCheck, "Built to be inspected", "Understanding should withstand review, not depend on spectacle or opacity."]
              ].map(([Icon, title, description]) => (
                <div key={String(title)}>
                  <Icon aria-hidden="true" />
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="explore" className="vaeroex-public-chapter vaeroex-public-chapter--closing">
          <div className="vaeroex-public-closing">
            <ChapterMarker index="05" label="Explore" />
            <p className="vaeroex-public-kicker">Explore Vaeroex</p>
            <h2>See how specialized intelligence takes shape.</h2>
            <p>Understand the Vaeroex intelligence philosophy, then explore the currently available Executive Intelligence environment.</p>
            <div className="vaeroex-public-actions vaeroex-public-actions--center">
              <Link href={INTELLIGENCE_SYSTEMS_ROUTE} className="vaeroex-button vaeroex-button--primary">Explore Intelligence Systems<ArrowRight aria-hidden="true" /></Link>
              <Link href={system.route} className="vaeroex-button vaeroex-button--quiet">Explore Executive Intelligence</Link>
            </div>
          </div>
        </section>
      </div>

      <NvidiaInceptionSection />
      <PublicFooter />
    </main>
  );
}
