import { providers, catalog } from "@/lib/integrations/reporting/catalog";
import { available as reportingAvailable } from "@/lib/integrations/reporting/security";
import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/operations/PageHeader";
import { customerConnectionStatus } from "@/lib/integrations/control-plane/customer-status";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { readSquareWorkspaceEvidence } from "@/lib/integrations/control-plane/square-workspace-evidence";
import { squareDirectEnabled, squareDirectView, squareSettingsPath } from "@/lib/integrations/square-direct/server";
import type { DirectView } from "@/lib/integrations/square-direct/contracts";
import { sheetsEnabled } from "@/lib/integrations/google-sheets/server";
import { GOOGLE_SHEETS_PILOT } from "@/lib/integrations/google-sheets/availability";
import { admin as loyverseAdmin, enabled as loyverseEnabled } from "@/lib/integrations/loyverse/server";
import { admin as zohoAdmin, enabled as zohoEnabled } from "@/lib/integrations/zoho-books/server";
import { admin as wixAdmin, enabled as wixEnabled } from "@/lib/integrations/wix-orders/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { ProviderCard, ProviderCatalog } from "./_ProviderCard";
import { readQuickBooksStatus } from "./_qbo";

export const dynamic = "force-dynamic";

const squareLabels: Record<DirectView["connections"][number]["state"], string> = {
  consent_pending: "Waiting for Square authorization",
  exchanging: "Finishing Square authorization",
  mapping_required: "Choose a Square location",
  connected: "Connected",
  syncing: "Reading Square Payments",
  retry_required: "Payments update needs another attempt",
  reauthorization_required: "Square authorization needs renewal",
  disconnected: "Disconnected"
};

