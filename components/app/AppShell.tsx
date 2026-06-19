import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { selectWorkspaceAction } from "@/lib/workspaces/actions";
import { AppNavigation } from "@/components/app/AppNavigation";
import { ToastRegion } from "@/components/app/ToastRegion";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { isVaeroexAdminEmail } from "@/lib/admin/admin-emails";
import type { Profile, Workspace, WorkspaceMember } from "@/lib/supabase/types";

const baseNavSections = [
  {
    label: "Home",
    items: [
      { href: "/app", label: "Executive Dashboard" },
      { href: "/app/notifications", label: "Notifications" }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/app/tasks", label: "Tasks" },
      { href: "/app/checklists", label: "Checklists" },
      { href: "/app/issues", label: "Issues" },
      { href: "/app/assets", label: "Assets" },
      { href: "/app/people", label: "People" }
    ]
  },
  {
    label: "Sales & Customers",
    items: [
      { href: "/app/crm", label: "CRM" },
      { href: "/app/forms", label: "Forms" },
      { href: "/app/form-submissions", label: "Form Submissions" }
    ]
  },
  {
    label: "Data & Insights",
    items: [
      { href: "/app/kpis", label: "KPIs" },
      { href: "/app/files", label: "Files" },
      { href: "/app/reports", label: "Reports" }
    ]
  },
  {
    label: "Knowledge Base",
    items: [{ href: "/app/sops", label: "SOPs" }]
  },
  {
    label: "Vaeroex",
    items: [{ href: "/app/agents", label: "Ask Vaeroex" }]
  },
  {
    label: "Account",
    items: [
      { href: "/app/account/subscription", label: "Subscription" },
      { href: "/app/support", label: "Support" }
    ]
  }
] satisfies Array<{ label: string; items: Array<{ href: string; label: string }> }>;

const adminNavSection = {
  label: "Admin",
  items: [
    { href: "/app/admin", label: "Admin Dashboard" },
    { href: "/app/admin/customers", label: "Customers" },
    { href: "/app/admin/workspaces", label: "Workspaces" },
    { href: "/app/admin/subscriptions", label: "Subscriptions" },
    { href: "/app/admin/ai-usage", label: "AI Usage" },
    { href: "/app/admin/support-requests", label: "Support Requests" },
    { href: "/app/admin/audit-logs", label: "Audit Logs" }
  ]
} satisfies { label: string; items: Array<{ href: string; label: string }> };

type AppShellProps = {
  children: ReactNode;
  profile: Profile | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  membership: WorkspaceMember | null;
  notificationUnreadCount?: number;
};

function NotificationBadge({ count, light = false }: { count: number; light?: boolean }) {
  if (!count) {
    return null;
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${light ? "bg-white text-vaeroex-blue" : "bg-vaeroex-blue text-white shadow-sm shadow-blue-900/20"}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function workspaceAccessLabel(workspace: Workspace | null) {
  if (!workspace) return "Setup required";
  if (workspace.subscription_status === "demo") return "Demo workspace";
  if (!workspace.subscription_required || workspace.manually_unlocked || ["active", "trialing"].includes(workspace.subscription_status)) return "Active";
  if (workspace.subscription_status === "manual_review") return "Pending activation";
  return "Subscription required";
}

export function AppShell({ children, profile, workspaces, activeWorkspace, membership, notificationUnreadCount = 0 }: AppShellProps) {
  const navSections = isVaeroexAdminEmail(profile?.email) ? [...baseNavSections, adminNavSection] : baseNavSections;
  const accessLabel = workspaceAccessLabel(activeWorkspace);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-800 bg-vaeroex-navy p-5 text-white shadow-command lg:flex lg:flex-col">
        <Link href="/app" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-vaeroex-blue text-sm font-bold shadow-sm shadow-blue-950/30">V</span>
          <span>
            <span className="block text-sm font-semibold tracking-wide">Vaeroex</span>
            <span className="block text-xs text-vaeroex-silver">Executive Ops System</span>
          </span>
        </Link>

        <form action={selectWorkspaceAction} className="mt-7 rounded-lg border border-white/10 bg-white/[0.06] p-3 shadow-sm shadow-black/10">
          <p className="text-xs uppercase tracking-[0.18em] text-vaeroex-silver">Workspace</p>
          <select
            name="workspace_id"
            aria-label="Workspace switcher"
            className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white outline-none focus:border-vaeroex-blue"
            defaultValue={activeWorkspace?.id || ""}
          >
            {workspaces.length ? (
              workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}{workspace.subscription_status === "demo" ? " (Demo)" : ""}
                </option>
              ))
            ) : (
              <option value="">No workspace yet</option>
            )}
          </select>
          <p className="mt-2 text-xs text-vaeroex-silver">
            Role: <span className="font-semibold text-white">{membership?.role || "setup pending"}</span>
          </p>
          <p className="mt-2 text-xs text-vaeroex-silver">
            Status: <span className="font-semibold text-white">{accessLabel}</span>
          </p>
          {workspaces.length > 1 ? (
            <button className="mt-3 w-full rounded-md border border-white/10 px-2 py-1.5 text-xs font-semibold text-slate-100 hover:border-vaeroex-accent hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Switch workspace
            </button>
          ) : null}
        </form>

        <AppNavigation sections={navSections} notificationUnreadCount={notificationUnreadCount} />

        <form action={signOutAction} className="mt-5">
          <button className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:bg-white/10">
            Sign out
          </button>
        </form>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-vaeroex-navy px-4 py-3 text-white shadow-command lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-silver">
                {activeWorkspace?.name || "Setup required"} · {accessLabel}
              </p>
              <h1 className="mt-1 text-lg font-semibold tracking-wide">Vaeroex Command Center</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/app/agents"
                className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/20 hover:bg-vaeroex-accent hover:text-vaeroex-navy"
              >
                Ask Vaeroex
              </Link>
              <Link
                href="/app/notifications"
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:bg-white/15"
              >
                <span>Notifications</span>
                <NotificationBadge count={notificationUnreadCount} />
              </Link>
              <div className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-100">
                {profile?.full_name || profile?.email || "User"}
              </div>
            </div>
          </div>
        </header>

        <nav className="border-b border-line bg-white px-4 py-2 lg:hidden">
          <AppNavigation sections={navSections} notificationUnreadCount={notificationUnreadCount} mobile />
        </nav>

        <main className="mx-auto w-full max-w-[1480px] space-y-5 p-4 lg:p-6">
          <ComplianceNotice compact />
          {children}
        </main>
      </div>
      <ToastRegion />
    </div>
  );
}
