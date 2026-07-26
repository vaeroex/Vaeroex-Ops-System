import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceAgreementActions } from "@/components/legal/WorkspaceAgreementActions";
import { WorkspaceAgreementDocument } from "@/components/legal/WorkspaceAgreementDocument";
import { hashWorkspaceAgreement } from "@/lib/legal/workspace-agreement-record";
import { parseWorkspaceAgreementSnapshot } from "@/lib/legal/workspace-agreement-schema";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function WorkspaceAgreementPage({
  params
}: {
  params: Promise<{ agreementId: string }>;
}) {
  const { agreementId } = await params;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data: agreement, error } = await supabase
    .from("workspace_agreements")
    .select("*")
    .eq("id", agreementId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !agreement) notFound();

  const parsed = parseWorkspaceAgreementSnapshot(agreement.agreement_snapshot_json);
  if (
    !parsed.success ||
    parsed.data.agreementId !== agreement.id ||
    parsed.data.workspaceId !== agreement.workspace_id ||
    hashWorkspaceAgreement(parsed.data) !== agreement.immutable_hash
  ) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-muted" aria-label="Breadcrumb">
          <Link href="/app/sources" className="font-semibold text-vaeroex-blue">Evidence</Link>
          <span aria-hidden="true">/</span>
          <Link href="/app/sources?tab=legal" className="font-semibold text-vaeroex-blue">Legal &amp; Agreements</Link>
          <span aria-hidden="true">/</span>
          <span>Workspace Agreement</span>
        </nav>
        <WorkspaceAgreementActions agreementId={agreement.id} />
      </div>
      <WorkspaceAgreementDocument snapshot={parsed.data} immutableHash={agreement.immutable_hash} />
    </div>
  );
}
