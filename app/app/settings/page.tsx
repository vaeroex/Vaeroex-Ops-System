import { AuthMessage } from "@/components/auth/AuthMessage";
import { ThemeControls } from "@/components/app/ThemeControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { WorkspaceResetPanel } from "@/components/settings/WorkspaceResetPanel";
import { changePasswordAction } from "@/lib/auth/actions";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import type { Database } from "@/lib/supabase/types";

type SettingsPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    reset_operation?: string;
    reset_status?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const { context, supabase, workspaceId } = await requireWorkspacePage();
  const canResetWorkspace = context.membership?.role === "owner" || context.membership?.role === "admin";
  let resetCapabilityAvailable = true;
  let recentResetOperations: Array<
    Pick<
      Database["public"]["Tables"]["workspace_reset_operations"]["Row"],
      "id" | "storage_mode" | "setup_mode" | "status" | "purge_after" | "failure_summary" | "created_at"
    >
  > = [];

  if (canResetWorkspace) {
    const { data, error } = await supabase
      .from("workspace_reset_operations")
      .select("id,storage_mode,setup_mode,status,purge_after,failure_summary,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      resetCapabilityAvailable = false;
    } else {
      recentResetOperations = data || [];
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="User Settings"
        title="Vaeroex Settings"
        description="Manage your personal workspace experience, including the official Pulsar visual identity and display preferences."
      />

      <AuthMessage error={params?.error} message={params?.message} />

      <ThemeControls />

      <SectionCard
        title="Account Security"
        description="Change the password for your signed-in Vaeroex account. Use a strong password and update it only from a trusted device."
      >
        <form action={changePasswordAction} className="max-w-xl space-y-4">
          <label className="block text-sm font-medium text-ink">
            New password
            <input
              required
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            Confirm password
            <input
              required
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
            />
          </label>
          <p className="text-xs leading-5 text-muted">
            Passwords must be at least 8 characters. Vaeroex will keep you signed in after a successful update.
          </p>
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Change password
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Current workspace" description="Theme settings are personal to this browser. Workspace access and account permissions remain unchanged.">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Workspace</p>
            <p className="mt-2 text-sm font-semibold text-ink">{context.activeWorkspace?.name || "Setup required"}</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Role</p>
            <p className="mt-2 text-sm font-semibold text-ink">{context.membership?.role || "Setup pending"}</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Account</p>
            <p className="mt-2 text-sm font-semibold text-ink">{context.profile?.email || "Signed in"}</p>
          </div>
        </div>
      </SectionCard>

      {canResetWorkspace && context.activeWorkspace ? (
        <section className="space-y-3" aria-labelledby="danger-zone-title">
          <div>
            <p className="text-xs font-semibold uppercase text-red-700">Danger Zone</p>
            <h2 id="danger-zone-title" className="mt-1 text-xl font-semibold text-ink">Destructive workspace controls</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">These controls affect business content only. Account, access, billing, legal, and security history remain protected.</p>
          </div>
          <WorkspaceResetPanel
            workspaceId={workspaceId}
            workspaceName={context.activeWorkspace.name}
            available={resetCapabilityAvailable}
            recentOperations={recentResetOperations}
          />
        </section>
      ) : null}
    </div>
  );
}
