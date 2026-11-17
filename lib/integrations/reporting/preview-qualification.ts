import "server-only";
import { z } from "zod";

const schema = z.object({ deploymentHost: z.string().regex(/^[a-z0-9][a-z0-9-]+\.vercel\.app$/),
  actorUserId: z.string().uuid(), workspaceId: z.string().uuid(), startsAt: z.string().datetime(), expiresAt: z.string().datetime(),
  providers: z.array(z.enum(["clockify", "katana"])).min(1).max(2) }).strict();
const actions = ["connect", "select-account", "sync", "disconnect", "recurring-settings"];
function manifest() {
  try {
    const raw = process.env.REPORTING_PREVIEW_QUALIFICATION;
    if (process.env.VERCEL_ENV !== "preview" || !raw || raw.length > 2000) return null;
    const value = schema.parse(JSON.parse(raw)), start = Date.parse(value.startsAt), end = Date.parse(value.expiresAt), now = Date.now();
    if (value.deploymentHost !== process.env.VERCEL_URL || end <= start || end - start > 7_200_000 || now < start || now >= end
      || new Set(value.providers).size !== value.providers.length) return null;
    return value;
  } catch { return null; }
}
/** This permits only the proposed key-based synthetic refresh witness. OAuth
 * redirects, Production hosts and ordinary deployments keep their existing
 * policy. A URL match alone never grants actor/workspace access. */
export function reportingPreviewOrigin(request: Request, provider: string, action: string) {
  const value = manifest();
  if (!value || !value.providers.includes(provider as "clockify" | "katana") || !actions.includes(action)) return null;
  const expected = `https://${value.deploymentHost}`, url = new URL(request.url);
  if (url.origin !== expected || url.pathname !== `/api/integrations/${provider}/${action}` || url.search || url.hash) return null;
  return expected;
}
export function assertReportingPreviewActor(request: Request, provider: string, action: string,
  access: { workspaceId: string; user: { id: string } }) {
  const value = manifest(), expected = reportingPreviewOrigin(request, provider, action);
  if (!value || !expected || access.workspaceId !== value.workspaceId || access.user.id !== value.actorUserId)
    throw new Error("preview_qualification_denied");
  return expected;
}
