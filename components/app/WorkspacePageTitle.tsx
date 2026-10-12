"use client";

import { usePathname } from "next/navigation";
import { workspacePageTitle, type WorkspaceNavItem } from "@/lib/presentation/app-navigation";

export function WorkspacePageTitle({ items }: { items: WorkspaceNavItem[] }) {
  const pathname = usePathname();
  if (pathname === "/app/si") return <h1 className="mt-1 truncate text-base font-semibold tracking-tight sm:text-lg">Vaeroex Super Intelligence</h1>;
  return <p className="mt-1 truncate text-lg font-semibold tracking-wide">{workspacePageTitle(pathname, items)}</p>;
}
