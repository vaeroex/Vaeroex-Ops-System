import {
  buildPatternPlanForValidation,
  EASTER_EGG_RULESET,
  runnerSpeedAtTick,
  type EasterEggCourseObjectPlan,
  type EasterEggDifficultyTierId
} from "./rules";

type SimulationState = {
  bottomY: number;
  velocityY: number;
  supportId: string | "ground" | null;
  jumpTicks: number[];
};

const TIER_MAX_SPEED_TICKS: Record<EasterEggDifficultyTierId, number> = {
  1: 899,
  2: 2_399,
  3: 4_499,
  4: 7_199,
  5: 8_000
};

const VALIDATION_SPAWN_X = 560;
const FIXED_STEP_SECONDS = 1 / EASTER_EGG_RULESET.fixedTicksPerSecond;

function objectXAtSimulationTick(object: EasterEggCourseObjectPlan, tick: number, speed: number) {
  return VALIDATION_SPAWN_X + object.xOffset - speed * tick * FIXED_STEP_SECONDS;
}

function overlapsPlayerHorizontally(object: EasterEggCourseObjectPlan, tick: number, speed: number) {
  const objectX = objectXAtSimulationTick(object, tick, speed);
  const playerLeft = EASTER_EGG_RULESET.playerX - EASTER_EGG_RULESET.playerWidth / 2;
  const playerRight = EASTER_EGG_RULESET.playerX + EASTER_EGG_RULESET.playerWidth / 2;
  return playerRight > objectX - object.width / 2 && playerLeft < objectX + object.width / 2;
}

function collidesWithHazard(
  state: SimulationState,
  hazards: EasterEggCourseObjectPlan[],
  tick: number,
  speed: number
) {
  const playerTop = state.bottomY - EASTER_EGG_RULESET.playerHeight;
  return hazards.some((hazard) => overlapsPlayerHorizontally(hazard, tick, speed)
    && state.bottomY > hazard.topY
    && playerTop < hazard.bottomY);
}

function advanceState(input: {
  state: SimulationState;
  jump: boolean;
  tick: number;
  speed: number;
  platforms: EasterEggCourseObjectPlan[];
  hazards: EasterEggCourseObjectPlan[];
}) {
  const { state, tick, speed, platforms, hazards } = input;
  let supportId = state.supportId;
  let bottomY = state.bottomY;
  let velocityY = state.velocityY;
  const jumpTicks = input.jump ? [...state.jumpTicks, tick] : state.jumpTicks;

  if (supportId && supportId !== "ground") {
    const support = platforms.find((platform) => platform.objectId === supportId);
    if (!support || !overlapsPlayerHorizontally(support, tick, speed)) supportId = null;
  }

  if (input.jump && supportId) {
    supportId = null;
    velocityY = EASTER_EGG_RULESET.jumpVelocity;
  }

  if (supportId === "ground") {
    bottomY = EASTER_EGG_RULESET.groundY;
    velocityY = 0;
  } else if (supportId) {
    const support = platforms.find((platform) => platform.objectId === supportId);
    if (support) {
      bottomY = support.topY;
      velocityY = 0;
    }
  } else {
    const previousBottom = bottomY;
    velocityY += EASTER_EGG_RULESET.gravity * FIXED_STEP_SECONDS;
    bottomY += velocityY * FIXED_STEP_SECONDS;

    if (velocityY >= 0) {
      const landing = platforms
        .filter((platform) => overlapsPlayerHorizontally(platform, tick, speed)
          && previousBottom <= platform.topY
          && bottomY >= platform.topY)
        .sort((left, right) => left.topY - right.topY)[0];
      if (landing) {
        bottomY = landing.topY;
        velocityY = 0;
        supportId = landing.objectId;
      }
    }

    if (!supportId && bottomY >= EASTER_EGG_RULESET.groundY) {
      bottomY = EASTER_EGG_RULESET.groundY;
      velocityY = 0;
      supportId = "ground";
    }
  }

  const nextState = { bottomY, velocityY, supportId, jumpTicks };
  return collidesWithHazard(nextState, hazards, tick, speed) ? null : nextState;
}

function stateKey(state: SimulationState) {
  return [Math.round(state.bottomY * 4), Math.round(state.velocityY * 2), state.supportId || "air"].join(":");
}

export function simulatePatternJumpSequence(input: {
  patternId: string;
  tier: EasterEggDifficultyTierId;
  jumpTicks: readonly number[];
}) {
  const pattern = buildPatternPlanForValidation(input.patternId, input.tier);
  if (!pattern) return false;
  const speed = runnerSpeedAtTick(TIER_MAX_SPEED_TICKS[input.tier]);
  const hazards = pattern.objects.filter((object) => object.kind === "hazard");
  const platforms = pattern.objects.filter((object) => object.kind === "platform");
  const lastRightEdge = Math.max(...pattern.objects.map((object) => VALIDATION_SPAWN_X + object.xOffset + object.width / 2));
  const finalTick = Math.ceil((lastRightEdge - EASTER_EGG_RULESET.playerX + 120) / speed / FIXED_STEP_SECONDS);
  let state: SimulationState | null = {
    bottomY: EASTER_EGG_RULESET.groundY,
    velocityY: 0,
    supportId: "ground",
    jumpTicks: []
  };
  const jumps = new Set(input.jumpTicks);
  for (let tick = 0; tick <= finalTick && state; tick += 1) {
    state = advanceState({ state, jump: jumps.has(tick) && Boolean(state.supportId), tick, speed, platforms, hazards });
  }
  return Boolean(state);
}

export function findPassablePatternTraversal(
  patternId: string,
  tier: EasterEggDifficultyTierId
): { passable: boolean; jumpTicks: number[]; speed: number } {
  const pattern = buildPatternPlanForValidation(patternId, tier);
  const speed = runnerSpeedAtTick(TIER_MAX_SPEED_TICKS[tier]);
  if (!pattern) return { passable: false, jumpTicks: [], speed };
  const hazards = pattern.objects.filter((object) => object.kind === "hazard");
  const platforms = pattern.objects.filter((object) => object.kind === "platform");
  const lastRightEdge = Math.max(...pattern.objects.map((object) => VALIDATION_SPAWN_X + object.xOffset + object.width / 2));
  const finalTick = Math.ceil((lastRightEdge - EASTER_EGG_RULESET.playerX + 120) / speed / FIXED_STEP_SECONDS);
  let states = new Map<string, SimulationState>();
  const initial: SimulationState = {
    bottomY: EASTER_EGG_RULESET.groundY,
    velocityY: 0,
    supportId: "ground",
    jumpTicks: []
  };
  states.set(stateKey(initial), initial);

  for (let tick = 0; tick <= finalTick; tick += 1) {
    const nextStates = new Map<string, SimulationState>();
    for (const state of states.values()) {
      const choices = state.supportId ? [false, true] : [false];
      for (const jump of choices) {
        const next = advanceState({ state, jump, tick, speed, platforms, hazards });
        if (!next) continue;
        const key = stateKey(next);
        const current = nextStates.get(key);
        if (!current || next.jumpTicks.length < current.jumpTicks.length) nextStates.set(key, next);
      }
    }
    states = nextStates;
    if (states.size === 0) return { passable: false, jumpTicks: [], speed };
  }

  const result = [...states.values()].sort((left, right) => left.jumpTicks.length - right.jumpTicks.length)[0];
  return { passable: Boolean(result), jumpTicks: result?.jumpTicks || [], speed };
}
