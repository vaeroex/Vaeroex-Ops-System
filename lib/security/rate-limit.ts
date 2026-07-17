import "server-only";

import { createHash } from "crypto";
import { headers } from "next/headers";
import type { Json } from "@/lib/supabase/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RateLimitResult = {
  allowed: boolean;
  action: string;
  limit: number;
  remaining: number;
  resetAt: string;
  message?: string;
};

type RateLimitOptions = {
  action: string;
  limit: number;
  windowSeconds: number;
  userId?: string | null;
  workspaceId?: string | null;
  identifiers?: Array<string | null | undefined>;
  requestHeaders?: Headers;
  metadata?: Json;
  strict?: boolean;
};

const FALLBACK_LIMIT_MESSAGE = "Too many requests. Please try again shortly.";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function firstHeaderValue(value: string | null) {
  return (value || "").split(",")[0]?.trim() || "";
}

export function clientIpFromHeaders(headerBag: Headers) {
  return (
    firstHeaderValue(headerBag.get("cf-connecting-ip")) ||
    firstHeaderValue(headerBag.get("x-real-ip")) ||
    firstHeaderValue(headerBag.get("x-forwarded-for")) ||
    "unknown"
  );
}

async function currentRequestHeaders() {
  try {
    return await headers();
  } catch {
    return null;
  }
}

function windowStartFor(nowMs: number, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(nowMs / windowMs) * windowMs).toISOString();
}

function resetAtFor(windowStart: string, windowSeconds: number) {
  return new Date(new Date(windowStart).getTime() + windowSeconds * 1000).toISOString();
}

function isMissingRateLimitTable(error: { code?: string | null; message?: string | null } | null | undefined) {
  return error?.code === "42P01" || /request_rate_limits|does not exist|schema cache/i.test(error?.message || "");
}

export async function enforceRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowSeconds = Math.max(1, Math.floor(options.windowSeconds));
  const nowMs = Date.now();
  const windowStart = windowStartFor(nowMs, windowSeconds);
  const resetAt = resetAtFor(windowStart, windowSeconds);
  const requestHeaders = options.requestHeaders || (await currentRequestHeaders());
  const ip = requestHeaders ? clientIpFromHeaders(requestHeaders) : "unknown";
  const identifier = [
    options.workspaceId ? `workspace:${options.workspaceId}` : "",
    options.userId ? `user:${options.userId}` : "",
    ...((options.identifiers || []).filter(Boolean).map((item) => `extra:${item}`) as string[]),
    `ip:${ip}`
  ]
    .filter(Boolean)
    .join("|");
  const identifierHash = sha256(`${options.action}:${identifier}`);
  const admin = createSupabaseAdminClient();

  if (!admin) {
    if (options.strict) throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
    return {
      allowed: true,
      action: options.action,
      limit,
      remaining: limit,
      resetAt
    };
  }

  const client = admin as any;

  const { data, error } = await client
    .from("request_rate_limits")
    .select("id,count")
    .eq("action_key", options.action)
    .eq("identifier_hash", identifierHash)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (error) {
    if (options.strict) throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
    if (!isMissingRateLimitTable(error)) {
      console.warn("[rate-limit] check failed:", error.message);
    }

    return {
      allowed: true,
      action: options.action,
      limit,
      remaining: limit,
      resetAt
    };
  }

  if (data && data.count >= limit) {
    return {
      allowed: false,
      action: options.action,
      limit,
      remaining: 0,
      resetAt,
      message: FALLBACK_LIMIT_MESSAGE
    };
  }

  if (data) {
    const updateResult = await client
      .from("request_rate_limits")
      .update({
        count: data.count + 1,
        last_seen_at: new Date(nowMs).toISOString(),
        metadata_json: options.metadata || {}
      })
      .eq("id", data.id);

    if ("error" in updateResult && updateResult.error && !isMissingRateLimitTable(updateResult.error)) {
      console.warn("[rate-limit] update failed:", updateResult.error.message);
    }
    if ("error" in updateResult && updateResult.error && options.strict) {
      throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
    }

    return {
      allowed: true,
      action: options.action,
      limit,
      remaining: Math.max(0, limit - data.count - 1),
      resetAt
    };
  }

  const insertResult = await client.from("request_rate_limits").insert({
    action_key: options.action,
    identifier_hash: identifierHash,
    window_start: windowStart,
    count: 1,
    metadata_json: options.metadata || {}
  });

  if (insertResult.error && !isMissingRateLimitTable(insertResult.error)) {
    console.warn("[rate-limit] insert failed:", insertResult.error.message);
  }
  if (insertResult.error && options.strict) {
    throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
  }

  return {
    allowed: true,
    action: options.action,
    limit,
    remaining: Math.max(0, limit - 1),
    resetAt
  };
}

export function rateLimitMessage(result: RateLimitResult) {
  return result.message || FALLBACK_LIMIT_MESSAGE;
}
