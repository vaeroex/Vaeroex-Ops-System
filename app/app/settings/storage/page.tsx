import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { CapacityPurchase } from "@/components/storage-capacity/CapacityPurchase";
import { StorageFileList } from "@/components/storage-capacity/StorageFileList";
import { StorageTrash } from "@/components/storage-capacity/StorageTrash";
import { StorageUsageOverview } from "@/components/storage-capacity/StorageUsageOverview";
import { requireStorageAccess } from "@/lib/storage-capacity/access";
import { getWorkspaceCapacityBilling } from "@/lib/storage-capacity/billing";
import { getWorkspaceStorageUsage } from "@/lib/storage-capacity/server";

export const dynamic = "force-dynamic";

export default async function WorkspaceStoragePage({ searchParams }: {
  searchParams?: Promise<{ checkout?: string | string[] }>;
}) {
  const access = await requireStorageAccess({ allowExpired: true });
  const isOwner = access.membership.role === "owner";
  const canManage = ["owner", "admin", "manager"].includes(access.membership.role);
  const [usageResult, billingResult, paramsResult] = await Promise.allSettled([
    getWorkspaceStorageUsage(access),
    isOwner ? getWorkspaceCapacityBilling(access.workspaceId, access.user.id) : Promise.resolve(null),
    searchParams,
  ]);
  const usage = usageResult.status === "fulfilled" ? usageResult.value : null;
  const billing = billingResult.status === "fulfilled" ? billingResult.value : null;
  const params = paramsResult.status === "fulfilled" ? paramsResult.value : undefined;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Settings" title="Usage & Storage" description={`Storage and capacity for ${access.workspace.name}. Allowances belong only to this workspace.`}
      actions={<Link href="/app/settings" title="Back to Settings" aria-label="Back to Settings" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-ink hover:bg-slate-50"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    <nav aria-label="Storage sections" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-vaeroex-blue">
      <a href="#largest-storage-files" className="inline-flex min-h-11 items-center">Largest files</a>
      <a href="#storage-trash" className="inline-flex min-h-11 items-center">Trash & recovery</a>
      <a href="#separate-data-heading" className="inline-flex min-h-11 items-center">Other workspace data</a>
    </nav>
    {usage ? <>
      <StorageUsageOverview usage={usage} />
      {isOwner && billing ? <CapacityPurchase key={`${access.workspaceId}:${usage.paidPacks}`} workspaceId={access.workspaceId} workspaceName={access.workspace.name}
        currentPacks={usage.paidPacks} billing={billing} checkoutResult={typeof params?.checkout === "string" ? params.checkout : undefined} /> : null}
      {isOwner && !billing ? <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-semibold">Buy capacity</h2><p className="mt-1">Billing details are temporarily unavailable. Reload this page before purchasing or managing capacity. No purchase or cancellation has been made.</p><form action="/app/settings/storage" method="get"><button type="submit" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Reload billing details</button></form>
      </section> : null}
      {!isOwner ? <p className="text-sm text-muted">A workspace owner can buy capacity or manage recurring capacity purchases at any usage level.</p> : null}
      <section id="largest-storage-files" aria-labelledby="largest-storage-heading" className="rounded-lg border border-line bg-white p-4 sm:p-5">
        <div className="mb-4"><h2 id="largest-storage-heading" className="text-base font-semibold text-ink">Largest retained files</h2><p className="mt-1 text-sm text-muted">Up to 50 original files, largest first, including archived files and Trash. File contents are not shown.</p></div>
        <StorageFileList workspaceId={access.workspaceId} files={usage.largestFiles} canManage={canManage} />
      </section>
      <StorageTrash key={access.workspaceId} workspaceId={access.workspaceId} canManage={canManage} />
      <p className="text-xs text-muted">{usage.measuredAt ? <>Usage measured <time dateTime={usage.measuredAt}>{new Date(usage.measuredAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</time>.</> : "Usage measurement time is unavailable."} Uploads in progress reserve capacity before an original is accepted.</p>
    </> : <section role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <h2 className="font-semibold">Storage usage is temporarily unavailable</h2><p className="mt-1">This workspace includes 15 GB and 500 file slots. Used and available capacity could not be measured, so no zero-usage estimate is shown. Your files are retained.</p>
      <form action="/app/settings/storage" method="get"><button type="submit" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Reload storage usage</button></form>
    </section>}
  </div>;
}
