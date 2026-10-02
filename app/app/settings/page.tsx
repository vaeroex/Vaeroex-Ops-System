import { AuthMessage } from "@/components/auth/AuthMessage";
import { ThemeControls } from "@/components/app/ThemeControls";
import { ConnectionStatusPanel } from "@/components/integrations/ConnectionStatusPanel";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { changePasswordAction } from "@/lib/auth/actions";
import { qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { SquareEvidenceCard } from "@/components/integrations/SquareEvidenceCard";
import { readSquareWorkspaceEvidence } from "@/lib/integrations/control-plane/square-workspace-evidence";
import { headers } from "next/headers";
import Link from "next/link";
import { FileText } from "lucide-react";
import { squareDirectEnabled } from "@/lib/integrations/square-direct/server";

type SettingsPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const { context, supabase, workspaceId } = await requireWorkspacePage();
  const squareEvidence = await readSquareWorkspaceEvidence(supabase, workspaceId, await headers());
  const squareConnectionsEnabled = squareDirectEnabled() && context.membership?.role === "owner";
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
    <div className="workspace-page workspace-settings mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage optional connections, your account, and this browser’s appearance."
      />

      {squareConnectionsEnabled || qboConnectionsEnabled || squareEvidence ? (
        <section aria-labelledby="settings-connections" className="workspace-panel space-y-4">
          <div>
            <h2 id="settings-connections" className="text-lg font-semibold text-ink">Connections</h2>
            <p className="mt-1 text-sm text-muted">Optional sources for this workspace. Connecting a service is not required to use Vaeroex.</p>
          </div>

          {squareConnectionsEnabled ? <div className="workspace-settings-connection flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink">Square connection</h3>
              <p className="mt-1 text-sm text-muted">Manage this workspace’s connection and saved Payments.</p>
            </div>
            <Link href="/app/settings/integrations/square" className="workspace-row-link inline-flex min-h-10 shrink-0 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue">
              Manage Square
            </Link>
          </div> : null}

          {qboConnectionsEnabled ? (
            <SectionCard
              title="QuickBooks connection"
              description="Connection health and data freshness for this workspace."
            >
              <ConnectionStatusPanel
                connections={connections ?? []}
                freshness={freshness ?? []}
                businessEntities={businessEntities ?? []}
                canManage={context.membership?.role === "owner"}
              />
              {context.membership?.role === "owner" ? (
                <div className="flex flex-wrap items-center gap-4"><Link href="/app/settings/integrations/quickbooks/data"
                  className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-vaeroex-blue">
                  <FileText aria-hidden="true" className="h-4 w-4" />
                  View stored QuickBooks data
                </Link><Link href="/app/settings/integrations/quickbooks/accounting"
                  className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-vaeroex-blue">
                  Accounting authority
                </Link></div>
              ) : null}
            </SectionCard>
          ) : null}

          {squareEvidence ? <SquareEvidenceCard evidence={squareEvidence} /> : null}
        </section>
      ) : null}

      <div className="workspace-settings-account-grid grid items-start gap-5 lg:grid-cols-2">
      <SectionCard
        title="Account"
        description={context.profile?.email || "Signed in to Vaeroex"}
      >
        <details open={Boolean(params?.error || params?.message)}>
          <summary className="w-fit cursor-pointer rounded-md py-1 text-sm font-semibold text-vaeroex-blue outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-blue focus-visible:ring-offset-2">Change password</summary>
          <form action={changePasswordAction} className="mt-4 max-w-xl space-y-4">
            <AuthMessage error={params?.error} message={params?.message} />
            <p className="text-sm text-muted">Use a strong password and update it only from a trusted device.</p>
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
              Update password
            </button>
          </form>
        </details>
      </SectionCard>

      <SectionCard title="Workspace">
        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Current workspace</dt>
            <dd className="mt-1 font-semibold text-ink">{context.activeWorkspace?.name || "Setup required"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Your role</dt>
            <dd className="mt-1 font-semibold text-ink">{context.membership?.role || "Setup pending"}</dd>
          </div>
        </dl>
      </SectionCard>
      </div>

      <ThemeControls />
    </div>
  );
}
