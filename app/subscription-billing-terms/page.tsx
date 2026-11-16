import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Subscription and Billing Terms | Vaeroex", description: "Executive Intelligence subscription billing, renewal, cancellation, and payment terms, with separate terms for capacity and commissioned projects.", path: "/subscription-billing-terms" });

export default function SubscriptionBillingTermsPage() {
  return <LegalDocumentPage documentId="subscription-billing-terms" />;
}
