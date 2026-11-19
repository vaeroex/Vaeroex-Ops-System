import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Trust and Security | Vaeroex",
  description: "Review current access and evidence controls for Drug Discovery Intelligence and VSI Chat in Executive Intelligence, and see what is planned for research.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
