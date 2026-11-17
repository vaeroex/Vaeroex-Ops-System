import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Acceptable Use Policy | Vaeroex", description: "Rules for responsible use of Vaeroex, including prohibited activities, customer responsibilities, and service boundaries.", path: "/acceptable-use" });

export default function AcceptableUsePage() {
  return <LegalDocumentPage documentId="acceptable-use" />;
}
