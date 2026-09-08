import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";

const outcomes = Object.freeze({ inspect: "inspected", prepare: "prepared", fence: "fenced", assign: "assigned", activate: "activated", authenticate: "authenticated" });
const targetFields = Object.freeze(["projectReference", "host", "port", "database", "role", "systemIdentifier", "databaseOid", "adminRole", "capabilityRole", "rootCertificate", "roleOid"]);
const safeFailure = () => new Error("local_synthetic_native_operation_failed");
const label = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const credentialByte = value => (value >= 48 && value <= 57) || (value >= 97 && value <= 102);
const staticLine = value => Buffer.from(value, "ascii");
const readyLine = staticLine('{"phase":"ready"}');

// No arbitrary JSON/error decoding: only the finite C protocol can become JS
// strings. Unknown stdout/stderr bytes are wiped, never forwarded or logged.
function terminal(line, operation) {
  const prefix = staticLine(`{"outcome":"${outcomes[operation]}","committed":true,"role_oid":"`);
  const suffix = staticLine('"}');
  if (line.length <= prefix.length + suffix.length || line.length > prefix.length + suffix.length + 10 ||
      !line.subarray(0, prefix.length).equals(prefix) || !line.subarray(-suffix.length).equals(suffix)) return undefined;
  const digits = line.subarray(prefix.length, -suffix.length);
  if (!digits.every(value => value >= 48 && value <= 57) || (digits.length > 1 && digits[0] === 48)) return undefined;
  return digits.toString("ascii"); // Verified non-sensitive role OID only.
}

/**
 * The ONLY executable adapter is a local synthetic one. It accepts loopback
 * fixtures, an empty fixture-admin credential and an explicitly supplied local
 * binary. There is no production/admin-secret supplier or environment override.
 * The release C binary independently rejects all execution.
 *
 * Node pipes are private IPC, not temporary files. The native child owns BEGIN,
 * generation, SCRAM, private-delivery acknowledgement and COMMIT. A successful
 * assignment requires exact terminal ACK, successful exit AND verified staging.
 * No process output or error is used as a secret or a commit-status oracle.
 */
