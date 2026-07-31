import {
  EASTER_EGG_GAME_CONTRACT_VERSION,
  EASTER_EGG_MAX_ACTIVE_TICKS,
  EASTER_EGG_MAX_RUN_AGE_MS
} from "./contracts";
import { calculateEasterEggScore, expectedRunProgress, runDurationMs } from "./rules";

export type EasterEggValidationReason =
  | "accepted"
  | "malformed"
  | "duration_mismatch"
  | "impossible_obstacle_count"
  | "impossible_platform_count"
  | "difficulty_tier_mismatch"
  | "course_mismatch"
  | "score_mismatch"
  | "submission_too_early"
  | "submission_expired"
  | "contract_mismatch";

export type EasterEggValidationResult = {
  valid: boolean;
  reason: EasterEggValidationReason;
  durationMs: number;
};

export function validateEasterEggRun(input: {
  seed: number;
  contractVersion: string;
  startedAtMs: number;
  submittedAtMs: number;
  activeTickCount: number;
  hazardCount: number;
  platformCount: number;
  difficultyTier: number;
  courseFingerprint: string;
  score: number;
}): EasterEggValidationResult {
  const { activeTickCount, hazardCount, platformCount, difficultyTier, courseFingerprint, score } = input;
  const durationMs = Number.isInteger(activeTickCount) ? runDurationMs(activeTickCount) : 0;

  if (input.contractVersion !== EASTER_EGG_GAME_CONTRACT_VERSION) {
    return { valid: false, reason: "contract_mismatch", durationMs };
  }
  if (![input.seed, activeTickCount, hazardCount, platformCount, difficultyTier, score, input.startedAtMs, input.submittedAtMs].every(Number.isFinite)
    || ![input.seed, activeTickCount, hazardCount, platformCount, difficultyTier, score].every(Number.isInteger)
    || input.seed < 0
    || input.seed > 0xffffffff
    || activeTickCount < 0
    || activeTickCount > EASTER_EGG_MAX_ACTIVE_TICKS
    || hazardCount < 0
    || platformCount < 0
    || difficultyTier < 1
    || difficultyTier > 5
    || !/^[0-9a-f]{8}$/.test(courseFingerprint)
    || score < 0) {
    return { valid: false, reason: "malformed", durationMs };
  }

  const elapsedMs = input.submittedAtMs - input.startedAtMs;
  if (elapsedMs < 0 || elapsedMs > EASTER_EGG_MAX_RUN_AGE_MS) {
    return { valid: false, reason: "submission_expired", durationMs };
  }
  if (activeTickCount > 90 && elapsedMs + 2_500 < durationMs) {
    return { valid: false, reason: "duration_mismatch", durationMs };
  }
  if (activeTickCount < 30 && score > 0) {
    return { valid: false, reason: "submission_too_early", durationMs };
  }
  const expected = expectedRunProgress(input.seed, activeTickCount);
  if (hazardCount !== expected.hazardCount) {
    return { valid: false, reason: "impossible_obstacle_count", durationMs };
  }
  if (platformCount !== expected.platformCount) {
    return { valid: false, reason: "impossible_platform_count", durationMs };
  }
  if (difficultyTier !== expected.difficultyTier) {
    return { valid: false, reason: "difficulty_tier_mismatch", durationMs };
  }
  if (courseFingerprint !== expected.courseFingerprint) {
    return { valid: false, reason: "course_mismatch", durationMs };
  }
  if (score !== calculateEasterEggScore(activeTickCount, hazardCount)) {
    return { valid: false, reason: "score_mismatch", durationMs };
  }
  return { valid: true, reason: "accepted", durationMs };
}
