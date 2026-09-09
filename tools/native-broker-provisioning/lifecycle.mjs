import { timingSafeEqual } from "node:crypto";

// This file has no network, process-spawn, SQL or cloud-store implementation.
// A reviewed synthetic adapter is not a supported provider provisioning lane.
export const realProvisioningEnabled = false;
export function provisionRealBroker() {
  return Object.freeze({ outcome: "blocked", reason: "provider_provisioning_not_qualified" });
}

const targetKeys = Object.freeze([
  "projectReference", "host", "port", "database", "role", "systemIdentifier", "databaseOid",
  "adminRole", "capabilityRole", "rootCertificate", "roleOid",
]);
const nativeMethods = [
  "inspect", "prepare", "fence", "assign", "activate", "authenticate", "abortAndDrain",
];
const storeMethods = ["reserve", "stage", "withCredential", "markStagedReady", "discard"];
const ack = value => value?.ack === true;
const closed = value => ack(value) && value.authorityClosed === true;
const fenced = value => closed(value) && value.noLogin === true && value.sessionsTerminated === true;
const fault = () => new Error("synthetic_provisioning_denied");
const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const sameTarget = (left, right) => left && targetKeys.every(key => left[key] === right[key]) &&
  Object.keys(left).length === targetKeys.length;

function snapshotTarget(value) {
  if (!value || Object.keys(value).length !== targetKeys.length ||
      !targetKeys.every(key => Object.hasOwn(value, key)) ||
      !identifier(value.projectReference) || !identifier(value.host) ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(value.role) ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(value.adminRole) || value.adminRole === value.role ||
      value.capabilityRole !== "square_account_broker_authority" ||
      typeof value.rootCertificate !== "string" || !value.rootCertificate.startsWith("/") ||
      value.rootCertificate.length > 1024 || /[\u0000-\u001f\u007f]/.test(value.rootCertificate) ||
      !/^[a-zA-Z0-9_]{1,63}$/.test(value.database) ||
      !/^[1-9][0-9]{0,19}$/.test(value.systemIdentifier) ||
      !/^[1-9][0-9]{0,9}$/.test(value.databaseOid) ||
      !/^(?:0|[1-9][0-9]{0,9})$/.test(value.roleOid) ||
      !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw fault();
  return Object.freeze(Object.fromEntries(targetKeys.map(key => [key, value[key]])));
}

function requireMethods(adapter, methods) {
  if (!adapter || methods.some(name => typeof adapter[name] !== "function")) throw fault();
}

// Unlike Promise.race alone, this consumes late rejection and removes its abort
// listener. The caller must obtain a native drain barrier before compensation.
function abortable(action, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => settle(reject, fault());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    Promise.resolve().then(action).then(value => settle(resolve, value), () => settle(reject, fault()));
  });
}

async function boundedCleanup(action, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await abortable(() => action(controller.signal), controller.signal); }
  catch { return undefined; }
  finally { clearTimeout(timer); }
}

/**
 * Synthetic orchestration contract; the separate local adapter can connect it
 * to the C worker, never to an external secret store. Only the native side
 * generates the credential.
 *
 * Every native call receives the exact frozen target. Native implementations
 * must verify physical DB identity and the current, disabled application
 * authority while holding the relevant exclusion/authority locks, not merely
 * echo caller assertions. prepare may create a role only for `create`;
 * rotate/recover require the existing exact role. `fence` durably sets NOLOGIN,
 * terminates old sessions and verifies closed application use. `assign` owns
 * BEGIN, exclusion/authority locks, native generation, private delivery and its
 * acknowledgement, and COMMIT. There is no JS-controlled SQL/transaction API.
 * Enabling LOGIN permits only
 * the isolated authentication test; it never changes application authority.
 *
 * abortAndDrain ACK means the old command/connection has terminated and cannot
 * later submit DB work; a cancellation-request ACK is insufficient. Reaping a
 * process is not proof that server COMMIT stopped. The following fresh fence
 * must acquire the same locks and settle that ordering before it can ACK.
 * Any missing ACK is
 * uncertain, not evidence that the DB rolled back. Never look up a verifier.
 *
 * Secret-store reserve synchronously returns an opaque private reservation
 * without I/O; stage and reads
 * handle Buffers only. discard MUST terminally invalidate the reservation before
 * awaiting I/O, reject delayed writes and reconcile an uncertain stage by the
 * reservation, without exposing its value. markStagedReady is NOT publication
 * to the application. All adapters are trusted injected synthetic test doubles.
 */
