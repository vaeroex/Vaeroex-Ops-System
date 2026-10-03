import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SquareConnectionPanel } from "@/components/integrations/SquareConnectionPanel";
import { SquareProductionCustomerPanel } from "@/components/integrations/SquareProductionCustomerPanel";
import { SquareDirectCustomerPanel } from "@/components/integrations/SquareDirectCustomerPanel";
import { squareDirectEnabled, squareDirectView, squareDirectPayments } from "@/lib/integrations/square-direct/server";
import { parseDirectPaymentBrowseQuery, type DirectPaymentBrowser } from "@/lib/integrations/square-direct/payment-browse";
import { productionSquareCustomerEnabled, productionSquareCustomerView,productionSquareReadViews } from "@/lib/integrations/control-plane/square-production-customer";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import { squareCustomerConnectionsEnabled, squareCustomerPageView } from "@/lib/integrations/control-plane/square-customer-availability";
import { SQUARE_CUSTOMER_SETTINGS_PATH } from "@/lib/integrations/control-plane/square-customer-routes";

// Separate route group intentionally avoids ProtectedAppLayout authentication while disabled.
export const dynamic = "force-dynamic";
export default async function SquareConnectionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (squareDirectEnabled()) {
    const incoming = await headers();
    const host = "www.vaeroex.com";
    if (incoming.get("host") !== host || incoming.get("x-forwarded-host") && incoming.get("x-forwarded-host") !== host ||
      incoming.get("x-forwarded-proto") !== "https") notFound();
    const view = await squareDirectView();
    if (!view) notFound();
    const query = await searchParams;
    let browser: DirectPaymentBrowser | null = null;
    let browseError: string | null = null;
    let browseConnectionId: string | null = null;
    try { browseConnectionId = parseDirectPaymentBrowseQuery({ connectionId: query.connectionId }).connectionId; } catch { /* Invalid selection never broadens the current workspace. */ }
    try { browser = await squareDirectPayments(query); }
    catch { browseError = "Saved-payment browsing is unavailable or the filters are invalid. Your connection and saved records are unchanged."; }
    return <SquareDirectCustomerPanel view={view} browser={browser} browseError={browseError} browseConnectionId={browseConnectionId} />;
  }
  if (productionSquareCustomerEnabled()) {
    const incoming = await headers();
    const host = new URL(PUBLIC_SITE_URL).host;
    if (incoming.get("host") !== host || incoming.get("x-forwarded-host") && incoming.get("x-forwarded-host") !== host ||
      incoming.get("x-forwarded-proto") !== "https") notFound();
    const view = await productionSquareCustomerView();
    if (!view) notFound();
    return <><nav aria-label="Settings navigation" className="mx-auto max-w-5xl px-6 pt-6"><Link href="/app/settings" prefetch={false} className="font-semibold text-vaeroex-blue hover:underline">← Back to Settings</Link></nav><SquareProductionCustomerPanel view={view} reads={await productionSquareReadViews(view)} /></>;
  }
  if (!squareCustomerConnectionsEnabled()) notFound();
  const incoming = await headers();
  const host = incoming.get("host") ?? "square-unavailable.invalid";
  let request: Request;
  try { request = new Request(`http://${host}${SQUARE_CUSTOMER_SETTINGS_PATH}`, { headers: incoming }); }
  catch { notFound(); }
  const view = await squareCustomerPageView(request);
  if (!view) notFound();
  return <main className="mx-auto max-w-3xl p-6"><nav aria-label="Settings navigation" className="mb-6"><Link href="/app/settings" prefetch={false} className="font-semibold text-vaeroex-blue hover:underline">← Back to Settings</Link></nav><SquareConnectionPanel view={view} /></main>;
}
