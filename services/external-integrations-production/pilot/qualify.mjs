#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadJson, qualifyPilotEvidence } from "./model.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const contract = loadJson(path.join(directory, "contract.json"));
const args = process.argv.slice(2);

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
    "reads credentials, changes a gate, calls Square, or provisions infrastructure.",
    "Without --expect-blocked, the command exits nonzero until every pre-activation",
    "check passes while all activation gates remain false.",
    ""
  ].join("\n"));
  process.exit(0);
}

try {
  const evidencePath = path.resolve(value("--evidence"));
  const expectedHead = value("--expect-head");
  const result = qualifyPilotEvidence(contract, loadJson(evidencePath), expectedHead);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const expectedBlocked = args.includes("--expect-blocked");
  if (expectedBlocked ? result.readyForOneCustomerActivationReview : !result.readyForOneCustomerActivationReview) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "pilot qualification failed"}\n`);
  process.exitCode = 1;
}
