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
import { EXECUTIVE_INTELLIGENCE_SYSTEM } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Intelligence Systems",
  description: "Vaeroex creates intelligence systems that transform complex information into visibility, awareness, prediction, and action.",
  path: "/"
});

const systemPrinciples = [
  ["Specialized", "Designed around a decision environment rather than generic conversation."],
  ["Inspectable", "Supporting information remains available when understanding needs to be checked."],
  ["Decision-ready", "Complex information resolves into a clearer view of what deserves attention."]
] as const;

const conceptualPath = [
  ["Bring relevant information together", "Reports, spreadsheets, documents, KPIs, and other useful business information enter one secure workspace."],
  ["Establish trusted understanding", "Facts and supporting sources remain distinguishable from the interpretation built around them."],
  ["Transform information into intelligence", "Important conditions, changes, relationships, and priorities become easier to see."],
  ["Move with greater clarity", "Leadership can inspect the context, exercise judgment, and decide where to focus next."]
] as const;

function ChapterMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className="vaeroex-public-chapter-marker" aria-hidden="true">
      <span>{index}</span>
      <span>{label}</span>
    </div>
  );
}

function ExecutiveInstrument() {
  return (
    <div className="vaeroex-product-console" aria-label="Illustrative Executive Intelligence product view">
      <div className="vaeroex-product-console__bar">
        <span>Executive Intelligence</span>
        <span className="vaeroex-product-console__status">Current view</span>
      </div>
      <div className="vaeroex-product-console__body">
        <section className="vaeroex-health-readout" aria-label="Illustrative Business Health view">
          <div>
            <p>Business Health</p>
            <strong>82</strong>
          </div>
          <div className="vaeroex-health-readout__track" aria-hidden="true">
            <span />
          </div>
          <p className="vaeroex-health-readout__summary">Stable condition with two priorities requiring leadership attention.</p>
        </section>
        <section className="vaeroex-priority-readout" aria-label="Illustrative prioritized intelligence">
          <div className="vaeroex-priority-readout__heading">
            <span>Prioritized Intelligence</span>
            <span>3 findings</span>
          </div>
          {[
            ["01", "Margin pressure", "Requires attention"],
            ["02", "Pipeline concentration", "Monitor"],
            ["03", "Delivery performance", "Improving"]
          ].map(([number, title, state]) => (
            <div className="vaeroex-priority-readout__row" key={number}>
              <span>{number}</span>
              <strong>{title}</strong>
              <span>{state}</span>
            </div>
          ))}
        </section>
      </div>
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
          <a href="#executive-intelligence">03<span>Product</span></a>
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
            <div className="vaeroex-public-actions">
              <a href="#intelligence-systems" className="vaeroex-button vaeroex-button--primary">
                Enter the environment
                <ArrowRight aria-hidden="true" />
              </a>
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
          <span className="vaeroex-next-chapter-label" aria-hidden="true">02 / Intelligence Systems</span>
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--right">
            <ChapterMarker index="02" label="What Vaeroex builds" />
            <p className="vaeroex-public-kicker">Intelligence Systems</p>
            <h2>Complex information should resolve into understanding.</h2>
            <p className="vaeroex-public-copy">Vaeroex creates specialized systems for decision environments where the volume, fragmentation, and pace of information can obscure what matters.</p>
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
            <ChapterMarker index="02.1" label="A clearer category" />
            <p className="vaeroex-public-kicker">The Vaeroex philosophy</p>
            <h2>Not more information. A more useful relationship with it.</h2>
            <p className="vaeroex-public-copy">An Intelligence System brings relevant information into a coherent, inspectable view and helps people reason over it with greater precision. The system supports judgment. It does not replace it.</p>
            <div className="vaeroex-transformation-line" aria-label="Vaeroex transformation philosophy">
              {[
                ["01", "Visibility"],
                ["02", "Awareness"],
                ["03", "Prediction"],
                ["04", "Action"]
              ].map(([index, label]) => (
                <span key={label}><small>{index}</small>{label}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="vaeroex-public-chapter vaeroex-public-chapter--portfolio" aria-labelledby="vaeroex-product-family-heading">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--center">
            <ChapterMarker index="02.2" label="Product family" />
            <p className="vaeroex-public-kicker">Vaeroex Intelligence Systems</p>
            <h2 id="vaeroex-product-family-heading">Specialized intelligence for distinct decision environments.</h2>
            <p className="vaeroex-public-lede vaeroex-public-lede--center">Each Vaeroex product is designed around a serious information environment, a clear decision purpose, and an inspectable relationship with evidence.</p>
            <PublicSystemsPortfolio />
          </div>
        </section>

        <section id="executive-intelligence" className="vaeroex-public-chapter vaeroex-public-chapter--arrival">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--center">
            <ChapterMarker index="03" label="System arrival" />
            <p className="vaeroex-public-kicker">{system.relationship}</p>
            <h2>{system.name}</h2>
            <p className="vaeroex-public-lede vaeroex-public-lede--center">{system.tagline}</p>
            <Link href={system.route} className="vaeroex-text-link">
              Discover the system
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="vaeroex-public-chapter vaeroex-public-chapter--product">
          <div className="vaeroex-public-product-layout">
            <div className="vaeroex-public-product-copy">
              <p className="vaeroex-public-kicker">Leadership environment</p>
              <h2>See the whole condition. Inspect the important detail.</h2>
              <p>{system.description}</p>
              <div className="vaeroex-capability-rail" aria-label="Executive Intelligence capabilities">
                {system.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
              </div>
            </div>
            <ExecutiveInstrument />
          </div>
        </section>

        <section className="vaeroex-public-chapter vaeroex-public-chapter--method">
          <div className="vaeroex-public-chapter__content vaeroex-public-chapter__content--right vaeroex-public-chapter__content--wide">
            <ChapterMarker index="03.1" label="Conceptual journey" />
            <p className="vaeroex-public-kicker">How it works</p>
            <h2>From relevant information to executive clarity.</h2>
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
              <p className="vaeroex-public-copy">Executive Intelligence keeps supporting business information available for review, shows important limitations, and leaves consequential decisions with the people responsible for them.</p>
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
            <p className="vaeroex-public-kicker">Executive Intelligence is available now</p>
            <h2>Enter the first Vaeroex Intelligence System.</h2>
            <p>Explore the product, review its trust principles, and decide whether it belongs in your leadership environment.</p>
            <div className="vaeroex-public-actions vaeroex-public-actions--center">
              <Link href={system.route} className="vaeroex-button vaeroex-button--primary">Explore Executive Intelligence<ArrowRight aria-hidden="true" /></Link>
              <Link href="/pricing" className="vaeroex-button vaeroex-button--quiet">View pricing</Link>
            </div>
          </div>
        </section>
      </div>

      <NvidiaInceptionSection />
      <PublicFooter />
    </main>
  );
}
