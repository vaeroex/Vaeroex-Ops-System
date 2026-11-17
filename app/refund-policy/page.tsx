import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Refund Policy | Vaeroex", description: "Review the existing refund terms for Executive Intelligence and workspace capacity, and the agreement-based scope of commissioned projects.", path: "/refund-policy" });

export default function RefundPolicyPage() {
  return <LegalDocumentPage documentId="refund-policy" />;
}
