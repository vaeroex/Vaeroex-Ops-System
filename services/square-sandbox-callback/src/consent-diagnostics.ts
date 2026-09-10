import "server-only";

import { closeSync, constants, fstatSync, lstatSync, openSync, renameSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import { isPromise } from "node:util/types";
import { isSquareConsentStage, type SquareConsentObserver, type SquareConsentStage } from "@/lib/integrations/providers/square/account-connection-progress";

const DIRECTORY = "/run/vaeroex-square-callback";
const MAXIMUM_BYTES = 2_048;
type Outcome = "callback_returned" | "failed" | "cancelled";
type Failure = Readonly<{ completion: number; stage: SquareConsentStage; outcome: "failed" | "cancelled" }>;
type Sink = (bytes: Buffer) => boolean;
const noop = Object.freeze({ observe: (() => {}) as SquareConsentObserver, finish: (() => {}) as (outcome: Outcome) => void });

/** One process-local aggregate, at most two active callbacks. No request-derived
 * keys, identities, error objects, URLs or provider values enter this interface.
 * A returned callback can be a seller denial; it is NOT proof of stored consent.
 * Last failure survives later returned callbacks during this finite process. */
export function createSquareConsentDiagnostics(sink?: Sink) {
  let active = 0, started = 0, completed = 0;
  let lastOutcome: Outcome | "absent" = "absent", lastFailure: Failure | null = null;
  let persistence: "unknown" | "available" | "unavailable" = "unknown";
  const snapshot = () => Object.freeze({ schemaVersion: "square_consent_diagnostic_v1", started, completed, active,
    lastOutcome, lastFailure });
  const publish = () => {
    try {
      const bytes = Buffer.from(JSON.stringify(snapshot()) + "\n");
      const result = bytes.length <= MAXIMUM_BYTES ? sink?.(bytes) : false;
      if (isPromise(result)) Promise.prototype.then.call(result, undefined, () => {});
      persistence = result === true ? "available" : "unavailable";
    } catch { persistence = "unavailable"; }
  };
  publish();
  return Object.freeze({
    snapshot: () => Object.freeze({ ...snapshot(), persistence }),
    begin(signal: AbortSignal) {
      // The native listener independently enforces two requests / 100 opens.
      // Exhausted diagnostics never block or alter that authority.
      if (active >= 2 || started >= 100) return noop;
      active++; started++;
      // A crash can leave this active count nonzero: incomplete, not no attempt.
      // Stage changes are memory-only until failure/cancellation/return settles.
      publish();
      let stage: SquareConsentStage = "unknown", finalized = false;
      const observe: SquareConsentObserver = value => {
        if (!finalized && isSquareConsentStage(value)) stage = value;
      };
      const finish = (outcome: Outcome) => {
        if (finalized || !["callback_returned", "failed", "cancelled"].includes(outcome)) return;
        finalized = true; signal.removeEventListener("abort", abort); active--; completed++; lastOutcome = outcome;
        if (outcome !== "callback_returned") lastFailure = Object.freeze({ completion: completed, stage, outcome });
        publish();
      };
      const abort = () => finish("cancelled");
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      return Object.freeze({ observe, finish });
    }
  });
}

/** Fixed, bounded, volatile file only. No endpoint, remote/DB export or logging.
 * The optional directory is for disposable local tests, never runtime config.
 * Failure is observable in memory as unavailable; an old file can then be stale.
 * Private-directory ownership is the race boundary, not a claim of crash proof. */
export function createSquareConsentFileSink(directory = DIRECTORY): Sink {
  const file = `${directory}/consent-diagnostic.json`, temporary = `${directory}/.consent-diagnostic.tmp`;
  const uid = process.geteuid?.();
  const validDirectory = () => {
    const stat = lstatSync(directory);
    if (uid === undefined || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700) throw new Error();
    if (directory === DIRECTORY && (process.platform !== "linux" || statfsSync(directory).type !== 0x01021994)) throw new Error();
    return stat;
  };
  const validFile = () => {
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) throw new Error();
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw new Error();
    }
  };
  // Validate before the server can open any request-owned credential capability.
  try { validDirectory(); validFile(); } catch { return () => false; }
  return bytes => {
    let fd: number | undefined, owned: { dev: number; ino: number } | undefined;
    try {
      if (!Buffer.isBuffer(bytes) || bytes.length > MAXIMUM_BYTES) return false;
      const before = validDirectory(); validFile();
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const stat = fstatSync(fd); owned = { dev: stat.dev, ino: stat.ino };
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) throw new Error();
      writeFileSync(fd, bytes); closeSync(fd); fd = undefined;
      const after = validDirectory();
      if (before.dev !== after.dev || before.ino !== after.ino) throw new Error();
      validFile(); renameSync(temporary, file); owned = undefined;
      return true;
    } catch { return false; }
    finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* No raw IO errors. */ } }
      if (owned) { try {
        const stat = lstatSync(temporary);
        if (stat.dev === owned.dev && stat.ino === owned.ino) unlinkSync(temporary);
      } catch { /* Preserve unrelated files; no diagnostics retry. */ } }
    }
  };
}
