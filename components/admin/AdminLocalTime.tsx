"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** UTC on the server; browser-local with an explicit zone after hydration. */
export function AdminLocalTime({ value, label, className = "" }: { value: string; label?: string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span className={className}>Time unavailable</span>;
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(hydrated ? {} : { timeZone: "UTC" }) };
  const zone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  return <time dateTime={date.toISOString()} title={`${date.toISOString()} · ${zone}`} className={className}>{label ? `${label} ` : ""}{new Intl.DateTimeFormat(hydrated ? undefined : "en-US", options).format(date)}</time>;
}
