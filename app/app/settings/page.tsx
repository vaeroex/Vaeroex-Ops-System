import { AuthMessage } from "@/components/auth/AuthMessage";
import { ThemeControls } from "@/components/app/ThemeControls";
import { ConnectionStatusPanel } from "@/components/integrations/ConnectionStatusPanel";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { changePasswordAction } from "@/lib/auth/actions";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type SettingsPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const { context, supabase, workspaceId } = await requireWorkspacePage();
  const qboConnectionsEnabled = qboProductionCustomerConnectionsEnabled();
  const { data: connections } = qboConnectionsEnabled
    ? await supabase
        .from("integration_connection_summaries")
        .select("id, provider_key, safe_display_name, status, status_changed_at")
        .eq("workspace_id", workspaceId)
        .eq("provider_key", "quickbooks_online")
        .not("status", "in", '("deleted","disconnected")')
        .order("status_changed_at", { ascending: false })
    : { data: [] };
  const canManage = ["owner", "admin", "manager"].includes(
    context.membership?.role ?? ""
  );
  const { data: businessEntities } = qboConnectionsEnabled && canManage
    ? await supabase
        .from("business_entities")
        .select("id, display_name")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("display_name", { ascending: true })
    : { data: [] };
  const connectionIds = (connections ?? []).map((connection) => connection.id);
  const { data: freshness } = connectionIds.length
    ? await supabase
        .from("integration_freshness_summaries")
        .select("connection_id, scope_key, status, last_successful_sync_at, calculated_at")
        .eq("workspace_id", workspaceId)
        .in("connection_id", connectionIds)
    : { data: [] };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="User Settings"
        title="Vaeroex Settings"
        description="Manage your personal workspace experience, including the official Pulsar visual identity and display preferences."
      />

      <ThemeControls />

      {qboConnectionsEnabled ? (
        <SectionCard
          title="Accounting connection"
          description="Connection health and data freshness for this workspace."
        >
          <ConnectionStatusPanel
            connections={connections ?? []}
            freshness={freshness ?? []}
            businessEntities={businessEntities ?? []}
            canManage={canManage}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Account Security"
        description="Change the password for your signed-in Vaeroex account. Use a strong password and update it only from a trusted device."
      >
        <form action={changePasswordAction} className="max-w-xl space-y-4">
          <AuthMessage error={params?.error} message={params?.message} />
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
    </div>
  );
}
