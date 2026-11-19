import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Refund Policy | Vaeroex", description: "Read the refund policy for subscriptions, payments, and workspace capacity.", path: "/refund-policy" });

export default function RefundPolicyPage() {
  return <LegalDocumentPage documentId="refund-policy" />;
}
