import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Privacy Policy | Vaeroex", description: "How Vaeroex collects, uses, protects, and retains information, including customer responsibilities and privacy choices.", path: "/privacy" });

export default function PrivacyPage() {
  return <LegalDocumentPage documentId="privacy" />;
}
