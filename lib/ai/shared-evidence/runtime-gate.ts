/** Release qualification is intentionally a reviewed code change, not an env
 * toggle. Database migration, writer concurrency, provider policy and both
 * consumer completion paths must be qualified before changing this gate. */
export function sharedEvidenceRuntimeEnabled(): boolean { return false; }
