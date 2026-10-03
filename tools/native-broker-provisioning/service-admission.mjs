// Supervised pilot admission reuses the native catalog/role checks and fencing.
// No SQL, credential generation, secret writes, or provider calls live here.
import { existingOAuthCandidate } from "./existing-candidate-reconciliation.mjs";
import { productionProvisioningBuildProfile } from "./production-profile.mjs";

const deny = () => new Error("native_service_admission_denied");
const profiles = new Set(["oauth", "broker", "runtime", "evidence"]);
const token = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const oauthTarget = productionProvisioningBuildProfile("oauth").target;
const proofFields = new Set(["kind", "intent", "approvalId", "time", "outcome", "failureStage", "failureCategory",
  "priorIntent", "roleOid", "versionName", "candidateAuthenticated", "fenceConfirmed", "originalDatabaseCommit", "credentialPublished"]);

export function admissionHangup(cancel) {
  process.on("SIGHUP", cancel);
  return () => process.removeListener("SIGHUP", cancel);
}

export function admissionOutput(output, cancel) {
  // Keep the listener through final writes: EPIPE's error event can arrive after
  // its callback. A disconnected Terminal must cancel, not bypass fencing.
  output.on("error", cancel);
  return () => new Promise((resolve, reject) => output.write("native_service_admitted_supervised\n",
    error => error ? reject(deny()) : resolve()));
}

async function notifyUntilCancellation(notify, signal) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (done, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); done(value);
    };
    const abort = () => finish(reject, deny());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else Promise.resolve().then(() => {
      if (signal.aborted) throw deny();
      return notify();
    }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function serviceAdmissionReceipt({ profile, last, roleOid, secretParent, prior, intent, approvalId }) {
  if (last?.kind === "existing_candidate_reconciliation_finished") {
    const pin = existingOAuthCandidate, target = { ...profile?.target, roleOid };
    // Present credential authentication is distinct from the lost historical
    // COMMIT acknowledgement. Accept only this exact closed OAuth proof, without
    // manufacturing a provisioning receipt or publishing/replacing a credential.
    if (profile?.kind !== "production" || profile.name !== "oauth" || roleOid !== pin.roleOid ||
        Object.keys(target).length !== Object.keys(oauthTarget).length ||
        !Object.keys(oauthTarget).every(key => target[key] === (key === "roleOid" ? pin.roleOid : oauthTarget[key])) ||
        `${secretParent}/versions/1` !== pin.versionName ||
        Object.keys(last).length !== proofFields.size || Object.keys(last).some(key => !proofFields.has(key)) ||
        last.outcome !== "existing_candidate_verified_closed" || last.priorIntent !== pin.priorIntent ||
        last.roleOid !== pin.roleOid || last.versionName !== pin.versionName ||
        last.candidateAuthenticated !== true || last.fenceConfirmed !== true ||
        last.originalDatabaseCommit !== "uncertain" || last.credentialPublished !== false ||
        last.failureStage !== null || last.failureCategory !== null || !Number.isSafeInteger(last.time) || last.time < 1 ||
        !token(last.intent) || last.intent === pin.priorIntent || last.intent === pin.retainedProofIntent ||
        !token(last.approvalId) || last.approvalId === pin.retainedProofApprovalId ||
        !Array.isArray(prior) || prior.at(-1) !== last || !token(intent) || !token(approvalId) ||
        prior.filter(entry => entry?.kind === "existing_candidate_reconciliation_finished" &&
          entry.outcome === "existing_candidate_verified_closed").length !== 1 ||
        intent === pin.priorIntent || prior.some(entry => entry?.intent === intent || entry?.approvalId === approvalId)) throw deny();
    return pin.versionName;
  }
  if (profile?.kind !== "production" || !profiles.has(profile.name) || !/^[1-9][0-9]{0,9}$/.test(roleOid ?? "") ||
      last?.kind !== "maintenance_finished" || last.outcome !== "staged_ready" || last.roleOid !== roleOid ||
      last.databaseCommit !== "acknowledged" || last.fenceConfirmed !== true || last.requiresFreshReplacement !== false ||
      last.applicationAuthority !== "verified_closed" || last.secret?.targetRole !== profile.target.role ||
      last.secret.intent !== last.intent || last.secret.state !== "staged_ready" || last.secret.ownedVersionKnown !== true ||
      last.secret.recoveryPending !== false || last.secret.credentialPublished !== false ||
      last.secret.versionName !== `${secretParent}/versions/1`) throw deny();
  return last.secret.versionName;
}

/** The caller keeps the private administrator supplier alive until this returns.
 * Cancellation has an independent bounded fence attempt. Even a lost activation
 * ACK or failing receipt sink cannot skip it. Abrupt process/VM death is NOT a
 * database lease: it requires checked reconciliation, never a closure claim.
 */
export async function superviseServiceAdmission({ native, target, intent, approvalId, signal, record, notify }) {
  const context = { target, intent, approvalId, signal };
  const receipt = result => result?.ack === true && result.committed === true && result.roleOid === target.roleOid;
  let attempted = false, admitted = false, closed = false, failed = false;
  try {
    if (signal.aborted) throw deny();
    if (!receipt(await native.inspect(context))) throw deny();
    await record("admission_started"); // Must be durable before mutation.
    if (signal.aborted) throw deny();
    attempted = true;
    const active = await native.activate(context);
    if (!receipt(active) || active.noLogin !== false) throw deny();
    admitted = true;
    await record("admission_opened");
    await notifyUntilCancellation(notify, signal);
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", resolve, { once: true });
    });
  } catch { failed = true; }
  finally {
    if (attempted) {
      const cleanup = new AbortController();
      const timer = setTimeout(() => cleanup.abort(), 30000);
      try {
        await native.abortAndDrain();
        const fence = await native.fence({ ...context, signal: cleanup.signal });
        closed = receipt(fence) && fence.noLogin === true && fence.sessionsTerminated === true;
      } catch { closed = false; }
      finally { clearTimeout(timer); }
      // Receipt failure does not suppress fencing or turn uncertainty into success.
      try { await record(closed ? "admission_closed" : "admission_recovery_required"); }
      catch { failed = true; }
    }
  }
  return Object.freeze({ outcome: attempted && closed && !failed && admitted ? "service_closed" : "requires_checked_recovery",
    fenceConfirmed: closed, activationAttempted: attempted, roleOid: target.roleOid });
}
