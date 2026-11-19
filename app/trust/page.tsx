import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Trust and Security | Vaeroex",
  description: "See how researchers verify compound evidence, how membership controls access to private projects, and how to check the sources in a VSI answer.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
