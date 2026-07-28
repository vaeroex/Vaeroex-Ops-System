import type { SnapshotReasonCode, SnapshotState, SnapshotUnavailableState } from "@/lib/intelligence/snapshot/v1/types";

export function available<T>(value: T): SnapshotState<T> {
  return { state: "available", value };
}

export function unavailable<T>(
  state: SnapshotUnavailableState,
  code: SnapshotReasonCode,
  detail?: string
): SnapshotState<T> {
  return { state, reason: { code, ...(detail ? { detail } : {}) } };
}
