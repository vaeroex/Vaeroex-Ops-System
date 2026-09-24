import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, copyFileSync, chmodSync, existsSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, writeSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyReviewedPrivateAccessPlan } from "./apply-reviewed-private-access-plan.mjs";

const self = fileURLToPath(import.meta.url);
const MAX_EXECUTION_MS = 90 * 60 * 1000;
const GRACE_MS = 2000;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fixed = value => typeof value === "string" && /^private_access_[a-z0-9_]+$/.test(value);
function privateFile(path) {
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.mode & 0o077) {
    throw Error("private_access_execution_file_not_private");
  }
}
function writeDurable(path, value, flags = "wx") {
  const fd = openSync(path, flags, 0o600);
  try { writeSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
}
function readRequest(directory) {
  const st = lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || st.mode & 0o077) throw Error("private_access_execution_directory_invalid");
  const path = join(directory, "request.json"); privateFile(path);
  const request = JSON.parse(readFileSync(path, "utf8"));
  if (!/^[a-f0-9]{64}$/.test(request.hash) || !Number.isSafeInteger(request.deadlineMs) ||
      !Number.isSafeInteger(request.startedMs) || request.deadlineMs <= request.startedMs ||
      request.deadlineMs - request.startedMs > MAX_EXECUTION_MS || typeof request.cwd !== "string") {
    throw Error("private_access_execution_request_invalid");
  }
  return request;
}

export function recordProgress(directory, label, detail = {}) {
  if (!fixed(label)) throw Error("private_access_execution_label_invalid");
  // Raw child output, exception messages, credentials and provider objects are
  // deliberately not accepted by the receipt schema.
  writeDurable(join(directory, "progress.jsonl"), {
    label, utc: new Date().toISOString(),
    ...(label === "private_access_terraform_apply_returned" ? {
      exitCode: Number.isInteger(detail.exitCode) ? detail.exitCode : null,
      processError: detail.processError === "child_process_error" ? "child_process_error" : null,
      successful: detail.successful === true,
    } : {}),
  }, "a");
}

export function recordResult(directory, state, label) {
  if (!["succeeded", "failed", "uncertain"].includes(state) || !fixed(label)) throw Error("private_access_execution_result_invalid");
  try {
    writeDurable(join(directory, "result.json"), { state, label, utc: new Date().toISOString() });
    return true;
  } catch (error) { if (error.code === "EEXIST") return false; throw error; }
}

export function readExecution(directory, now = Date.now()) {
  const request = readRequest(directory);
  const evidence = {};
  const progressPath = join(directory, "progress.jsonl");
  if (existsSync(progressPath)) {
    privateFile(progressPath);
    for (const line of readFileSync(progressPath, "utf8").split("\n")) {
      try {
        const row = JSON.parse(line);
        if (!fixed(row.label)) continue;
        evidence.lastStage = row.label;
        if (row.label === "private_access_terraform_apply_returned") {
          evidence.terraformExitCode = Number.isInteger(row.exitCode) ? row.exitCode : null;
          evidence.terraformSuccessful = row.successful === true;
        }
      } catch { /* An interrupted final line cannot supply positive evidence. */ }
    }
  }
  const path = join(directory, "result.json");
  if (existsSync(path)) {
    try {
      privateFile(path); const result = JSON.parse(readFileSync(path, "utf8"));
      if (!["succeeded", "failed", "uncertain"].includes(result.state) || !fixed(result.label)) throw Error();
      return { ...result, ...evidence, planSha256: request.hash };
    } catch { return { state: "uncertain", label: "private_access_result_unreadable_requires_reconciliation", planSha256: request.hash }; }
  }
  // Missing acknowledgement is never converted to success or permission to
  // resubmit, even if the transport exited zero or the process disappeared.
  return {
    state: now >= request.deadlineMs + GRACE_MS ? "uncertain" : "pending",
    label: now >= request.deadlineMs + GRACE_MS
      ? "private_access_result_missing_requires_reconciliation"
      : "private_access_execution_pending_not_acknowledged",
    planSha256: request.hash,
    ...evidence,
  };
}

