import { createHash } from "node:crypto";

import { ProviderRateLimitObservationSchema } from "@/lib/integrations/runtime/contracts";

export type RuntimeRateLimitState = {
  capacityMilli: number;
  availableMilli: number;
  refillMilliPerSecond: number;
  maximumConcurrency: number;
  adaptiveConcurrency: number;
  blockedUntilMs: number;
  lastRefillAtMs: number;
  consecutiveLimited: number;
};

function boundedInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value)) throw new Error("integration_rate_limit_integer_invalid");
  return Math.min(maximum, Math.max(minimum, value));
}

function deterministicJitter(key: string, attempt: number, maximumMs: number) {
  if (maximumMs <= 0) return 0;
  const digest = createHash("sha256").update(`${key}:${attempt}`, "utf8").digest();
  return digest.readUInt32BE(0) % (maximumMs + 1);
}

export class ProviderNeutralRateLimiter {
  readonly #states = new Map<string, RuntimeRateLimitState>();

  configure(key: string, input: {
    capacity: number;
    refillPerSecond: number;
    maximumConcurrency: number;
    now: Date;
  }) {
    const capacityMilli = boundedInteger(input.capacity * 1_000, 1_000, 1_000_000);
    const refillMilliPerSecond = boundedInteger(
      input.refillPerSecond * 1_000,
      1,
      1_000_000
    );
    const adaptiveConcurrency = boundedInteger(input.maximumConcurrency, 1, 1_000);
    const state = {
      capacityMilli,
      availableMilli: capacityMilli,
      refillMilliPerSecond,
      maximumConcurrency: adaptiveConcurrency,
      adaptiveConcurrency,
      blockedUntilMs: 0,
      lastRefillAtMs: input.now.getTime(),
      consecutiveLimited: 0
    };
    this.#states.set(key, state);
    return { ...state };
  }

  acquire(key: string, input: { cost: number; now: Date }) {
    const state = this.#required(key);
    this.#refill(state, input.now.getTime());
    const costMilli = boundedInteger(input.cost * 1_000, 1_000, state.capacityMilli);
    if (input.now.getTime() < state.blockedUntilMs) {
      return { allowed: false, retryAt: new Date(state.blockedUntilMs).toISOString() } as const;
    }
    if (state.availableMilli < costMilli) {
      const deficit = costMilli - state.availableMilli;
      const delayMs = Math.ceil(deficit * 1_000 / state.refillMilliPerSecond);
      return {
        allowed: false,
        retryAt: new Date(input.now.getTime() + delayMs).toISOString()
      } as const;
    }
    state.availableMilli -= costMilli;
    return { allowed: true, retryAt: null } as const;
  }

  observe(key: string, input: { observation: unknown; attempt: number; now: Date }) {
    const state = this.#required(key);
    const observation = ProviderRateLimitObservationSchema.parse(input.observation);
    if (observation.category === "rate_limit") {
      state.consecutiveLimited += 1;
      state.adaptiveConcurrency = Math.max(1, Math.floor(state.adaptiveConcurrency / 2));
      const exponential = Math.min(3_600_000, 1_000 * (2 ** Math.min(input.attempt, 12)));
      const base = Math.max(observation.retryAfterMs ?? 0, exponential);
      state.blockedUntilMs = Math.max(
        state.blockedUntilMs,
        input.now.getTime() + base + deterministicJitter(key, input.attempt, Math.min(30_000, base))
      );
    } else if (observation.category === "availability") {
      state.consecutiveLimited += 1;
      state.adaptiveConcurrency = Math.max(1, state.adaptiveConcurrency - 1);
      state.blockedUntilMs = Math.max(
        state.blockedUntilMs,
        input.now.getTime() + Math.max(1_000, observation.retryAfterMs ?? 0)
      );
    } else if (observation.category === "authorization") {
      state.consecutiveLimited += 1;
      state.adaptiveConcurrency = 1;
      state.blockedUntilMs = Math.max(
        state.blockedUntilMs,
        input.now.getTime() + Math.max(3_600_000, observation.retryAfterMs ?? 0)
      );
    } else if (observation.category === "none") {
      state.consecutiveLimited = 0;
      state.adaptiveConcurrency = Math.min(
        state.maximumConcurrency,
        state.adaptiveConcurrency + 1
      );
    }
    return { ...state };
  }

  snapshot(key: string) {
    return { ...this.#required(key) };
  }

  #required(key: string) {
    const state = this.#states.get(key);
    if (!state) throw new Error("integration_rate_limit_state_missing");
    return state;
  }

  #refill(state: RuntimeRateLimitState, nowMs: number) {
    const elapsedMs = Math.max(0, nowMs - state.lastRefillAtMs);
    state.availableMilli = Math.min(
      state.capacityMilli,
      state.availableMilli + Math.floor(elapsedMs * state.refillMilliPerSecond / 1_000)
    );
    state.lastRefillAtMs = nowMs;
  }
}
