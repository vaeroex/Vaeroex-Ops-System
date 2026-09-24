import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const profileNames = Object.freeze(["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]);
export const runtimeModules = Object.freeze(["maintenance.mjs", "adapter.mjs", "lifecycle.mjs", "secret-store.mjs",
  "secret-manager-rest.mjs", "dsn-codec.mjs", "maintenance-identity.mjs", "private-entry.mjs",
  "maintenance-policy.mjs", "service-admission.mjs", "production-profile.mjs", "sandbox-profile.mjs"]);
const buildModules = ["build-production.mjs", "production-source.mjs", "native.c", "maintenance-launcher.c"];
const moduleRoot = "tools/native-broker-provisioning/";
const caSource = "tools/jit-access-feasibility/supabase-root-2021.crt";
const caPath = "/etc/vaeroex-production-native/supabase-root-2021.crt";
const caHash = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
const denied = () => new Error("production_profile_install_denied");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const cleanEnvironment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const migrationVersion = path => /^supabase\/migrations\/(\d{12}|\d{14})_[a-z0-9_]+\.sql$/.exec(path)?.[1];
function directory(path) { if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw denied(); }
function absent(path) { if (existsSync(path)) throw denied(); try { lstatSync(path); throw denied(); } catch (error) { if (error.code !== "ENOENT") throw error; } }
function regular(path) { const st=lstatSync(path); if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw denied(); return st; }
function trustedParents(path) {
  for (let current=path;;current=dirname(current)) {
    const st=lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== 0 || st.mode & 0o022) throw denied();
    if (current === "/") return;
  }
}

export function validateManifest(value) {
  if (!value || Object.keys(value).sort().join(",") !== "files,schemaVersion,sourceCommit" ||
      value.schemaVersion !== "production_native_install_source_v1" || !/^[a-f0-9]{40}$/.test(value.sourceCommit ?? "") ||
      !Array.isArray(value.files)) throw denied();
  const paths=value.files.map(item => {
    if (!item || Object.keys(item).sort().join(",") !== "path,sha256" ||
        typeof item.path !== "string" || !/^[a-zA-Z0-9_./-]+$/.test(item.path) ||
        item.path.startsWith("/") || item.path.split("/").some(part => !part || part === "." || part === "..") ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? "")) throw denied();
    return item.path;
  });
  const migrations=paths.filter(path => path.startsWith("supabase/migrations/"));
  const versions=migrations.map(migrationVersion);
  const exact=[...runtimeModules,...buildModules].map(name=>moduleRoot+name).concat(caSource);
  if (new Set(paths).size !== paths.length || migrations.length !== 104 ||
      versions.some(version=>!version || version>"20260902191325") || new Set(versions).size !== 104 ||
      [...versions].sort().at(-1) !== "20260902191325" ||
      paths.length !== exact.length+104 || exact.some(path=>!paths.includes(path))) throw denied();
  const ledger=hash([...versions].sort().map(version=>`${version.length}:${version}`).join(""));
  if (ledger !== "7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f") throw denied();
  return value;
}

/** Public-source staging only; never copies working-tree files or credentials. */
export function stageSource(repository, commit, output) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !output.startsWith("/")) throw denied();
  absent(output);
  const git=(...args)=>execFileSync("git",["-C",repository,...args],{env:{...cleanEnvironment},maxBuffer:32*1024*1024});
  if (git("rev-parse",`${commit}^{commit}`).toString().trim()!==commit) throw denied();
  const migrations=git("ls-tree","-r","--name-only",commit,"supabase/migrations").toString().trim().split("\n")
    .filter(path=>migrationVersion(path)&&migrationVersion(path)<="20260902191325");
  const paths=[...runtimeModules,...buildModules].map(name=>moduleRoot+name).concat(caSource,migrations).sort();
  const files=paths.map(path=>({path,bytes:git("show",`${commit}:${path}`)}));
  const manifest=validateManifest({schemaVersion:"production_native_install_source_v1",sourceCommit:commit,
    files:files.map(({path,bytes})=>({path,sha256:hash(bytes)}))});
  if (manifest.files.find(file=>file.path===caSource).sha256!==caHash) throw denied();
  mkdirSync(output,{mode:0o700});
  for (const file of files) { const destination=resolve(output,file.path);mkdirSync(dirname(destination),{recursive:true,mode:0o700});writeFileSync(destination,file.bytes,{flag:"wx",mode:0o400}); }
  const bytes=JSON.stringify(manifest,null,2)+"\n";
  writeFileSync(resolve(output,"source-manifest.json"),bytes,{flag:"wx",mode:0o400});
  return hash(bytes);
}

