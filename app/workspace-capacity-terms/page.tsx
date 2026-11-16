import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Workspace Capacity Terms | Vaeroex", description: "Terms for optional Vaeroex workspace capacity purchases, usage limits, payment, and capacity management.", path: "/workspace-capacity-terms" });

export default function WorkspaceCapacityTermsPage() {
  return <LegalDocumentPage documentId="workspace-capacity-terms" />;
}
