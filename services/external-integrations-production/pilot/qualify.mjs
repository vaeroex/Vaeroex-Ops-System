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

function value(flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) throw new Error(`missing ${flag}`);
  return args[index + 1];
}

if (args.includes("--help")) {
  process.stdout.write([
    "Usage: node qualify.mjs --evidence FILE --expect-head 40_HEX_COMMIT [--expect-blocked]",
    "",
    "Reads only a sanitized, nonsecret evidence file. It never contacts Production,",
    "reads credentials or private mapping identifiers, changes a gate, calls Square,",
    "or provisions infrastructure. Exact private subject mapping is reviewed separately.",
    "Without --expect-blocked, the command exits nonzero until every sanitized",
    "preflight check passes while all activation gates remain false.",
    ""
  ].join("\n"));
  process.exit(0);
}

try {
  const evidencePath = path.resolve(value("--evidence"));
  const expectedHead = value("--expect-head");
  const result = qualifyPilotEvidence(contract, loadJson(evidencePath), expectedHead, {
    qualificationSourcesExact: qualificationSourcesExact(expectedHead),
    overlaySourceIncluded: sourceIncluded(contract.database.requiredOverlaySourceCommit, expectedHead),
    sourceCommitsIncluded: {
      sharedBootstrapSourceCommit: sourceIncluded(contract.reviewedProductionRelease.sharedBootstrapSourceCommit, expectedHead),
      callbackEdgeSourceCommit: sourceIncluded(contract.reviewedProductionRelease.callbackEdgeSourceCommit, expectedHead),
      oauthCallbackSourceCommit: sourceIncluded(contract.reviewedProductionRelease.oauthCallbackSourceCommit, expectedHead)
    },
    sourceCommit: qualificationSourceHead(),
    sourceOverlaySha256: sourceOverlaySha256(expectedHead)
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const expectedBlocked = args.includes("--expect-blocked");
  if (expectedBlocked ? result.sanitizedPreflightPassed : !result.sanitizedPreflightPassed) {
    process.exitCode = 1;
  }
} catch {
  process.stderr.write("pilot qualification input rejected\n");
  process.exitCode = 1;
}
