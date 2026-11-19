/* eslint-disable @typescript-eslint/no-require-imports -- Credential-free release boundary checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const root = path.resolve(__dirname, '..');
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const deploymentHolds = ['main', 'codex/all12-qualified-release', 'codex/vsi-exact-fact-bindings', 'codex/vsi-context-overhead', 'codex/vsi-preparation-diagnostics', 'codex/vsi-all12-harness-qualification', 'codex/vsi-bounded-qualification'];
for (const branch of deploymentHolds) {
  assert.equal(deployment.git.deploymentEnabled[branch], false, 'automatic deployment must remain disabled');
}
const gates = [
  require('../lib/ai/shared-evidence/runtime-gate.ts').sharedEvidenceRuntimeEnabled,
  require('../lib/ai/shared-evidence/qualitative-policy.ts').qualitativeSynthesisEnabled,
  require('../lib/vsi/failure-accounting-gate.ts').vsiFailureAccountingEnabled,
];
for (const gate of gates) assert.equal(gate(), false, 'release qualification does not authorize activation');
console.log(JSON.stringify({ gatesOff: 3, deploymentHolds, modelCalls: 0 }));