export default async function IntegrationsPage() {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const squareEnabled = squareDirectEnabled() && owner;
  const qboEnabled = qboProductionCustomerConnectionsEnabled();
  const googleSheetsEnabled = sheetsEnabled();
  const loyverseAvailable = loyverseEnabled();
  const zohoAvailable = zohoEnabled();
  const wixAvailable = wixEnabled();
  const [square, qbo, squareEvidence, googleSheets, loyverse, zoho, wix, reporting] = await Promise.all([
    squareEnabled ? squareDirectView() : null,
    qboEnabled ? readQuickBooksStatus(access) : null,
    readSquareWorkspaceEvidence(access.supabase, access.workspaceId, await headers()),
    googleSheetsEnabled ? access.supabase.from("google_sheets_connections").select("status, active_approval_id, revocation_pending, authorization_uncertain").eq("workspace_id", access.workspaceId) : null,
    loyverseAvailable ? loyverseAdmin().from("loyverse_connections").select("status").eq("workspace_id", access.workspaceId).neq("status", "disconnected") : null,
    zohoAvailable ? zohoAdmin().from("zoho_books_connections").select("status").eq("workspace_id", access.workspaceId).neq("status", "disconnected") : null,
    wixAvailable ? wixAdmin().from("wix_order_connections").select("status").eq("workspace_id", access.workspaceId).neq("status", "disconnected") : null,
    providers.some(reportingAvailable) ? access.supabase.from("reporting_connections").select("provider,status").eq("workspace_id", access.workspaceId).neq("status", "disconnected") : null
  ]);
  const squareStatuses = square?.connections.map((connection) =>
    connection.recoveryRequired ? "Connection recovery required"
      : connection.revocationPending ? "Disconnecting" : squareLabels[connection.state]);
  const qboStatuses = qbo?.connections.map((connection) => customerConnectionStatus(
    connection, qbo.freshness.filter((row) => row.connection_id === connection.id)
  ).status);

  return (
    <div className="workspace-page mx-auto max-w-5xl space-y-5">
      <PageHeader eyebrow="Workspace" title="Plug-ins" description="Find plug-ins by the work you do. View connection status and manage your workspace data." />
      <ProviderCatalog>
          {squareEnabled ? <ProviderCard id="square" name="Square" description="Payments and location connections."
            reads="Connected Square locations and payment IDs, dates, status, amounts, and currency."
            requires="A Square seller account; the workspace owner must authorize access."
            statuses={!square ? ["Status unavailable"] : squareStatuses?.length ? [...new Set(squareStatuses)] : ["Not connected"]}
            href={squareSettingsPath} action={square?.available && !square.connections.length ? "Connect Square" : "Manage Square"} /> : null}
          {qboEnabled ? <ProviderCard id="quickbooks" name="QuickBooks Online" description="Accounting connections and stored financial data."
            reads="Company details, accounts, customers, vendors, items, sales and expense transactions, and financial reports."
            requires="A QuickBooks Online company and an active Vaeroex business entity."
            statuses={!qbo ? ["Status unavailable"] : qboStatuses?.length ? [...new Set(qboStatuses)] : ["Not connected"]}
            href="/app/settings/integrations/quickbooks" action={owner && qbo && !qbo.connections.length ? "Connect QuickBooks" : "Manage QuickBooks"} /> : null}
          {loyverseAvailable ? <ProviderCard id="loyverse" availability="Historical import testing pending" name="Loyverse" description="Read-only POS sales with selectable imports and saved history."
            reads="Merchant details and receipt totals, refunds, and dates; no customer details are stored."
            requires="A U.S. Loyverse merchant account and owner authorization."
            statuses={loyverse?.error ? ["Status unavailable"] : loyverse?.data?.length
              ? [...new Set(loyverse.data.map((connection) => connection.status === "connected" ? "Connected" :
                connection.status === "reauthorization_required" ? "Reauthorization required" : "Waiting for authorization"))]
              : ["Not connected"]}
            href="/app/integrations/loyverse" action={owner && !loyverse?.data?.length ? "Connect Loyverse" : "Manage Loyverse"} /> : null}
          {zohoAvailable ? <ProviderCard id="zoho-books" availability="Historical import testing pending" name="Zoho Books" description="Read-only invoice and expense totals with selectable imports and saved history."
            reads="Organization, invoice, and expense totals and dates; no contacts or line items are stored."
            requires="A U.S. Zoho Books organization and owner authorization."
            statuses={zoho?.error ? ["Status unavailable"] : zoho?.data?.length
              ? [...new Set(zoho.data.map((connection) => connection.status === "connected" ? "Connected" :
                connection.status === "choose_organization" ? "Choose an organization" :
                connection.status === "reauthorization_required" ? "Reauthorization required" : "Waiting for authorization"))]
              : ["Not connected"]}
            href="/app/integrations/zoho-books" action={owner && !zoho?.data?.length ? "Connect Zoho Books" : "Manage Zoho Books"} /> : null}
          {owner || wixAvailable ? <ProviderCard id="wix-orders" name="Wix online orders" description="Read-only order counts and totals with selectable imports and saved history."
            reads="Order dates, totals, currency, and payment status; no customer details or items are stored."
            requires="A U.S. Wix site with online orders enabled and a Wix plan that supports payments. Wix Restaurants Orders must be installed for restaurant orders."
            availability={wixAvailable ? "Unlisted connector" : "Setup in progress"}
            availabilityNote="Public App Market review is separate from this connection. Historical imports still need live connection testing."
            statuses={!wixAvailable ? [] : wix?.error ? ["Status unavailable"] : wix?.data?.length
              ? [...new Set(wix.data.map((connection) => connection.status === "connected" ? "Connected" :
                connection.status === "pending" ? "Waiting for Wix installation" : "Reconnect required"))]
              : ["Not connected"]}
            href="/app/integrations/wix-orders" action={wixAvailable ? "Manage Wix" : "View Wix requirements"} /> : null}
          {providers.filter(provider => owner || reportingAvailable(provider)).map(provider => {
            const info = catalog[provider], enabled = reportingAvailable(provider);
            const connection = reporting?.data?.find(row => row.provider === provider);
            const status = reporting?.error ? "Status unavailable" :
              connection?.status === "connected" ? "Connected" : connection?.status === "choose_account" ? "Choose an account" :
              connection?.status === "pending" ? "Waiting for authorization" : connection?.status === "reauthorization_required" ? "Reauthorization required" : "Not connected";
            return <ProviderCard id={provider} key={provider} name={info.name} description={info.description} reads={`${Object.values(info.metrics).join(", ")}.`}
              requires={info.auth === "oauth" ? "Owner authorization and an eligible provider account." : "An owner-provided API key with access to the selected account."}
              availability={!enabled ? "Configuration required" : provider === "katana" ? "Private API key connection" : undefined}
              availabilityNote={provider === "katana" ? "Public OAuth partnership is not approved." : undefined}
              statuses={enabled ? [status] : []} href={`/app/integrations/${provider}`} action={enabled ? `Manage ${info.name}` : `View ${info.name} setup`} />;
          })}
          {googleSheetsEnabled || owner ? <ProviderCard id="google-sheets" name="Google Sheets" description={GOOGLE_SHEETS_PILOT.catalog}
            reads="The selected spreadsheet, sheet names, column headings, and approved data columns."
            requires="A Google account with access to the spreadsheet; connection awaits Google approval."
            availability={googleSheetsEnabled ? "Limited pilot" : "Configuration required"}
            availabilityNote="Only approved Google test accounts can connect; Google Sheets is not generally available."
            statuses={!googleSheetsEnabled ? [] : googleSheets?.error ? ["Status unavailable"] : googleSheets?.data?.length ? [...new Set(googleSheets.data.map((connection) =>
              connection.revocation_pending ? "Disconnect needs another attempt" : connection.authorization_uncertain ? "Authorization needs recovery" : connection.status === "connected" ? connection.active_approval_id ? "Connected" : "Mapping needs approval" : connection.status === "reauthorization_required" ? "Reauthorization required" : connection.status === "pending_authorization" ? "Waiting for Google authorization" : "Disconnected"))] : ["Not connected"]}
            href="/app/settings/integrations/google-sheets" action={googleSheetsEnabled ? "Manage Google Sheets" : "View Google Sheets setup"}>
            <Link href="/app/sources" prefetch={false} className="text-sm font-semibold text-vaeroex-blue underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Upload spreadsheet files instead</Link>
          </ProviderCard> : null}
          {squareEvidence ? <ProviderCard id="square-sandbox" name="Square Sandbox" description="Verified non-economic observations."
            reads="Sandbox observations for testing."
            requires="A Square Sandbox test connection."
            availability="Sandbox only" statuses={["Sync health unknown"]} href="/app/integrations/square" action="View Square Sandbox" /> : null}
        </ProviderCatalog>
    </div>
  );
}
