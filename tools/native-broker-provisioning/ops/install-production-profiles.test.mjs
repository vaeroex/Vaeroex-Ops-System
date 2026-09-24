import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  assert.equal(runtimeModules.length,12);
  assert.ok(runtimeModules.includes("service-admission.mjs"));
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
  assert.match(source,/^umask 077$/m);
  assert.match(source,/^state=\/var\/lib\/vaeroex-production-native-setup$/m);
  assert.match(source,/^mkdir -m 0700 "\$state"$/m);
  assert.match(source,/ -o "\$state\/libpq-version"$/m);
  assert.match(source,/^"\$state\/libpq-version" \|\| fail production_guest_runtime_libpq17_required$/m);
  assert.doesNotMatch(source,/mount .*remount| -o "\$scratch\/libpq-version"|^"\$scratch\/libpq-version"/m);
  assert.match(source,/199\.36\.153\.8 secretmanager\.googleapis\.com/);
  assert.match(source,/Storage=none\\nProcessSizeMax=0/);
  assert.match(source,/^export PATH=\/usr\/bin:\/bin LANG=C LC_ALL=C DEBIAN_FRONTEND=noninteractive$/m);
  assert.match(source,/^\/usr\/sbin\/sysctl -p "\$sysctl_file" >\/dev\/null$/m);
  assert.match(source,/public_setup_complete_no_credential_entry/);
  assert.doesNotMatch(source,/apt-key|curl.*\|.*sh|trusted=yes|--allow-unauthenticated|swapoff|gcloud|supabase|psql|read -s|systemctl (?:stop|disable).*ssh|systemctl (?:stop|disable).*google|secretmanager.*:access/);
});

test("guest sysctl executable resolves under the restricted setup PATH without kernel mutation",{skip:process.platform!=="linux"},()=>{
  const source=readFileSync(resolve(here,"setup-production-guest.sh"),"utf8");
  const command=source.match(/^(\S+) -p "\$sysctl_file" >\/dev\/null$/m)?.[1];
  assert.equal(command,"/usr/sbin/sysctl");
  // Extract the actual setup executable, but replace the mutation arguments
  // with its read-only version request. Do not load a sysctl configuration.
  const result=spawnSync(command,["--version"],{env:{PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C"},encoding:"utf8",timeout:5000});
  assert.equal(result.status,0);
  assert.match(result.stdout,/^sysctl from procps-ng /);
  assert.equal(result.stderr,"");
});

test("guest libpq probe executes from private state while Linux scratch remains noexec",{skip:process.platform!=="linux"},()=>{
  const source=readFileSync(resolve(here,"setup-production-guest.sh"),"utf8");
  const main=source.match(/'(int main\(void\)\{[^\n']+\})'/)?.[1];
  const invocation=source.match(/^"\$(?:state|scratch)\/libpq-version" \|\| fail production_guest_runtime_libpq17_required$/m)?.[0];
  const outputDirectory=source.match(/ -o "\$(state|scratch)\/libpq-version"$/m)?.[1];
  assert.ok(main);
  assert.ok(invocation);
  assert.equal(outputDirectory,"state");
  // Resolve the visible mount, including a private CI overmount of /dev/shm.
  const mountOptions=execFileSync("/usr/bin/findmnt",["--target","/dev/shm","--noheadings","--output","OPTIONS"],{encoding:"utf8",timeout:5000,maxBuffer:4096}).trim().split(",");
  assert.ok(mountOptions.includes("noexec"),"the regression requires actual noexec scratch in the disposable CI namespace");
  const state=mkdtempSync(resolve(tmpdir(),"production-libpq-state-"));
  const scratch=mkdtempSync("/dev/shm/production-libpq-scratch-");
  try {
    assert.equal(statSync(state).mode&0o777,0o700);
    const cSource=resolve(scratch,"libpq-version.c");
    const executable=resolve(outputDirectory==="state"?state:scratch,"libpq-version");
    for(const [version,expected] of [[170006,0],[170005,2],[180000,2]]) {
      // Stub only the public version value, retaining the setup's exact C
      // predicate and shell invocation; no database or libpq install is needed.
      writeFileSync(cSource,`int PQlibVersion(void){return ${version};}\n${main}\n`,{mode:0o600});
      const compile=spawnSync("/usr/bin/cc",[cSource,"-o",executable],{encoding:"utf8",timeout:10000});
      assert.equal(compile.status,0,"public probe compiles into executable private state");
      const result=spawnSync("/bin/bash",["-c",`set -euo pipefail\nfail(){ printf '%s\\n' "$1"; exit 2; }\n${invocation}`],{env:{PATH:"/usr/bin:/bin",state,scratch},encoding:"utf8",timeout:5000});
      assert.equal(result.status,expected);
      assert.equal(result.stdout,expected===0?"":"production_guest_runtime_libpq17_required\n");
      assert.equal(result.stderr,"");
      if(version===170006) {
        const scratchExecutable=resolve(scratch,"libpq-version");
        copyFileSync(executable,scratchExecutable);
        chmodSync(scratchExecutable,0o700);
        const rejected=spawnSync(scratchExecutable,[],{encoding:"utf8",timeout:5000});
        assert.equal(rejected.error?.code,"EACCES","the prior scratch execution fails because the actual mount is noexec");
      }
    }
  } finally {
    rmSync(scratch,{recursive:true,force:true});
    rmSync(state,{recursive:true,force:true});
  }
});
