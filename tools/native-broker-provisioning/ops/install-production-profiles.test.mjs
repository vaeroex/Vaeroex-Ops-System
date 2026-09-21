import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { profileNames, runtimeModules, stageSource, validateManifest } from "./install-production-profiles.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const repository=resolve(here,"../../..");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const clone=value=>JSON.parse(JSON.stringify(value));

test("stage copies only committed public native files and exact 104-migration history",()=>{
  const temporary=mkdtempSync(resolve(tmpdir(),"production-native-public-stage-"));
  try {
    const commit=execFileSync("git",["-C",repository,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
    const stage=resolve(temporary,"source");
    const expected=stageSource(repository,commit,stage);
    const bytes=readFileSync(resolve(stage,"source-manifest.json"));
    assert.equal(hash(bytes),expected);
    const manifest=validateManifest(JSON.parse(bytes));
    assert.equal(manifest.sourceCommit,commit);
    const migrations=manifest.files.filter(file=>file.path.startsWith("supabase/migrations/"));
    assert.equal(migrations.length,104);
    assert.equal(migrations.filter(file=>/\/\d{12}_/.test(file.path)).length,33);
    assert.equal(migrations.filter(file=>/\/\d{14}_/.test(file.path)).length,71);
    assert.equal(migrations.at(-1).path,"supabase/migrations/20260902191325_square_production_internal_pilot_runtime.sql");
    assert.equal(migrations.at(-1).sha256,"ff2182044f28d6901f1582db3d31ef20d027a1e4590f0b295a7a64a1ad4c1325");
    for (const file of manifest.files) {
      assert.equal(hash(readFileSync(resolve(stage,file.path))),file.sha256);
      assert.equal(statSync(resolve(stage,file.path)).mode&0o777,0o400);
      assert.doesNotMatch(file.path,/\.env|\.temp|(?:^|\/)seed(?:\.|\/)|\.pem$/);
    }
    assert.deepEqual(readdirSync(resolve(stage,"supabase")),["migrations"]);
    assert.throws(()=>stageSource(repository,commit,stage),/production_profile_install_denied/,
      "an existing stage is never overwritten");
    const mutations=[
      value=>value.files.push({...value.files[0]}),
      value=>value.files[0].path="../outside.sql",
      value=>value.files[0].path="/tmp/outside.sql",
      value=>value.files[0].sha256="not-a-hash",
      value=>value.files.push({path:"supabase/seed.sql",sha256:"1".repeat(64)}),
      value=>value.files.find(file=>file.path===migrations[0].path).path="supabase/migrations/20260902191326_later.sql",
      value=>value.files.splice(value.files.findIndex(file=>file.path===migrations[0].path),1),
    ];
    for(const mutate of mutations){const changed=clone(manifest);mutate(changed);assert.throws(()=>validateManifest(changed),/production_profile_install_denied/);}
  } finally {rmSync(temporary,{recursive:true,force:true});}
});

test("installer has only six fixed flat destinations and never invokes maintenance",()=>{
  assert.deepEqual(profileNames,["oauth","broker","scheduler","webhook","runtime","evidence"]);
  assert.equal(runtimeModules.length,11);
  const source=readFileSync(resolve(here,"install-production-profiles.mjs"),"utf8");
  assert.match(source,/constants\.COPYFILE_EXCL/);
  assert.match(source,/absent\(`\/var\/lib\/vaeroex-production-square-\$\{name\}`\)/);
  assert.match(source,/maintenance\.jsonl"\),"",\{flag:"wx",mode:0o600\}/);
  assert.match(source,/rootCertificate!==caPath/);
  assert.match(source,/native-managed\.sha256/);
  assert.doesNotMatch(source,/execFileSync\([^\n]*maintenance-launcher|\.rpc\(|\.query\(|psql|addSecretVersion|readPrivateAdministrator/);
  const result=spawnSync(process.execPath,[resolve(here,"install-production-profiles.mjs"),"--install"],{encoding:"utf8",timeout:5000});
  assert.equal(result.status,2);
  assert.equal(result.stdout,"production_profile_install_stopped_requires_review\n");
  assert.equal(result.stderr,"");
});

test("guest setup is bounded public Debian setup and preserves administrative services",()=>{
  const file=resolve(here,"setup-production-guest.sh");
  assert.equal(spawnSync("/bin/bash",["-n",file],{encoding:"utf8"}).status,0);
  const source=readFileSync(file,"utf8");
  assert.match(source,/debian:13/);
  assert.match(source,/signed-by=\/usr\/share\/keyrings\/debian-archive-keyring\.gpg/);
  assert.match(source,/https:\/\/deb\.debian\.org\/debian trixie main/);
  assert.match(source,/Acquire::https::Verify-Peer=true/);
  assert.match(source,/Acquire::https::Verify-Host=true/);
  assert.match(source,/APT::Get::AllowUnauthenticated=false/);
  assert.match(source,/Acquire::Retries=0/);
  assert.match(source,/package_bytes" -le 201326592/);
  assert.match(source,/v>=170006&&v<180000/);
  assert.match(source,/199\.36\.153\.8 secretmanager\.googleapis\.com/);
  assert.match(source,/Storage=none\\nProcessSizeMax=0/);
  assert.match(source,/public_setup_complete_no_credential_entry/);
  assert.doesNotMatch(source,/apt-key|curl.*\|.*sh|trusted=yes|--allow-unauthenticated|swapoff|gcloud|supabase|psql|read -s|systemctl (?:stop|disable).*ssh|systemctl (?:stop|disable).*google|secretmanager.*:access/);
});
