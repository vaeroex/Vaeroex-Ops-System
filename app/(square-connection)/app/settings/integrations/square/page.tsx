import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SquareConnectionPanel } from "@/components/integrations/SquareConnectionPanel";
import { squareCustomerConnectionsEnabled, squareCustomerPageView } from "@/lib/integrations/control-plane/square-customer-availability";
import { SQUARE_CUSTOMER_SETTINGS_PATH } from "@/lib/integrations/control-plane/square-customer-routes";

// Separate route group intentionally avoids ProtectedAppLayout authentication while disabled.
export const dynamic = "force-dynamic";
export default async function SquareConnectionPage() {
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
