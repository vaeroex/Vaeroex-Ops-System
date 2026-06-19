import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { selectWorkspaceAction } from "@/lib/workspaces/actions";
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
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${light ? "bg-white text-vaeroex-blue" : "bg-vaeroex-blue text-white"}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavSection({
  label,
  items,
  notificationUnreadCount
}: {
  label: string;
  items: Array<{ href: string; label: string }>;
  notificationUnreadCount: number;
}) {
  return (
    <details open className="group rounded-lg border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100">
        {label}
        <span className="text-blue-200 transition group-open:rotate-90">&gt;</span>
      </summary>
      <div className="pb-2">
        {items.map((item) => (
          <Link
            key={`${item.href}-${item.label}`}
            href={item.href as Route}
            className="mx-2 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-blue-50 hover:bg-white/10"
          >
            <span>{item.label}</span>
            {item.href === "/app/notifications" ? <NotificationBadge count={notificationUnreadCount} light /> : null}
          </Link>
        ))}
      </div>
    </details>
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
    <div className="min-h-screen bg-slate-50 text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-800 bg-vaeroex-navy p-5 text-white lg:flex lg:flex-col">
        <Link href="/app" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-vaeroex-blue text-sm font-bold">V</span>
          <span>
            <span className="block text-sm font-semibold">Vaeroex</span>
            <span className="block text-xs text-blue-100">Ops System</span>
          </span>
        </Link>

        <form action={selectWorkspaceAction} className="mt-7 rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-xs uppercase tracking-wide text-blue-100">Workspace</p>
          <select
            name="workspace_id"
            aria-label="Workspace switcher"
            className="mt-2 w-full rounded-md border border-white/10 bg-vaeroex-navy px-2 py-2 text-sm text-white"
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
          <p className="mt-2 text-xs text-blue-100">
            Role: <span className="font-semibold text-white">{membership?.role || "setup pending"}</span>
          </p>
          <p className="mt-2 text-xs text-blue-100">
            Status: <span className="font-semibold text-white">{accessLabel}</span>
          </p>
          {workspaces.length > 1 ? (
            <button className="mt-3 w-full rounded-md border border-white/10 px-2 py-1.5 text-xs text-blue-50">
              Switch workspace
            </button>
          ) : null}
        </form>

        <nav className="mt-5 flex flex-1 flex-col gap-2 overflow-auto pr-1">
          {navSections.map((section) => (
            <NavSection key={section.label} label={section.label} items={section.items} notificationUnreadCount={notificationUnreadCount} />
          ))}
        </nav>

        <form action={signOutAction} className="mt-5">
          <button className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-blue-50 hover:bg-white/10">
            Sign out
          </button>
        </form>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">
                {activeWorkspace?.name || "Setup required"} · {accessLabel}
              </p>
              <h1 className="text-lg font-semibold">Vaeroex Ops System</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/app/agents"
                className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white"
              >
                Ask Vaeroex
              </Link>
              <Link
                href="/app/notifications"
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold"
              >
                <span>Notifications</span>
                <NotificationBadge count={notificationUnreadCount} />
              </Link>
              <div className="rounded-full border border-line bg-white px-3 py-2 text-sm">
                {profile?.full_name || profile?.email || "User"}
              </div>
            </div>
          </div>
        </header>

        <nav className="border-b border-line bg-white px-4 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {navSections.map((section) => (
              <details key={section.label} className="shrink-0 rounded-md bg-slate-100 px-3 py-2">
                <summary className="cursor-pointer list-none whitespace-nowrap text-sm font-semibold text-slate-700">{section.label}</summary>
                <div className="mt-2 grid gap-1">
                  {section.items.map((item) => (
                    <Link key={`${section.label}-${item.label}`} href={item.href as Route} className="flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-2 py-1 text-sm text-slate-700">
                      <span>{item.label}</span>
                      {item.href === "/app/notifications" ? <NotificationBadge count={notificationUnreadCount} /> : null}
                    </Link>
                  ))}
                </div>
              </details>
            ))}
          </div>
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
