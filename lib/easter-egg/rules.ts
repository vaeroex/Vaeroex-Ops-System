import {
  EASTER_EGG_FIXED_TICKS_PER_SECOND,
  EASTER_EGG_GAME_CONTRACT_VERSION,
  EASTER_EGG_MAX_ACTIVE_TICKS
} from "./contracts";

export type EasterEggDifficultyTierId = 1 | 2 | 3 | 4 | 5;
export type EasterEggCourseObjectKind = "hazard" | "platform";
export type EasterEggHazardSize = "low" | "standard" | "wide" | "tall" | "tower";
export type EasterEggPlatformTypeId = "safe-low" | "safe-mid" | "safe-high" | "safe-wide";

export type EasterEggDifficultyTier = {
  id: EasterEggDifficultyTierId;
  label: "Normal" | "Busy" | "Quarter End" | "Executive Panic" | "The Quarter Never Ends";
  startTick: number;
  patternGapDistance: number;
};

export type EasterEggHazardType = {
  id: string;
  label: string;
  size: EasterEggHazardSize;
  minTier: EasterEggDifficultyTierId;
  fill: number;
};

type HazardTemplate = {
  kind: "hazard";
  size: EasterEggHazardSize;
  x: number;
};

type PlatformTemplate = {
  kind: "platform";
  platformTypeId: EasterEggPlatformTypeId;
  x: number;
  width: number;
  topY: number;
};

export type EasterEggPatternTemplate = {
  id: string;
  minTier: EasterEggDifficultyTierId;
  maxTier: EasterEggDifficultyTierId;
  objects: readonly (HazardTemplate | PlatformTemplate)[];
};

export type EasterEggCourseObjectPlan = {
  sequence: number;
  patternSequence: number;
  patternId: string;
  tier: EasterEggDifficultyTierId;
  objectId: string;
  kind: EasterEggCourseObjectKind;
  typeId: string;
  label: string;
  spawnTick: number;
  clearTick: number;
  xOffset: number;
  width: number;
  height: number;
  topY: number;
  bottomY: number;
  fill: number;
};

export type EasterEggPatternPlan = {
  sequence: number;
  patternId: string;
  tier: EasterEggDifficultyTierId;
  spawnTick: number;
  nextSpawnTick: number;
  safeExitDistance: number;
  objects: EasterEggCourseObjectPlan[];
};

const HAZARD_DIMENSIONS: Record<EasterEggHazardSize, { width: number; height: number }> = {
  low: { width: 42, height: 30 },
  standard: { width: 48, height: 48 },
  wide: { width: 76, height: 34 },
  tall: { width: 44, height: 76 },
  tower: { width: 54, height: 118 }
};

export const EASTER_EGG_DIFFICULTY_TIERS: readonly EasterEggDifficultyTier[] = Object.freeze([
  { id: 1, label: "Normal", startTick: 0, patternGapDistance: 340 },
  { id: 2, label: "Busy", startTick: 900, patternGapDistance: 260 },
  { id: 3, label: "Quarter End", startTick: 2_400, patternGapDistance: 195 },
  { id: 4, label: "Executive Panic", startTick: 4_500, patternGapDistance: 145 },
  { id: 5, label: "The Quarter Never Ends", startTick: 7_200, patternGapDistance: 110 }
]);

