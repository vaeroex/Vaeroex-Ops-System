import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, closeSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createManagedSupabaseNativeAdapter } from "./adapter.mjs";
import { createManagedSupabaseProvisioningCoordinator } from "./lifecycle.mjs";
import { createGoogleSecretManagerStagingStore } from "./secret-store.mjs";
import { createSandboxSecretManagerRestClient } from "./secret-manager-rest.mjs";
import { createManagedSupabaseDsnCodec } from "./dsn-codec.mjs";
import { createGceMaintenanceIdentity } from "./maintenance-identity.mjs";
import { readPrivateAdministrator, releasePrivateAdministratorInput } from "./private-entry.mjs";
import { sandboxTarget, sandboxMaintenance as pin } from "./sandbox-profile.mjs";
import { maintenanceWindow, requireMutationWindow, requiresClearance, checkRecoveryClearance } from "./maintenance-policy.mjs";

// Dedicated operator CLI. Never imported by an application or invoked on boot.
// All command arguments are public correlation/target metadata, not credentials.
const install = "/opt/vaeroex-native-broker";
const executable = `${install}/native-managed`;
const journal = "/var/lib/vaeroex-native-broker/maintenance.jsonl";
const denied = () => new Error("native_maintenance_denied");
let password, journalFd, lockFd, lockIdentity, native, reservation, store, softTimer, hardTimer, clearanceExpiry = Infinity, finished = false;
const lockPath = "/var/lib/vaeroex-native-broker/maintenance.lock";
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on("SIGINT", cancel); process.on("SIGTERM", cancel);

