import type { Json } from "@/lib/supabase/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function labelForKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => readableValue(item)).join(", ");
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${labelForKey(key)}: ${readableValue(item)}`)
      .join("; ");
  }

  return String(value);
}

export function ReadableData({ value, empty = "No details saved." }: { value: Json | unknown; empty?: string }) {
  if (Array.isArray(value)) {
    const items = value.filter((item) => item !== null && item !== undefined && item !== "");

    if (!items.length) {
      return <p className="text-sm text-muted">{empty}</p>;
    }

    return (
      <ul className="space-y-2 text-sm leading-6 text-muted">
        {items.map((item, index) => (
          <li key={`${index}-${readableValue(item)}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
            <span>{readableValue(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "");

    if (!entries.length) {
      return <p className="text-sm text-muted">{empty}</p>;
    }

    return (
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        {entries.map(([key, item]) => (
          <div key={key} className="rounded-lg border border-line bg-white p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{labelForKey(key)}</dt>
            <dd className="mt-1 leading-6 text-ink">{readableValue(item)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return <p className="text-sm leading-6 text-muted">{readableValue(value) || empty}</p>;
}
