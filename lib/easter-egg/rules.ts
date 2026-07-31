import {
  EASTER_EGG_FIXED_TICKS_PER_SECOND,
  EASTER_EGG_GAME_CONTRACT_VERSION,
  EASTER_EGG_MAX_ACTIVE_TICKS
} from "./contracts";

export type EasterEggDifficultyTierId = 1 | 2 | 3 | 4 | 5;
export type EasterEggCourseObjectKind = "hazard" | "platform";
export type EasterEggHazardSize = "low" | "standard" | "wide" | "tall" | "tower";
export type EasterEggPlatformTypeId = "safe-low" | "safe-mid" | "safe-high" | "safe-wide";
export type EasterEggHazardVisualKind =
  | "email-inbox"
  | "spreadsheet"
  | "printer"
  | "coffee"
  | "kpi-chart"
  | "meeting-calendar"
  | "receipts"
  | "compliance-warning"
  | "deadline-folder"
  | "quick-call"
  | "loading-spinner"
  | "sticky-note"
  | "laptop-update"
  | "notification-tower";

export type EasterEggDifficultyTier = {
  id: EasterEggDifficultyTierId;
  label: "Normal" | "Busy" | "Quarter End" | "Executive Panic" | "The Quarter Never Ends";
  startTick: number;
  patternGapDistance: number;
  speedStart: number;
  speedEnd: number;
};

export type EasterEggHazardType = {
  id: string;
  label: string;
  visualKind: EasterEggHazardVisualKind;
  size: EasterEggHazardSize;
  minTier: EasterEggDifficultyTierId;
  visualWidth: number;
  visualHeight: number;
  collisionWidth: number;
  collisionHeight: number;
  fill: number;
};

