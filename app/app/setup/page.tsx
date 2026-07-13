import { SetupWizard } from "@/components/setup/SetupWizard";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { workspaceSetupCategories } from "@/data/workspace-categories";
import { getWorkspaceContext } from "@/lib/workspaces/current";
import { redirect } from "next/navigation";

type SetupPageProps = {
  searchParams?: Promise<{
    error?: string;
    reset_operation?: string;
  }>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  let resetOperationId: string | undefined;
  let existingWorkspaceName: string | undefined;

  if (supabase) {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (user) {
      const status = await getSubscriptionStatus({
        supabase,
        userId: user.id,
        email: user.email
      });

      if (!status.allowed) {
        redirect(`/billing-required?reason=${encodeURIComponent(status.reason)}`);
      }

      if (params?.reset_operation) {
        const { data: operation, error } = await supabase
          .from("workspace_reset_operations")
          .select("id,workspace_id,setup_mode,setup_status,status")
          .eq("id", params.reset_operation)
          .eq("setup_mode", "guided")
          .in("setup_status", ["pending", "in_progress"])
          .in("status", ["recoverable", "completed", "partial"])
          .maybeSingle();

        if (error || !operation) {
          redirect("/app/settings?error=This%20guided%20setup%20reset%20operation%20is%20not%20available.");
        }

        const workspaceContext = await getWorkspaceContext();
        if (workspaceContext.activeWorkspace?.id !== operation.workspace_id) {
          redirect("/app/settings?error=This%20guided%20setup%20operation%20does%20not%20match%20your%20active%20workspace.");
        }

        const { data: workspace } = await supabase.from("workspaces").select("name").eq("id", operation.workspace_id).maybeSingle();
        resetOperationId = operation.id;
        existingWorkspaceName = workspace?.name;
      }
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Setup wizard</p>
        <h2 className="mt-2 text-2xl font-semibold">{resetOperationId ? "Reconfigure your Vaeroex workspace" : "Create your Vaeroex workspace"}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          {resetOperationId
            ? "Confirm the organizational context Vaeroex should use after the reset. No sample KPIs, Business Signals, reports, or evidence will be created. You can leave setup without adding records."
            : "Answer a few setup questions and choose the type of operational environment Vaeroex will analyze. This helps configure initial dashboards, terminology, Business Signals, and intelligence context. You can adjust this later."}
        </p>
      </section>
      <ComplianceNotice />
      <SetupWizard
        categories={workspaceSetupCategories}
        error={params?.error}
        resetOperationId={resetOperationId}
        existingWorkspaceName={existingWorkspaceName}
      />
    </div>
  );
}
