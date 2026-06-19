import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireVaeroexAdmin } from "@/lib/security/require-vaeroex-admin";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireVaeroexAdmin("/app");

  return (
    <div className="space-y-6">
      <AdminNav />
      {children}
    </div>
  );
}
