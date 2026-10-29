/* eslint-disable @typescript-eslint/no-require-imports -- Credential-free release boundary checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const root = path.resolve(__dirname, '..');
const { assertTemporaryActivation, branch, offBase, offTree } = require('./vsi-temporary-activation-test-support.cjs');
assertTemporaryActivation();
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const deploymentHolds = ['main', 'codex/all12-qualified-release', 'codex/vsi-exact-fact-bindings', 'codex/vsi-context-overhead', 'codex/vsi-preparation-diagnostics', branch];
for (const heldBranch of deploymentHolds) {
  assert.equal(deployment.git.deploymentEnabled[heldBranch], false, 'automatic deployment must remain disabled');
}
const gates = [
  require('../lib/ai/shared-evidence/runtime-gate.ts').sharedEvidenceRuntimeEnabled,
  require('../lib/ai/shared-evidence/qualitative-policy.ts').qualitativeSynthesisEnabled,
  require('../lib/vsi/failure-accounting-gate.ts').vsiFailureAccountingEnabled,
];
for (const gate of gates) assert.equal(gate(), true, 'temporary qualification requires the exact approved three gates');
console.log(JSON.stringify({ temporaryArtifactOnly: true, gatesOn: 3, offBase, offTree, deploymentHolds, modelCalls: 0 }));
