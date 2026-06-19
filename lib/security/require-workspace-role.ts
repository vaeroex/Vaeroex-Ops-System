import "server-only";

import { redirect } from "next/navigation";
import type { AppWorkspaceRole } from "@/lib/security/types";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

export async function requireWorkspaceRole(allowedRoles: AppWorkspaceRole[], preferredWorkspaceId?: string | null) {
  const access = await requireWorkspaceAccess(preferredWorkspaceId);

  if (!allowedRoles.includes(access.membership.role)) {
    redirect("/app?error=You do not have permission to perform that workspace action.");
  }

  return access;
}
