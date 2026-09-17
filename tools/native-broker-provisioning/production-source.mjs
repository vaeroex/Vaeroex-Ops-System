import { createHash } from "node:crypto";
import { productionSourcePins } from "./production-profile.mjs";

const denied = () => new Error("production_native_source_manifest_denied");
const versionOf = name => name.split("_", 1)[0];
const ledgerFingerprint = versions => `sha256:${createHash("sha256").update(
  versions.map(version => `${version.length}:${version}`).join(""),
).digest("hex")}`;

// Pure source-manifest validation shared by the offline builder and tests. The
// digest callback reads only the named migration bytes; no deployment binding,
// database connection or credential is involved.
export function productionSourceManifest({ migrationNames, digest } = {}) {
  if (!Array.isArray(migrationNames) || typeof digest !== "function" ||
      migrationNames.some(name => typeof name !== "string" || !/^\d+_.+\.sql$/.test(name)) ||
      new Set(migrationNames).size !== migrationNames.length) throw denied();
  const names = [...migrationNames].sort();
  const baselineVersions = names.filter(name => versionOf(name) <= productionSourcePins.baselineVersion).map(versionOf);
  const overlayVersions = names.filter(name => versionOf(name) <= productionSourcePins.overlayVersion).map(versionOf);
  const internalRuntimeVersions = names
    .filter(name => versionOf(name) <= productionSourcePins.internalRuntimeVersion).map(versionOf);
  const foundation = `${productionSourcePins.baselineVersion}_integration_production_runtime_foundation.sql`;
  const overlay = `${productionSourcePins.overlayVersion}_square_production_runtime_overlay.sql`;
  const internalRuntime = `${productionSourcePins.internalRuntimeVersion}_square_production_internal_pilot_runtime.sql`;
  if (baselineVersions.length !== productionSourcePins.baselineMigrationCount ||
      ledgerFingerprint(baselineVersions) !== productionSourcePins.baselineLedgerFingerprint ||
      overlayVersions.length !== productionSourcePins.overlayMigrationCount ||
      ledgerFingerprint(overlayVersions) !== productionSourcePins.overlayLedgerFingerprint ||
      names[productionSourcePins.baselineMigrationCount - 1] !== foundation ||
      names[productionSourcePins.baselineMigrationCount] !== overlay ||
      digest(foundation) !== productionSourcePins.foundationSha256 ||
      digest(overlay) !== productionSourcePins.overlaySha256) throw denied();
  const internalRuntimeNames = names.filter(name => versionOf(name) === productionSourcePins.internalRuntimeVersion);
  if (internalRuntimeNames.length === 0) return Object.freeze({ phase: "overlay", internalRuntimeSha256: null });
  if (internalRuntimeNames.length !== 1 || internalRuntimeNames[0] !== internalRuntime ||
      internalRuntimeVersions.length !== productionSourcePins.internalRuntimeMigrationCount ||
      ledgerFingerprint(internalRuntimeVersions) !== productionSourcePins.internalRuntimeLedgerFingerprint ||
      typeof productionSourcePins.internalRuntimeSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(productionSourcePins.internalRuntimeSha256) ||
      digest(internalRuntime) !== productionSourcePins.internalRuntimeSha256) throw denied();
  return Object.freeze({ phase: "internalRuntime", internalRuntimeSha256: productionSourcePins.internalRuntimeSha256 });
}
