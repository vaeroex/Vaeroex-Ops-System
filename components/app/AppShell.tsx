import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { selectWorkspaceAction } from "@/lib/workspaces/actions";
import { ToastRegion } from "@/components/app/ToastRegion";
import { ComplianceNotice } from "@/components/operations/ComplianceNotice";
import type { Profile, Workspace, WorkspaceMember } from "@/lib/supabase/types";

const navSections = [
  {
    label: "Dashboard",
    items: [{ href: "/app", label: "Executive Dashboard" }]
  },
  {
    label: "Operations",
    items: [
      { href: "/app/tasks", label: "Tasks" },
      { href: "/app/checklists", label: "Checklists" },
      { href: "/app/sops", label: "SOPs" },
      { href: "/app/issues", label: "Issues" },
      { href: "/app/forms", label: "Forms" },
      { href: "/app/form-submissions", label: "Form Submissions" },
      { href: "/app/assets", label: "Assets" },
      { href: "/app/people", label: "People" }
    ]
  },
  {
    label: "Data & Insights",
    items: [
      { href: "/app/kpis", label: "KPIs" },
      { href: "/app/reports", label: "Reports" },
      { href: "/app/files", label: "Files" },
      { href: "/app/agents", label: "Ask Vaeroex" }
    ]
  },
  {
    label: "Growth",
    items: [{ href: "/app/crm", label: "CRM" }]
  },
  {
    label: "Admin",
    items: [
      { href: "/app/account/subscription", label: "Subscription" },
      { href: "/app/support", label: "Support" },
      { href: "/app/settings", label: "Settings" },
      { href: "/app/admin", label: "Admin" }
    ]
  }
] satisfies Array<{ label: string; items: Array<{ href: string; label: string }> }>;

type AppShellProps = {
  children: ReactNode;
  profile: Profile | null;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  membership: WorkspaceMember | null;
};

function NavSection({ label, items }: { label: string; items: Array<{ href: string; label: string }> }) {
  return (
    <details open className="group rounded-lg border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100">
        {label}
        <span className="text-blue-200 transition group-open:rotate-90">&gt;</span>
      </summary>
      <div className="pb-2">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className="mx-2 block rounded-md px-3 py-2 text-sm text-blue-50 hover:bg-white/10"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </details>
  );
}

export function AppShell({ children, profile, workspaces, activeWorkspace, membership }: AppShellProps) {
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
                  {workspace.name}
                </option>
              ))
            ) : (
              <option value="">No workspace yet</option>
            )}
          </select>
          <p className="mt-2 text-xs text-blue-100">
            Role: <span className="font-semibold text-white">{membership?.role || "setup pending"}</span>
          </p>
          {workspaces.length > 1 ? (
            <button className="mt-3 w-full rounded-md border border-white/10 px-2 py-1.5 text-xs text-blue-50">
              Switch workspace
            </button>
          ) : null}
        </form>

        <nav className="mt-5 flex flex-1 flex-col gap-2 overflow-auto pr-1">
          {navSections.map((section) => (
            <NavSection key={section.label} label={section.label} items={section.items} />
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
                {activeWorkspace?.name || "Setup required"}
              </p>
              <h1 className="text-lg font-semibold">Accountability dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/app/agents"
                className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white"
              >
                Ask Vaeroex
              </Link>
              <div className="rounded-full border border-line bg-white px-3 py-2 text-sm">
                {profile?.full_name || profile?.email || "User"}
              </div>
            </div>
          </div>
        </header>

        <nav className="border-b border-line bg-white px-4 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {navSections.flatMap((section) =>
              section.items.map((item) => (
                <Link key={item.href} href={item.href as Route} className="whitespace-nowrap rounded-md bg-slate-100 px-3 py-2 text-sm">
                  {item.label}
                </Link>
              ))
            )}
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
