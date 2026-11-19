import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import { CompoundDemo } from "./CompoundDemo";
import styles from "./demo.module.css";

export const metadata = publicPageMetadata({
  title:"Explore sample compounds | Drug Discovery Intelligence | Vaeroex",
  description:"Inspect published acetazolamide and dorzolamide structures for human carbonic anhydrase II, review their assay evidence and download an approved sample shortlist.",
  path:"/drug-discovery-intelligence/demo",
});

export default async function SampleCompounds({searchParams}:{searchParams:Promise<{compound?:string|string[]}>}) {
  const {compound} = await searchParams;
  return <main className="vaeroex-public-site"><PublicSiteHeader/>
    <div className={styles.page} id="sample-compounds">
      <Link className={styles.back} href="/drug-discovery-intelligence"><ArrowLeft size={15}/> Drug Discovery Intelligence</Link>
      <header className={styles.intro}><p className={styles.kicker}>Free compound demo</p>
        <h1>Explore sample compounds</h1>
        <p>Inspect two experimental structures of human carbonic anhydrase II. Compare the measured evidence, then approve and export your own sample shortlist.</p>
      </header>
      <CompoundDemo initialId={compound==="dorzolamide"?"dorzolamide":"acetazolamide"}/>
    </div><PublicFooter/></main>;
}
