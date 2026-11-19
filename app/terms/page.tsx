import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Terms of Service | Vaeroex", description: "Terms governing Vaeroex services, accounts, payments, and the responsibilities of workspace users.", path: "/terms" });

export default function TermsPage() {
  return <LegalDocumentPage documentId="terms" />;
}
