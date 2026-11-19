import { publicPageMetadata } from "@/lib/seo/public-seo";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export const metadata = publicPageMetadata({ title: "Subscription and Billing Terms | Vaeroex", description: "Review monthly subscriptions, renewal, billing, cancellation, and payment terms.", path: "/subscription-billing-terms" });

export default function SubscriptionBillingTermsPage() {
  return <LegalDocumentPage documentId="subscription-billing-terms" />;
}
