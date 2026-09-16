#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadJson, qualifyPilotEvidence } from "./model.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const contract = loadJson(path.join(directory, "contract.json"));
const args = process.argv.slice(2);
const repository = path.resolve(directory, "../../..");
const qualificationSourcePaths = Object.freeze([
  "services/external-integrations-production/pilot/contract.json",
  "services/external-integrations-production/pilot/model.mjs",
  "services/external-integrations-production/pilot/qualify.mjs",
  "services/external-integrations-production/pilot/verify-database.sql"
]);

function gitOutput(args) {
  try {
    return execFileSync("git", ["-C", repository, ...args], {
      encoding: null,
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}

function qualificationSourceHead() {
  const output = gitOutput(["rev-parse", "HEAD"]);
  const head = output?.toString("utf8").trim();
  return typeof head === "string" && /^[a-f0-9]{40}$/.test(head) ? head : null;
}

function sourceOverlaySha256(expectedHead) {
  const relative = contract.database.requiredOverlayPath;
  if (!/^[a-f0-9]{40}$/.test(expectedHead) || typeof relative !== "string" || path.isAbsolute(relative)) return null;
  const candidate = path.resolve(repository, relative);
  if (!candidate.startsWith(`${repository}${path.sep}`)) return null;
  const blob = gitOutput(["show", `${expectedHead}:${relative}`]);
  return blob === null ? null : crypto.createHash("sha256").update(blob).digest("hex");
}

function qualificationSourcesExact(expectedHead) {
  if (!/^[a-f0-9]{40}$/.test(expectedHead)) return false;
  const status = gitOutput(["status", "--porcelain=v1", "--untracked-files=all", "--", ...qualificationSourcePaths]);
  if (status === null || status.length !== 0) return false;
  for (const relative of qualificationSourcePaths) {
    const committed = gitOutput(["show", `${expectedHead}:${relative}`]);
    let working;
    try {
      working = fs.readFileSync(path.join(repository, relative));
    } catch {
      return false;
    }
    if (committed === null || committed.length !== working.length || !crypto.timingSafeEqual(committed, working)) return false;
  }
  return true;
}

function sourceIncluded(source, expectedHead) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{40}$/.test(expectedHead)) return false;
  return gitOutput(["merge-base", "--is-ancestor", source, expectedHead]) !== null;
}

function sourceCollectionSha256(sourceCommit, sourcePaths) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? "") || !Array.isArray(sourcePaths) || sourcePaths.length === 0 ||
    new Set(sourcePaths).size !== sourcePaths.length || sourcePaths.some((relative) => typeof relative !== "string" ||
      (!relative.startsWith("tools/native-broker-provisioning/") &&
       ![".github/workflows/ci.yml", "package.json", "scripts/run-square-production-overlay-qualification.js"].includes(relative)) ||
      relative.includes("..") || path.isAbsolute(relative))) return null;
  const digest = crypto.createHash("sha256");
  for (const relative of [...sourcePaths].sort()) {
    const blob = gitOutput(["show", `${sourceCommit}:${relative}`]);
    if (blob === null) return null;
    digest.update(Buffer.from(`${Buffer.byteLength(relative)}:${relative}:${blob.length}:`, "utf8"));
    digest.update(blob);
  }
  return digest.digest("hex");
}

function productionNativeProvisioningSource(expectedHead) {
  const pin = contract.productionNativeProvisioning;
  if (!["reviewed_source_pending_execution_environment", "reviewed_production_native_profiles"].includes(pin?.status)) return Object.freeze({
    sourceExact: false, sourceCommit: null, sourceSha256: null, deploymentIdentityManifestSha256: null
  });
  const sourceCommit = pin.sourceCommit;
  const sourceSha256 = sourceCollectionSha256(sourceCommit, pin.sourcePaths);
  return Object.freeze({
    sourceExact: sourceIncluded(sourceCommit, expectedHead) && sourceSha256 === pin.sourceSha256,
    sourceCommit, sourceSha256,
    deploymentIdentityManifestSha256: pin.deploymentIdentityManifestSha256
  });
}

