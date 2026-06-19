import { ThemeControls } from "@/components/app/ThemeControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export default async function SettingsPage() {
  const { context } = await requireWorkspacePage();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="User Settings"
        title="Vaeroex Settings"
        description="Manage your personal workspace experience, including the premium dark mode for long operating sessions."
      />

      <ThemeControls />

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
    </div>
  );
}
