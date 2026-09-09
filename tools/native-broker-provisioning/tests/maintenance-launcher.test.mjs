import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, fstatSync, mkdtempSync, mkdirSync, openSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Public synthetic code only. No network, operator account, token or database.
// Test-only immutable build pins cannot be supplied to the production binary.
const directory = dirname(fileURLToPath(import.meta.url));
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const publicArgs = ["create", "0", "synthetic_intent", "synthetic_approval", "1999999999999"];
const denied = "native_maintenance_launcher_denied\n";
function run(command, args, options = {}) {
  return spawnSync(command, args, { env: environment, encoding: "utf8", timeout: 15000, maxBuffer: 8192, ...options });
}
function success(result) {
  // Never attach captured child output, errors or argv to an assertion message.
  assert.equal(result.error === undefined, true, "fixed local synthetic command started");
  assert.equal(result.status, 0, "fixed local synthetic command succeeds");
}

test("fixed native entry clears interpreter/loader hooks before Node and preserves only public argv", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-launcher-public-test-")));
  let inherited;
  try {
    chmodSync(root, 0o700);
    const install = join(root, "install");mkdirSync(install, { mode: 0o700 });
    const launcher = join(root, "launcher");
    const source = resolve(directory, "../maintenance-launcher.c");
    const node = realpathSync(process.execPath);
    const fdPath = join(root, "public-inherited-fd");writeFileSync(fdPath, "PUBLIC_SYNTHETIC_FD", { mode: 0o600 });
    inherited = openSync(fdPath, "r");
    const identity = fstatSync(inherited);
    const fixture = `import { fstatSync, readFileSync } from 'node:fs';
const expected = ${JSON.stringify(publicArgs)};
const exactArgs = JSON.stringify(process.argv.slice(2)) === JSON.stringify(expected) && process.execArgv.length === 0;
// macOS CoreFoundation adds this variable inside Node startup; production
// Linux must observe exactly the three variables supplied by execve.
const envKeys = Object.keys(process.env).filter(key => !(process.platform === 'darwin' && key === '__CF_USER_TEXT_ENCODING')).sort();
const exactEnv = JSON.stringify(envKeys) === JSON.stringify(['LANG','LC_ALL','PATH']) &&
 process.env.LANG === 'C' && process.env.LC_ALL === 'C' && process.env.PATH === '/usr/bin:/bin';
let inherited = false;try { const s=fstatSync(3);inherited=s.dev===${identity.dev} && s.ino===${identity.ino}; } catch {}
const core = process.platform !== 'linux' || /Max core file size\\s+0\\s+0\\s+bytes/.test(readFileSync('/proc/self/limits','utf8'));
if (!exactArgs)process.exit(7);if (!exactEnv)process.exit(8);if (inherited)process.exit(9);if (!core)process.exit(10);
process.stdout.write('synthetic_fixed_entry_passed\\n');
`;
    writeFileSync(join(install, "maintenance.mjs"), fixture, { mode: 0o600 });
    const flags = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-D_FORTIFY_SOURCE=2", "-fstack-protector-strong",
      ...(process.platform === "linux" ? ["-static"] : []), "-DVAEROEX_LAUNCHER_SYNTHETIC_ONLY",
      `-DVAEROEX_TEST_NODE=${JSON.stringify(node)}`, `-DVAEROEX_TEST_INSTALL=${JSON.stringify(install)}`,
      source, "-o", launcher];
    success(run("/usr/bin/cc", flags));
    if (process.platform === "linux") {
      const headers = run("/usr/bin/readelf", ["-lW", launcher]);success(headers);
      const dynamic = run("/usr/bin/readelf", ["-dW", launcher]);success(dynamic);
      assert.equal(/\bINTERP\b/.test(headers.stdout) || /\bNEEDED\b/.test(dynamic.stdout), false, "actual ELF has no dynamic loader/dependencies");
    }
    const invoke = (args = publicArgs, extra = {}) => run(launcher, args, {
      env: { ...environment, ...extra }, stdio: ["ignore", "pipe", "pipe", inherited],
    });
    const accepted = result => {
      success(result);
      assert.equal(result.stdout === "synthetic_fixed_entry_passed\n" && result.stderr === "", true, "fixed response only; no preload executes");
    };
    accepted(invoke());
    for (const kind of ["require", "import"]) {
      const preload = join(root, kind === "require" ? "public-preload.cjs" : "public-preload.mjs");
      writeFileSync(preload, "process.stdout.write('SYNTHETIC_NODE_HOOK_EXECUTED\\n');\n", { mode: 0o600 });
      const options = `--${kind}=${preload}`;
      const control = run(node, ["-e", "process.stdout.write('CONTROL\\n')"], { env: { ...environment, NODE_OPTIONS: options } });
      success(control);
      assert.equal(control.stdout === "SYNTHETIC_NODE_HOOK_EXECUTED\nCONTROL\n", true, "Node hook positive control actually executes");
      accepted(invoke(publicArgs, { NODE_OPTIONS: options, NODE_PATH: root, PGHOST: "public.invalid", EXTRA_PUBLIC: "discard" }));
    }
    if (process.platform === "linux") {
      const hookSource = join(root, "public-loader-hook.c"), hook = join(root, "public-loader-hook.so");
      writeFileSync(hookSource, '#include <unistd.h>\n__attribute__((constructor)) static void hook(void){const char v[]="SYNTHETIC_LD_HOOK_EXECUTED\\n";ssize_t n=write(1,v,sizeof(v)-1);(void)n;}\n', { mode: 0o600 });
      success(run("/usr/bin/cc", ["-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", hookSource, "-o", hook]));
      const control = run(node, ["-e", "process.stdout.write('CONTROL\\n')"], { env: { ...environment, LD_PRELOAD: hook } });
      success(control);
      assert.equal(control.stdout === "SYNTHETIC_LD_HOOK_EXECUTED\nCONTROL\n", true, "loader hook positive control actually executes");
      accepted(invoke(publicArgs, { LD_PRELOAD: hook, LD_LIBRARY_PATH: root, LD_DEBUG: "all" }));
    }
    for (const args of [[], [...publicArgs, "extra"], ["--inspect", ...publicArgs.slice(1)],
      ["create", "1", ...publicArgs.slice(2)], ["rotate", "0", ...publicArgs.slice(2)],
      ["create", "00", ...publicArgs.slice(2)], ["create", "0", "space invalid", ...publicArgs.slice(3)],
      [...publicArgs.slice(0, 4), "not_a_deadline"]]) {
      const result = invoke(args);
      assert.equal(result.status === 2 && result.stdout === denied && result.stderr === "", true, "invalid public argv rejected before interpreter");
    }
    chmodSync(join(install, "maintenance.mjs"), 0o622);
    assert.equal(invoke().stdout === denied, true, "writable entry rejected");
    chmodSync(join(install, "maintenance.mjs"), 0o600);
    const imported = join(install, "synthetic-import.mjs");writeFileSync(imported, "", { mode: 0o622 });chmodSync(imported, 0o622);
    assert.equal(invoke().stdout === denied, true, "writable imported module rejected");
    unlinkSync(imported);symlinkSync(join(install, "maintenance.mjs"), imported);
    assert.equal(invoke().stdout === denied, true, "symlink imported module rejected");
    unlinkSync(imported);
    chmodSync(install, 0o722);
    assert.equal(invoke().stdout === denied, true, "writable install directory rejected");
    chmodSync(install, 0o700);
    accepted(invoke());
  } finally {
    if (inherited !== undefined) closeSync(inherited);
    rmSync(root, { recursive: true, force: true }); // This invocation's public-synthetic mkdtemp only.
  }
});
