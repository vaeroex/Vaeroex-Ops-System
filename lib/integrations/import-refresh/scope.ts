import "server-only";
import { z } from "zod";

export const importProviders = ["loyverse", "zoho-books", "wix-orders"] as const;
export type ImportProvider = typeof importProviders[number];
export function isImportProvider(value: unknown): value is ImportProvider {
  return typeof value === "string" && (importProviders as readonly string[]).includes(value);
}
export function importRefreshScope(env: NodeJS.ProcessEnv = process.env) {
  if (env.IMPORT_AUTOMATIC_REFRESH_ENABLED !== "true") return null;
  const workspaceIds = env.IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS?.split(",").map(value => value.trim()) ?? [];
  const providers = env.IMPORT_AUTOMATIC_REFRESH_PROVIDERS?.split(",").map(value => value.trim()) ?? [];
  if (!workspaceIds.length || workspaceIds.length > 100 || workspaceIds.some(value => !z.string().uuid().safeParse(value).success) ||
    new Set(workspaceIds).size !== workspaceIds.length || !providers.length || providers.length > importProviders.length ||
    providers.some(value => !isImportProvider(value)) || new Set(providers).size !== providers.length) return null;
  return { workspaceIds, providers: providers as ImportProvider[] };
}
export function importRecurringAllowed(workspaceId: string, provider: ImportProvider) {
  const scope = importRefreshScope();
  return Boolean(scope?.workspaceIds.includes(workspaceId) && scope.providers.includes(provider));
}
