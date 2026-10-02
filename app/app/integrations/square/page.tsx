import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SquareEvidenceCard } from "@/components/integrations/SquareEvidenceCard";
import { readSquareWorkspaceEvidence } from "@/lib/integrations/control-plane/square-workspace-evidence";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function SquareSandboxManagementPage() {
  const access = await requireWorkspacePage();
  const evidence = await readSquareWorkspaceEvidence(access.supabase, access.workspaceId, await headers());
  if (!evidence) notFound();

  return (
    <div className="workspace-page mx-auto max-w-5xl space-y-5">
      <PageHeader eyebrow="Integrations" title="Square Sandbox" description="Authorized observations for this workspace."
        actions={<Link href="/app/integrations" title="Back to integrations" aria-label="Back to integrations"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white text-ink hover:bg-slate-50">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </Link>} />
      <SquareEvidenceCard evidence={evidence} />
    </div>
  );
}