export function createLocalSyntheticNativeAdapter({ executable, target: suppliedTarget, timeoutMs = 20000 }) {
  if (typeof executable !== "string" || !isAbsolute(executable) || /[\u0000-\u001f\u007f]/.test(executable) ||
      !suppliedTarget || suppliedTarget.host !== "127.0.0.1" || !/^synthetic(?:-|$)/.test(suppliedTarget.projectReference) ||
      Object.keys(suppliedTarget).length !== targetFields.length || !targetFields.every(key => Object.hasOwn(suppliedTarget, key)) ||
      !Number.isInteger(suppliedTarget.port) || suppliedTarget.port < 1 || suppliedTarget.port > 65535 ||
      !["database", "role", "adminRole"].every(key => typeof suppliedTarget[key] === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(suppliedTarget[key])) ||
      !/^(?:square_|vaeroex_)/.test(suppliedTarget.role) || /qbo|password/.test(suppliedTarget.role) ||
      suppliedTarget.role === suppliedTarget.adminRole || suppliedTarget.capabilityRole !== "square_account_broker_authority" ||
      !["systemIdentifier", "databaseOid", "roleOid"].every(key => typeof suppliedTarget[key] === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(suppliedTarget[key])) ||
      typeof suppliedTarget.rootCertificate !== "string" || !isAbsolute(suppliedTarget.rootCertificate) ||
      /[\u0000-\u001f\u007f]/.test(suppliedTarget.rootCertificate) || suppliedTarget.rootCertificate.length > 1024 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw safeFailure();
  const target = Object.freeze(Object.fromEntries(targetFields.map(key => [key, suppliedTarget[key]])));
  let roleOid = target.roleOid;
  const active = new Set();
  const same = candidate => candidate && Object.keys(candidate).length === targetFields.length &&
    targetFields.every(key => candidate[key] === (key === "roleOid" ? roleOid : target[key]));

  async function execute(operation, context) {
    if (active.size || !same(context.target) || !label(context.intent) || !label(context.approvalId) ||
        !(context.signal instanceof AbortSignal) || context.signal.aborted) throw safeFailure();
    const t = context.target;
    const args = [operation, t.host, String(t.port), t.database, t.adminRole, t.role, t.capabilityRole,
      t.systemIdentifier, t.databaseOid, t.rootCertificate, context.intent, t.roleOid, context.approvalId];
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(executable, args, { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
          stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"], windowsHide: true });
      } catch { reject(safeFailure()); return; }
      const output = Buffer.alloc(1024), frame = Buffer.alloc(129);
      let outputUsed = 0, frameUsed = 0, totalOutput = 0, invalid = false, finished = false;
      let terminalOid, progressSeen = false, delivered = false, stored = false, authenticatedInput = false;
      let privateBorrow;
      const outgoingFrames = new Set();
      let killTimer;
      let reapResolve;
      const reaped = new Promise(done => { reapResolve = done; });
      const record = { child, reaped, stop: undefined };
      const stop = () => {
        if (finished) return;
        invalid = true;
        privateBorrow?.fill(0); frame.fill(0);
        for (const bytes of outgoingFrames) bytes.fill(0);
        child.kill("SIGTERM");
        if (!killTimer) killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      };
      record.stop = stop;
      active.add(record);
      const timer = setTimeout(stop, timeoutMs);
      context.signal.addEventListener("abort", stop, { once: true });
      if (context.signal.aborted) stop();
      for (const pipe of child.stdio.slice(1)) pipe?.on("error", stop);
      child.on("error", stop);
      child.stderr.on("data", bytes => { bytes.fill(0); stop(); });
      child.stdout.on("data", bytes => {
        try {
          totalOutput += bytes.length;
          if (totalOutput > 1024 || invalid) { stop(); return; }
          for (const value of bytes) {
            if (value === 10) {
              const line = output.subarray(0, outputUsed);
              if (operation === "assign" && !progressSeen && !terminalOid && line.equals(readyLine)) progressSeen = true;
              else if (!terminalOid) {
                const parsed = terminal(line, operation);
                if (parsed === undefined || (operation === "assign" && !progressSeen)) { stop(); return; }
                terminalOid = parsed;
              } else { stop(); return; }
              output.fill(0); outputUsed = 0;
            } else {
              if (outputUsed === output.length || value < 32 || value > 126) { stop(); return; }
              output[outputUsed++] = value;
            }
          }
        } finally { bytes.fill(0); }
      });
      child.stdio[4].on("data", bytes => {
        try {
          if (operation !== "assign" || delivered || invalid || bytes.length + frameUsed > frame.length) { stop(); return; }
          bytes.copy(frame, frameUsed); frameUsed += bytes.length;
          if (frameUsed !== frame.length) return;
          if (frame[128] !== 10 || !frame.subarray(0, 128).every(credentialByte)) { stop(); return; }
          delivered = true;
          privateBorrow = Buffer.from(frame.subarray(0, 128)); frame.fill(0);
          Promise.resolve().then(() => {
            if (invalid || finished || typeof context.deliver !== "function") throw safeFailure();
            return context.deliver(privateBorrow);
          }).then(() => {
            privateBorrow?.fill(0); privateBorrow = undefined;
            if (invalid || finished || context.signal.aborted) { stop(); return; }
            child.stdio[5].end(staticLine("STORED\n"), () => { stored = true; });
          }, stop);
        } finally { bytes.fill(0); }
      });
      // Empty synthetic trust-auth input, never a secret supplier.
      child.stdio[3].end(staticLine("\n"));
      if (operation === "authenticate") {
        Promise.resolve().then(async () => {
          if (typeof context.withCredential !== "function") throw safeFailure();
          const read = await context.withCredential(async bytes => {
            if (invalid || finished || !Buffer.isBuffer(bytes) || bytes.length !== 128 || !bytes.every(credentialByte)) throw safeFailure();
            privateBorrow = bytes;
            const candidateFrame = Buffer.alloc(129);
            outgoingFrames.add(candidateFrame);
            bytes.copy(candidateFrame); candidateFrame[128] = 10;
            try {
              await new Promise((done, denied) => child.stdio[6].end(candidateFrame, error => error ? denied(safeFailure()) : done()));
              authenticatedInput = true;
            } finally { candidateFrame.fill(0); outgoingFrames.delete(candidateFrame); bytes.fill(0); privateBorrow = undefined; }
          });
          if (!read?.ack) throw safeFailure();
        }).catch(stop);
      }
      child.once("close", (code, signal) => {
        finished = true;
        clearTimeout(timer); clearTimeout(killTimer);
        context.signal.removeEventListener("abort", stop);
        output.fill(0); frame.fill(0); privateBorrow?.fill(0); privateBorrow = undefined;
        for (const bytes of outgoingFrames) bytes.fill(0);
        outgoingFrames.clear();
        active.delete(record); reapResolve();
        for (const pipe of child.stdio.slice(1)) pipe?.destroy();
        const expectedOid = operation === "prepare" ? terminalOid !== "0" : terminalOid === roleOid;
        if (invalid || code !== 0 || signal || outputUsed || terminalOid === undefined || !expectedOid ||
            (operation === "assign" && (!delivered || !stored)) || (operation === "authenticate" && !authenticatedInput)) {
          reject(safeFailure()); return;
        }
        if (operation === "prepare") roleOid = terminalOid;
        resolve(Object.freeze({ ack: true, authorityClosed: true, committed: true, roleOid: terminalOid,
          ...(operation === "prepare" ? { noLogin: true } : {}),
          ...(operation === "fence" ? { noLogin: true, sessionsTerminated: true } : {}),
          ...(operation === "assign" ? { storeAcknowledged: true } : {}),
          ...(operation === "activate" ? { noLogin: false } : {}),
          ...(operation === "authenticate" ? { sessionUser: t.role, target: t } : {}),
        }));
      });
    });
  }

  return Object.freeze({
    ...Object.fromEntries(Object.keys(outcomes).map(operation => [operation, context => execute(operation, context)])),
    async abortAndDrain() {
      const pending = [...active];
      for (const record of pending) record.stop();
      await Promise.all(pending.map(record => record.reaped));
      // Process reaping only. Caller MUST perform fresh lock-ordered DB fence.
      return Object.freeze({ ack: true, drained: true });
    },
    realProvisioningEnabled: false,
  });
}
