import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { ArrowUpRight } from "lucide-react";
import { PublicNavigation } from "@/components/marketing/PublicNavigation";
import { discoveryDemo, discoveryWalkthrough } from "@/lib/marketing/discovery-evidence";
import "@/components/marketing/public-design.css";

export function PublicSiteHeader() {
  return (
    <header className="vx-header">
      <a href="#public-content" className="vx-skip">
        Skip to content
      </a>
      <div className="vx-header-inner">
        <Link href="/" className="vx-wordmark" aria-label="Vaeroex home">
          <VaeroexLogo compact priority />
        </Link>
        <PublicNavigation />
        <div className="vx-header-actions">
          <Link href={discoveryDemo} className="vx-button vx-button--primary">
            Explore sample compounds <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <Link href={discoveryWalkthrough} className="vx-text-link">Request a walkthrough</Link>
        </div>
      </div>
      <span id="public-content" tabIndex={-1} />
    </header>
  );
}
