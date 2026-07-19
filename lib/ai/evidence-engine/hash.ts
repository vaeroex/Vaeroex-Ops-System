import { createHash } from "crypto";

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalized(child)])
  );
}

export function evidenceEngineHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(normalized(value))).digest("hex");
}
