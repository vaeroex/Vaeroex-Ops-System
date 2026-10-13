import React from "react";
import { AppShell } from "@/components/app/AppShell";
import { ActivityProvider } from "@/components/app/ActivityProvider";
import KpisPage from "@/app/app/kpis/page";
import { renderSourcesPage } from "@/app/app/sources/SourcesPage";
import IntelligencePage from "@/app/app/intelligence/page";
import OverviewLoading from "@/app/app/loading";
import KpisLoading from "@/app/app/kpis/loading";
import SourcesLoading from "@/app/app/sources/loading";
import ReportsLoading from "@/app/app/reports/loading";
import AppError from "@/app/app/error";
import { AS_OF, workspace, profile, type FixtureState, type FixtureRole } from "./data";
import { setFixture } from "./read-adapters";
export const routes = Object.freeze([
  { href: "/app/intelligence", label: "Intelligence" },
  { href: "/app/kpis", label: "Performance" }, { href: "/app/sources", label: "Files" },
]);
export function loadingScreen(pathname: string) {
  if (pathname.startsWith("/app/kpis")) return <KpisLoading />;
  if (pathname.startsWith("/app/sources")) return <SourcesLoading />;
  if (pathname.startsWith("/app/reports")) return <ReportsLoading />;
  return <OverviewLoading />;
}
export function pageParams(params: URLSearchParams) {
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) { const items = params.getAll(key); values[key] = items.length > 1 ? items : items[0]; }
  return values;
}
export async function renderScreen(pathname: string, state: FixtureState, role: FixtureRole, params = new URLSearchParams(), reset = () => {}) {
  setFixture(state, role);
  if (state === "loading") return loadingScreen(pathname);
  if (state === "error") return <AppError error={new Error("Synthetic unavailable state. No live request was made; use Try again to return to populated data.")} reset={reset} />;
  if (pathname === "/app" || pathname === "/app/intelligence") return IntelligencePage({ searchParams: Promise.resolve(Object.fromEntries(params)) });
  if (pathname.startsWith("/app/kpis")) return KpisPage({ searchParams: Promise.resolve(pageParams(params)) });
  if (pathname === "/app/sources" || pathname === "/app/files") return renderSourcesPage(Object.fromEntries(params));
  if (pathname.startsWith("/app/sources/")) return renderSourcesPage({ ...Object.fromEntries(params), file: decodeURIComponent(pathname.split("/").at(-1)!) }, { sourceDetail: true });
  return <section className="rounded-lg border border-line bg-white p-6"><h1 className="text-xl font-semibold">Outside this preview</h1><p className="mt-2">This destination is not part of the website capture. No backend request was made.</p></section>;
}
export function wrapScreen(body: React.ReactNode, role: FixtureRole, pathname: string) {
  // The real Square route lives in (square-connection), outside ProtectedAppLayout.
  // Retain only the root ActivityProvider; never synthesize a workspace shell here.
  if (pathname === "/app/settings/integrations/square") return <ActivityProvider>{body}</ActivityProvider>;
  const props = { profile, workspaces: [workspace], activeWorkspace: workspace, membership: { workspace_id: workspace.id, user_id: profile.id, role }, isVaeroexAdmin: false, children: body } as unknown as React.ComponentProps<typeof AppShell>;
  return <ActivityProvider><AppShell {...props} /></ActivityProvider>;
}
export { AS_OF };

export { calculatedIntelligence } from "./calculations";
export { kpis, files, imports, metrics, csvContents, performanceKpiSettings } from "./data";