export const EASTER_EGG_HAZARD_TYPES: readonly EasterEggHazardType[] = Object.freeze([
  { id: "urgent-email", label: "URGENT", size: "standard", minTier: 1, fill: 0x9f1239 },
  { id: "ref-spreadsheet", label: "#REF!", size: "standard", minTier: 1, fill: 0x7f1d1d },
  { id: "meeting-block", label: "MEETING", size: "wide", minTier: 2, fill: 0x7c2d12 },
  { id: "printer-error", label: "PRINT ERR", size: "standard", minTier: 2, fill: 0x991b1b },
  { id: "coffee-spill", label: "COFFEE", size: "low", minTier: 2, fill: 0x92400e },
  { id: "red-kpi", label: "KPI DOWN", size: "tall", minTier: 2, fill: 0xbe123c },
  { id: "quick-call", label: "QUICK CALL?", size: "wide", minTier: 3, fill: 0x6b21a8 },
  { id: "receipt-stack", label: "RECEIPTS", size: "standard", minTier: 3, fill: 0x9a3412 },
  { id: "compliance-warning", label: "COMPLIANCE", size: "tall", minTier: 3, fill: 0xb91c1c },
  { id: "quarter-end-deadline", label: "Q-END", size: "tower", minTier: 2, fill: 0x881337 },
  { id: "circle-back", label: "CIRCLE BACK", size: "standard", minTier: 4, fill: 0x7e22ce },
  { id: "sentient-spinner", label: "LOADING...", size: "wide", minTier: 5, fill: 0x4338ca }
]);

export const EASTER_EGG_PATTERN_CATALOG: readonly EasterEggPatternTemplate[] = Object.freeze([
  { id: "single-basic", minTier: 1, maxTier: 5, objects: [{ kind: "hazard", size: "standard", x: 0 }] },
  { id: "single-wide", minTier: 2, maxTier: 5, objects: [{ kind: "hazard", size: "wide", x: 0 }] },
  { id: "single-tall", minTier: 2, maxTier: 5, objects: [{ kind: "hazard", size: "tall", x: 0 }] },
  {
    id: "paired-low",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "hazard", size: "low", x: 0 },
      { kind: "hazard", size: "low", x: 112 }
    ]
  },
  {
    id: "alternating-short-tall",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "hazard", size: "low", x: 0 },
      { kind: "hazard", size: "tall", x: 230 }
    ]
  },
  {
    id: "platform-boost",
    minTier: 2,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 500, topY: 264 },
      { kind: "hazard", size: "tower", x: 300 }
    ]
  },
  {
    id: "ascending-platforms",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 170, topY: 274 },
      { kind: "platform", platformTypeId: "safe-mid", x: 190, width: 170, topY: 246 },
      { kind: "hazard", size: "tower", x: 410 }
    ]
  },
  {
    id: "safe-staircase",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 170, topY: 276 },
      { kind: "platform", platformTypeId: "safe-mid", x: 180, width: 170, topY: 250 },
      { kind: "platform", platformTypeId: "safe-high", x: 360, width: 170, topY: 224 }
    ]
  },
  {
    id: "raised-over-hazard",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-wide", x: 70, width: 350, topY: 248 },
      { kind: "hazard", size: "standard", x: 80 },
      { kind: "hazard", size: "low", x: 190 }
    ]
  },
  {
    id: "platform-gap-platform",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-mid", x: 0, width: 190, topY: 248 },
      { kind: "hazard", size: "tower", x: 230 },
      { kind: "platform", platformTypeId: "safe-mid", x: 450, width: 200, topY: 248 }
    ]
  },
  {
    id: "descending-platforms",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-high", x: 0, width: 180, topY: 220 },
      { kind: "platform", platformTypeId: "safe-mid", x: 200, width: 180, topY: 246 },
      { kind: "platform", platformTypeId: "safe-low", x: 400, width: 180, topY: 274 }
    ]
  },
  {
    id: "late-mixed-sequence",
    minTier: 5,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 500, topY: 264 },
      { kind: "hazard", size: "tower", x: 300 },
      { kind: "hazard", size: "low", x: 560 },
      { kind: "hazard", size: "low", x: 700 }
    ]
  }
]);

function nextRandom(state: number) {
  let next = (state + 0x6d2b79f5) >>> 0;
  next = Math.imul(next ^ (next >>> 15), next | 1);
  next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
  return { state: next >>> 0, value: ((next ^ (next >>> 14)) >>> 0) / 4294967296 };
}

export function difficultyTierAtTick(tick: number): EasterEggDifficultyTier {
  const safeTick = Math.max(0, Math.floor(tick));
  for (let index = EASTER_EGG_DIFFICULTY_TIERS.length - 1; index >= 0; index -= 1) {
    if (safeTick >= EASTER_EGG_DIFFICULTY_TIERS[index].startTick) return EASTER_EGG_DIFFICULTY_TIERS[index];
  }
  return EASTER_EGG_DIFFICULTY_TIERS[0];
}

