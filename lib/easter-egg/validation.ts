import {
  EASTER_EGG_GAME_CONTRACT_VERSION,
  EASTER_EGG_MAX_ACTIVE_TICKS,
  EASTER_EGG_MAX_RUN_AGE_MS
} from "./contracts";
import { calculateEasterEggScore, clearedObstacleCount, runDurationMs } from "./rules";

export type EasterEggValidationReason =
  | "accepted"
  | "malformed"
  | "duration_mismatch"
  | "impossible_obstacle_count"
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
  obstacleCount: number;
  score: number;
}): EasterEggValidationResult {
  const { activeTickCount, obstacleCount, score } = input;
  const durationMs = Number.isInteger(activeTickCount) ? runDurationMs(activeTickCount) : 0;

  if (input.contractVersion !== EASTER_EGG_GAME_CONTRACT_VERSION) {
    return { valid: false, reason: "contract_mismatch", durationMs };
  }
  if (![input.seed, activeTickCount, obstacleCount, score, input.startedAtMs, input.submittedAtMs].every(Number.isFinite)
    || ![input.seed, activeTickCount, obstacleCount, score].every(Number.isInteger)
    || input.seed < 0
    || input.seed > 0xffffffff
    || activeTickCount < 0
    || activeTickCount > EASTER_EGG_MAX_ACTIVE_TICKS
    || obstacleCount < 0
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
  const maximumCleared = clearedObstacleCount(input.seed, activeTickCount);
  if (obstacleCount > maximumCleared) {
    return { valid: false, reason: "impossible_obstacle_count", durationMs };
  }
  if (score !== calculateEasterEggScore(activeTickCount, obstacleCount)) {
    return { valid: false, reason: "score_mismatch", durationMs };
  }
  return { valid: true, reason: "accepted", durationMs };
}
