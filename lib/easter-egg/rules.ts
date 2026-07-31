import {
  EASTER_EGG_FIXED_TICKS_PER_SECOND,
  EASTER_EGG_GAME_CONTRACT_VERSION,
  EASTER_EGG_MAX_ACTIVE_TICKS
} from "./contracts";

export type EasterEggObstaclePlan = {
  sequence: number;
  spawnTick: number;
  clearTick: number;
  width: number;
  height: number;
};

function nextRandom(state: number) {
  let next = (state + 0x6d2b79f5) >>> 0;
  next = Math.imul(next ^ (next >>> 15), next | 1);
  next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
  return { state: next >>> 0, value: ((next ^ (next >>> 14)) >>> 0) / 4294967296 };
}

export function runnerSpeedAtTick(tick: number) {
  return Math.min(520, 250 + Math.floor(Math.max(0, tick) / 360) * 7);
}

export function obstacleGapAtTick(tick: number) {
  return Math.max(62, 126 - Math.floor(Math.max(0, tick) / 480) * 3);
}

export function buildObstaclePlan(seed: number, activeTickLimit: number) {
  const safeLimit = Math.max(0, Math.min(EASTER_EGG_MAX_ACTIVE_TICKS, Math.floor(activeTickLimit)));
  const obstacles: EasterEggObstaclePlan[] = [];
  let randomState = seed >>> 0;
  let spawnTick = 150;
  let sequence = 0;

  while (spawnTick <= safeLimit) {
    const random = nextRandom(randomState);
    randomState = random.state;
    const height = 36 + Math.floor(random.value * 4) * 8;
    const width = 24 + (sequence % 3) * 4;
    const travelTicks = Math.ceil((900 / runnerSpeedAtTick(spawnTick)) * EASTER_EGG_FIXED_TICKS_PER_SECOND);
    obstacles.push({ sequence, spawnTick, clearTick: spawnTick + travelTicks, width, height });
    const jitter = Math.floor(random.value * 15) - 7;
    spawnTick += obstacleGapAtTick(spawnTick) + jitter;
    sequence += 1;
  }

  return obstacles;
}

export function clearedObstacleCount(seed: number, activeTickCount: number) {
  return buildObstaclePlan(seed, activeTickCount).filter((obstacle) => obstacle.clearTick <= activeTickCount).length;
}

export function calculateEasterEggScore(activeTickCount: number, obstacleCount: number) {
  const safeTicks = Math.max(0, Math.min(EASTER_EGG_MAX_ACTIVE_TICKS, Math.floor(activeTickCount)));
  const safeObstacles = Math.max(0, Math.floor(obstacleCount));
  return Math.floor(safeTicks / 6) + safeObstacles * 25;
}

export function runDurationMs(activeTickCount: number) {
  return Math.round((Math.max(0, activeTickCount) / EASTER_EGG_FIXED_TICKS_PER_SECOND) * 1000);
}

export const EASTER_EGG_RULESET = Object.freeze({
  contractVersion: EASTER_EGG_GAME_CONTRACT_VERSION,
  fixedTicksPerSecond: EASTER_EGG_FIXED_TICKS_PER_SECOND,
  gravity: 1_650,
  jumpVelocity: -590,
  groundY: 280
});
