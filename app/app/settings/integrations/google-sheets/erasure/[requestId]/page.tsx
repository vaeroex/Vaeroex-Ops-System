import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireSheetsManager } from "@/lib/integrations/google-sheets/route-helpers";
import { erasureScopeSchema, type ErasureRpcClient, type ErasureScope } from "../scope";
import { ErasureApprovalForm } from "./ErasureApprovalForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Sheets erasure approval", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function GoogleSheetsErasurePage({ params }: { params: Promise<{ requestId: string }> }) {
  const id = z.string().uuid().safeParse((await params).requestId);
  if (!id.success) notFound();
  let scope: ErasureScope;
  try {
    const access = await requireSheetsManager(undefined, false);
    const client = access.supabase as unknown as ErasureRpcClient;
    const result = await client.rpc("read_google_sheets_erasure_request_v1", { p_request_id: id.data });
    if (result.error) notFound();
    scope = erasureScopeSchema.parse(result.data);
    if (scope.requestId !== id.data || scope.workspaceId !== access.workspaceId) notFound();
  } catch {
    notFound();
  }

  return <div className="workspace-page mx-auto max-w-3xl space-y-5">
    <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted">Google Sheets</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Approve data erasure</h1>
      </div>
      <Link href="/app/integrations" prefetch={false} title="Back to integrations" aria-label="Back to integrations"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-ink hover:bg-slate-50">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      </Link>
    </header>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="min-w-0"><dt className="font-medium text-ink">Connection ID</dt><dd className="mt-1 break-all font-mono text-xs leading-6 text-slate-600">{scope.connectionId}</dd></div>
      <div className="min-w-0"><dt className="font-medium text-ink">Request ID</dt><dd className="mt-1 break-all font-mono text-xs leading-6 text-slate-600">{scope.requestId}</dd></div>
    </dl>
    <section aria-label="Erasure scope" className="space-y-3 text-sm leading-6 text-slate-600">
      <p>This scope covers permanent erasure of the Google-derived imports and history listed below from Vaeroex Ops System. Erasure cannot be undone. The source must stop syncing and remain disconnected.</p>
      <p>Any selected analysis that combines Google Sheets with other sources will be deleted in full only with your approval. Its underlying unrelated sources are preserved, along with the items marked to keep.</p>
      <p>Your Google spreadsheet will not be modified. Revoking the Google access grant is required before erasure and may affect other connections using the same Google account.</p>
      <p>This page records your scope approval only. Erasure requires a separate execution step. Opening this page or approving the request does not execute erasure.</p>
    </section>
    <section aria-labelledby="erasure-counts" className="border-y border-line py-4">
      <h2 id="erasure-counts" className="text-base font-semibold text-ink">Records in scope</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {Object.entries(scope.counts).map(([label, count]) => <div key={label} className="flex min-w-0 justify-between gap-3">
          <dt className="break-words text-slate-600">{label.replaceAll("_", " ")}</dt>
          <dd className="shrink-0 font-medium tabular-nums text-ink">{count.toLocaleString("en-US")}</dd>
        </div>)}
      </dl>
    </section>
    <ErasureApprovalForm key={`${scope.requestId}:${scope.scopeHash}:${scope.state}`} scope={scope} />
  </div>;
}
