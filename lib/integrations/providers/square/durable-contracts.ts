import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";
import { Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

export const SQUARE_DURABLE_CONTRACT_VERSION = "square_dormant_durable_page_v1" as const;

/** A task/worker binding, not seller verification or permission to enroll a connection. */
export const SquareDurableTaskContextSchema = z.object({
  taskId: UuidSchema,
  leaseOwnerFingerprint: Sha256FingerprintSchema
}).strict();
export type SquareDurableTaskContext = Readonly<z.infer<typeof SquareDurableTaskContextSchema>>;
export type SquareDurableDependencies = SquareDurableTaskContext & Readonly<{
  client: ExternalIntegrationsRpcClient;
}>;

/** Same inner-command capacity as PR #350; no parser, projection or QBO limit changes. */
export type SquareDurableJsonLimits = Readonly<{
  containers: number; values: number; bytes: number; depth: number;
  arrayLength: number; properties: number; stringLength: number;
}>;
export const SQUARE_DURABLE_JSON_LIMITS: SquareDurableJsonLimits = Object.freeze({
  containers: 66_000, values: 7_200_000, bytes: 64 * 1_024 * 1_024,
  depth: 64, arrayLength: 3_000, properties: 64, stringLength: 4_096
});

function invalid(): never { throw new Error("square_durable_contract_invalid"); }

/**
 * Inspect descriptors before schema, hashing or RPC serialization. Shared objects
 * count on EVERY occurrence; only active ancestors detect cycles. The byte count
 * is exact serialized UTF-8 JSON, including escaped strings, keys and punctuation.
 * Result has no shared mutable input references. Callers use fixed internal limits.
 */
export function snapshotSquareDurableJson(
  root: unknown,
  limits: SquareDurableJsonLimits = SQUARE_DURABLE_JSON_LIMITS
): unknown {
  let values = 0, containers = 0, bytes = 0;
  const active = new Set<object>();
  const charge = (amount: number) => { bytes += amount; if (bytes > limits.bytes) invalid(); };
  function visit(value: unknown, depth: number): unknown {
    if (++values > limits.values || depth > limits.depth) invalid();
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && (!Number.isSafeInteger(value) || Object.is(value, -0))) invalid();
      charge(JSON.stringify(value).length);
      return value;
    }
    if (typeof value === "string") {
      if (value.length > limits.stringLength) invalid();
      charge(Buffer.byteLength(JSON.stringify(value), "utf8"));
      return value;
    }
    if (typeof value !== "object" || isProxy(value) || active.has(value) || ++containers > limits.containers) invalid();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    const keys = Reflect.ownKeys(value);
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!descriptor || !("value" in descriptor) || !Number.isSafeInteger(descriptor.value) ||
          descriptor.value < 0 || descriptor.value > limits.arrayLength || keys.length !== descriptor.value + 1) invalid();
      for (let index = 0; index < descriptor.value; index++) if (!Object.hasOwn(value, String(index))) invalid();
    } else if (keys.length > limits.properties) invalid();
    active.add(value);
    charge(2);
    const result: unknown[] | Record<string, unknown> = array ? [] : {};
    let count = 0;
    try {
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
        if (count++ > 0) charge(1);
        if (!array) charge(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        const child = visit(descriptor.value, depth + 1);
        if (Array.isArray(result)) result.push(child); else result[key] = child;
      }
      return Object.freeze(result);
    } finally { active.delete(value); }
  }
  return visit(root, 0);
}

export function checkedSquareDurableTaskContext(input: unknown): SquareDurableTaskContext {
  return Object.freeze(SquareDurableTaskContextSchema.parse(snapshotSquareDurableJson(input, {
    containers: 1, values: 3, bytes: 512, depth: 1, arrayLength: 0, properties: 2, stringLength: 71
  })));
}
