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
  strict: boolean;
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

  const { data, error } = await admin
    .rpc("consume_request_rate_limit_v1", {
      p_action_key: options.action,
      p_identifier_hash: identifierHash,
      p_window_start: windowStart,
      p_limit: limit,
      p_metadata_json: options.metadata || {}
    })
    .maybeSingle();

  if (error) {
    if (options.strict) throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
    console.warn("[rate-limit] atomic quota check failed:", error.message);

    return {
      allowed: true,
      action: options.action,
      limit,
      remaining: limit,
      resetAt
    };
  }

  if (!data) {
    if (options.strict) throw new Error("Vaeroex could not verify request limits. Please try again shortly.");
    return {
      allowed: true,
      action: options.action,
      limit,
      remaining: limit,
      resetAt
    };
  }

  if (!data.allowed) {
    return {
      allowed: false,
      action: options.action,
      limit,
      remaining: 0,
      resetAt,
      message: FALLBACK_LIMIT_MESSAGE
    };
  }

  return {
    allowed: true,
    action: options.action,
    limit,
    remaining: Math.max(0, limit - data.request_count),
    resetAt
  };
}

export function rateLimitMessage(result: RateLimitResult) {
  return result.message || FALLBACK_LIMIT_MESSAGE;
}
