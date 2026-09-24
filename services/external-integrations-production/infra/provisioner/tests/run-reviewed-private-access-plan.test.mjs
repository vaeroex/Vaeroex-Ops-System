import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startExecution, readExecution, recordResult } from "../scripts/run-reviewed-private-access-plan.mjs";

// No Terraform binary, gcloud, credentials, network, database, or timed cloud
// plan is used. Real processes exercise detach, acknowledgement and deadlines.
const root = mkdtempSync(join(tmpdir(), "vaeroex-apply-ack-test-"));
const moduleUrl = new URL("../scripts/run-reviewed-private-access-plan.mjs", import.meta.url).href;
const planPath = join(root, "harmless.plan");
writeFileSync(planPath, "non-executable-local-fixture", { mode: 0o600 });
const reviewedSha256 = createHash("sha256").update(readFileSync(planPath)).digest("hex");
const supervisor = join(root, "fixture-supervisor.mjs"), worker = join(root, "fixture-worker.mjs");
const sentinel = "SYNTHETIC_RAW_OUTPUT_MUST_NOT_BE_RECORDED";
writeFileSync(supervisor, `
import { readFileSync } from 'node:fs';
import { superviseExecution } from ${JSON.stringify(moduleUrl)};
const directory=process.argv[3];
const mode=JSON.parse(readFileSync(directory+'/request.json')).cwd.split('/').at(-1);
await superviseExecution(directory,{childArgs:[${JSON.stringify(worker)},directory,mode]});
`);
writeFileSync(worker, `
import { openSync,closeSync,writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { recordProgress,recordResult } from ${JSON.stringify(moduleUrl)};
const [directory,mode]=process.argv.slice(2);
closeSync(openSync(directory+'/fixture-once','wx',0o600));
console.log(${JSON.stringify(sentinel)});console.error(${JSON.stringify(sentinel)});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
recordProgress(directory,'private_access_terraform_apply_started');
if(mode==='hang'){
 const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
 writeFileSync(directory+'/fixture-child.pid',String(child.pid));
 await wait(10000);
}else if(mode==='lost'){
 recordProgress(directory,'private_access_terraform_apply_returned',{exitCode:0,successful:true});
}else{
 await wait(210);
 recordProgress(directory,'private_access_terraform_apply_returned',{exitCode:mode==='failed'?1:0,successful:mode!=='failed',raw:${JSON.stringify(sentinel)}});
 if(mode==='failed'){
  recordProgress(directory,'private_access_revocation_wait_started');await wait(130);
  recordProgress(directory,'private_access_revocation_wait_completed');
  recordProgress(directory,'private_access_effective_revocation_confirmed');
  recordResult(directory,'failed','private_access_open_apply_failed_after_effective_revocation');
 }else recordResult(directory,'succeeded','private_access_verified_plan_apply_completed');
}
`);
const wait = ms => new Promise(done => setTimeout(done, ms));
async function terminal(directory) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (existsSync(join(directory, "result.json"))) return readExecution(directory);
    await wait(20);
  }
  throw Error("local_execution_test_timeout");
}
function input(mode, budget = 4000) {
  const cwd = join(root, mode);
  if (!existsSync(cwd)) mkdirSync(cwd, { mode: 0o700 });
  return { planPath, reviewedSha256, cwd, directory: join(cwd, "receipt"), deadlineMs: Date.now() + budget };
}
try {
  const legacy = spawnSync(process.execPath, ["-e", "setTimeout(()=>console.log('late-result'),400)"], { timeout: 300 });
  assert.equal(legacy.error?.code, "ETIMEDOUT");
  assert.equal(legacy.stdout.length, 0);

  const failed = input("failed");
  await startExecution(failed, { supervisorPath: supervisor });
  const before = readFileSync(join(failed.directory, "request.json"));
  await assert.rejects(startExecution(failed, { supervisorPath: supervisor }), error => error.code === "EEXIST");
  assert.deepEqual(readFileSync(join(failed.directory, "request.json")), before);
  const failedResult = await terminal(failed.directory);
  assert.equal(failedResult.state, "failed");
  assert.equal(failedResult.label, "private_access_open_apply_failed_after_effective_revocation");
  assert.equal(failedResult.terraformExitCode, 1);
  assert.equal(failedResult.terraformSuccessful, false);
  assert.equal(failedResult.lastStage, "private_access_effective_revocation_confirmed");
  const progress = readFileSync(join(failed.directory, "progress.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(progress[1].exitCode, 1);
  assert.equal(progress[2].label, "private_access_revocation_wait_started");
  assert.equal(progress.at(-1).label, "private_access_effective_revocation_confirmed");
  assert.ok(Date.parse(failedResult.utc) - Date.parse(progress[0].utc) >= 300);
  assert.equal(recordResult(failed.directory, "succeeded", "private_access_verified_plan_apply_completed"), false);

  const success = input("success");
  const launcher = join(root, "transport.mjs");
  writeFileSync(launcher, `import {startExecution} from ${JSON.stringify(moduleUrl)};
console.log(JSON.stringify(await startExecution(${JSON.stringify(success)},{supervisorPath:${JSON.stringify(supervisor)}})));
setInterval(()=>{},1000);`);
  const transport = spawn(process.execPath, [launcher], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((done, reject) => { transport.stdout.once("data", done); transport.once("error", reject); });
  transport.kill("SIGTERM");
  const successResult = await terminal(success.directory);
  assert.equal(successResult.state, "succeeded");
  assert.equal(readExecution(success.directory).state, "succeeded");
  assert.equal(readdirSync(success.directory).filter(x => x === "fixture-once").length, 1);

  const lost = input("lost");
  await startExecution(lost, { supervisorPath: supervisor });
  assert.equal((await terminal(lost.directory)).state, "uncertain");
  assert.equal(readExecution(lost.directory).label, "private_access_acknowledgement_missing_requires_reconciliation");

  const hang = input("hang", 800);
  await startExecution(hang, { supervisorPath: supervisor });
  const hungResult = await terminal(hang.directory);
  assert.equal(hungResult.state, "uncertain");
  assert.equal(hungResult.label, "private_access_deadline_requires_reconciliation");
  const childPid = Number(readFileSync(join(hang.directory, "fixture-child.pid"), "utf8"));
  let alive = true;
  for (let n = 0; n < 100 && alive; n++) {
    try { process.kill(childPid, 0); await wait(20); } catch (e) { assert.equal(e.code, "ESRCH"); alive = false; }
  }
  assert.equal(alive, false, "deadline must stop the descendant, not just its parent");

  await assert.rejects(startExecution({ ...input("bad-hash"), reviewedSha256: "0".repeat(64) }), /reviewed_hash_mismatch/);
  const publicPlan = join(root, "public.plan"); writeFileSync(publicPlan, "fixture"); chmodSync(publicPlan, 0o644);
  await assert.rejects(startExecution({ ...input("public-plan"), planPath: publicPlan }), /file_not_private/);
  await assert.rejects(startExecution({ ...input("expired"), deadlineMs: Date.now() - 1 }), /deadline_invalid/);
  for (const directory of [failed.directory, success.directory, lost.directory, hang.directory]) {
    for (const name of ["request.json", "progress.jsonl", "result.json"]) {
      assert.equal(statSync(join(directory, name)).mode & 0o077, 0);
      assert.ok(!readFileSync(join(directory, name), "utf8").includes(sentinel));
    }
  }
  console.log("PASS: bounded local execution, recovery beyond old timeout, detached acknowledgement, one-shot admission, missing-result denial, descendant shutdown, private fixed-label receipts; zero cloud calls");
} finally { rmSync(root, { recursive: true, force: true }); }
