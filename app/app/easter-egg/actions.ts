"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  EASTER_EGG_GAME_CONTRACT_VERSION,
  type EasterEggRunStart,
  type EasterEggRunSubmission
} from "@/lib/easter-egg/contracts";
import { validateEasterEggDisplayName } from "@/lib/easter-egg/display-name";
import { validateEasterEggRun } from "@/lib/easter-egg/validation";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireWorkspaceRole } from "@/lib/security/require-workspace-role";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type GameActionResult<T = never> = { ok: true; data: T } | { ok: false; message: string };

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function applyGameRateLimit(input: { action: string; userId: string; workspaceId: string; limit: number; windowSeconds: number }) {
  const result = await enforceRateLimit({
    action: input.action,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
    userId: input.userId,
    workspaceId: input.workspaceId,
    strict: true,
    metadata: { source: "easter_egg_runner" }
  });
  return result.allowed ? null : rateLimitMessage(result);
}

export async function startEasterEggRunAction(idempotencyKey: string): Promise<GameActionResult<EasterEggRunStart>> {
  if (!isUuid(idempotencyKey)) return { ok: false, message: "The game run could not be started safely." };
  const access = await requireWorkspaceAccess();
  const rateLimitError = await applyGameRateLimit({
    action: "easter_egg.run.start",
    userId: access.user.id,
    workspaceId: access.workspaceId,
    limit: 12,
    windowSeconds: 60
  });
  if (rateLimitError) return { ok: false, message: rateLimitError };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Game storage is unavailable." };
  const seed = randomBytes(4).readUInt32BE(0);
  const runId = crypto.randomUUID();
  const inserted = await admin.from("easter_egg_runs").insert({
    id: runId,
    workspace_id: access.workspaceId,
    actor_user_id: access.user.id,
    idempotency_key: idempotencyKey,
    game_contract_version: EASTER_EGG_GAME_CONTRACT_VERSION,
    seed
  }).select("id,seed,game_contract_version").single();

  if (!inserted.error && inserted.data) {
    return { ok: true, data: { runId: inserted.data.id, seed: inserted.data.seed, contractVersion: inserted.data.game_contract_version } };
  }

  if (inserted.error?.code === "23505") {
    const existing = await admin
      .from("easter_egg_runs")
      .select("id,seed,game_contract_version,validation_status")
      .eq("workspace_id", access.workspaceId)
      .eq("actor_user_id", access.user.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (!existing.error && existing.data?.validation_status === "pending") {
      return { ok: true, data: { runId: existing.data.id, seed: existing.data.seed, contractVersion: existing.data.game_contract_version } };
    }
  }

  return { ok: false, message: "The game run could not be started. Try again in a moment." };
}

export async function submitEasterEggRunAction(input: EasterEggRunSubmission): Promise<GameActionResult<{
  accepted: boolean;
  score: number;
  workspaceHighScore: number;
}>> {
  if (!isUuid(input.runId)) return { ok: false, message: "The score submission could not be verified." };
  const access = await requireWorkspaceAccess();
  const rateLimitError = await applyGameRateLimit({
    action: "easter_egg.run.submit",
    userId: access.user.id,
    workspaceId: access.workspaceId,
    limit: 16,
    windowSeconds: 60
  });
  if (rateLimitError) return { ok: false, message: rateLimitError };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Game storage is unavailable." };
  const existing = await admin
    .from("easter_egg_runs")
    .select("*")
    .eq("id", input.runId)
    .eq("workspace_id", access.workspaceId)
    .eq("actor_user_id", access.user.id)
    .maybeSingle();
  if (existing.error || !existing.data) return { ok: false, message: "The score submission could not be verified." };

  if (existing.data.validation_status !== "pending") {
    const highScore = await admin.from("easter_egg_runs").select("score").eq("workspace_id", access.workspaceId).eq("validation_status", "valid").order("score", { ascending: false }).limit(1).maybeSingle();
    return {
      ok: true,
      data: {
        accepted: existing.data.validation_status === "valid",
        score: existing.data.score || 0,
        workspaceHighScore: highScore.data?.score || 0
      }
    };
  }

  const submittedAtMs = Date.now();
  const validation = validateEasterEggRun({
    seed: existing.data.seed,
    contractVersion: existing.data.game_contract_version,
    startedAtMs: Date.parse(existing.data.created_at),
    submittedAtMs,
    activeTickCount: input.activeTickCount,
    obstacleCount: input.obstacleCount,
    score: input.score
  });
  const terminalStatus = validation.valid ? "valid" : "rejected";
  const completedAt = new Date(submittedAtMs).toISOString();
  const storedScore = Number.isSafeInteger(input.score) ? Math.max(0, Math.min(10_000_000, input.score)) : 0;
  const storedTickCount = Number.isSafeInteger(input.activeTickCount) ? Math.max(0, Math.min(216_000, input.activeTickCount)) : 0;
  const storedObstacleCount = Number.isSafeInteger(input.obstacleCount) ? Math.max(0, Math.min(100_000, input.obstacleCount)) : 0;
  const update = await admin
    .from("easter_egg_runs")
    .update({
      validation_status: terminalStatus,
      score: storedScore,
      run_duration_ms: validation.durationMs,
      obstacle_count: storedObstacleCount,
      active_tick_count: storedTickCount,
      validation_reason_code: validation.reason,
      completed_at: completedAt
    })
    .eq("id", input.runId)
    .eq("workspace_id", access.workspaceId)
    .eq("actor_user_id", access.user.id)
    .eq("validation_status", "pending")
    .select("validation_status,score")
    .maybeSingle();

  if (update.error) return { ok: false, message: "The score could not be recorded safely." };
  if (!update.data) {
    const terminal = await admin
      .from("easter_egg_runs")
      .select("validation_status,score")
      .eq("id", input.runId)
      .eq("workspace_id", access.workspaceId)
      .eq("actor_user_id", access.user.id)
      .maybeSingle();
    if (terminal.error || !terminal.data || terminal.data.validation_status === "pending") {
      return { ok: false, message: "The score submission is still being verified. Please reload before retrying." };
    }
    const highScore = await admin.from("easter_egg_runs").select("score").eq("workspace_id", access.workspaceId).eq("validation_status", "valid").order("score", { ascending: false }).limit(1).maybeSingle();
    return { ok: true, data: { accepted: terminal.data.validation_status === "valid", score: terminal.data.score || 0, workspaceHighScore: highScore.data?.score || 0 } };
  }

  const highScore = await admin.from("easter_egg_runs").select("score").eq("workspace_id", access.workspaceId).eq("validation_status", "valid").order("score", { ascending: false }).limit(1).maybeSingle();
  revalidatePath("/app/easter-egg");
  return {
    ok: true,
    data: {
      accepted: update.data.validation_status === "valid",
      score: update.data.score || 0,
      workspaceHighScore: highScore.data?.score || 0
    }
  };
}

export async function updateEasterEggLeaderboardSettingsAction(input: {
  participate: boolean;
  displayName?: string;
}): Promise<GameActionResult<{ moderationStatus: "none" | "pending" }>> {
  const access = await requireWorkspaceRole(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Game settings are unavailable." };

  if (!input.participate) {
    const result = await admin.from("easter_egg_workspace_settings").upsert({
      workspace_id: access.workspaceId,
      public_participation_requested: false,
      public_display_name: null,
      moderation_status: "none",
      workspace_approved_by: null,
      workspace_approved_at: null,
      moderated_by: null,
      moderated_at: null,
      moderation_reason_code: null,
      updated_by: access.user.id
    }, { onConflict: "workspace_id" });
    if (result.error) return { ok: false, message: "Leaderboard participation could not be updated." };
    revalidatePath("/app/easter-egg");
    revalidatePath("/app/admin/easter-egg");
    return { ok: true, data: { moderationStatus: "none" } };
  }

  const displayName = validateEasterEggDisplayName(input.displayName || "");
  if (!displayName.valid) return { ok: false, message: displayName.error };
  const result = await admin.from("easter_egg_workspace_settings").upsert({
    workspace_id: access.workspaceId,
    public_participation_requested: true,
    public_display_name: displayName.value,
    moderation_status: "pending",
    workspace_approved_by: access.user.id,
    workspace_approved_at: new Date().toISOString(),
    moderated_by: null,
    moderated_at: null,
    moderation_reason_code: null,
    updated_by: access.user.id
  }, { onConflict: "workspace_id" });
  if (result.error) return { ok: false, message: "The public display name could not be submitted for review." };
  revalidatePath("/app/easter-egg");
  revalidatePath("/app/admin/easter-egg");
  return { ok: true, data: { moderationStatus: "pending" } };
}

export async function deleteEasterEggWorkspaceHistoryAction(confirmation: string): Promise<GameActionResult<{ deleted: number }>> {
  if (confirmation !== "DELETE GAME HISTORY") return { ok: false, message: "Type DELETE GAME HISTORY to confirm." };
  const access = await requireWorkspaceRole(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Game storage is unavailable." };
  const result = await admin.from("easter_egg_runs").delete({ count: "exact" }).eq("workspace_id", access.workspaceId);
  if (result.error) return { ok: false, message: "Private game history could not be deleted." };
  revalidatePath("/app/easter-egg");
  revalidatePath("/app/admin/easter-egg");
  return { ok: true, data: { deleted: result.count || 0 } };
}
