import React from "react";
import { SquareDirectCustomerPanel } from "@/components/integrations/SquareDirectCustomerPanel";
import { QboStoredDataView } from "@/lib/integrations/qbo-customer/view";
import { GoogleSheetsMappingEditor } from "@/components/integrations/google-sheets/GoogleSheetsMappingEditor";
import { PageHeader } from "@/components/operations/PageHeader";
import { squareView, squareBrowser, qboBrowser, qboQuery, sheetsConnectionId, sheetsHeaders, sheetsMapping } from "./integration-data";

// Actual production components with validated in-memory read inputs. No provider
// authorization, connection mutation, importer or production account is involved.
export function integrationScreen(pathname: string) {
  if (pathname === "/app/settings/integrations/square") return <SquareDirectCustomerPanel view={squareView} browser={squareBrowser} />;
  if (pathname === "/app/settings/integrations/quickbooks/data") return <div className="min-w-0 space-y-6"><PageHeader eyebrow="Accounting connection" title="Stored QuickBooks data" description="Source observations" /><QboStoredDataView browser={qboBrowser} query={qboQuery} /></div>;
  if (pathname === "/app/settings/integrations/google-sheets") return <div className="min-w-0 space-y-6"><PageHeader eyebrow="Google Sheets · Limited pilot" title="Coastal Kitchen" description="Guest satisfaction by week" /><GoogleSheetsMappingEditor connectionId={sheetsConnectionId} headers={sheetsHeaders} savedMapping={sheetsMapping} automaticEnabled={false} approved={false} /></div>;
  return null;
}
