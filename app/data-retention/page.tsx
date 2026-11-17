import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Data Retention Policy | Vaeroex", description: "Vaeroex data retention, deletion, and storage practices, including customer responsibilities and applicable limitations.", path: "/data-retention" });

export default function DataRetentionPage() {
  return <LegalDocumentPage documentId="data-retention" />;
}
