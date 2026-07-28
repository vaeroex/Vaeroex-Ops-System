import { createHash } from "node:crypto";

export function canonicalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshotValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeSnapshotValue(child)])
  );
}

export function canonicalSnapshotJson(value: unknown) {
  return JSON.stringify(canonicalizeSnapshotValue(value));
}

export function snapshotHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalSnapshotJson(value)).digest("hex")}` as const;
}