export function runnerSpeedAtTick(tick: number) {
  return Math.min(510, 250 + Math.floor(Math.max(0, tick) / 30));
}

export function patternGapDistanceAtTick(tick: number) {
  const tier = difficultyTierAtTick(tick);
  const nextTier = EASTER_EGG_DIFFICULTY_TIERS[tier.id];
  if (!nextTier) return tier.patternGapDistance;
  const progress = Math.min(1, Math.max(0, tick - tier.startTick) / Math.max(1, nextTier.startTick - tier.startTick));
  return Math.round(tier.patternGapDistance + (nextTier.patternGapDistance - tier.patternGapDistance) * progress * 0.45);
}

function travelDistanceBetweenTicks(startTick: number, endTick: number) {
  let distance = 0;
  for (let tick = Math.max(0, Math.floor(startTick)); tick < Math.max(startTick, Math.floor(endTick)); tick += 1) {
    distance += runnerSpeedAtTick(tick) / EASTER_EGG_FIXED_TICKS_PER_SECOND;
  }
  return distance;
}

function tickAfterTravelDistance(startTick: number, distance: number) {
  let tick = Math.max(0, Math.floor(startTick));
  let travelled = 0;
  while (travelled < distance && tick < EASTER_EGG_MAX_ACTIVE_TICKS + 600) {
    travelled += runnerSpeedAtTick(tick) / EASTER_EGG_FIXED_TICKS_PER_SECOND;
    tick += 1;
  }
  return tick;
}

function selectHazardType(size: EasterEggHazardSize, tier: EasterEggDifficultyTierId, randomValue: number) {
  const eligible = EASTER_EGG_HAZARD_TYPES.filter((hazard) => hazard.size === size && hazard.minTier <= tier);
  if (eligible.length === 0) throw new Error(`No Easter Egg hazard is legal for ${size} at tier ${tier}.`);
  return eligible[Math.min(eligible.length - 1, Math.floor(randomValue * eligible.length))];
}

export function allowedPatternsForTier(tier: EasterEggDifficultyTierId) {
  return EASTER_EGG_PATTERN_CATALOG.filter((pattern) => pattern.minTier <= tier && pattern.maxTier >= tier);
}

export function getEasterEggPattern(patternId: string) {
  return EASTER_EGG_PATTERN_CATALOG.find((pattern) => pattern.id === patternId) || null;
}

export function buildPatternPlanForValidation(
  patternId: string,
  tier: EasterEggDifficultyTierId,
  seed = 0x5eed1234
) {
  const template = getEasterEggPattern(patternId);
  if (!template || template.minTier > tier || template.maxTier < tier) return null;
  const instantiated = instantiatePattern({
    template,
    patternSequence: 0,
    spawnTick: 0,
    tier,
    randomState: seed >>> 0,
    objectSequence: 0
  });
  return {
    sequence: 0,
    patternId: template.id,
    tier,
    spawnTick: 0,
    nextSpawnTick: 0,
    safeExitDistance: 0,
    objects: instantiated.objects
  } satisfies EasterEggPatternPlan;
}

export function safeExitDistanceForPatternObjects(objects: EasterEggCourseObjectPlan[]) {
  const highestPlatform = objects
    .filter((object) => object.kind === "platform")
    .reduce((highest, platform) => Math.max(highest, EASTER_EGG_RULESET.groundY - platform.topY), 0);
  if (highestPlatform <= 0) return 0;
  const fallSeconds = Math.sqrt((2 * highestPlatform) / EASTER_EGG_RULESET.gravity);
  const reactionSeconds = EASTER_EGG_RULESET.minimumReactionTicks / EASTER_EGG_RULESET.fixedTicksPerSecond;
  return Math.ceil((fallSeconds + reactionSeconds) * EASTER_EGG_RULESET.maximumSpeed + 40);
}

