import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxTarget as target } from "./sandbox-profile.mjs";

// Explicit build operation only. Never run by an application/build hook. It
// creates a pinned maintenance binary; it does not connect to any service.
if (process.argv.length !== 3 || !process.argv[2].startsWith("/") ||
    /[\u0000-\u0020\u007f]/.test(process.argv[2]) || process.platform !== "linux") {
  process.stdout.write("managed_build_requires_linux_and_absolute_output\n"); process.exit(2);
}
const pins = { HOST: target.host, PORT: String(target.port), DATABASE: target.database, ADMIN: target.adminRole,
  TARGET: target.role, SYSTEM_ID: target.systemIdentifier, DATABASE_OID: target.databaseOid, CA: target.rootCertificate,
  ADMIN_USER: `${target.adminRole}.${target.projectReference}`, TARGET_USER: `${target.role}.${target.projectReference}` };
try {
  const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  const include = execFileSync("/usr/bin/pg_config", ["--includedir"], { env: environment, encoding: "utf8" }).trim();
  const library = execFileSync("/usr/bin/pg_config", ["--libdir"], { env: environment, encoding: "utf8" }).trim();
  if (![include, library].every(value => value.startsWith("/") && !/[\u0000-\u0020\u007f]/.test(value))) throw new Error();
  execFileSync("/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread", "-D_FORTIFY_SOURCE=2",
    "-fstack-protector-strong", "-fPIE", "-pie", "-Wl,-z,relro,-z,now", `-I${include}`, `-L${library}`,
    "-DVAEROEX_MANAGED_SUPABASE", ...Object.entries(pins).map(([key, value]) => `-DVAEROEX_MANAGED_${key}=${JSON.stringify(value)}`),
    resolve(dirname(fileURLToPath(import.meta.url)), "native.c"), "-lpq", "-o", process.argv[2]],
  { env: environment, stdio: "pipe", timeout: 30000 });
  const launcher = process.argv[2] + ".launcher";
  execFileSync("/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-static",
    "-D_FORTIFY_SOURCE=2", "-fstack-protector-strong", "-Wl,-z,relro,-z,now",
    resolve(dirname(fileURLToPath(import.meta.url)), "maintenance-launcher.c"), "-o", launcher],
  { env: environment, stdio: "pipe", timeout: 30000 });
  // A dynamic launcher would itself honor LD_PRELOAD before main. Verify the
  // produced ELF, not just the compiler flag, before admitting this output.
  const programHeaders = execFileSync("/usr/bin/readelf", ["-lW", launcher], { env: environment, encoding: "utf8" });
  const dynamicEntries = execFileSync("/usr/bin/readelf", ["-dW", launcher], { env: environment, encoding: "utf8" });
  if (/\bINTERP\b/.test(programHeaders) || /\bNEEDED\b/.test(dynamicEntries)) throw new Error();
  process.stdout.write("managed_pinned_binary_built_no_hosted_qualification\n");
} catch { process.stdout.write("managed_build_failed\n"); process.exitCode = 2; }
