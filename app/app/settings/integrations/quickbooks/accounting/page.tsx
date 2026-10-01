import Link from "next/link";
import { ArrowLeft, Check, ShieldOff } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/operations/PageHeader";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { QBO_CUSTOMER_SETTINGS_PATH } from "@/lib/integrations/control-plane/qbo-customer-routes";
import {
  QBO_ACCOUNTING_API_PATH, QBO_ACCOUNTING_CONSENT, QBO_ACCOUNTING_ERRORS, QBO_ACCOUNTING_PATH, QBO_ACCOUNTING_POLICY,
  QboAccountingAuthorityError, parseQboAccountingSelection, readQboAccountingAuthority,
  requireQboAccountingOwner
} from "@/lib/integrations/qbo-customer/accounting-authority";
import type { QboAccountingAuthority } from "@/lib/integrations/qbo-customer/accounting-authority";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const fieldClass = "mt-2 block min-h-10 w-full min-w-0 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink";

export default async function QuickBooksAccountingPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!qboProductionCustomerConnectionsEnabled()) notFound();
  let connectionId: string | undefined;
  let message: string | undefined;
  try {
    const { error, ...selection } = await searchParams ?? {};
    connectionId = parseQboAccountingSelection(selection);
    if (error !== undefined) {
      if (typeof error !== "string" || !Object.hasOwn(QBO_ACCOUNTING_ERRORS, error)) throw Error("invalid_error");
      message = QBO_ACCOUNTING_ERRORS[error as keyof typeof QBO_ACCOUNTING_ERRORS];
    }
  }
  catch { message = "That accounting selection is invalid. Select a QuickBooks connection again."; }
  let access;
  try { access = await requireQboAccountingOwner(); }
  catch (error) {
    if (!(error instanceof QboAccountingAuthorityError)) throw error;
    if (error.reason === "disabled") notFound();
    message = "Workspace owner access is required to manage QuickBooks accounting authority.";
  }
  let connections: { id: string; safe_display_name: string; status: string }[] = [];
  let authority: QboAccountingAuthority | null = null;
  if (access) {
    try {
      const result = await access.supabase.from("integration_connection_summaries")
        .select("id,safe_display_name,status")
        .eq("workspace_id", access.workspaceId).eq("provider_key", "quickbooks_online")
        .eq("provider_environment", "production").neq("status", "deleted")
        .order("status_changed_at", { ascending: false });
      if (result.error) throw new QboAccountingAuthorityError("unavailable");
      connections = result.data ?? [];
      if (connectionId) authority = await readQboAccountingAuthority(access, connectionId);
    } catch {
      message = "Accounting authority is unavailable. Its status and coverage have not been verified.";
    }
  }
  const connection = connections.find((item) => item.id === authority?.connectionId);
  const canEnable = connection && ["initializing", "active", "degraded"].includes(connection.status);

  return <div className="mx-auto min-w-0 max-w-3xl space-y-6">
    <PageHeader eyebrow="Accounting connection" title="QuickBooks accounting authority"
      description="Owner consent for posted accrual accounting."
      actions={<Link href={QBO_CUSTOMER_SETTINGS_PATH} title="Back to settings" aria-label="Back to settings"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      </Link>} />

    {message ? <p role="alert" className="border-l-2 border-red-400 pl-3 text-sm text-red-700">{message}</p> : null}

    {access ? <section aria-labelledby="accounting-connection" className="space-y-4 border-b border-line pb-6">
      <h2 id="accounting-connection" className="text-base font-semibold text-ink">QuickBooks connection</h2>
      {connections.length ? <form action={QBO_ACCOUNTING_PATH} method="get" className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1 basis-64 text-sm font-medium text-ink">
          Connection
          <select required name="connectionId" defaultValue={connectionId ?? ""} className={fieldClass}>
            <option value="" disabled>Select a connection</option>
            {connections.map((item) => <option key={item.id} value={item.id}>{item.safe_display_name}</option>)}
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink">
          Review authority
        </button>
      </form> : !message ? <p className="text-sm text-muted">No QuickBooks connection is available in this workspace.</p> : null}
    </section> : null}

    {authority ? <>
      <section aria-labelledby="accounting-status" className="space-y-4 border-b border-line pb-6">
        <h2 id="accounting-status" className="break-words text-base font-semibold text-ink">{authority.businessEntityName}</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Accounting authority</dt><dd className="mt-1 font-semibold text-ink">{authority.enabled ? "Enabled" : "Not enabled"}</dd></div>
          <div><dt className="text-muted">Currency</dt><dd className="mt-1 font-semibold text-ink">{authority.currency}</dd></div>
          <div><dt className="text-muted">Saved effective date (UTC)</dt><dd className="mt-1 text-ink">{authority.effectiveFrom ? new Date(authority.effectiveFrom).toISOString().slice(0, 10) : "Not selected"}</dd></div>
          <div><dt className="text-muted">Coverage</dt><dd className="mt-1 font-semibold text-ink">Not assessed</dd></div>
        </dl>
        <p className="text-sm leading-6 text-muted">Coverage may be partial. Enabling authority does not establish complete posted revenue, full ledger coverage, or completed reconciliation.</p>
      </section>

      <section aria-labelledby="accounting-policy" className="space-y-4">
        <h2 id="accounting-policy" className="text-base font-semibold text-ink">Fixed accounting policy</h2>
        <ul id="accounting-policy-terms" className="list-disc space-y-2 pl-5 text-sm leading-6 text-ink">
          {QBO_ACCOUNTING_POLICY.map((term) => <li key={term}>{term}</li>)}
        </ul>
        {canEnable ? <form action={QBO_ACCOUNTING_API_PATH} method="post" className="space-y-4 border-t border-line pt-4">
          <input type="hidden" name="action" value="enable" />
          <input type="hidden" name="connectionId" value={authority.connectionId} />
          <input type="hidden" name="expectedAuthorityId" value={authority.authorityId ?? ""} />
          <label className="block max-w-xs text-sm font-medium text-ink">
            Effective date (UTC)
            <input required type="date" name="effectiveDate" max={new Date().toISOString().slice(0, 10)} className={fieldClass} />
          </label>
          <label className="flex items-start gap-3 text-sm leading-6 text-ink">
            <input required type="checkbox" name="policyConsent" value={QBO_ACCOUNTING_CONSENT}
              aria-describedby="accounting-policy-terms" className="mt-1 h-4 w-4 shrink-0" />
            <span>I approve this fixed accounting policy for this business entity from my selected effective date.</span>
          </label>
          <button type="submit" className="inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
            {authority.enabled ? "Confirm updated authority" : "Enable accounting authority"}
          </button>
        </form> : <p className="text-sm text-muted">This connection is not available for enabling accounting authority.</p>}
      </section>

      {authority.enabled && authority.authorityId ? <section aria-labelledby="revoke-authority" className="space-y-4 border-t border-line pt-6">
        <h2 id="revoke-authority" className="text-base font-semibold text-ink">Revoke accounting authority</h2>
        <p id="revoke-consequences" className="text-sm leading-6 text-muted">Revocation withdraws this authority&apos;s revenue contributions atomically. Stored source records and audit evidence are preserved. No fallback source is enabled automatically.</p>
        <form action={QBO_ACCOUNTING_API_PATH} method="post" className="space-y-4">
          <input type="hidden" name="action" value="revoke" />
          <input type="hidden" name="connectionId" value={authority.connectionId} />
          <input type="hidden" name="expectedAuthorityId" value={authority.authorityId} />
          <label className="flex items-start gap-3 text-sm leading-6 text-ink">
            <input required type="checkbox" name="confirmation" value="revoke" aria-describedby="revoke-consequences" className="mt-1 h-4 w-4 shrink-0" />
            <span>I confirm revocation of QuickBooks accounting authority for this business entity.</span>
          </label>
          <button type="submit" className="inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700">
            <ShieldOff aria-hidden="true" className="h-4 w-4 shrink-0" />Revoke accounting authority
          </button>
        </form>
      </section> : null}
    </> : null}
  </div>;
}
