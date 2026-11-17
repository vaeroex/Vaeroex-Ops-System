import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Human Review Policy | Vaeroex", description: "Customer review and confirmation responsibilities for AI-assisted findings, recommendations, and supported actions.", path: "/human-review" });

export default function HumanReviewPage() {
  return <LegalDocumentPage documentId="human-review" />;
}