function instantiatePattern(input: {
  template: EasterEggPatternTemplate;
  patternSequence: number;
  spawnTick: number;
  tier: EasterEggDifficultyTierId;
  randomState: number;
  objectSequence: number;
}) {
  let randomState = input.randomState;
  let objectSequence = input.objectSequence;
  const objects = input.template.objects.map((template, objectIndex): EasterEggCourseObjectPlan => {
    if (template.kind === "platform") {
      const height = 18;
      const clearDistance = EASTER_EGG_RULESET.spawnX + template.x + template.width / 2
        - (EASTER_EGG_RULESET.playerX - EASTER_EGG_RULESET.playerWidth / 2);
      const object: EasterEggCourseObjectPlan = {
        sequence: objectSequence,
        patternSequence: input.patternSequence,
        patternId: input.template.id,
        tier: input.tier,
        objectId: `${input.patternSequence}:${objectIndex}:${template.platformTypeId}`,
        kind: "platform",
        typeId: template.platformTypeId,
        label: "SAFE",
        spawnTick: input.spawnTick,
        clearTick: tickAfterTravelDistance(input.spawnTick, clearDistance),
        xOffset: template.x,
        width: template.width,
        height,
        topY: template.topY,
        bottomY: template.topY + height,
        fill: 0x0e7490
      };
      objectSequence += 1;
      return object;
    }

    const random = nextRandom(randomState);
    randomState = random.state;
    const hazard = selectHazardType(template.size, input.tier, random.value);
    const dimensions = HAZARD_DIMENSIONS[template.size];
    const clearDistance = EASTER_EGG_RULESET.spawnX + template.x + dimensions.width / 2
      - (EASTER_EGG_RULESET.playerX - EASTER_EGG_RULESET.playerWidth / 2);
    const object: EasterEggCourseObjectPlan = {
      sequence: objectSequence,
      patternSequence: input.patternSequence,
      patternId: input.template.id,
      tier: input.tier,
      objectId: `${input.patternSequence}:${objectIndex}:${hazard.id}`,
      kind: "hazard",
      typeId: hazard.id,
      label: hazard.label,
      spawnTick: input.spawnTick,
      clearTick: tickAfterTravelDistance(input.spawnTick, clearDistance),
      xOffset: template.x,
      width: dimensions.width,
      height: dimensions.height,
      topY: EASTER_EGG_RULESET.groundY - dimensions.height,
      bottomY: EASTER_EGG_RULESET.groundY,
      fill: hazard.fill
    };
    objectSequence += 1;
    return object;
  });

  return { objects, randomState, objectSequence };
}

export function buildCoursePlan(seed: number, activeTickLimit: number) {
  const safeLimit = Math.max(0, Math.min(EASTER_EGG_MAX_ACTIVE_TICKS, Math.floor(activeTickLimit)));
  const patterns: EasterEggPatternPlan[] = [];
  let randomState = seed >>> 0;
  let spawnTick = 150;
  let patternSequence = 0;
  let objectSequence = 0;

  while (spawnTick <= safeLimit) {
    const tier = difficultyTierAtTick(spawnTick).id;
    const patternRandom = nextRandom(randomState);
    randomState = patternRandom.state;
    const allowedPatterns = allowedPatternsForTier(tier);
    const template = allowedPatterns[Math.min(allowedPatterns.length - 1, Math.floor(patternRandom.value * allowedPatterns.length))];
    const instantiated = instantiatePattern({ template, patternSequence, spawnTick, tier, randomState, objectSequence });
    randomState = instantiated.randomState;
    objectSequence = instantiated.objectSequence;
    const leftEdge = Math.min(...instantiated.objects.map((object) => object.xOffset - object.width / 2));
    const rightEdge = Math.max(...instantiated.objects.map((object) => object.xOffset + object.width / 2));
    const gapRandom = nextRandom(randomState);
    randomState = gapRandom.state;
    const gapJitter = Math.round((gapRandom.value - 0.5) * 24);
    const safeExitDistance = safeExitDistanceForPatternObjects(instantiated.objects);
    const interPatternGap = Math.max(patternGapDistanceAtTick(spawnTick) + gapJitter, safeExitDistance);
    const nextPatternDistance = rightEdge - leftEdge + interPatternGap;
    const nextSpawnTick = tickAfterTravelDistance(spawnTick, nextPatternDistance);
    patterns.push({
      sequence: patternSequence,
      patternId: template.id,
      tier,
      spawnTick,
      nextSpawnTick,
      safeExitDistance,
      objects: instantiated.objects
    });
    spawnTick = nextSpawnTick;
    patternSequence += 1;
  }

  return patterns;
}

