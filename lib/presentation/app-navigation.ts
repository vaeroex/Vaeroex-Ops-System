export type WorkspaceNavItem = { href: string; label: string };

export function isWorkspacePathActive(pathname: string, href: string) {
  if (href === "/app" || href === "/app/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function currentWorkspaceDestination(pathname: string, items: readonly WorkspaceNavItem[]) {
  // Prefer the specific destination over its parent (for example Admin Customers).
  return items.filter((item) => isWorkspacePathActive(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function workspacePageTitle(pathname: string, items: readonly WorkspaceNavItem[]) {
  if (pathname.startsWith("/app/settings/integrations/square")) return "Square";
  const destination = currentWorkspaceDestination(pathname, items);
  if (destination) return destination.label;
  if (pathname.startsWith("/app/help")) return "Help Center";
  if (pathname.startsWith("/app/support")) return "Support";
  return "Workspace";
}
