"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS public dependency builder. */
// Public source dependency build only; no database, provider auth, credentials,
// SQL execution, cloud resources, or root/system installation.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const repository = path.resolve(__dirname, "../../..");
const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
let stage = "inputs", root;
function run(executable, args, cwd, timeout = 120000) {
  const result = spawnSync(executable, args, { cwd, env, timeout, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("public_build_failed");
  return result.stdout;
}
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
try {
  const qualify = process.argv.length === 3 && process.argv[2] === "--qualify";
  if ((!qualify && process.argv.length !== 2) || process.platform !== "linux" || process.getuid() === 0) throw new Error("local_build_inputs_denied");
  const nodeModulesRoot = fs.realpathSync(path.join(repository, "node_modules"));
  if (!fs.statSync(path.join(nodeModulesRoot, "pg")).isDirectory()) throw new Error("frozen_pg_dependency_missing");
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-broker-public-build-")));
  fs.chmodSync(root, 0o700);
  const archive = path.join(root, "postgresql-17.6.tar.bz2"), pgRoot = path.join(root, "install");
  stage = "postgres_download";
  run("/usr/bin/curl", ["-q", "--fail", "--silent", "--show-error", "--proto", "=https", "--tlsv1.2", "--max-time", "90",
    "--output", archive, "https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2"], root);
  if (hash(archive) !== "e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0") throw new Error("postgres_archive_digest");
  run("/usr/bin/tar", ["-xjf", archive], root);
  const source = path.join(root, "postgresql-17.6");
  stage = "postgres_build";
  run(path.join(source, "configure"), ["--prefix=" + pgRoot, "--with-ssl=openssl", "--without-icu", "--without-readline"], source);
  run("/usr/bin/make", ["-j2"], source, 1200000);
  run("/usr/bin/make", ["install"], source, 120000);
  for (const name of ["pg_stat_statements", "auto_explain"]) {
    run("/usr/bin/make", ["-j2"], path.join(source, "contrib", name));
    run("/usr/bin/make", ["install"], path.join(source, "contrib", name));
  }
  const auditRoot = path.join(root, "pgaudit"), supaRoot = path.join(root, "supautils");
  for (const [name, directory, commit] of [["pgaudit/pgaudit", auditRoot, "538f89a93d8fd0d8913f3d740cacaea7b7eb66d9"],
    ["supabase/supautils", supaRoot, "e35f8affc4467202ff0d98f8dd14cb955bc13c75"]]) {
    stage = directory === auditRoot ? "pgaudit_source_build" : "supautils_source_build";
    run("/usr/bin/git", ["-c", "credential.helper=", "clone", "--no-checkout", "https://github.com/" + name + ".git", directory], root);
    run("/usr/bin/git", ["checkout", "--detach", commit], directory);
    if (run("/usr/bin/git", ["rev-parse", "HEAD"], directory).trim() !== commit) throw new Error("extension_source_pin");
    run("/usr/bin/make", ["-j2", "PG_CONFIG=" + path.join(pgRoot, "bin/pg_config")], directory);
  }
  stage = "record_local_manifest";
  const files = [path.join(pgRoot, "bin/postgres"), path.join(pgRoot, "lib/libpq.so.5"), path.join(auditRoot, "pgaudit.so"),
    path.join(supaRoot, "supautils.so"), path.join(pgRoot, "lib/postgresql/pg_stat_statements.so"), path.join(pgRoot, "lib/postgresql/auto_explain.so")];
  const manifest = { pgRoot, auditRoot, supaRoot, nodeModulesRoot, binarySha256: files.map(hash) };
  const manifestPath = path.join(root, "dependencies.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ publicSourceBuildOnly: true, manifestPath, postgres: "17.6", pgaudit: "17.1", hostedQualification: false }) + "\n");
  if (qualify) {
    stage = "local_synthetic_qualification";
    const result = spawnSync(process.execPath, [path.join(__dirname, "qualify.cjs")], {
      env: { ...env, VAEROEX_NATIVE_TEST_DEPENDENCIES: manifestPath }, encoding: "utf8", timeout: 240000, maxBuffer: 16384
    });
    if (result.error || result.stderr || result.stdout.length > 4096) throw new Error("qualification_output_denied");
    const summary = JSON.parse(result.stdout);
    if (Object.keys(summary).sort().join(",") !== "assertions,failure,hostedQualification,localOnly,stopped,suite" ||
      summary.suite !== "native_broker_local_synthetic" || !Number.isSafeInteger(summary.assertions) ||
      summary.localOnly !== true || summary.hostedQualification !== false ||
      summary.failure !== null && !/^[a-z_0-9]+$/.test(summary.failure)) throw new Error("qualification_output_denied");
    process.stdout.write(JSON.stringify(summary) + "\n");
    if (result.status !== 0) process.exitCode = 1;
  }
} catch {
  process.stdout.write(JSON.stringify({ publicSourceBuildOnly: true, failure: stage, hostedQualification: false }) + "\n");
  process.exitCode = 1;
}
