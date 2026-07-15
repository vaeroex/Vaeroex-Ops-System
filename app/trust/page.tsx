import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Trust | Vaeroex Intelligence Systems",
  description: "Review current Vaeroex workspace isolation, evidence lineage, lifecycle exclusion, AI limitations, and responsible-use boundaries.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
