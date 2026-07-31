import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EasterEggLeaderboardEntry, EasterEggWorkspaceSettings } from "@/lib/easter-egg/contracts";

const EMPTY_SETTINGS: EasterEggWorkspaceSettings = {
  publicParticipationRequested: false,
  publicDisplayName: null,
  moderationStatus: "none"
};

export async function loadEasterEggWorkspaceState(workspaceId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { highScore: 0, settings: EMPTY_SETTINGS, leaderboard: [] as EasterEggLeaderboardEntry[], error: "Game storage is unavailable." };
  }

  const [highScoreResult, settingsResult, leaderboardResult] = await Promise.all([
    admin
      .from("easter_egg_runs")
      .select("score")
      .eq("workspace_id", workspaceId)
      .eq("validation_status", "valid")
      .order("score", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("easter_egg_workspace_settings")
      .select("public_participation_requested,public_display_name,moderation_status")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("easter_egg_public_leaderboard_v1")
      .select("public_display_name,score,score_rank,leaderboard_position")
      .lte("leaderboard_position", 10)
      .order("leaderboard_position", { ascending: true })
  ]);

  const error = [highScoreResult.error, settingsResult.error, leaderboardResult.error].find(Boolean);
  const leaderboardRows = leaderboardResult.data || [];
  const rankCounts = new Map<number, number>();
  for (const row of leaderboardRows) rankCounts.set(row.score_rank, (rankCounts.get(row.score_rank) || 0) + 1);

  return {
    highScore: highScoreResult.data?.score || 0,
    settings: settingsResult.data ? {
      publicParticipationRequested: settingsResult.data.public_participation_requested,
      publicDisplayName: settingsResult.data.public_display_name,
      moderationStatus: settingsResult.data.moderation_status
    } satisfies EasterEggWorkspaceSettings : EMPTY_SETTINGS,
    leaderboard: leaderboardRows.map((row) => ({
      rank: row.score_rank,
      displayName: row.public_display_name,
      score: row.score,
      tied: (rankCounts.get(row.score_rank) || 0) > 1
    })) satisfies EasterEggLeaderboardEntry[],
    error: error ? "Game scores could not be loaded." : null
  };
}

export async function loadEasterEggAdminState() {
  const admin = createSupabaseAdminClient();
  if (!admin) return { error: "Game storage is unavailable.", metrics: null, pending: [], recent: [], leaderboard: [] };

  const [participants, validRuns, rejectedRuns, highest, pending, recent, leaderboard] = await Promise.all([
    admin.from("easter_egg_workspace_settings").select("workspace_id", { count: "exact", head: true }).eq("public_participation_requested", true),
    admin.from("easter_egg_runs").select("id", { count: "exact", head: true }).eq("validation_status", "valid"),
    admin.from("easter_egg_runs").select("id", { count: "exact", head: true }).eq("validation_status", "rejected"),
    admin.from("easter_egg_runs").select("score").eq("validation_status", "valid").order("score", { ascending: false }).limit(1).maybeSingle(),
    admin.from("easter_egg_workspace_settings").select("workspace_id,public_display_name,updated_at").eq("moderation_status", "pending").order("updated_at", { ascending: true }).limit(50),
    admin.from("easter_egg_runs").select("id,workspace_id,score,run_duration_ms,obstacle_count,completed_at").eq("validation_status", "valid").order("completed_at", { ascending: false }).limit(20),
    admin.from("easter_egg_public_leaderboard_v1").select("public_display_name,score,score_rank,leaderboard_position").lte("leaderboard_position", 10).order("leaderboard_position", { ascending: true })
  ]);

  const errors = [participants.error, validRuns.error, rejectedRuns.error, highest.error, pending.error, recent.error, leaderboard.error].filter(Boolean);
  return {
    error: errors.length ? "Some Easter Egg activity could not be loaded." : null,
    metrics: {
      participatingWorkspaces: participants.count || 0,
      validRuns: validRuns.count || 0,
      rejectedRuns: rejectedRuns.count || 0,
      highestScore: highest.data?.score || 0
    },
    pending: pending.data || [],
    recent: recent.data || [],
    leaderboard: leaderboard.data || []
  };
}
