import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { CompoundDemo } from "./demo/CompoundDemo";
import { ResearchStudies } from "@/components/marketing/discovery/ResearchStudies";
import { assayTable, discoveryDemo, discoveryWalkthrough } from "@/lib/marketing/discovery-evidence";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import shared from "@/components/marketing/Solutions.module.css";
import styles from "@/components/marketing/discovery/Discovery.module.css";

export const metadata = publicPageMetadata({
  title: "Drug Discovery Intelligence | Vaeroex",
  description: "Follow a compound from published inhibition data and experimental protein structures to a documented decision and an approved test-batch export. Try the free sample.",
  path: "/drug-discovery-intelligence",
});

type PageProps = { searchParams: Promise<{ compound?: string | string[] }> };

export default async function DrugDiscoveryIntelligence({ searchParams }: PageProps) {
  const { compound } = await searchParams;
  const initialId = compound === "dorzolamide" ? "dorzolamide" : "acetazolamide";
  return (
    <main className={`vaeroex-public-site ${styles.product}`}>
      <PublicSiteHeader />
      <div className={styles.shell}>
        <header className={styles.productHero}>
          <h1>Drug Discovery Intelligence</h1>
          <p>Explore how two glaucoma drugs bind to human carbonic anhydrase II. Inspect each experimental structure alongside its published assay, then choose which compounds to shortlist.</p>
        </header>
        <section id="compound-explorer" className={styles.explorer} aria-labelledby="explorer-title">
          <h2 id="explorer-title">Compound explorer</h2>
          <CompoundDemo key={initialId} initialId={initialId} />
        </section>
        <section id="evidence" className={styles.section}>
          <div className={styles.spread}>
            <div>
              <p className={styles.source}>Reading the evidence</p>
              <h2>What was measured? What was predicted?</h2>
              <p>A lab measurement describes an experiment. A docking model proposes a pose, the position and orientation of a compound against a protein. A reviewer needs to know which kind of evidence they are looking at before deciding what to test.</p>
            </div>
            <div>
              <div className={styles.fact}>
                <p className={styles.source}>Published assay · Human carbonic anhydrase II</p>
                <strong>12 nM / 9 nM</strong>
                <p>Table 1 reports inhibition constants (Kᵢ) of 12 nanomolar for acetazolamide and 9 nanomolar for dorzolamide. These are measurements under the reported enzyme assay conditions.</p>
                <a className="vx-text-link" href={assayTable}>Read Table 1 and its methods <ArrowUpRight size={15} aria-hidden="true" /></a>
              </div>
            </div>
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.spread}>
            <figure className={styles.figure}>
              <Image unoptimized src="/brand/compound-demo/3hs4-site.svg" width={520} height={346} alt="Crystal coordinates of the zinc-bound acetazolamide molecule and the surrounding atoms of chain A" />
              <figcaption><span>Acetazolamide · Experimental structure · Chain A</span><a href="https://www.rcsb.org/structure/3HS4">PDB 3HS4</a></figcaption>
            </figure>
            <div><p className={styles.source}>Protein Structures</p><h2>Check the reference before comparing a pose.</h2>
              <p>In the research workspace, import an experimental structure from the Protein Data Bank (PDB) and select a chain. The project saves the source revision and a checksum so a colleague can reopen the same file and chain.</p>
              <p>A saved prediction can be placed on the protein when the receptor and pose share a verified coordinate frame. An overlay also needs an aligned experimental reference. The public sample displays the deposited experimental coordinates for each compound.</p>
              <Link href={discoveryDemo} className="vx-text-link">Inspect the two binding sites <ArrowUpRight size={15} aria-hidden="true" /></Link>
            </div>
          </div>
          <div className={styles.comparison}>
            <h3>How close is each compound to zinc in its own crystal?</h3>
            <p>Both structures place an inhibitor nitrogen beside the catalytic zinc. Each distance comes from one deposited structure. The distance alone cannot rank the drugs’ potency.</p>
            <table><caption>Observed nitrogen-to-zinc distance · Human carbonic anhydrase II, chain A</caption>
              <thead><tr><th scope="col">Compound</th><th scope="col">Experimental distance</th><th scope="col">Source</th></tr></thead>
              <tbody>
                <tr><th scope="row">Acetazolamide</th><td>1.94 Å</td><td><a href="https://www.rcsb.org/structure/3HS4">3HS4</a></td></tr>
                <tr><th scope="row">Dorzolamide</th><td>2.04 Å</td><td><a href="https://www.rcsb.org/structure/4M2U">4M2U</a></td></tr>
              </tbody>
            </table>
            <p>One ångström (Å) is one ten-billionth of a meter.</p>
            <Link className="vx-text-link" href="/drug-discovery-intelligence?compound=dorzolamide#compound-explorer">Open the dorzolamide binding site <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
        </section>
        <section id="approval" className={styles.section}>
          <div className={styles.spread}>
            <div><p className={styles.source}>Project review</p><h2>Approve the evidence you want the lab to receive.</h2>
              <p>Mark each compound Test next, Needs review, or Hold. The working shortlist brings the Test next entries and their reasons together. A reviewer can revise that draft before approval.</p>
              <p>The approved snapshot freezes the selection, reasons, and available evidence references. A later edit to the working project leaves the original export reproducible.</p>
              <Link className="vx-text-link" href={discoveryDemo}>Try the browser-only sample CSV <ArrowUpRight size={15} aria-hidden="true" /></Link>
            </div>
            <div><h3>What goes into an approved export?</h3>
              <dl className={styles.records}>
                <div><dt>Compound</dt><dd>Identifier and name for each approved entry.</dd></div>
                <div><dt>Researcher decision</dt><dd>The reason recorded at approval.</dd></div>
                <div><dt>Evidence references</dt><dd>Available run, assay, and experimental comparison records. A missing reference stays blank.</dd></div>
              </dl>
            </div>
          </div>
        </section>
        <section id="vsi" className={styles.section}>
          <div className={styles.spread}>
            <div><p className={styles.source}>Vaeroex Super Intelligence</p><h2>Trace an answer to its sources.</h2>
              <p>VSI is Vaeroex’s AI system. It checks cited references against the sources available for an answer and identifies gaps when a review covers only part of the evidence.</p>
              <p>This saved research example pairs each observation with the public record that supports it.</p>
            </div>
            <div><p className={styles.source}>Saved example</p><h3>What do we know about acetazolamide at this binding site?</h3>
              <blockquote className={styles.note}>The crystal structure shows acetazolamide bound to zinc in chain A of human carbonic anhydrase II. In a separate enzyme assay, its reported inhibition constant (Kᵢ) was 12 nM.</blockquote>
              <p>The structure shows where the compound binds. The assay measures inhibition under its test conditions. A conclusion about patient outcomes requires clinical evidence.</p>
              <div className={shared.actions}>
                <a className="vx-text-link" href="https://www.rcsb.org/structure/3HS4">Crystal structure · PDB 3HS4 <ArrowUpRight size={15} aria-hidden="true" /></a>
                <a className="vx-text-link" href={assayTable}>Inhibition constant · Table 1, hCA II <ArrowUpRight size={15} aria-hidden="true" /></a>
              </div>
            </div>
          </div>
        </section>
        <section id="research" className={styles.section}>
          <h2>AI in research and development</h2>
          <ResearchStudies />
        </section>
        <section className={styles.section}>
          <p className={styles.source}>Access and availability</p>
          <h2>Bring your team’s next review.</h2>
          <p>The free sample runs in your browser with two fixed public structures. Request a walkthrough for the invitation-based project workspace, published structure import, and approved exports.</p>
          <div className={shared.actions}><Link href={discoveryDemo} className="vx-button vx-button--primary">Explore sample compounds <ArrowUpRight size={17} aria-hidden="true" /></Link><Link href={discoveryWalkthrough} className="vx-text-link">Request a walkthrough</Link></div>
        </section>
      </div>
      <PublicFooter />
    </main>
  );
}
