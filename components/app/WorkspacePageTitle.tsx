"use client";

import { usePathname } from "next/navigation";
import { workspacePageTitle, type WorkspaceNavItem } from "@/lib/presentation/app-navigation";

export function WorkspacePageTitle({ items }: { items: WorkspaceNavItem[] }) {
  const pathname = usePathname();
  return <p className="mt-1 truncate text-lg font-semibold tracking-wide">{workspacePageTitle(pathname, items)}</p>;
}