export function buildCourseObjects(seed: number, activeTickLimit: number) {
  return buildCoursePlan(seed, activeTickLimit).flatMap((pattern) => pattern.objects);
}

export function buildObstaclePlan(seed: number, activeTickLimit: number) {
  return buildCourseObjects(seed, activeTickLimit).filter((object) => object.kind === "hazard");
}

export function clearedHazardCount(seed: number, activeTickCount: number) {
  return buildCourseObjects(seed, activeTickCount).filter((object) => object.kind === "hazard" && object.clearTick <= activeTickCount).length;
}

export function clearedPlatformCount(seed: number, activeTickCount: number) {
  return buildCourseObjects(seed, activeTickCount).filter((object) => object.kind === "platform" && object.clearTick <= activeTickCount).length;
}

export const clearedObstacleCount = clearedHazardCount;

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprintCourseObjects(seed: number, activeTickCount: number, objects: EasterEggCourseObjectPlan[]) {
  const payload = objects.map((object) => [
    object.patternId,
    object.tier,
    object.typeId,
    object.kind,
    object.spawnTick,
    object.xOffset,
    object.width,
    object.height,
    object.topY
  ].join(":"));
  return fnv1a(`${EASTER_EGG_GAME_CONTRACT_VERSION}|${seed >>> 0}|${Math.floor(activeTickCount)}|${payload.join("|")}`);
}

export function courseFingerprintAtTick(seed: number, activeTickCount: number) {
  return fingerprintCourseObjects(seed, activeTickCount, buildCourseObjects(seed, activeTickCount));
}

export function expectedRunProgress(seed: number, activeTickCount: number) {
  const objects = buildCourseObjects(seed, activeTickCount);
  return {
    difficultyTier: difficultyTierAtTick(activeTickCount).id,
    hazardCount: objects.filter((object) => object.kind === "hazard" && object.clearTick <= activeTickCount).length,
    platformCount: objects.filter((object) => object.kind === "platform" && object.clearTick <= activeTickCount).length,
    courseFingerprint: fingerprintCourseObjects(seed, activeTickCount, objects)
  };
}

export function calculateEasterEggScore(activeTickCount: number, hazardCount: number) {
  const safeTicks = Math.max(0, Math.min(EASTER_EGG_MAX_ACTIVE_TICKS, Math.floor(activeTickCount)));
  const safeHazards = Math.max(0, Math.floor(hazardCount));
  return Math.floor(safeTicks / 6) + safeHazards * 25;
}

export function runDurationMs(activeTickCount: number) {
  return Math.round((Math.max(0, activeTickCount) / EASTER_EGG_FIXED_TICKS_PER_SECOND) * 1000);
}

export function travelledDistanceForTicks(startTick: number, endTick: number) {
  return travelDistanceBetweenTicks(startTick, endTick);
}

export const EASTER_EGG_RULESET = Object.freeze({
  contractVersion: EASTER_EGG_GAME_CONTRACT_VERSION,
  fixedTicksPerSecond: EASTER_EGG_FIXED_TICKS_PER_SECOND,
  gravity: 1_650,
  jumpVelocity: -590,
  groundY: 308,
  playerX: 112,
  playerWidth: 34,
  playerHeight: 54,
  spawnX: 850,
  minimumReactionTicks: 8,
  maximumSpeed: 510
});
