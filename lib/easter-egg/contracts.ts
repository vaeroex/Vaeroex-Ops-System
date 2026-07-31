export const EASTER_EGG_GAME_CONTRACT_VERSION = "easter_egg_runner_v2" as const;
export const EASTER_EGG_LEGACY_GAME_CONTRACT_VERSION = "easter_egg_runner_v1" as const;
export const EASTER_EGG_FIXED_TICKS_PER_SECOND = 60;
export const EASTER_EGG_MAX_ACTIVE_TICKS = 216_000;
export const EASTER_EGG_MAX_RUN_AGE_MS = 3_900_000;

export type EasterEggRunStart = {
  runId: string;
  seed: number;
  contractVersion: typeof EASTER_EGG_GAME_CONTRACT_VERSION;
};

export type EasterEggRunSubmission = {
  runId: string;
  activeTickCount: number;
  hazardCount: number;
  platformCount: number;
  difficultyTier: 1 | 2 | 3 | 4 | 5;
  courseFingerprint: string;
  score: number;
};

export type EasterEggLeaderboardEntry = {
  rank: number;
  displayName: string;
  score: number;
  tied: boolean;
};

export type EasterEggWorkspaceSettings = {
  publicParticipationRequested: boolean;
  publicDisplayName: string | null;
  moderationStatus: "none" | "pending" | "approved" | "rejected";
};