export function createSyntheticProvisioningCoordinator({ target: inputTarget, native, secretStore, audit, now = Date.now }) {
  return createProvisioningCoordinator({ target: inputTarget, native, secretStore, audit, now });
}

// This explicit composition is for operator-mediated isolated maintenance, not
// application startup. Hosted qualification and private operator entry remain
// prerequisites; no application binding is enabled by this state machine.
export function createManagedSupabaseProvisioningCoordinator(options) {
  const target = options?.target;
  if (target?.projectReference !== "oysjpoondtcrqpghhrbd" ||
      target.host !== "aws-0-us-west-2.pooler.supabase.com" || target.port !== 5432 ||
      target.database !== "postgres" || target.adminRole !== "postgres" ||
      target.systemIdentifier !== "7678069749886157684" || target.databaseOid !== "5" ||
      !/^square_sandbox_[a-z_]{1,40}$/.test(target.role)) throw fault();
  return createProvisioningCoordinator(options);
}

function createProvisioningCoordinator({ target: inputTarget, native, secretStore, audit, now = Date.now }) {
  const target = snapshotTarget(inputTarget);
  requireMethods(native, nativeMethods);
  requireMethods(secretStore, storeMethods);
  requireMethods(audit, ["append"]);
  if (typeof now !== "function") throw fault();
  let running = false;
  let requiresRecovery = false;
  let pinnedRoleOid = target.roleOid;
  const usedIntents = new Set();

  async function run({ operation, actor, intent, approvalId, signal, deadlineMs = 10000, cleanupTimeoutMs = 2000 } = {}) {
    if (!["create", "rotate", "recover"].includes(operation) || !identifier(actor) || !identifier(intent) || !identifier(approvalId) ||
        !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30000 ||
        !Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 10000 ||
        (signal !== undefined && !(signal instanceof AbortSignal))) throw fault();
    if (running || usedIntents.size >= 256 || usedIntents.has(intent) || (requiresRecovery && operation !== "recover")) {
      return Object.freeze({ outcome: "blocked", phase: "preflight", requiresFreshReplacement: requiresRecovery });
    }
    running = true;
    usedIntents.add(intent);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, deadlineMs);
    let context = Object.freeze({ target: Object.freeze({ ...target, roleOid: pinnedRoleOid }), operation, actor, intent, approvalId, signal: controller.signal });
    let phase = "preflight";
    let reservation;
    let acceptingDelivery = false;
    let deliveryCount = 0;
    let deliveryPromise;
    let stageVerified = false;
    let mutationStarted = false;
    let commitAttempted = false;
    let commitAcknowledged = false;
    let missingAcknowledgement = false;
    let auditFailed = false;
    let authorityVerified = false;
    let stopped = false;
    let pendingPreparation;
    let validPrepared = () => false;
    const borrowedBuffers = new Set();

    const check = () => { if (stopped || controller.signal.aborted) throw fault(); };
    const record = async (at, outcome, cleanup = false) => {
      const time = now();
      if (!Number.isSafeInteger(time) || time < 0) { auditFailed = true; throw fault(); }
      // No error object, target URL, password, verifier, reservation or callback.
      const event = Object.freeze({ actor, targetRole: target.role, operation, intent, phase: at, time, outcome });
      try {
        const result = cleanup
          ? await boundedCleanup(() => audit.append(event), cleanupTimeoutMs)
          : await abortable(() => audit.append(event), controller.signal);
        if (!ack(result)) throw fault();
      } catch { auditFailed = true; throw fault(); }
    };
    const step = async (name, action, validate = ack) => {
      check(); phase = name;
      await record(name, "started"); check();
      const value = await abortable(action, controller.signal);
      check();
      if (!validate(value)) { missingAcknowledgement = true; throw fault(); }
      await record(name, "acknowledged"); check();
      return value;
    };
    const result = (outcome, fenceConfirmed, replacement) => Object.freeze({
      outcome, phase, intent, fenceConfirmed, requiresFreshReplacement: replacement,
      roleOid: context.target.roleOid,
      databaseCommit: commitAcknowledged ? "acknowledged" : commitAttempted ? "uncertain" : "not_attempted",
      applicationAuthority: authorityVerified ? "verified_closed" : "unverified", credentialPublished: false,
    });

    try {
      await step("verify_closed_authority", () => native.inspect(context), closed);
      authorityVerified = true;
      // Reservation is created before mutation or generation. It is never active.
      phase = "reserve";
      check();
      reservation = secretStore.reserve(context);
      if (!reservation || typeof reservation !== "object" || typeof reservation.then === "function") throw fault();
      check();
      mutationStarted = true;
      if (operation === "create") {
        const initialRoleOid = context.target.roleOid;
        validPrepared = value => closed(value) && value.committed === true && value.noLogin === true &&
          /^[1-9][0-9]{0,9}$/.test(value.roleOid) && initialRoleOid === "0";
        await step("prepare_no_login", async () => {
          pendingPreparation = Promise.resolve(native.prepare(context));
          const prepared = await pendingPreparation;
          // Capture authenticated DB identity before any fallible audit write or
          // cancellation check. An audit failure cannot erase a committed role
          // identity needed for compensation/recovery. Truly late completion
          // after finalization cannot update this coordinator.
          if (!stopped && validPrepared(prepared)) {
            pinnedRoleOid = prepared.roleOid;
            context = Object.freeze({ ...context, target: Object.freeze({ ...target, roleOid: pinnedRoleOid }) });
          }
          return prepared;
        }, validPrepared);
      } else if (context.target.roleOid === "0") throw fault();
      await step("fence", () => native.fence(context), fenced);
      acceptingDelivery = true;
      const deliver = bytes => {
        if (!Buffer.isBuffer(bytes)) return Promise.reject(fault());
        if (!acceptingDelivery || stopped || controller.signal.aborted || ++deliveryCount !== 1 || bytes.length < 32 || bytes.length > 1024) {
          bytes.fill(0); return Promise.reject(fault());
        }
        borrowedBuffers.add(bytes);
        deliveryPromise = (async () => {
          try {
            if (!ack(await secretStore.stage(reservation, bytes))) throw fault();
            let reads = 0;
            const read = await secretStore.withCredential(reservation, copy => {
              reads++;
              if (!Buffer.isBuffer(copy)) throw fault();
              try {
                check();
                if (copy === bytes || copy.length !== bytes.length || !timingSafeEqual(copy, bytes)) throw fault();
              } finally { copy.fill(0); }
            });
            if (!ack(read) || reads !== 1) throw fault();
            check(); stageVerified = true;
          } finally { bytes.fill(0); borrowedBuffers.delete(bytes); }
        })();
        // A misbehaving native adapter may not await delivery. Consume rejection
        // here as well as below; no credential or diagnostic escapes.
        deliveryPromise.catch(() => undefined);
        return deliveryPromise;
      };
      await step("assign_and_commit", async () => {
        commitAttempted = true;
        const value = await native.assign(Object.freeze({ ...context, deliver }));
        acceptingDelivery = false;
        check();
        if (!deliveryPromise || deliveryCount !== 1) throw fault();
        await abortable(() => deliveryPromise, controller.signal);
        check();
        if (closed(value) && value.committed === true && value.storeAcknowledged === true && stageVerified) commitAcknowledged = true;
        return value;
      }, value => closed(value) && value.committed === true && value.storeAcknowledged === true && stageVerified);
      await step("enable_login_for_authentication", () => native.activate(context),
        value => closed(value) && value.noLogin === false);
      let authenticationReads = 0;
      let authenticationVerified = false;
      let authenticationPromise;
      await step("authenticate_candidate", () => native.authenticate(Object.freeze({
        ...context,
        withCredential: async consume => {
          check();
          if (typeof consume !== "function" || ++authenticationReads !== 1) throw fault();
          authenticationPromise = (async () => {
            let borrowedReads = 0;
            const read = await secretStore.withCredential(reservation, async bytes => {
              if (!Buffer.isBuffer(bytes)) throw fault();
              borrowedBuffers.add(bytes);
              try {
                check();
                if (++borrowedReads !== 1) throw fault();
                await consume(bytes); check();
              } finally { bytes.fill(0); borrowedBuffers.delete(bytes); }
            });
            check();
            if (!ack(read) || borrowedReads !== 1) throw fault();
            authenticationVerified = true;
            return read;
          })();
          authenticationPromise.catch(() => undefined);
          return authenticationPromise;
        },
      })), value => closed(value) && value.sessionUser === target.role && sameTarget(value.target, context.target) &&
        authenticationReads === 1 && authenticationVerified);
      // Native auth connection is closed before a staged-ready result exists.
      await step("close", () => native.abortAndDrain(context), value => ack(value) && value.drained === true);
      await step("staged_ready", () => secretStore.markStagedReady(reservation));
      requiresRecovery = false;
      return result("staged_ready", false, false);
    } catch {
      stopped = true;
      acceptingDelivery = false;
      for (const bytes of borrowedBuffers) bytes.fill(0);
      borrowedBuffers.clear();
      // Secret deletion is not DB commit proof. A terminal reservation tombstone
      // also prevents a delayed stage completion from becoming usable.
      const discarded = reservation === undefined || ack(await boundedCleanup(() => secretStore.discard(reservation), cleanupTimeoutMs));
      let fenceConfirmed = !mutationStarted;
      let barrier = !mutationStarted;
      if (mutationStarted) {
        const drain = await boundedCleanup(cleanSignal => native.abortAndDrain(Object.freeze({ ...context, signal: cleanSignal })), cleanupTimeoutMs);
        barrier = ack(drain) && drain.drained === true;
        if (barrier) {
          if (pendingPreparation && context.target.roleOid === "0") {
            // Abort can win the outer wait after CREATE commits but before its
            // authenticated ACK is consumed. Reconcile only this invocation's
            // original bounded completion, after draining and before fencing.
            // No callback mutates identity after finalization, and a truly lost
            // ACK cannot be replaced with audit evidence or a same-name lookup.
            const prepared = await boundedCleanup(() => pendingPreparation, cleanupTimeoutMs);
            if (validPrepared(prepared)) {
              pinnedRoleOid = prepared.roleOid;
              context = Object.freeze({ ...context, target: Object.freeze({ ...target, roleOid: pinnedRoleOid }) });
            }
          }
          const fence = await boundedCleanup(cleanSignal => native.fence(Object.freeze({ ...context, signal: cleanSignal })), cleanupTimeoutMs);
          fenceConfirmed = fenced(fence);
        }
      }
      const uncertain = (commitAttempted && !commitAcknowledged) || !barrier || !fenceConfirmed || !discarded || missingAcknowledgement;
      const outcome = uncertain ? "uncertain" : controller.signal.aborted ? "cancelled" : "fenced_failure";
      requiresRecovery = mutationStarted || uncertain;
      try { await record("final", outcome, true); } catch { /* fixed metadata only; never infer DB outcome from audit */ }
      return Object.freeze({ ...result(outcome, fenceConfirmed, requiresRecovery), auditComplete: !auditFailed });
    } finally {
      stopped = true;
      acceptingDelivery = false;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      running = false;
    }
  }

  return Object.freeze({ run, target, realProvisioningEnabled: false });
}

