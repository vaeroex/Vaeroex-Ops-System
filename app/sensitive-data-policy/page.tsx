import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Sensitive Data Policy | Vaeroex", description: "Information that must not be submitted to Vaeroex and customer responsibilities for excluding regulated and sensitive data.", path: "/sensitive-data-policy" });

export default function SensitiveDataPolicyPage() {
  return <LegalDocumentPage documentId="sensitive-data-policy" />;
}
