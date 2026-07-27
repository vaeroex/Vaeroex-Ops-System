import Link from "next/link";
import type { Route } from "next";

export type AdminCompanyTab = "overview" | "workspace" | "subscription" | "agreement";

export function AdminCompanyTabs({ workspaceId, activeTab }: { workspaceId: string; activeTab: AdminCompanyTab }) {
  const tabs: Array<{ value: AdminCompanyTab; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "workspace", label: "Workspace" },
    { value: "subscription", label: "Subscription" },
    { value: "agreement", label: "Agreement" }
  ];

  return (
    <nav aria-label="Company management sections" className="flex gap-2 overflow-x-auto rounded-lg border border-line bg-white p-2 shadow-panel">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={`/app/admin/customers/${workspaceId}?tab=${tab.value}` as Route}
          aria-current={activeTab === tab.value ? "page" : undefined}
          className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 ${activeTab === tab.value ? "bg-vaeroex-blue text-white" : "text-muted hover:bg-slate-100 hover:text-ink"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