/** Bounded, transient test double; never a hosted secret-store implementation. */
export function createInMemorySyntheticSecretStore({ capacity = 16 } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) throw fault();
  const reservations = new WeakMap();
  const intents = new Set();
  let count = 0;
  const entry = handle => { const value = reservations.get(handle); if (!value || value.state === "discarded") throw fault(); return value; };
  return Object.freeze({
    reserve({ target, intent }) {
      if (count >= capacity || intents.size >= 256 || intents.has(intent)) throw fault();
      snapshotTarget(target);
      const handle = Object.freeze(Object.create(null));
      intents.add(intent); count++;
      reservations.set(handle, { state: "reserved", bytes: undefined });
      return handle;
    },
    async stage(handle, bytes) {
      const value = entry(handle);
      if (value.state !== "reserved" || !Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > 1024) throw fault();
      value.bytes = Buffer.from(bytes); value.state = "staged";
      return { ack: true };
    },
    async withCredential(handle, consume) {
      const value = entry(handle);
      if (value.state !== "staged" || typeof consume !== "function") throw fault();
      const copy = Buffer.from(value.bytes);
      try { await consume(copy); } finally { copy.fill(0); }
      if (value.state !== "staged") throw fault();
      return { ack: true };
    },
    async markStagedReady(handle) {
      const value = entry(handle);
      if (value.state !== "staged") throw fault();
      value.state = "staged_ready";
      // No read API or publication method exists for a ready candidate here.
      return { ack: true };
    },
    async discard(handle) {
      const value = reservations.get(handle);
      if (!value) throw fault();
      if (value.state !== "discarded") { value.state = "discarded"; value.bytes?.fill(0); value.bytes = undefined; count--; }
      return { ack: true };
    },
  });
}
