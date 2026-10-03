import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/operations/PageHeader";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { QBO_CUSTOMER_SETTINGS_PATH } from "@/lib/integrations/control-plane/qbo-customer-routes";
import { QboCustomerBrowseError, qboCustomerStoredData } from "@/lib/integrations/qbo-customer/server";
import { QboStoredDataUnavailable, QboStoredDataView } from "@/lib/integrations/qbo-customer/view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QuickBooksDataPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!qboProductionCustomerConnectionsEnabled()) notFound();
  // Authentication redirects must propagate; do not turn them into browse errors.
  let data;
  let error: "denied" | "query" | "unavailable" | null = null;
  try { data = await qboCustomerStoredData(await searchParams ?? {}); }
  catch (failure) {
    if (!(failure instanceof QboCustomerBrowseError)) throw failure;
    error = failure.reason;
  }
  if (!data && !error) notFound();
  return <div className="min-w-0 space-y-6">
    <PageHeader eyebrow="Accounting connection" title="Stored QuickBooks data" description="Source observations"
      actions={<Link href={QBO_CUSTOMER_SETTINGS_PATH} title="Back to settings" aria-label="Back to settings" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line"><ArrowLeft className="h-4 w-4" /></Link>} />
    {data ? <QboStoredDataView {...data} /> : <QboStoredDataUnavailable reason={error ?? "unavailable"} />}
  </div>;
}
