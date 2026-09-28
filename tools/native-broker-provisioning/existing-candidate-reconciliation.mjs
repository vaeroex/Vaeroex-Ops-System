import { productionProvisioningBuildProfile } from "./production-profile.mjs";
import { createPinnedSupabaseDsnCodec } from "./dsn-codec.mjs";

// One retained candidate, not a replacement/rotation or a general secret reader.
export const existingOAuthCandidate = Object.freeze({
  priorIntent: "prod_oauth_20260927_224909_v1",
  roleOid: "34220",
  versionName: "projects/711446392261/secrets/square-production-oauth-db/versions/1",
  createTime: "2026-09-27T23:21:17.971560Z",
});
const pin = existingOAuthCandidate;
const deny = () => new Error("existing_oauth_candidate_denied");
const token = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const expected = productionProvisioningBuildProfile("oauth").target;

function exactTarget(target) {
  return target?.roleOid === pin.roleOid && Object.keys(expected).every(k => k === "roleOid" || target[k] === expected[k]) &&
    Object.keys(target).length === Object.keys(expected).length;
}

export function checkExistingCandidateClearance({ profile, prior, journalSha256, roleOid, intent, approvalId, clearance, now }) {
  const last = prior?.at(-1);
  if (profile?.kind !== "production" || profile.name !== "oauth" || !exactTarget({ ...profile.target, roleOid }) ||
      !Array.isArray(prior) || last?.kind !== "maintenance_finished" || last.intent !== pin.priorIntent ||
      last.phase !== "assign_and_commit" || last.outcome !== "uncertain" || last.databaseCommit !== "uncertain" ||
      last.roleOid !== pin.roleOid || last.requiresFreshReplacement !== true || last.applicationAuthority !== "verified_closed" ||
      prior.filter(x => x.kind === "maintenance_started" && x.intent === pin.priorIntent).length !== 1 ||
      prior.filter(x => x.kind === "maintenance_finished" && x.intent === pin.priorIntent).length !== 1 ||
      !token(intent) || !token(approvalId) || prior.some(x => x.intent === intent) ||
      !/^[a-f0-9]{64}$/.test(journalSha256 ?? "") ||
      clearance?.schema !== "oauth_existing_candidate_reconciliation_v1" ||
      clearance.priorIntent !== pin.priorIntent || clearance.nextIntent !== intent || clearance.approvalId !== approvalId ||
      clearance.projectReference !== expected.projectReference || clearance.targetRole !== expected.role ||
      clearance.roleOid !== pin.roleOid || clearance.versionName !== pin.versionName ||
      clearance.createTime !== pin.createTime || clearance.journalSha256 !== journalSha256 ||
      clearance.roleFenced !== true || clearance.sessions !== 0 || clearance.candidateState !== "ENABLED" ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(clearance.expiresAt) ||
      clearance.expiresAt <= now || clearance.expiresAt > now + 600000) throw deny();
  // This authorizes inspection of an unresolved candidate, NOT an assertion
  // that the old transaction succeeded or that no unresolved version exists.
  return clearance.expiresAt;
}

export function checkExistingCandidateMetadata(value) {
  if (value?.name !== pin.versionName || value.state !== "ENABLED" || value.createTime !== pin.createTime) throw deny();
}

function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function untilAbort(action, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true; signal.removeEventListener("abort", abort); fn(value);
    };
    const abort = () => finish(reject, deny());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else Promise.resolve().then(() => {
      if (signal.aborted) throw deny();
      return action();
    }).then(value => finish(resolve, value), () => finish(reject, deny()));
  });
}

/** Proof only. No prepare/assign, reservation, add/disable version or publication.
 * Authentication necessarily uses a bounded LOGIN interval. Gates stay closed;
 * the existing native primitives validate the catalog and exact target/OID.
 * Fencing is independent of journal/output success. A failed test never rotates.
 */
