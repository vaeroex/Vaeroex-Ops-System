import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Trust Center",
  description: "Review Vaeroex trust, safety, privacy, legal, and responsible-use resources.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