function productionRuntimeSurface(expectedHead, maximumMigrationVersion) {
  const closedSurface = () => Object.freeze({
    migrationCount: 0, ledgerHead: null, ledgerFingerprint: null, sourceSha256: null,
    authorityRpcs: Object.freeze([]), blockingPredicates: Object.freeze([]),
    definedFunctions: Object.freeze([]), runtimeAuthorityRpcs: Object.freeze([])
  });
  if (typeof expectedHead !== "string" || !/^[a-f0-9]{40}$/.test(expectedHead)) return closedSurface();
  if (typeof maximumMigrationVersion !== "bigint") return closedSurface();
  const tree = gitOutput(["ls-tree", "-r", "--name-only", expectedHead, "--", "supabase/migrations"]);
  if (tree === null) return closedSurface();
  const files = (tree?.toString("utf8").trim().split("\n") ?? [])
    .filter((relative) => /^supabase\/migrations\/\d+_.+\.sql$/.test(relative))
    .filter((relative) => BigInt(path.basename(relative).split("_", 1)[0]) <= maximumMigrationVersion)
    .sort((left, right) => {
      const a = BigInt(path.basename(left).split("_", 1)[0]);
      const b = BigInt(path.basename(right).split("_", 1)[0]);
      return a < b ? -1 : a > b ? 1 : left.localeCompare(right);
    });
  const sourceDigest = crypto.createHash("sha256");
  const sources = [];
  for (const relative of files) {
    const blob = gitOutput(["show", `${expectedHead}:${relative}`]);
    if (blob === null) return closedSurface();
    sourceDigest.update(Buffer.from(`${Buffer.byteLength(relative)}:${relative}:${blob.length}:`, "utf8"));
    sourceDigest.update(blob);
    sources.push(blob.toString("utf8"));
  }
  const sql = sources.join("\n");
  const authorities = new Set(Object.keys(contract.database.authorityRpcBindings));
  const authorityRpcs = [];
  const grantPattern = /grant\s+execute\s+on\s+function\s+([^;]+?)\s+to\s+([a-z][a-z0-9_]*)\s*;/gi;
  for (const match of sql.matchAll(grantPattern)) {
    if (!authorities.has(match[2])) continue;
    const signature = match[1].replace(/\s+/g, "").replace(/,$/, "");
    authorityRpcs.push(`${match[2]}=${signature}`);
  }
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definedFunctions = (contract.productionRuntimeSurface.runtimeContract?.requiredFunctions ?? []).filter((name) =>
    new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escape(name)}\\s*\\(`, "i").test(sql));
  const compactSql = sql.replace(/\s+/g, " ");
  const blockingPredicates = [
    ["runtime_enabled_constrained_false", /runtime_enabled boolean not null default false check\(not runtime_enabled\)/],
    ["provider_calls_enabled_constrained_false", /provider_calls_enabled boolean not null default false check\(not provider_calls_enabled\)/],
    ["customer_onboarding_enabled_constrained_false", /customer_onboarding_enabled boolean not null default false check\(not customer_onboarding_enabled\)/],
    ["oauth_requires_customer_onboarding_enabled", /\(p_capability='oauth' and not current_configuration\.customer_onboarding_enabled\)/]
  ].filter(([, pattern]) => pattern.test(compactSql)).map(([label]) => label).sort();
  const finalRuntime = contract.productionRuntimeSurface.runtimeContract.status === "reviewed_runtime_migration" &&
    maximumMigrationVersion >= BigInt(contract.productionRuntimeSurface.runtimeContract.ledgerHead);
  const runtimeSource = finalRuntime ? gitOutput(["show", `${expectedHead}:${contract.productionRuntimeSurface.runtimeContract.sourcePath}`]) : null;
  return Object.freeze({
    migrationCount: files.length,
    ledgerHead: files.length ? path.basename(files.at(-1)).split("_", 1)[0] : null,
    ledgerFingerprint: finalRuntime ? contract.productionRuntimeSurface.runtimeContract.ledgerFingerprint : null,
    sourceSha256: finalRuntime && runtimeSource !== null
      ? crypto.createHash("sha256").update(runtimeSource).digest("hex")
      : sourceDigest.digest("hex"),
    authorityRpcs: Object.freeze(finalRuntime
      ? [...contract.productionRuntimeSurface.runtimeContract.authorityRpcs].sort()
      : [...new Set(authorityRpcs)].sort()),
    blockingPredicates: Object.freeze(blockingPredicates),
    definedFunctions: Object.freeze(definedFunctions.sort()),
    runtimeAuthorityRpcs: Object.freeze(finalRuntime
      ? [...contract.productionRuntimeSurface.runtimeContract.authorityRpcs].sort()
      : authorityRpcs.filter((binding) => !contract.productionRuntimeSurface.baselineAuthorityRpcs.includes(binding)).sort())
  });
}

function value(flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) throw new Error(`missing ${flag}`);
  return args[index + 1];
}

function sanitizedRuntimeCatalogPostflight(file) {
  if (!file) return null;
  const candidate = loadJson(path.resolve(file));
  const keys = ["marker", "ledgerHead", "ledgerFingerprint", "migrationSourceSha256", "authorityRpcs", "requiredFunctions"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
      JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify([...keys].sort()) ||
      typeof candidate.marker !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(candidate.marker) ||
      !/^\d{14}$/.test(candidate.ledgerHead) ||
      !/^sha256:[a-f0-9]{64}$/.test(candidate.ledgerFingerprint) ||
      !/^[a-f0-9]{64}$/.test(candidate.migrationSourceSha256) ||
      !Array.isArray(candidate.authorityRpcs) || !Array.isArray(candidate.requiredFunctions) ||
      candidate.authorityRpcs.some((entry) => typeof entry !== "string" || entry.length > 512 || /[\r\n]/.test(entry)) ||
      candidate.requiredFunctions.some((entry) => typeof entry !== "string" || entry.length > 512 || /[\r\n]/.test(entry))) {
    throw new Error("runtime catalog postflight input rejected");
  }
  return Object.freeze({
    marker: candidate.marker,
    ledgerHead: candidate.ledgerHead,
    ledgerFingerprint: candidate.ledgerFingerprint,
    migrationSourceSha256: candidate.migrationSourceSha256,
    authorityRpcs: Object.freeze([...candidate.authorityRpcs].sort()),
    requiredFunctions: Object.freeze([...candidate.requiredFunctions].sort())
  });
}

if (args.includes("--help")) {
  process.stdout.write([
    "Usage: node qualify.mjs --evidence FILE --expect-head 40_HEX_COMMIT --phase PHASE [--expect-blocked|--expect-consistent] [--runtime-catalog-postflight FILE]",
    "",
    "Reads only a sanitized, nonsecret evidence file. It never contacts Production,",
    "reads credentials or private mapping identifiers, changes a gate, calls Square,",
    "or provisions infrastructure. Exact private subject mapping is reviewed separately.",
    "A phase is an assertion-consistency check, never proof that hosted work ran.",
    "It never reports activation readiness; use --expect-blocked for the intentionally blocked example or --expect-consistent for a clean assertion candidate.",
    ""
  ].join("\n"));
  process.exit(0);
}

try {
  const evidencePath = path.resolve(value("--evidence"));
  const expectedHead = value("--expect-head");
  const targetPhase = value("--phase");
  const result = qualifyPilotEvidence(contract, loadJson(evidencePath), expectedHead, {
    qualificationSourcesExact: qualificationSourcesExact(expectedHead),
    overlaySourceIncluded: sourceIncluded(contract.database.requiredOverlaySourceCommit, expectedHead),
    sourceCommitsIncluded: {
      sharedBootstrapSourceCommit: sourceIncluded(contract.reviewedProductionRelease.sharedBootstrapSourceCommit, expectedHead),
      callbackEdgeSourceCommit: sourceIncluded(contract.reviewedProductionRelease.callbackEdgeSourceCommit, expectedHead),
      oauthCallbackSourceCommit: sourceIncluded(contract.reviewedProductionRelease.oauthCallbackSourceCommit, expectedHead)
    },
    sourceCommit: qualificationSourceHead(),
    sourceOverlaySha256: sourceOverlaySha256(expectedHead),
    productionRuntimeBaselineSurface: productionRuntimeSurface(expectedHead, BigInt(contract.productionRuntimeSurface.baselineHead)),
    productionRuntimeSurface: productionRuntimeSurface(expectedHead,
      contract.productionRuntimeSurface.runtimeContract.status === "reviewed_runtime_migration"
        ? BigInt(contract.productionRuntimeSurface.runtimeContract.ledgerHead)
        : BigInt(contract.productionRuntimeSurface.baselineHead)),
    // The catalog marker is a separate sanitized readback generated by the
    // read-only verifier. Source CREATE/GRANT text can never substitute for it.
    productionRuntimeCatalogPostflight: sanitizedRuntimeCatalogPostflight(
      args.includes("--runtime-catalog-postflight") ? value("--runtime-catalog-postflight") : null
    ),
    productionNativeProvisioning: productionNativeProvisioningSource(expectedHead)
  }, targetPhase);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const expectedBlocked = args.includes("--expect-blocked");
  const expectedConsistent = args.includes("--expect-consistent");
  if (expectedBlocked === expectedConsistent ||
      (expectedBlocked && (result.activationReadiness || result.findings.length === 0)) ||
      (expectedConsistent && (!result.operatorAssertionsInternallyConsistent || result.activationReadiness))) {
    process.exitCode = 1;
  }
} catch {
  process.stderr.write("pilot qualification input rejected\n");
  process.exitCode = 1;
}
