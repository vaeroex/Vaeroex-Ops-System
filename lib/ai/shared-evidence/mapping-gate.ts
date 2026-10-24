/** Owner-confirmed correspondence is setup, independent of model dispatch.
 * The authenticated mapping helper and RPC still enforce owner/session,
 * workspace, active entity and current connection-version checks. */
export function evidenceMappingSetupEnabled(): boolean { return true; }