function trustedFile(path, maximum, privateFile = false) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & (privateFile ? 0o077 : 0o022)) || stat.size > maximum) throw denied();
  return stat;
}
function append(event) {
  // Callers construct only finite schema-checked nonsecret metadata. No errors,
  // SQL, URLs, input bytes, token values or secret payload are accepted here.
  const bytes = Buffer.from(JSON.stringify(event) + "\n");
  if (bytes.length > 4096) throw denied();
  let offset = 0;
  while (offset < bytes.length) { const n = writeSync(journalFd, bytes, offset); if (!n) throw denied(); offset += n; }
  fsyncSync(journalFd);
}
async function main() {
  const [operation, roleOid, intent, approvalId, deadlineText] = process.argv.slice(2);
  if (process.argv.length !== 7 || process.execArgv.length || process.platform !== "linux" || process.getuid() !== 0 ||
      fileURLToPath(import.meta.url) !== `${install}/maintenance.mjs` ||
      !["create", "rotate", "recover"].includes(operation) || !/^(0|[1-9][0-9]{0,9})$/.test(roleOid ?? "") ||
      operation === "create" && roleOid !== "0" || operation !== "create" && roleOid === "0" ||
      ![intent, approvalId].every(x => /^[a-zA-Z0-9_-]{1,80}$/.test(x ?? "")) || !/^[1-9][0-9]{12}$/.test(deadlineText ?? "") ||
      Object.keys(process.env).some(k => /^(NODE_|PG|LD_|DYLD_|MALLOC|LIBPQ)/.test(k))) throw denied();
  const deadline = Number(deadlineText);
  const window = maintenanceWindow(deadline, Date.now());
  softTimer = setTimeout(cancel, window.softCancelAfterMs);
  hardTimer = setTimeout(() => {
    cancel(); void native?.abortAndDrain().catch(() => undefined); password?.fill(0);
    process.stdout.write("native_deadline_interrupted_recovery_required\n"); process.exit(2);
  }, window.hardStopAfterMs);
  trustedFile(executable, 1048576);
  trustedFile(`${install}/native-managed.sha256`, 128);
  const expectedHash = readFileSync(`${install}/native-managed.sha256`, "ascii").trim();
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || createHash("sha256").update(readFileSync(executable)).digest("hex") !== expectedHash) throw denied();
  trustedFile(sandboxTarget.rootCertificate, 16384);
  if (createHash("sha256").update(readFileSync(sandboxTarget.rootCertificate)).digest("hex") !== pin.caSha256) throw denied();
  trustedFile(journal, 1048576, true);
  lockFd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  lockIdentity = fstatSync(lockFd);
  writeSync(lockFd, JSON.stringify({ pid: process.pid, intent, time: Date.now() }) + "\n"); fsyncSync(lockFd);
  const prior = readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  if (prior.some(e => e.intent === intent)) throw denied();
  const last = prior.at(-1);
  // No process restart silently forgets an interrupted/uncertain invocation.
  // Recovery requires independent exact-role/version reconciliation recorded by
  // the operator in the runbook, not a successful-looking audit event.
  if (requiresClearance(last, operation)) {
    const clearancePath = "/var/lib/vaeroex-native-broker/recovery-clearance.json";
    trustedFile(clearancePath, 4096, true);
    const clearance = JSON.parse(readFileSync(clearancePath, "utf8"));
    clearanceExpiry = checkRecoveryClearance({ last, operation, roleOid, intent, approvalId, clearance, now: Date.now() });
  }
  journalFd = openSync(journal, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  const identity = createGceMaintenanceIdentity();
  await identity.verify();
  const client = createSandboxSecretManagerRestClient({ withAccessToken: identity.withAccessToken });
  await client.preflight();
  // Public TLS evidence only, before private administrator entry. The presented
  // chain is never itself promoted to a trust root.
  const tls = promisify(execFile)("/usr/bin/openssl", ["s_client", "-starttls", "postgres", "-connect", `${sandboxTarget.host}:5432`,
    "-servername", sandboxTarget.host, "-verify_hostname", sandboxTarget.host, "-CAfile", sandboxTarget.rootCertificate,
    "-verify_return_error", "-brief"], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    timeout: 10000, maxBuffer: 32768, signal: cancellation.signal });
  tls.child.stdin.end();
  await tls;
  if (cancellation.signal.aborted) throw denied();
  const entryWindow = maintenanceWindow(deadline, Date.now());
  process.stdout.write("native_nonsecret_preflight_passed\n");
  password = await readPrivateAdministrator({ timeoutMs: entryWindow.entryTimeoutMs, signal: cancellation.signal });
  if (cancellation.signal.aborted) throw denied();
  requireMutationWindow(deadline, clearanceExpiry, Date.now());
  const target = Object.freeze({ ...sandboxTarget, roleOid });
  native = createManagedSupabaseNativeAdapter({ executable, target, withAdministrator: async (consume, signal) => {
    if (!password || signal.aborted) throw denied();
    await consume(password);
    if (signal.aborted) throw denied();
    return { ack: true };
  } });
  const underlyingStore = createGoogleSecretManagerStagingStore({ client, projectId: pin.projectId,
    projectNumber: pin.projectNumber, secretParent: pin.secretParent, payloadCodec: createManagedSupabaseDsnCodec({ role: target.role }) });
  store = Object.freeze({ ...underlyingStore, reserve(context) { reservation = underlyingStore.reserve(context); return reservation; } });
  const coordinator = createManagedSupabaseProvisioningCoordinator({ target, native, secretStore: store,
    audit: { async append(event) { append({ kind: "lifecycle", ...event }); return { ack: true }; } } });
  append({ kind: "maintenance_started", actor: pin.serviceAccount, targetRole: sandboxTarget.role, operation, intent, approvalId, time: Date.now() });
  const result = await coordinator.run({ operation, actor: "isolated_native_postgres_operator", intent, approvalId,
    deadlineMs: 30000, cleanupTimeoutMs: 10000, signal: cancellation.signal });
  const metadata = reservation ? store.metadata(reservation) : undefined;
  append({ kind: "maintenance_finished", time: Date.now(), intent, ...result, ...(metadata ? { secret: metadata } : {}) });
  process.stdout.write(`native_maintenance_${result.outcome}\n`);
  if (metadata?.versionName && result.outcome === "staged_ready") process.stdout.write(`native_staged_version ${metadata.versionName}\n`);
  finished = true;
  if (result.outcome !== "staged_ready") process.exitCode = 2;
}
try { await main(); }
catch {
  process.stdout.write("native_maintenance_failed_requires_checked_recovery\n"); process.exitCode = 2;
} finally {
  cancellation.abort();
  await native?.abortAndDrain().catch(() => undefined);
  if (!finished && reservation) await store.discard(reservation).catch(() => undefined);
  password?.fill(0); password = undefined;
  releasePrivateAdministratorInput();
  clearTimeout(softTimer); clearTimeout(hardTimer);
  if (journalFd !== undefined) closeSync(journalFd);
  if (lockFd !== undefined) {
    closeSync(lockFd);
    try {
      const current = lstatSync(lockPath);
      if (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) unlinkSync(lockPath);
    } catch { /* A stale/changed lock requires explicit operator recovery. */ }
  }
  process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
}
