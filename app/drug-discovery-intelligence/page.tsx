import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ResearchStudies } from "@/components/marketing/discovery/ResearchStudies";
import { assayTable, diffDockGuide, discoveryDemo, discoveryWalkthrough, nistProfile } from "@/lib/marketing/discovery-evidence";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import shared from "@/components/marketing/Solutions.module.css";
import styles from "@/components/marketing/discovery/Discovery.module.css";

export const metadata = publicPageMetadata({
  title: "Drug Discovery Intelligence | Vaeroex",
  description: "Follow a compound from published inhibition data and experimental protein structures to a documented decision and an approved test-batch export. Try the free sample.",
  path: "/drug-discovery-intelligence",
});

export default function DrugDiscoveryIntelligence() {
  return (
    <main className={`vaeroex-public-site ${styles.product}`}>
      <PublicSiteHeader />
      <div className={styles.shell}>
        <header className={styles.productHero}>
          <div>
            <p className={styles.source}>Vaeroex · Research workspace</p>
            <h1>Drug Discovery Intelligence</h1>
            <p>Bring a compound’s assay, protein structure, and review history into the same decision. Start with two glaucoma drugs bound to human carbonic anhydrase II, an enzyme involved in producing fluid in the eye.</p>
            <div className={shared.actions}>
              <Link className="vx-button vx-button--primary" href={discoveryDemo}>Explore sample compounds <ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link className="vx-text-link" href={discoveryWalkthrough}>Request a walkthrough</Link>
            </div>
          </div>
          <figure className={styles.figure}>
            <Image unoptimized priority src="/brand/compound-demo/4m2u-site.svg" width={520} height={346} alt="Dorzolamide beside the catalytic zinc in its experimentally determined binding site" />
            <figcaption><span>Dorzolamide · Experimental structure · Chain A</span><a href="https://www.rcsb.org/structure/4M2U">PDB 4M2U</a></figcaption>
          </figure>
        </header>
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
              <div className={styles.fact}>
                <p className={styles.source}>Model confidence · Illustrative score</p>
                <strong>−0.50</strong>
                <p>For a typical drug-like input, this example falls in the DiffDock authors’ approximate moderate-confidence band for a proposed pose. It is a teaching example, independent of either compound. Pose confidence cannot establish potency or clinical efficacy.</p>
                <a className="vx-text-link" href={diffDockGuide}>DiffDock authors’ interpretation guide <ArrowUpRight size={15} aria-hidden="true" /></a>
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
            <Link className="vx-text-link" href="/drug-discovery-intelligence/demo?compound=dorzolamide">Open the dorzolamide binding site <ArrowUpRight size={15} aria-hidden="true" /></Link>
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
            <div><p className={styles.source}>Vaeroex Super Intelligence</p><h2>What would a researcher be able to check in VSI Chat?</h2>
              <p>VSI Chat in Executive Intelligence can answer supported questions using authorized business evidence and reopen supporting records. Integration with Drug Discovery is planned.</p>
              <p>The research design aims to reduce unsupported answers. Factual claims should link to records the researcher can access. Measurements, model outputs, and review notes have different meanings. Missing records or conflicting evidence should be called out.</p>
              <a className="vx-text-link" href={nistProfile}>Design rationale · NIST AI 600-1 <ArrowUpRight size={15} aria-hidden="true" /></a>
            </div>
            <div><p className={styles.source}>Illustrative future interaction</p><h3>“What evidence supported putting this compound on the shortlist?”</h3>
              <blockquote className={styles.note}>“The reviewer selected acetazolamide as a reference control. The cited table reports a Kᵢ of 12 nM, and PDB 3HS4 records its position near zinc in chain A.”</blockquote>
              <p>You could check the assay row, the experimental chain, and the original approval note. If the approved record contained no model result, the answer should say so.</p>
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
          <p>The free sample runs in your browser with two fixed public structures. Request a walkthrough for the invitation-based project workspace, published structure import, and approved exports. New protein folding predictions, molecule generation, and cross-product VSI reasoning are planned. Customer-run production docking and its pricing are pending.</p>
          <div className={shared.actions}><Link href={discoveryWalkthrough} className="vx-button vx-button--primary">Request a walkthrough <ArrowUpRight size={17} aria-hidden="true" /></Link><Link href={discoveryDemo} className="vx-text-link">Explore sample compounds</Link></div>
        </section>
      </div>
      <PublicFooter />
    </main>
  );
}
