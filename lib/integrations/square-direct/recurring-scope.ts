import "server-only";
import { z } from "zod";

/** Additional recurring scope; this never replaces the existing Square customer
 * backend environment/configuration gate or the database's owner consent. */
export function squareRecurringScope(env: NodeJS.ProcessEnv = process.env) {
  if (env.SQUARE_AUTOMATIC_REFRESH_ENABLED !== "true") return null;
  const workspaceIds = env.SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS?.split(",").map(value => value.trim()) ?? [];
  if (!workspaceIds.length || workspaceIds.length > 100 || workspaceIds.some(value => !z.string().uuid().safeParse(value).success)
    || new Set(workspaceIds).size !== workspaceIds.length) return null;
  return { workspaceIds };
}
export function squareRecurringAllowed(workspaceId: string) {
  return Boolean(squareRecurringScope()?.workspaceIds.includes(workspaceId));
}
