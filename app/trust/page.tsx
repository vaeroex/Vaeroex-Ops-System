import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Trust and Security | Vaeroex",
  description: "See how researchers verify compound evidence, control access to private projects, and review plans for research questions in VSI Chat.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
