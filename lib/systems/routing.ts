import type { Route } from "next";

export type SystemLink = Readonly<{ id: string; name: string; href: Route }>;
export type SystemDecision = SystemLink & Readonly<{ available: boolean; allowed: boolean }>;

// Only trusted server decisions enter here. Upcoming definitions never count.
export function accessibleSystemLinks(decisions: readonly SystemDecision[]): SystemLink[] {
  const seen = new Set<string>();
  return decisions.filter(system => {
    if (!system.available || !system.allowed || seen.has(system.id)) return false;
    seen.add(system.id);
    return true;
  })
    .map(({ id, name, href }) => ({ id, name, href }));
}

export function defaultSystemDestination(decisions: readonly SystemDecision[]): Route {
  const accessible = accessibleSystemLinks(decisions);
  return accessible.length === 1 ? accessible[0].href : "/systems" as Route;
}
