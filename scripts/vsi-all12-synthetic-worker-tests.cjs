/* eslint-disable @typescript-eslint/no-require-imports -- Offline IPC seam tests; no credentials or network. */
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const { cases, syntheticLabel } = require('./vsi-all12-synthetic-cases.cjs');
const { assertMockAnswerMatchesWire } = require('./vsi-all12-synthetic-runner.cjs');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { sharedReply } = require('./vsi-shared-answer-test-support.cjs');
const root = path.resolve(__dirname, '..');
const variedText = 'Confirm the missing record correspondence and reporting scope before acting on this synthetic comparison.';

function replyFor(body, scenario) {
  const request = JSON.parse(body), payload = JSON.parse(request.input[1].content);
  if (request.text.format.name === 'vsi_research_plan_v1') {
    const answer = { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] };
    assertMockAnswerMatchesWire(request, answer);
    return answer;
  }
  assert.equal(request.text.format.name, 'vsi_shared_answer_v2');
  const answer = sharedReply(payload), policy = payload.invoiceReviewOrder || [];
  if (policy.length) answer.observations = answer.observations.filter(o => !policy.some(p => p.ref === o.ref) || policy.some(p => p.ref === o.ref && p.eligible.includes(o.factIndex)));
  const premises = scenario.providers.map(provider => answer.observations.find(o => payload.qualitative_sources.find(s => s.ref === o.ref)?.provider === provider));
  assert(premises.every(Boolean));
  answer.missing_information = [{ kind: 'selected_fact_time_comparison', premises }];
  answer.next_checks = [{ premises, text: variedText }];
  assertMockAnswerMatchesWire(request, answer);
  return answer;
}

async function run(scenario, mode = 'valid') {
  const env = { SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR: process.env.SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR, VAEROEX_ALL12_IPC_WORKER: '1', TZ: 'UTC' };
  if (mode === 'credential_env') env.OPENAI_API_KEY = 'dummy-must-never-be-read-or-reflected';
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'vsi-all12-synthetic-runner.cjs'), ['--ipc-case', scenario.id], { cwd: root, env, execArgv: [], stdio: ['ignore','ignore','ignore','ipc'] });
    const requests = [], retained = [], terminal = [];
    let failure;
    const timer = setTimeout(() => { child.kill(); reject(Error('worker_test_timeout')); }, 30000);
    child.on('error', error => { failure = error; });
    child.on('message', message => {
      try {
        assert.equal(message.protocol, 1); assert.equal(message.caseId, scenario.id);
        if (message.type !== 'provider_request') { assert(['case_result','case_failure'].includes(message.type)); terminal.push(message); return; }
        assert.deepEqual(Object.keys(message).sort(), ['body','caseId','endpoint','protocol','requestId','type']);
        assert.equal(message.endpoint, 'https://api.openai.com/v1/responses');
        assert.equal(message.requestId, requests.length + 1); assert(requests.length < 2);
        assert.equal(typeof message.body, 'string'); assert(!message.body.includes('isolated-mock-no-credential'));
        const body = JSON.parse(message.body); assert.equal(body.store, false); assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.tools, undefined);
        requests.push(message);
        if (mode === 'disconnect') { child.disconnect(); return; }
        if (mode === 'transport_error') { child.send({ type: 'provider_error', protocol: 1, caseId: scenario.id, requestId: message.requestId, category: 'accounting_uncertain' }); return; }
        let output = replyFor(message.body, scenario);
        if (mode === 'clarify' && message.requestId === 1) output = { mode: 'clarify', businessEvidence: true, tier: 'simple', clarification: 'Which reporting period should this synthetic comparison use?', publicTargets: [], objectives: [] };
        if (mode === 'unknown_binding' && message.requestId === 2) output.observations[0].binding = 'f'.repeat(64);
        const payload = { model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 100, output_tokens: 100 }, output_text: mode === 'malformed' && message.requestId === 2 ? '{invalid json' : JSON.stringify(output) };
        retained.push(structuredClone(payload)); // before worker parsing/validation
        child.send({ type: 'provider_response', protocol: 1, caseId: scenario.id, requestId: mode === 'wrong_request' ? message.requestId + 1 : message.requestId, httpStatus: 200, payload });
      } catch (error) { failure = error; child.kill(); }
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (failure) { reject(failure); return; }
      try {
        assert(!JSON.stringify(terminal).includes('dummy-must-never-be-read-or-reflected'));
        if (mode === 'disconnect') { assert.notEqual(code, 0); assert.equal(requests.length, 1); assert.equal(terminal.length, 0); }
        else {
          assert.equal(terminal.length, 1, 'one terminal outcome');
          if (mode === 'valid') {
            assert.equal(code, 0); assert.equal(signal, null); assert.equal(requests.length, 2); assert.equal(retained.length, 2);
            const result = terminal[0].result;
            assert.equal(terminal[0].type, 'case_result'); assert.equal(result.mechanicalPass, true);
            assert(result.actualSQLAdmission && result.exactSaveAndReopen && result.onceAccounting);
            assert.equal(result.networkAttempts, 0); assert.equal(result.responseAdapterCalls, 2); assert.equal(result.modelCalls, null);
            assert.equal(result.manualModelUsefulness, 'PENDING_MANUAL_REVIEW'); assert(result.answer.includes(variedText));
            assert.equal(result.answer.split(syntheticLabel).length - 1, 1);
            assert(result.engineAnswer.includes(variedText));
            assert.equal(result.answer, `${syntheticLabel}\n\n${result.engineAnswer}`);
            assert.deepEqual(result.presentation, { owner: 'isolated_fixture', label: syntheticLabel, engineAnswerUnchanged: true, renderedLabelCount: 1, savedReopenedLabelCount: 1 });
            assert(!result.answer.includes(scenario.mockNextCheck), 'supplied answer is not coerced to the deterministic mock');
            assert.deepEqual(result.admittedProviders, [...scenario.providers].sort());
          } else {
            assert.notEqual(code, 0); assert.equal(terminal[0].type, 'case_failure');
            const expected = { credential_env: 'ipc_protocol_denied', wrong_request: 'ipc_protocol_denied', transport_error: 'accounting_uncertain', clarify: 'planner_clarification', malformed: 'engine_validation_failed', unknown_binding: 'engine_validation_failed' }[mode];
            assert.equal(terminal[0].category, expected);
            assert.equal(requests.length, mode === 'credential_env' ? 0 : ['malformed','unknown_binding'].includes(mode) ? 2 : 1);
            if (mode === 'unknown_binding') assert.equal(terminal[0].diagnostic.contractRule, 'fact_reference');
            if (mode === 'malformed') assert.equal(terminal[0].diagnostic.stage, 'answer_json');
          }
        }
        resolve({ caseId: scenario.id, mode, requests: requests.length, outcome: terminal[0]?.type || 'disconnected', modelCalls: 0 });
      } catch (error) { reject(error); }
    });
  });
}

(async () => {
  const results = [];
  for (const scenario of cases) results.push(await run(scenario));
  for (const mode of ['malformed','unknown_binding','wrong_request','transport_error','credential_env','clarify','disconnect']) results.push(await run(cases[0], mode));
  console.log(JSON.stringify({ result: 'PASS', cases: results.length, modelCalls: 0, networkCalls: 0, mockedIPCOnly: true, realModelQuality: 'UNTESTED', results }));
})().catch(error => { console.error(error); process.exitCode = 1; });
