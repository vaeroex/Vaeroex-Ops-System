import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "AI Disclaimer | Vaeroex", description: "Limits of AI-assisted outputs, uncertainty, and the need to review important results before relying on them.", path: "/ai-disclaimer" });

export default function AiDisclaimerPage() {
  return <LegalDocumentPage documentId="ai-disclaimer" />;
}
