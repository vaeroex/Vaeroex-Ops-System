import type { UploadSourceState } from "@/lib/files/upload-types";
import { navigate } from "./navigation";

export type FixtureMode = "success" | "delayed" | "recoverable" | "unknown";
export type FixtureRecord = {
  id: string; fileName: string; displayName: string; folder: string; size: number; extension: string;
  rowCount: number; status: string; worksheets: { name: string; status: string; rows: number }[];
  rows: Record<string, string | number | null>[]; issues: { message: string; worksheet: string }[];
};
let state = { mode: "success" as FixtureMode, uploadRequests: 0, primaryRequests: 0, analysisRequests: 0, records: [] as FixtureRecord[] };
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const snapshot = () => state;
const completions = new Map<string, () => void>();
export function completeSharedAction(kind: "primary" | "analysis") { completions.get(kind)?.(); completions.delete(kind); }
function update(patch: Partial<typeof state>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); }
export function setMode(mode: FixtureMode) { update({ mode }); }

// Explicit substitute for the server action: no auth, storage, database, AI,
// duplicate checks, or approval mutations. Only the pure validator/parser run.
export async function uploadSourceAction(_previous: UploadSourceState, formData: FormData): Promise<UploadSourceState> {
  const submittedMode = state.mode;
  update({ uploadRequests: state.uploadRequests + 1 });
  formData.set("fixture_mode", submittedMode);
  try {
    const response = await fetch("/__fixture/inspect", { method: "POST", body: formData });
    const result = await response.json() as UploadSourceState & { records?: FixtureRecord[]; record?: FixtureRecord };
    if (result.records) update({ records: result.records });
    if (result.error) return { error: result.error, blocked: result.blocked };
    if (!result.record) return { error: "The fixture returned no source confirmation.", blocked: true };
    navigate(`/app/sources/${result.record.id}?message=${encodeURIComponent("Synthetic upload completed. Review is still required; no business records were created.")}`);
    return { error: null };
  } catch {
    return { error: "The local fixture response could not be confirmed. Check saved sources before another upload.", blocked: true };
  }
}
export async function runSharedAction(kind: "primary" | "analysis") {
  const key = kind === "primary" ? "primaryRequests" : "analysisRequests";
  update({ [key]: state[key] + 1 });
  await new Promise<void>((resolve) => { completions.set(kind, resolve); });
  navigate(`/app/sources?message=${encodeURIComponent(`Synthetic ${kind} action completed. This result stays visible until Close.`)}`);
}