type HazardTemplate = {
  kind: "hazard";
  size: EasterEggHazardSize;
  hazardTypeId?: string;
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
  visualKind: EasterEggHazardVisualKind | "safe-platform";
  spawnTick: number;
  clearTick: number;
  xOffset: number;
  width: number;
  height: number;
  visualWidth: number;
  visualHeight: number;
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

export const EASTER_EGG_DIFFICULTY_TIERS: readonly EasterEggDifficultyTier[] = Object.freeze([
  { id: 1, label: "Normal", startTick: 0, patternGapDistance: 440, speedStart: 210, speedEnd: 238 },
  { id: 2, label: "Busy", startTick: 900, patternGapDistance: 320, speedStart: 248, speedEnd: 286 },
  { id: 3, label: "Quarter End", startTick: 2_400, patternGapDistance: 238, speedStart: 306, speedEnd: 362 },
  { id: 4, label: "Executive Panic", startTick: 4_500, patternGapDistance: 174, speedStart: 392, speedEnd: 452 },
  { id: 5, label: "The Quarter Never Ends", startTick: 7_200, patternGapDistance: 122, speedStart: 474, speedEnd: 510 }
]);

export const EASTER_EGG_HAZARD_TYPES: readonly EasterEggHazardType[] = Object.freeze([
  { id: "urgent-email", label: "URGENT", visualKind: "email-inbox", size: "low", minTier: 1, visualWidth: 42, visualHeight: 30, collisionWidth: 34, collisionHeight: 23, fill: 0x9f1239 },
  { id: "ref-spreadsheet", label: "#REF!", visualKind: "spreadsheet", size: "low", minTier: 1, visualWidth: 44, visualHeight: 32, collisionWidth: 36, collisionHeight: 25, fill: 0x7f1d1d },
  { id: "printer-error", label: "PAPER JAM", visualKind: "printer", size: "standard", minTier: 2, visualWidth: 48, visualHeight: 43, collisionWidth: 40, collisionHeight: 35, fill: 0x991b1b },
  { id: "coffee-spill", label: "COFFEE", visualKind: "coffee", size: "low", minTier: 2, visualWidth: 40, visualHeight: 29, collisionWidth: 32, collisionHeight: 22, fill: 0x92400e },
  { id: "meeting-block", label: "MEETING", visualKind: "meeting-calendar", size: "wide", minTier: 3, visualWidth: 68, visualHeight: 38, collisionWidth: 58, collisionHeight: 31, fill: 0x7c2d12 },
  { id: "quick-call", label: "QUICK CALL?", visualKind: "quick-call", size: "wide", minTier: 3, visualWidth: 72, visualHeight: 38, collisionWidth: 60, collisionHeight: 30, fill: 0x6b21a8 },
  { id: "receipt-stack", label: "RECEIPTS", visualKind: "receipts", size: "standard", minTier: 2, visualWidth: 46, visualHeight: 40, collisionWidth: 38, collisionHeight: 33, fill: 0x9a3412 },
  { id: "red-kpi", label: "KPI DOWN", visualKind: "kpi-chart", size: "tall", minTier: 3, visualWidth: 50, visualHeight: 72, collisionWidth: 42, collisionHeight: 64, fill: 0xbe123c },
  { id: "compliance-warning", label: "COMPLIANCE", visualKind: "compliance-warning", size: "tall", minTier: 3, visualWidth: 54, visualHeight: 76, collisionWidth: 46, collisionHeight: 66, fill: 0xb91c1c },
  { id: "quarter-end-deadline", label: "EOD", visualKind: "deadline-folder", size: "tower", minTier: 4, visualWidth: 62, visualHeight: 108, collisionWidth: 52, collisionHeight: 98, fill: 0x881337 },
  { id: "circle-back", label: "CIRCLE BACK", visualKind: "sticky-note", size: "standard", minTier: 4, visualWidth: 50, visualHeight: 48, collisionWidth: 42, collisionHeight: 40, fill: 0x7e22ce },
  { id: "sentient-spinner", label: "LOADING...", visualKind: "loading-spinner", size: "wide", minTier: 4, visualWidth: 70, visualHeight: 42, collisionWidth: 58, collisionHeight: 34, fill: 0x4338ca },
  { id: "laptop-update", label: "UPDATE REQUIRED", visualKind: "laptop-update", size: "wide", minTier: 4, visualWidth: 74, visualHeight: 46, collisionWidth: 64, collisionHeight: 38, fill: 0x9f1239 },
  { id: "unread-notifications", label: "99+", visualKind: "notification-tower", size: "tower", minTier: 5, visualWidth: 58, visualHeight: 98, collisionWidth: 50, collisionHeight: 88, fill: 0xbe123c }
]);

export const EASTER_EGG_PATTERN_CATALOG: readonly EasterEggPatternTemplate[] = Object.freeze([
  { id: "single-basic", minTier: 1, maxTier: 5, objects: [{ kind: "hazard", size: "low", x: 0 }] },
  { id: "single-office-snag", minTier: 2, maxTier: 4, objects: [{ kind: "hazard", size: "standard", x: 0 }] },
  {
    id: "paired-small-interruptions",
    minTier: 2,
    maxTier: 4,
    objects: [
      { kind: "hazard", size: "low", x: 0 },
      { kind: "hazard", size: "low", x: 142 }
    ]
  },
  {
    id: "printer-paperwork",
    minTier: 2,
    maxTier: 4,
    objects: [
      { kind: "hazard", size: "standard", hazardTypeId: "printer-error", x: 0 },
      { kind: "hazard", size: "standard", hazardTypeId: "receipt-stack", x: 172 }
    ]
  },
  { id: "single-wide", minTier: 3, maxTier: 5, objects: [{ kind: "hazard", size: "wide", x: 0 }] },
  { id: "single-tall", minTier: 3, maxTier: 5, objects: [{ kind: "hazard", size: "tall", x: 0 }] },
  {
    id: "quick-call-meeting",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "hazard", size: "wide", hazardTypeId: "quick-call", x: 0 },
      { kind: "hazard", size: "wide", hazardTypeId: "meeting-block", x: 214 }
    ]
  },
  {
    id: "spreadsheet-kpi",
    minTier: 3,
    maxTier: 5,
    objects: [
      { kind: "hazard", size: "low", hazardTypeId: "ref-spreadsheet", x: 0 },
      { kind: "hazard", size: "tall", hazardTypeId: "red-kpi", x: 238 }
    ]
  },
  {
    id: "platform-boost",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 500, topY: 264 },
      { kind: "hazard", size: "tower", x: 300 }
    ]
  },
  {
    id: "ascending-platforms",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 180, topY: 274 },
      { kind: "platform", platformTypeId: "safe-mid", x: 198, width: 180, topY: 246 },
      { kind: "hazard", size: "tower", x: 430 }
    ]
  },
  {
    id: "safe-staircase",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 180, topY: 276 },
      { kind: "platform", platformTypeId: "safe-mid", x: 190, width: 180, topY: 250 },
      { kind: "platform", platformTypeId: "safe-high", x: 380, width: 180, topY: 224 }
    ]
  },
  {
    id: "raised-over-hazard",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-wide", x: 70, width: 360, topY: 248 },
      { kind: "hazard", size: "standard", x: 90 },
      { kind: "hazard", size: "low", x: 215 }
    ]
  },
  {
    id: "loading-update",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "hazard", size: "wide", hazardTypeId: "sentient-spinner", x: 0 },
      { kind: "hazard", size: "wide", hazardTypeId: "laptop-update", x: 205 }
    ]
  },
  {
    id: "platform-gap-platform",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-mid", x: 0, width: 200, topY: 248 },
      { kind: "hazard", size: "tower", x: 240 },
      { kind: "platform", platformTypeId: "safe-mid", x: 470, width: 210, topY: 248 }
    ]
  },
  {
    id: "descending-platforms",
    minTier: 4,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-high", x: 0, width: 190, topY: 220 },
      { kind: "platform", platformTypeId: "safe-mid", x: 210, width: 190, topY: 246 },
      { kind: "platform", platformTypeId: "safe-low", x: 420, width: 190, topY: 274 }
    ]
  },
  {
    id: "notification-escalation",
    minTier: 5,
    maxTier: 5,
    objects: [
      { kind: "hazard", size: "low", hazardTypeId: "urgent-email", x: 0 },
      { kind: "hazard", size: "standard", hazardTypeId: "circle-back", x: 190 },
      { kind: "hazard", size: "tower", hazardTypeId: "unread-notifications", x: 500 }
    ]
  },
  {
    id: "late-mixed-sequence",
    minTier: 5,
    maxTier: 5,
    objects: [
      { kind: "platform", platformTypeId: "safe-low", x: 0, width: 510, topY: 264 },
      { kind: "hazard", size: "tower", x: 310 },
      { kind: "hazard", size: "low", x: 580 },
      { kind: "hazard", size: "low", x: 730 }
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
  const safeTick = Math.max(0, Math.floor(tick));
  const tier = difficultyTierAtTick(safeTick);
  const nextTier = EASTER_EGG_DIFFICULTY_TIERS[tier.id];
  const tierEndTick = nextTier?.startTick || EASTER_EGG_MAX_ACTIVE_TICKS;
  const progress = Math.min(1, Math.max(0, safeTick - tier.startTick) / Math.max(1, tierEndTick - tier.startTick));
  return Math.round(tier.speedStart + (tier.speedEnd - tier.speedStart) * progress);
}

export function patternGapDistanceAtTick(tick: number) {
  const tier = difficultyTierAtTick(tick);
  const nextTier = EASTER_EGG_DIFFICULTY_TIERS[tier.id];
  if (!nextTier) return tier.patternGapDistance;
  const progress = Math.min(1, Math.max(0, tick - tier.startTick) / Math.max(1, nextTier.startTick - tier.startTick));
  return Math.round(tier.patternGapDistance + (nextTier.patternGapDistance - tier.patternGapDistance) * progress * 0.35);
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

function selectHazardType(template: HazardTemplate, tier: EasterEggDifficultyTierId, randomValue: number) {
  if (template.hazardTypeId) {
    const exact = EASTER_EGG_HAZARD_TYPES.find((hazard) => hazard.id === template.hazardTypeId);
    if (!exact || exact.size !== template.size || exact.minTier > tier) {
      throw new Error(`Hazard ${template.hazardTypeId} is not legal for ${template.size} at tier ${tier}.`);
    }
    return exact;
  }
  const eligible = EASTER_EGG_HAZARD_TYPES.filter((hazard) => hazard.size === template.size && hazard.minTier <= tier);
  if (eligible.length === 0) throw new Error(`No Easter Egg hazard is legal for ${template.size} at tier ${tier}.`);
  return eligible[Math.min(eligible.length - 1, Math.floor(randomValue * eligible.length))];
}

export function allowedPatternsForTier(tier: EasterEggDifficultyTierId) {
  return EASTER_EGG_PATTERN_CATALOG.filter((pattern) => pattern.minTier <= tier && pattern.maxTier >= tier);
}

export function getEasterEggPattern(patternId: string) {
  return EASTER_EGG_PATTERN_CATALOG.find((pattern) => pattern.id === patternId) || null;
}

export function buildPatternPlanForValidation(patternId: string, tier: EasterEggDifficultyTierId, seed = 0x5eed1234) {
  const template = getEasterEggPattern(patternId);
  if (!template || template.minTier > tier || template.maxTier < tier) return null;
  const instantiated = instantiatePattern({ template, patternSequence: 0, spawnTick: 0, tier, randomState: seed >>> 0, objectSequence: 0 });
  return { sequence: 0, patternId: template.id, tier, spawnTick: 0, nextSpawnTick: 0, safeExitDistance: 0, objects: instantiated.objects } satisfies EasterEggPatternPlan;
}

export function safeExitDistanceForPatternObjects(objects: EasterEggCourseObjectPlan[]) {
  const highestPlatform = objects.filter((object) => object.kind === "platform").reduce((highest, platform) => Math.max(highest, EASTER_EGG_RULESET.groundY - platform.topY), 0);
  if (highestPlatform <= 0) return 0;
  const fallSeconds = Math.sqrt((2 * highestPlatform) / EASTER_EGG_RULESET.gravity);
  const reactionSeconds = EASTER_EGG_RULESET.minimumReactionTicks / EASTER_EGG_RULESET.fixedTicksPerSecond;
  return Math.ceil((fallSeconds + reactionSeconds) * EASTER_EGG_RULESET.maximumSpeed + 40);
}

function instantiatePattern(input: { template: EasterEggPatternTemplate; patternSequence: number; spawnTick: number; tier: EasterEggDifficultyTierId; randomState: number; objectSequence: number }) {
  let randomState = input.randomState;
  let objectSequence = input.objectSequence;
  const objects = input.template.objects.map((template, objectIndex): EasterEggCourseObjectPlan => {
    if (template.kind === "platform") {
      const height = 18;
      const clearDistance = EASTER_EGG_RULESET.spawnX + template.x + template.width / 2 - (EASTER_EGG_RULESET.playerX - EASTER_EGG_RULESET.playerWidth / 2);
      const object: EasterEggCourseObjectPlan = {
        sequence: objectSequence, patternSequence: input.patternSequence, patternId: input.template.id, tier: input.tier,
        objectId: `${input.patternSequence}:${objectIndex}:${template.platformTypeId}`,
        kind: "platform", typeId: template.platformTypeId, label: "SAFE", visualKind: "safe-platform",
        spawnTick: input.spawnTick, clearTick: tickAfterTravelDistance(input.spawnTick, clearDistance), xOffset: template.x,
        width: template.width, height, visualWidth: template.width, visualHeight: height,
        topY: template.topY, bottomY: template.topY + height, fill: 0x0e7490
      };
      objectSequence += 1;
      return object;
    }

    const random = nextRandom(randomState);
    randomState = random.state;
    const hazard = selectHazardType(template, input.tier, random.value);
    const clearDistance = EASTER_EGG_RULESET.spawnX + template.x + hazard.collisionWidth / 2 - (EASTER_EGG_RULESET.playerX - EASTER_EGG_RULESET.playerWidth / 2);
    const object: EasterEggCourseObjectPlan = {
      sequence: objectSequence, patternSequence: input.patternSequence, patternId: input.template.id, tier: input.tier,
      objectId: `${input.patternSequence}:${objectIndex}:${hazard.id}`,
      kind: "hazard", typeId: hazard.id, label: hazard.label, visualKind: hazard.visualKind,
      spawnTick: input.spawnTick, clearTick: tickAfterTravelDistance(input.spawnTick, clearDistance), xOffset: template.x,
      width: hazard.collisionWidth, height: hazard.collisionHeight,
      visualWidth: hazard.visualWidth, visualHeight: hazard.visualHeight,
      topY: EASTER_EGG_RULESET.groundY - hazard.collisionHeight, bottomY: EASTER_EGG_RULESET.groundY, fill: hazard.fill
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
    const leftEdge = Math.min(...instantiated.objects.map((object) => object.xOffset - object.visualWidth / 2));
    const rightEdge = Math.max(...instantiated.objects.map((object) => object.xOffset + object.visualWidth / 2));
    const gapRandom = nextRandom(randomState);
    randomState = gapRandom.state;
    const gapJitter = Math.round((gapRandom.value - 0.5) * 20);
    const safeExitDistance = safeExitDistanceForPatternObjects(instantiated.objects);
    const interPatternGap = Math.max(patternGapDistanceAtTick(spawnTick) + gapJitter, safeExitDistance);
    const nextSpawnTick = tickAfterTravelDistance(spawnTick, rightEdge - leftEdge + interPatternGap);
    patterns.push({ sequence: patternSequence, patternId: template.id, tier, spawnTick, nextSpawnTick, safeExitDistance, objects: instantiated.objects });
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
    object.patternId, object.tier, object.typeId, object.kind, object.visualKind, object.spawnTick, object.xOffset,
    object.width, object.height, object.visualWidth, object.visualHeight, object.topY
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
  return Math.floor(safeTicks / 6) + Math.max(0, Math.floor(hazardCount)) * 25;
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
  minimumReactionTicks: 10,
  maximumSpeed: 510
});
