import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { productionProvisioningBuildProfile } from "./production-profile.mjs";
import { productionSourceManifest } from "./production-source.mjs";
import { customerNativeContract } from "./customer-source.mjs";

// Offline build only. The committed deployment binding must first contain every
// reviewed public endpoint/CA/VM identity pin; null pins fail before compiler I/O.
if (process.argv.length !== 4 || !process.argv[2].startsWith("/") ||
    /[\u0000-\u0020\u007f]/.test(process.argv[2]) || process.platform !== "linux") {
  process.stdout.write("production_build_requires_linux_absolute_output_and_profile\n"); process.exit(2);
}
let profile;
try { profile = productionProvisioningBuildProfile(process.argv[3]); }
catch { process.stdout.write("production_build_identity_manifest_required\n"); process.exit(2); }
const target = profile.target;
const pins = { HOST: target.host, PORT: String(target.port), DATABASE: target.database, ADMIN: target.adminRole,
  TARGET: target.role, SYSTEM_ID: target.systemIdentifier, DATABASE_OID: target.databaseOid, CA: target.rootCertificate,
  ADMIN_USER: `${target.adminRole}.${target.projectReference}`, TARGET_USER: `${target.role}.${target.projectReference}` };
const macro = `-DVAEROEX_PRODUCTION_${profile.name.toUpperCase()}`;
try {
  const source = dirname(fileURLToPath(import.meta.url));
  const migrations = resolve(source, "../../supabase/migrations");
  const names = readdirSync(migrations).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const digest = name => createHash("sha256").update(readFileSync(resolve(migrations, name))).digest("hex");
  const sourceManifest = productionSourceManifest({ migrationNames: names, digest });
  const customer = customerNativeContract();
  const sourcePhaseMacro = sourceManifest.phase === "internalRuntime"
    ? [`-DVAEROEX_PRODUCTION_INTERNAL_RUNTIME_SOURCE_SHA256=${JSON.stringify(sourceManifest.internalRuntimeSha256)}`]
    : [];
  const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  const include = execFileSync("/usr/bin/pg_config", ["--includedir"], { env: environment, encoding: "utf8" }).trim();
  const library = execFileSync("/usr/bin/pg_config", ["--libdir"], { env: environment, encoding: "utf8" }).trim();
  if (![include, library].every(value => value.startsWith("/") && !/[\u0000-\u0020\u007f]/.test(value))) throw new Error();
  execFileSync("/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread", "-D_FORTIFY_SOURCE=2",
    "-fstack-protector-strong", "-fPIE", "-pie", "-Wl,-z,relro,-z,now", `-I${include}`, `-L${library}`,
    "-DVAEROEX_MANAGED_SUPABASE", macro, ...sourcePhaseMacro,
    `-DVAEROEX_PRODUCTION_CUSTOMER_CONTRACT=${JSON.stringify(customer.sql)}`,
    ...Object.entries(pins).map(([key, value]) => `-DVAEROEX_MANAGED_${key}=${JSON.stringify(value)}`),
    resolve(source, "native.c"), "-lpq", "-o", process.argv[2]], { env: environment, stdio: "pipe", timeout: 30000 });
  const launcher = process.argv[2] + ".launcher";
  execFileSync("/usr/bin/cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-static", "-D_FORTIFY_SOURCE=2",
    "-fstack-protector-strong", "-Wl,-z,relro,-z,now", macro,
    resolve(source, "maintenance-launcher.c"), "-o", launcher], { env: environment, stdio: "pipe", timeout: 30000 });
  const headers = execFileSync("/usr/bin/readelf", ["-lW", launcher], { env: environment, encoding: "utf8" });
  const dynamic = execFileSync("/usr/bin/readelf", ["-dW", launcher], { env: environment, encoding: "utf8" });
  if (/\bINTERP\b/.test(headers) || /\bNEEDED\b/.test(dynamic)) throw new Error();
  process.stdout.write("production_pinned_binary_built_no_hosted_qualification\n");
} catch { process.stdout.write("production_build_failed\n"); process.exitCode = 2; }
