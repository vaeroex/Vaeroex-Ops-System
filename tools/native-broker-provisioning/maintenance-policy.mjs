import { sandboxProvisioningProfile } from "./sandbox-profile.mjs";
const denied = () => new Error("maintenance_policy_denied");

export function maintenanceWindow(deadline, now) {
  if (!Number.isSafeInteger(deadline) || !Number.isSafeInteger(now) || now < 0 ||
      deadline - now < 180000 || deadline - now > 3600000) throw denied();
  return Object.freeze({ softCancelAfterMs: deadline - now - 60000, hardStopAfterMs: deadline - now,
    entryTimeoutMs: Math.min(300000, deadline - now - 120000) });
}
export function requireMutationWindow(deadline, clearanceExpiry, now) {
  if (!Number.isSafeInteger(deadline) || !Number.isSafeInteger(now) || now < 0 ||
      clearanceExpiry !== Infinity && !Number.isSafeInteger(clearanceExpiry) ||
      deadline - now < 120000 || clearanceExpiry - now < 30000) throw denied();
}
export function requiresClearance(last, operation) {
  if (!["create", "rotate", "recover"].includes(operation)) throw denied();
  return operation === "recover" || Boolean(last && !(last.kind === "maintenance_finished" &&
    (last.outcome === "staged_ready" || last.databaseCommit === "not_attempted" && last.requiresFreshReplacement === false)));
}
export function checkRecoveryClearance({ last, operation, roleOid, intent, approvalId, clearance, now, profile = "callback" }) {
  const { target: sandboxTarget } = sandboxProvisioningProfile(profile);
  if (!requiresClearance(last, operation)) return Infinity;
  if (!last || !["create", "recover"].includes(operation) || !clearance ||
      clearance.priorIntent !== last.intent || clearance.nextIntent !== intent || clearance.approvalId !== approvalId ||
      clearance.projectReference !== sandboxTarget.projectReference || clearance.targetRole !== sandboxTarget.role ||
      clearance.roleOid !== roleOid || (operation === "create" ? roleOid !== "0" || clearance.roleAbsent !== true : roleOid === "0" || clearance.roleFenced !== true) ||
      clearance.sessions !== 0 || clearance.unresolvedSecretVersions !== false ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(clearance.expiresAt) || clearance.expiresAt <= now || clearance.expiresAt > now + 600000) throw denied();
  return clearance.expiresAt;
}