export async function reconcileExistingOAuthCandidate({ native, client, target, intent, approvalId, signal, record }) {
  if (!exactTarget(target) || !token(intent) || intent === pin.priorIntent || !token(approvalId) ||
      !(signal instanceof AbortSignal) || typeof record !== "function" ||
      ["inspect", "fence", "activate", "authenticate", "abortAndDrain"].some(k => typeof native?.[k] !== "function") ||
      typeof client?.getSecretVersion !== "function" || typeof client?.accessSecretVersion !== "function") throw deny();
  const controller = new AbortController(), cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const context = Object.freeze({ target, intent, approvalId, signal: controller.signal });
  const receipt = r => r?.ack === true && r.committed === true && r.authorityClosed === true && r.roleOid === pin.roleOid;
  const fenceReceipt = r => receipt(r) && r.noLogin === true && r.sessionsTerminated === true;
  const check = () => { if (controller.signal.aborted) throw deny(); };
  const step = action => untilAbort(action, controller.signal);
  const codec = createPinnedSupabaseDsnCodec(target);
  let attempted = false, matched = false, fenced = false, failed = false, reads = 0, consumed = false;
  let payload, candidate;
  try {
    await step(() => record("started")); check();
    attempted = true;
    if (!receipt(await step(() => native.inspect(context)))) throw deny();
    if (!fenceReceipt(await step(() => native.fence(context)))) throw deny();
    checkExistingCandidateMetadata(await step(() => client.getSecretVersion({ name: pin.versionName }, { timeout: 4000, retry: null })));
    await step(() => record("authentication_started")); check();
    if (!receipt(await step(async () => {
      const r = await native.activate(context);
      if (r?.noLogin !== false) throw deny();
      return r;
    }))) throw deny();
    const auth = await step(() => native.authenticate({ ...context, withCredential: async consume => {
      check();
      if (++reads !== 1 || typeof consume !== "function") throw deny();
      let reply;
      try {
        // Read once, by immutable numeric version. Late responses are wiped and
        // checked for cancellation before any native private pipe receives data.
        reply = await client.accessSecretVersion({ name: pin.versionName }, { timeout: 4000, retry: null });
        payload = reply?.payload?.data;
        check();
        const checksum = reply?.payload?.dataCrc32c;
        if (reply?.name !== pin.versionName || !Buffer.isBuffer(payload) || payload.buffer instanceof SharedArrayBuffer ||
            payload.length > 8192 || !/^(0|[1-9][0-9]{0,9})$/.test(String(checksum)) || Number(checksum) !== crc32c(payload)) throw deny();
        candidate = codec.decode(payload); check();
        await consume(candidate); check(); consumed = true;
        return { ack: true };
      } finally {
        candidate?.fill(0); candidate = undefined;
        if (payload instanceof Uint8Array) payload.fill(0);
        payload = undefined;
      }
    } }));
    check();
    if (!receipt(auth) || auth.sessionUser !== expected.role || !exactTarget(auth.target) || reads !== 1 || !consumed) throw deny();
    matched = true;
    await step(() => record("candidate_authenticated"));
  } catch { failed = true; }
  finally {
    controller.abort(); candidate?.fill(0); if (payload instanceof Uint8Array) payload.fill(0);
    if (attempted) {
      // A missing drain acknowledgement must not skip the independent fence.
      // The adapter itself refuses fencing while a worker is still active.
      const drain = new AbortController(), drainTimer = setTimeout(() => drain.abort(), 10000);
      try {
        const drained = await untilAbort(() => native.abortAndDrain(), drain.signal);
        if (drained?.ack !== true || drained.drained !== true) throw deny();
      } catch { failed = true; }
      finally { clearTimeout(drainTimer); }
      const cleanup = new AbortController(), timer = setTimeout(() => cleanup.abort(), 30000);
      try {
        fenced = fenceReceipt(await untilAbort(() => native.fence({ ...context, signal: cleanup.signal }), cleanup.signal));
      } catch { fenced = false; }
      finally { clearTimeout(timer); }
      try { await record(fenced ? "fenced" : "fence_uncertain"); } catch { failed = true; }
    }
    signal.removeEventListener("abort", cancel);
  }
  return Object.freeze({ outcome: !failed && matched && fenced ? "existing_candidate_verified_closed" : "existing_candidate_reconciliation_uncertain",
    priorIntent: pin.priorIntent, roleOid: pin.roleOid, versionName: pin.versionName,
    candidateAuthenticated: matched, fenceConfirmed: fenced, originalDatabaseCommit: "uncertain", credentialPublished: false });
}
