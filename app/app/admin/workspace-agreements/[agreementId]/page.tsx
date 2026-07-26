import Link from "next/link";
import { notFound } from "next/navigation";
import { resendWorkspaceAgreementAdminEmailAction } from "@/app/app/admin/workspace-agreements/actions";
import { WorkspaceAgreementActions } from "@/components/legal/WorkspaceAgreementActions";
import { WorkspaceAgreementDocument } from "@/components/legal/WorkspaceAgreementDocument";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { hashWorkspaceAgreement } from "@/lib/legal/workspace-agreement-record";
import { parseWorkspaceAgreementSnapshot } from "@/lib/legal/workspace-agreement-schema";

export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))
    : "Not available";
}

export default async function AdminWorkspaceAgreementPage({
  params,
  searchParams
}: {
  params: Promise<{ agreementId: string }>;
  searchParams?: Promise<{ message?: string; error?: string }>;
}) {
  const { agreementId } = await params;
  const notices = (await searchParams) || {};
  const { admin } = await requireVaeroexAdmin("/app");
  const { data: agreement, error } = await admin.from("workspace_agreements").select("*").eq("id", agreementId).maybeSingle();
  if (error || !agreement) notFound();
  const { data: delivery } = await admin
    .from("workspace_agreement_admin_email_deliveries")
    .select("*")
    .eq("agreement_id", agreementId)
    .maybeSingle();

  const parsed = parseWorkspaceAgreementSnapshot(agreement.agreement_snapshot_json);
  if (
    !parsed.success ||
    parsed.data.agreementId !== agreement.id ||
    parsed.data.workspaceId !== agreement.workspace_id ||
    hashWorkspaceAgreement(parsed.data) !== agreement.immutable_hash
  ) notFound();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <Link href="/app/admin/workspace-agreements" className="text-sm font-semibold text-vaeroex-blue">Back to Workspace Agreements</Link>
        <WorkspaceAgreementActions agreementId={agreement.id} admin />
      </div>
      {notices.message ? <p className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 print:hidden">{notices.message}</p> : null}
      {notices.error ? <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 print:hidden">{notices.error}</p> : null}
      <section className="rounded-lg border border-line bg-white p-4 shadow-panel print:hidden" aria-labelledby="admin-email-delivery-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="admin-email-delivery-title" className="font-semibold">Administrative email delivery</h2>
            <p className="mt-1 text-sm text-muted">
              {delivery
                ? `${delivery.status.charAt(0).toUpperCase()}${delivery.status.slice(1)} · ${delivery.attempt_count} provider attempt${delivery.attempt_count === 1 ? "" : "s"} · Updated ${formatDate(delivery.updated_at)}`
                : "No administrative delivery has been recorded for this agreement."}
            </p>
            {delivery?.failure_reason ? <p className="mt-1 text-xs text-muted">{delivery.failure_reason}</p> : null}
          </div>
          {!delivery || delivery.status === "failed" || delivery.status === "skipped" ? (
            <form action={resendWorkspaceAgreementAdminEmailAction}>
              <input type="hidden" name="agreement_id" value={agreement.id} />
              <button className="min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Send administrative email
              </button>
            </form>
          ) : null}
        </div>
      </section>
      <WorkspaceAgreementDocument snapshot={parsed.data} immutableHash={agreement.immutable_hash} />
    </div>
  );
}
