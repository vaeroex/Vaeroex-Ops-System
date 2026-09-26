import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SquareConnectionPanel } from "@/components/integrations/SquareConnectionPanel";
import { SquareProductionCustomerPanel } from "@/components/integrations/SquareProductionCustomerPanel";
import { productionSquareCustomerEnabled, productionSquareCustomerView } from "@/lib/integrations/control-plane/square-production-customer";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import { squareCustomerConnectionsEnabled, squareCustomerPageView } from "@/lib/integrations/control-plane/square-customer-availability";
import { SQUARE_CUSTOMER_SETTINGS_PATH } from "@/lib/integrations/control-plane/square-customer-routes";

// Separate route group intentionally avoids ProtectedAppLayout authentication while disabled.
export const dynamic = "force-dynamic";
export default async function SquareConnectionPage() {
  if (productionSquareCustomerEnabled()) {
    const incoming = await headers();
    const host = new URL(PUBLIC_SITE_URL).host;
    if (incoming.get("host") !== host || incoming.get("x-forwarded-host") && incoming.get("x-forwarded-host") !== host ||
      incoming.get("x-forwarded-proto") !== "https") notFound();
    const view = await productionSquareCustomerView();
    if (!view) notFound();
    return <SquareProductionCustomerPanel view={view} />;
  }
  if (!squareCustomerConnectionsEnabled()) notFound();
  const incoming = await headers();
  const host = incoming.get("host") ?? "square-unavailable.invalid";
  let request: Request;
  try { request = new Request(`http://${host}${SQUARE_CUSTOMER_SETTINGS_PATH}`, { headers: incoming }); }
  catch { notFound(); }
  const view = await squareCustomerPageView(request);
  if (!view) notFound();
  return <main className="mx-auto max-w-3xl p-6"><SquareConnectionPanel view={view} /></main>;
}