export async function installProfiles(source, expectedManifestHash) {
  if (process.platform!=="linux" || process.getuid()!==0 || process.execArgv.length ||
      Object.keys(process.env).some(key=>/^(NODE_|PG|LD_|DYLD_|MALLOC|LIBPQ)/.test(key)) ||
      !/^[a-f0-9]{64}$/.test(expectedManifestHash ?? "")) throw denied();
  source=realpathSync(source);trustedParents(source);directory(source);
  const manifestPath=resolve(source,"source-manifest.json");
  const manifestStat=regular(manifestPath);
  if (manifestStat.uid!==0 || manifestStat.mode&0o022 || manifestStat.size>65536) throw denied();
  const bytes=readFileSync(manifestPath);
  if (hash(bytes)!==expectedManifestHash) throw denied();
  const manifest=validateManifest(JSON.parse(bytes));
  for (const file of manifest.files) {
    const path=resolve(source,file.path);trustedParents(dirname(path));const st=regular(path);
    if (st.uid!==0 || st.mode&0o022 || hash(readFileSync(path))!==file.sha256) throw denied();
  }
  const node=regular("/usr/bin/node");trustedParents("/usr/bin");
  if (node.uid!==0 || node.mode&0o022 || !(node.mode&0o111)) throw denied();
  if (readFileSync("/var/lib/vaeroex-production-native-setup/status","utf8")!=="public_setup_complete_no_credential_entry\n") throw denied();
  trustedParents("/opt");trustedParents("/var/lib");trustedParents("/etc");
  for (const name of profileNames) { absent(`/opt/vaeroex-production-square-${name}`);absent(`/var/lib/vaeroex-production-square-${name}`); }
  absent("/var/lib/vaeroex-production-native-build");absent("/etc/vaeroex-production-native");
  const profiles=await import(pathToFileURL(resolve(source,moduleRoot,"production-profile.mjs")));
  const sourceCheck=await import(pathToFileURL(resolve(source,moduleRoot,"production-source.mjs")));
  const migrations=manifest.files.filter(file=>file.path.startsWith("supabase/migrations/"));
  if (sourceCheck.productionSourceManifest({migrationNames:migrations.map(file=>file.path.split("/").at(-1)),
    digest:name=>manifest.files.find(file=>file.path===`supabase/migrations/${name}`)?.sha256}).phase!=="internalRuntime") throw denied();
  for (const name of profileNames) {
    const profile=profiles.productionProvisioningBuildProfile(name);
    if (profile.target.rootCertificate!==caPath || profile.maintenance.caSha256!==caHash ||
        profile.target.projectReference!=="mdiianhfrojmxqpwrflh" || profile.kind!=="production") throw denied();
  }
  const build="/var/lib/vaeroex-production-native-build";
  mkdirSync(build,{mode:0o700});
  const artifactManifest={sourceCommit:manifest.sourceCommit,sourceManifestSha256:expectedManifestHash,files:[]};
  for (const name of profileNames) {
    const output=resolve(build,`native-${name}`);
    const label=execFileSync("/usr/bin/node",[resolve(source,moduleRoot,"build-production.mjs"),output,name],
      {env:cleanEnvironment,encoding:"utf8",timeout:70000,maxBuffer:65536});
    if (label!=="production_pinned_binary_built_no_hosted_qualification\n") throw denied();
    for (const path of [output,output+".launcher"]) {regular(path);artifactManifest.files.push({path,sha256:hash(readFileSync(path))});}
  }
  // All builds have passed before any installation or journal is created.
  mkdirSync("/etc/vaeroex-production-native",{mode:0o755});
  copyFileSync(resolve(source,caSource),caPath,constants.COPYFILE_EXCL);chmodSync(caPath,0o444);
  for (const name of profileNames) {
    const install=`/opt/vaeroex-production-square-${name}`,state=`/var/lib/vaeroex-production-square-${name}`;
    mkdirSync(install,{mode:0o755});mkdirSync(state,{mode:0o700});
    for (const moduleName of runtimeModules) {const target=resolve(install,moduleName);copyFileSync(resolve(source,moduleRoot,moduleName),target,constants.COPYFILE_EXCL);chmodSync(target,0o444);}
    for (const [from,to] of [[`native-${name}`,"native-managed"],[`native-${name}.launcher`,"maintenance-launcher"]]) {
      copyFileSync(resolve(build,from),resolve(install,to),constants.COPYFILE_EXCL);chmodSync(resolve(install,to),0o555);
    }
    writeFileSync(resolve(install,"native-managed.sha256"),hash(readFileSync(resolve(install,"native-managed")))+"\n",{flag:"wx",mode:0o444});
    writeFileSync(resolve(state,"maintenance.jsonl"),"",{flag:"wx",mode:0o600});
    for (const file of readdirSync(install)) {
      const path=resolve(install,file),st=regular(path);
      if (st.uid!==0 || st.mode&0o022) throw denied();
      artifactManifest.files.push({path,sha256:hash(readFileSync(path))});
    }
  }
  writeFileSync(resolve(build,"installed-manifest.json"),JSON.stringify(artifactManifest,null,2)+"\n",{flag:"wx",mode:0o400});
  return "production_six_profiles_installed_no_database_or_secret_operation";
}

if (process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv[2]==="--stage" && process.argv.length===6) {
      process.stdout.write(`production_public_source_manifest_sha256 ${stageSource(process.argv[3],process.argv[4],process.argv[5])}\n`);
    } else if (process.argv[2]==="--install" && process.argv.length===5) {
      process.stdout.write(`${await installProfiles(process.argv[3],process.argv[4])}\n`);
    } else throw denied();
  } catch { process.stdout.write("production_profile_install_stopped_requires_review\n");process.exitCode=2; }
}
