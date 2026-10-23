/** Demo-only code gate. No environment variable, workspace label or client
 * request can enable it. Activation needs a separately reviewed isolated host
 * binding AND the matching private database policy. Production stays closed. */
export function sandboxSharedEvidenceInstallation(): string | null { return null; }
export function sandboxDescriptiveModelUseEnabled(): boolean { return false; }
