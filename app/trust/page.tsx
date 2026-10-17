import type { Metadata } from "next";
import { TrustCenterPage } from "@/components/legal/TrustCenterPage";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Trust and Security | Vaeroex",
  description: "Learn how Vaeroex protects workspace access, uses evidence to help prevent hallucinated answers, explains missing information, and keeps decisions under your control.",
  path: "/trust"
});

export default function PublicTrustPage() {
  return <TrustCenterPage />;
}
