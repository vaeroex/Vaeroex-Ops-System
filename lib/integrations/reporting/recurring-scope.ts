import "server-only";
import { z } from "zod";
import { isProvider, type Provider } from "./catalog";

export type ReportingRefreshScope = { workspaceIds: string[]; providers: Provider[] };
const uuid = z.string().uuid();

/** This release is opt-in at both the deployment and connection. An absent,
 * malformed, or broadening scope never means "all workspaces/providers". */
export function reportingRefreshScope(env: NodeJS.ProcessEnv = process.env): ReportingRefreshScope | null {
  if (env.REPORTING_AUTOMATIC_REFRESH_ENABLED !== "true") return null;
  const workspaceIds = env.REPORTING_AUTOMATIC_REFRESH_WORKSPACE_IDS?.split(",").map(value => value.trim()) ?? [];
  const providers = env.REPORTING_AUTOMATIC_REFRESH_PROVIDERS?.split(",").map(value => value.trim()) ?? [];
  if (!workspaceIds.length || workspaceIds.length > 100 || workspaceIds.some(value => !uuid.safeParse(value).success) ||
    new Set(workspaceIds).size !== workspaceIds.length || !providers.length || providers.length > 6 ||
    providers.some(value => !isProvider(value)) || new Set(providers).size !== providers.length) return null;
  return { workspaceIds, providers: providers as Provider[] };
}
export function reportingRecurringAllowed(workspaceId: string, provider: Provider) {
  const scope = reportingRefreshScope();
  return Boolean(scope?.workspaceIds.includes(workspaceId) && scope.providers.includes(provider));
}
