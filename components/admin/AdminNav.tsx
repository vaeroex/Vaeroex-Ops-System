import Link from "next/link";
import type { Route } from "next";

const adminLinks: { href: Route; label: string }[] = [
  { href: "/app/admin", label: "Overview" },
  { href: "/app/admin/customers", label: "Customers" },
  { href: "/app/admin/workspaces", label: "Workspaces" },
  { href: "/app/admin/subscriptions", label: "Subscriptions" },
  { href: "/app/admin/ai-usage", label: "Vaeroex usage" },
  { href: "/app/admin/support-requests", label: "Support requests" },
  { href: "/app/admin/audit-logs", label: "Audit logs" }
];

export function AdminNav() {
  return (
    <nav className="flex gap-2 overflow-x-auto rounded-lg border border-line bg-white p-2 shadow-panel">
      {adminLinks.map((link) => (
        <Link key={link.href} href={link.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold text-muted hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
