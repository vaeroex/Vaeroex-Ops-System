/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual-engine worker; synthetic authority and IPC responses, no network. */
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const { usefulSharedReply } = require('./vsi-shared-answer-test-support.cjs');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
// Exercise the actual release gates, independently of the worker's fixture
// overrides. Scoped preview preparation must not turn on ordinary access.
const releaseGates = [
  require('../lib/ai/shared-evidence/runtime-gate.ts').sharedEvidenceRuntimeEnabled,
  require('../lib/ai/shared-evidence/qualitative-policy.ts').qualitativeSynthesisEnabled,
  require('../lib/vsi/failure-accounting-gate.ts').vsiFailureAccountingEnabled,
];
for (const gate of releaseGates) assert.equal(gate(), false);
let calls = 0, complete = false;
const worker = fork(path.join(__dirname, 'vsi-isolated-contract-evaluation.cjs'), ['--fixture-worker', 'qualified-brief', 'qualification_activation'], {
  env: { VAEROEX_SYNTHETIC_EVAL_WORKER: '1' }, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc']
});
const timer = setTimeout(() => finish(new Error('offline_activation_timeout')), 20000);
function finish(error) {
  if (complete) return;
  complete = true; clearTimeout(timer); worker.kill();
  if (error) { console.error(error); process.exitCode = 1; }
  else console.log('Preview activation passed with both global source gates false: actual engine, protected preparation and manifest, two guarded mock dispatches, structured brief rendered and citations retained. Zero external calls.');
}
worker.on('error', finish);
worker.on('exit', () => { if (!complete) finish(new Error('offline_activation_worker_exited')); });
worker.on('message', message => {
  try {
    if (message.type === 'result') {
      assert.equal(message.result.mechanicalPass, true, JSON.stringify(message.result));
      assert.equal(message.result.usage.providerCalls, 2); assert.equal(calls, 2);
      assert.equal(message.result.citations.length, 2);
      assert.match(message.result.answer, /Recommended check \(model draft; not performed\)/);
      finish(); return;
    }
    assert.equal(message.type, 'provider_request'); assert(++calls <= 2);
    assert.equal(message.url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(message.body), payload = JSON.parse(body.input[1].content);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.tools, undefined);
    assert.equal(body.store, false); assert.equal(body.stream, false);
    const planner = body.text.format.name === 'vsi_research_plan_v1';
    if (!planner) assert.equal(body.text.format.name, 'vsi_shared_answer_v2');
    const output = planner ? { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] }
      : usefulSharedReply(payload, 'qualified-brief');
    worker.send({ type: 'provider_response', request: message.request, payload: {
      model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 100, output_tokens: 30 }, output_text: JSON.stringify(output)
    } });
  } catch (error) { finish(error); }
});
