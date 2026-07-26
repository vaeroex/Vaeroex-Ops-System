import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceAgreementActions } from "@/components/legal/WorkspaceAgreementActions";
import { WorkspaceAgreementDocument } from "@/components/legal/WorkspaceAgreementDocument";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { hashWorkspaceAgreement } from "@/lib/legal/workspace-agreement-record";
import { parseWorkspaceAgreementSnapshot } from "@/lib/legal/workspace-agreement-schema";

export const dynamic = "force-dynamic";

export default async function AdminWorkspaceAgreementPage({ params }: { params: Promise<{ agreementId: string }> }) {
  const { agreementId } = await params;
  const { admin } = await requireVaeroexAdmin("/app");
  const { data: agreement, error } = await admin.from("workspace_agreements").select("*").eq("id", agreementId).maybeSingle();
  if (error || !agreement) notFound();

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
      <WorkspaceAgreementDocument snapshot={parsed.data} immutableHash={agreement.immutable_hash} />
    </div>
  );
}
