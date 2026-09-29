"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Presentation boundary only. Admin and public screens retain their approved styling. */
export function WorkspacePresentation({ children, className }: { children: ReactNode; className: string }) {
  const pathname = usePathname();
  const customerWorkspace = !pathname.startsWith("/app/admin");
  return <div className={`${className}${customerWorkspace ? " vaeroex-customer-workspace" : ""}`}>{children}</div>;
}

export function WorkspaceSwitcherDisclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/app/admin")) return <>{summary}{children}</>;
  return <details><summary className="workspace-switcher-summary flex min-h-11 cursor-pointer list-none items-center gap-3">{summary}</summary>{children}</details>;
}
