import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Trust and Security | Vaeroex Intelligence Systems",
  description: "Review how Vaeroex builds trustworthy intelligence systems through secure workspaces, evidence-backed conclusions, explainable reasoning, and human control.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
