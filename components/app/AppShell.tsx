import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { selectWorkspaceAction } from "@/lib/workspaces/actions";
import { AppNavigation } from "@/components/app/AppNavigation";
import { GlobalSearch } from "@/components/app/GlobalSearch";
import { ThemeControls } from "@/components/app/ThemeControls";
import { ToastRegion } from "@/components/app/ToastRegion";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import { isVaeroexAdminEmail } from "@/lib/admin/admin-emails";
import { legalLinks } from "@/lib/legal/content";
import type { Profile, Workspace, WorkspaceMember } from "@/lib/supabase/types";

const baseNavSections = [
  {
    label: "Home",
    items: [
      { href: "/app", label: "Operations Intelligence" },
      { href: "/app/notifications", label: "Notifications" }
    ]
  },
  {
    label: "Execution",
    items: [
      { href: "/app/tasks", label: "Follow-ups" },
      { href: "/app/checklists", label: "Checklists" },
      { href: "/app/issues", label: "Issues" },
      { href: "/app/assets", label: "Assets" },
      { href: "/app/people", label: "People" }
    ]
  },
  {
    label: "Relationships",
    items: [
      { href: "/app/crm", label: "CRM" },
      { href: "/app/forms", label: "Forms" },
      { href: "/app/form-submissions", label: "Form Submissions" }
    ]
  },
  {
    label: "Data & Intelligence",
    items: [
      { href: "/app/kpis", label: "KPIs" },
      { href: "/app/kpis/settings", label: "KPI Settings" },
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
      { href: "/app/settings", label: "Settings" },
      { href: "/app/account/subscription", label: "Subscription" },
      { href: "/app/help", label: "Help Center" },
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
    { href: "/app/admin/ai-usage", label: "Vaeroex Usage" },
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
  if (workspace.subscription_status === "demo") return "Demo Workspace";
  if (!workspace.subscription_required || workspace.manually_unlocked || ["active", "trialing"].includes(workspace.subscription_status)) return "Active";
  if (workspace.subscription_status === "manual_review") return "Pending activation";
  return "Subscription required";
}

function workspaceStatusTone(label: string) {
  if (label === "Active") return "border-emerald-300/30 bg-emerald-400/15 text-emerald-100";
  if (label === "Demo Workspace") return "border-vaeroex-accent/40 bg-vaeroex-accent/15 text-vaeroex-accent";
  if (label === "Pending activation") return "border-amber-300/30 bg-amber-300/15 text-amber-100";
  return "border-red-300/30 bg-red-400/15 text-red-100";
}

export function AppShell({ children, profile, workspaces, activeWorkspace, notificationUnreadCount = 0 }: AppShellProps) {
  const navSections = isVaeroexAdminEmail(profile?.email) ? [...baseNavSections, adminNavSection] : baseNavSections;
  const accessLabel = workspaceAccessLabel(activeWorkspace);
  const isDemoWorkspace = activeWorkspace?.subscription_status === "demo";
  const workspaceDisplayName = isDemoWorkspace ? "Demo Workspace" : activeWorkspace?.name || "Setup required";

  return (
    <div className="vaeroex-app-shell min-h-dvh overflow-x-hidden bg-[#f8fafc] text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-800 bg-vaeroex-navy p-5 text-white shadow-command lg:flex lg:flex-col">
        <Link href="/app" className="group flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-3 shadow-sm shadow-black/10">
          <VaeroexLogo variant="full" size="lg" priority className="transition group-hover:scale-[1.01]" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-silver">Intelligence Platform</span>
        </Link>

        <form action={selectWorkspaceAction} className="mt-5 rounded-lg border border-white/10 bg-white/[0.055] p-3 shadow-sm shadow-black/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{workspaceDisplayName}</p>
              {isDemoWorkspace && activeWorkspace?.name ? (
                <p className="mt-0.5 truncate text-xs text-vaeroex-silver">{activeWorkspace.name}</p>
              ) : null}
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${workspaceStatusTone(accessLabel)}`}>
              {isDemoWorkspace ? "Sample Business Environment" : accessLabel}
            </span>
          </div>
          <select
            name="workspace_id"
            aria-label="Workspace switcher"
            className="mt-3 w-full rounded-md border border-white/10 bg-slate-950/80 px-2 py-1.5 text-xs font-semibold text-white outline-none focus:border-vaeroex-blue"
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
          {workspaces.length > 1 ? (
            <button className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
              Switch Workspace
            </button>
          ) : null}
        </form>

        <AppNavigation sections={navSections} notificationUnreadCount={notificationUnreadCount} />

        <form action={signOutAction} className="mt-5">
          <button className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
            Sign out
          </button>
        </form>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-vaeroex-navy px-3 py-3 text-white shadow-command sm:px-4 lg:px-8">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-lg border border-white/15 bg-white/10 shadow-sm shadow-black/10">
                <VaeroexLogo variant="symbol" size="xs" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-silver">
                  {activeWorkspace?.name || "Setup required"} · {accessLabel}
                </p>
                <h1 className="mt-1 text-lg font-semibold tracking-wide">Vaeroex Intelligence Hub</h1>
              </div>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
              <GlobalSearch className="hidden w-56 shrink-0 xl:block" />
              <GlobalSearch variant="icon" className="xl:hidden" />
              <Link
                href="/app/agents"
                className="hidden items-center justify-center rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/20 hover:bg-blue-950/70 hover:text-white hover:ring-1 hover:ring-vaeroex-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 sm:inline-flex"
              >
                Ask Vaeroex
              </Link>
              <Link
                href="/app/notifications"
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
              >
                <span className="hidden sm:inline">Notifications</span>
                <span className="sm:hidden">Alerts</span>
                <NotificationBadge count={notificationUnreadCount} />
              </Link>
              <ThemeControls variant="compact" />
              <div className="hidden max-w-full truncate rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm text-slate-100 md:block">
                {profile?.full_name || profile?.email || "User"}
              </div>
            </div>
          </div>
        </header>

        <nav className="border-b border-line bg-white px-3 py-2 sm:px-4 lg:hidden">
          <AppNavigation sections={navSections} notificationUnreadCount={notificationUnreadCount} mobile />
        </nav>

        <main className="mx-auto w-full max-w-[1480px] space-y-5 overflow-x-hidden p-3 sm:p-4 lg:p-6">
          <ComplianceNotice compact />
          {children}
          <footer className="flex flex-col gap-2 border-t border-line pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>Vaeroex helps teams build visibility, accountability, and execution.</p>
            <nav className="flex flex-wrap gap-3" aria-label="In-app help and legal links">
              <Link href="/app/help" className="font-semibold hover:text-vaeroex-blue">Help Center</Link>
              <Link href="/app/help/trust" className="font-semibold hover:text-vaeroex-blue">Trust Center</Link>
              {legalLinks.slice(0, 2).map((link) => (
                <Link key={link.href} href={link.href} className="font-semibold hover:text-vaeroex-blue">
                  {link.label}
                </Link>
              ))}
              <Link href="/app/support" className="font-semibold hover:text-vaeroex-blue">Support</Link>
            </nav>
          </footer>
        </main>
      </div>
      <ToastRegion />
    </div>
  );
}
