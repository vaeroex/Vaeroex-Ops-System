import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Terms of Service | Vaeroex", description: "Terms for Executive Intelligence subscriptions, optional workspace capacity, platform use, and the separate agreements required for commissioned projects.", path: "/terms" });

export default function TermsPage() {
  return <LegalDocumentPage documentId="terms" />;
}