export async function startExecution({ planPath, reviewedSha256, directory, deadlineMs, cwd = process.cwd() }, options = {}) {
  const now = Date.now();
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= now || deadlineMs - now > MAX_EXECUTION_MS) throw Error("private_access_execution_deadline_invalid");
  planPath = resolve(planPath); directory = resolve(directory); privateFile(planPath);
  if (hash(readFileSync(planPath)) !== reviewedSha256) throw Error("private_access_plan_reviewed_hash_mismatch");
  // The directory itself is the one-shot admission guard. A duplicate launch
  // cannot truncate an earlier receipt or invoke a second apply.
  mkdirSync(directory, { mode: 0o700 });
  copyFileSync(planPath, join(directory, "reviewed.tfplan")); chmodSync(join(directory, "reviewed.tfplan"), 0o600);
  writeDurable(join(directory, "request.json"), { hash: reviewedSha256, cwd: resolve(cwd), startedMs: now, deadlineMs });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^TF_LOG(?:_|$)/.test(key)) delete env[key];
  const child = spawn(process.execPath, [options.supervisorPath ?? self, "supervise", directory], {
    cwd, env, detached: true, stdio: "ignore",
  });
  await new Promise((accept, reject) => {
    child.once("spawn", accept);
    child.once("error", () => { recordResult(directory, "uncertain", "private_access_supervisor_launch_failed"); reject(Error("private_access_supervisor_launch_failed")); });
  });
  child.unref();
  return { label: "private_access_execution_started_not_apply_acknowledged", planSha256: reviewedSha256 };
}

export async function superviseExecution(directory, options = {}) {
  const request = readRequest(directory);
  try { closeSync(openSync(join(directory, "supervisor-once.guard"), "wx", 0o600)); }
  catch (error) { if (error.code === "EEXIST") return; throw error; }
  if (Date.now() >= request.deadlineMs) {
    recordResult(directory, "failed", "private_access_execution_expired_before_apply"); return;
  }
  const child = spawn(process.execPath, options.childArgs ?? [self, "execute", directory], {
    cwd: request.cwd, env: process.env, detached: true, stdio: "ignore",
  });
  let timedOut = false, drain = Promise.resolve();
  const killGroup = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const timer = setTimeout(() => {
    if (existsSync(join(directory, "result.json"))) return;
    timedOut = true;
    recordProgress(directory, "private_access_execution_deadline_reached");
    killGroup("SIGTERM");
    drain = new Promise(done => setTimeout(() => { killGroup("SIGKILL"); done(); }, GRACE_MS));
  }, Math.max(1, request.deadlineMs - Date.now()));
  await new Promise(resolveDone => {
    child.once("error", () => {
      recordResult(directory, "uncertain", "private_access_worker_launch_failed"); resolveDone();
    });
    child.once("close", async () => {
      // A terminated parent can leave a child in its process group. Finish the
      // bounded group stop before reporting timeout/reconciliation readiness.
      await drain;
      // Never infer an apply result from SSH or child exit status alone.
      recordResult(directory, "uncertain", timedOut
        ? "private_access_deadline_requires_reconciliation"
        : "private_access_acknowledgement_missing_requires_reconciliation");
      resolveDone();
    });
  });
  clearTimeout(timer);
}

export function executeReviewedApply(directory) {
  const request = readRequest(directory);
  try { closeSync(openSync(join(directory, "apply-once.guard"), "wx", 0o600)); }
  catch (error) { if (error.code === "EEXIST") return; throw error; }
  try {
    if (Date.now() >= request.deadlineMs) throw Error("private_access_execution_expired_before_apply");
    const result = applyReviewedPrivateAccessPlan(join(directory, "reviewed.tfplan"), request.hash, {
      cwd: request.cwd, onProgress: (label, detail) => recordProgress(directory, label, detail),
    });
    recordResult(directory, "succeeded", result.resultLabel);
  } catch (error) {
    recordResult(directory, "failed", fixed(error.fixedLabel) ? error.fixedLabel
      : fixed(error.message) ? error.message : "private_access_execution_failed_requires_reconciliation");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "start" && args.length === 4) {
      console.log(JSON.stringify(await startExecution({ planPath: args[0], reviewedSha256: args[1], directory: args[2], deadlineMs: Number(args[3]) })));
    } else if (mode === "status" && args.length === 1) console.log(JSON.stringify(readExecution(args[0])));
    else if (mode === "supervise" && args.length === 1) await superviseExecution(args[0]);
    else if (mode === "execute" && args.length === 1) executeReviewedApply(args[0]);
    else throw Error("private_access_execution_arguments_invalid");
  } catch (error) { console.log(fixed(error.message) ? error.message : "private_access_execution_stopped"); process.exitCode = 1; }
}
