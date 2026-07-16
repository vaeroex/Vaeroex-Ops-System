import "server-only";

import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

function intEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

export async function enforceAIProviderRateLimits({
  userId,
  workspaceId,
  operation
}: {
  userId?: string | null;
  workspaceId?: string | null;
  operation: string;
}) {
  if (!userId || !workspaceId) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
    }
    return;
  }
  const windowSeconds = intEnv("VAEROEX_AI_RATE_LIMIT_WINDOW_SECONDS", 600, 60, 3600);
  const [userLimit, workspaceLimit] = await Promise.all([
    enforceRateLimit({
      action: "ai.provider.user",
      limit: intEnv("VAEROEX_AI_USER_RATE_LIMIT", 60, 1, 1000),
      windowSeconds,
      userId,
      metadata: { scope: "user", operation },
      strict: true
    }),
    enforceRateLimit({
      action: "ai.provider.workspace",
      limit: intEnv("VAEROEX_AI_WORKSPACE_RATE_LIMIT", 240, 1, 5000),
      windowSeconds,
      workspaceId,
      metadata: { scope: "workspace", operation },
      strict: true
    })
  ]);
  if (!userLimit.allowed) throw new Error(rateLimitMessage(userLimit));
  if (!workspaceLimit.allowed) throw new Error(rateLimitMessage(workspaceLimit));
}
