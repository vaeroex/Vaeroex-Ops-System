/* eslint-disable @typescript-eslint/no-require-imports -- Fixed credential-free synthetic qualification. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { cases, fixtures, syntheticLabel, window } = require('./vsi-all12-synthetic-cases.cjs');

// Test-only provider conformance check. Compile the schema parsed from the
// actual serialized engine request, never a reconstructed/static contract.
// Deliberately invalid variants are checked on clones; do not repair prose or
// move it to next_checks to obtain acceptance. Live responseAdapter output is
// left to the unchanged engine/renderer validation, not this mock assertion.
function assertMockAnswerMatchesWire(body, answer) {
  const path = require('node:path');
  const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
  const validate = new Ajv({ allErrors: true }).compile(body.text.format.schema);
  const original = JSON.stringify(answer);
  assert.equal(validate(answer), true, 'mock_answer_must_satisfy_actual_wire_schema');
  if (body.text.format.name === 'vsi_shared_answer_v2') {
    const payload = JSON.parse(body.input[1].content);
    const business = new Set(payload.qualitative_sources.filter(source => !source.supportOnly).map(source => source.binding));
    const byBinding = new Map(answer.observations.filter(fact => business.has(fact.binding)).map(fact => [fact.binding, fact]));
    assert(byBinding.size >= 2, 'synthetic_case_requires_independent_business_originals');
    const premises = [...byBinding.values()].slice(0, 2);
    const misplaced = structuredClone(answer);
    misplaced.missing_information = [{ premises, text: 'The reporting periods and source record correspondence need clarification.' }];
    assert.equal(validate(misplaced), false, 'cross_original_prose_must_be_rejected_by_actual_wire_schema');
    assert.deepEqual(misplaced.next_checks, answer.next_checks, 'rejection_must_not_rewrite_or_move_prose');
    const singleOriginal = structuredClone(misplaced);
    singleOriginal.missing_information[0].premises = [premises[0]];
    assert.equal(validate(singleOriginal), true, 'single_original_prose_remains_expressible');
    const closedComparison = structuredClone(answer);
    closedComparison.missing_information = [{ kind: 'selected_fact_time_comparison', premises }];
    assert.equal(validate(closedComparison), true, 'closed_cross_original_time_comparison_remains_expressible');
  }
  assert.equal(JSON.stringify(answer), original, 'wire_schema_tests_must_preserve_mock_answer');
}

// This fixture-owned presentation is confined to the isolated evaluator. It is
// not a model instruction, a caller-controlled flag, or production labeling.
// Preserve the engine answer separately so review does not credit the model for
// the evaluator's synthetic disclosure or silently change its factual text.
function presentSyntheticAnswer(engineAnswer) {
  assert(typeof engineAnswer === 'string' && engineAnswer.trim(), 'synthetic_engine_answer_required');
  const occurrences = engineAnswer.split(syntheticLabel).length - 1;
  assert(occurrences <= 1, 'synthetic_label_duplicated');
  if (occurrences === 1) assert(engineAnswer.startsWith(`${syntheticLabel}\n\n`), 'synthetic_label_not_heading');
  const content = occurrences === 1 ? engineAnswer : `${syntheticLabel}\n\n${engineAnswer}`;
  assert.equal(content.split(syntheticLabel).length - 1, 1, 'synthetic_label_required_once');
  return content;
}

// No network mode, endpoint setting, credential reader, provider client or database URL.
// Run each case in a fresh process: the test loader intentionally replaces modules.
async function runCase(caseId, variant = 'present', { responseAdapter } = {}) {
  const scenario = cases.find(item => item.id === caseId);
  assert(scenario, 'unknown_synthetic_case');
  assert(responseAdapter === undefined || typeof responseAdapter === 'function', 'response_adapter_invalid');
  assert(!responseAdapter || variant === 'present', 'response_adapter_present_case_only');
  assert(['present', 'empty_history', 'missing_currency', 'wrong_workspace', 'stale_binding'].includes(variant));
  assert(variant !== 'empty_history' || caseId === 'time-coverage', 'empty_history_case_required');
  assert(variant !== 'missing_currency' || caseId === 'payments-and-operations', 'currency_case_required');
  for (const key of ['OPENAI_API_KEY', 'GOOGLE_SHEETS_OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']) {
    assert(!process.env[key], 'credential_environment_denied');
  }
  const fixture = await import('./vsi-all12-synthetic-db.mjs');
  const { db, metadata: limitations, seedReadableSheetsRows, bindTicketRoots } = await fixture.setupAll12SyntheticDb({ question: scenario.question });
  assert.equal(limitations.fullProductionSchemaAndRls, false);
  const { uuid, w, other, owner, owner2, session, secondSession, entity, conn, login, admin, map } = fixture;
  const ticket = uuid(101), request = uuid(103), providers = scenario.providers;
  // Actual supported default at the fixed fixture clock. Question date wording
  // does not implement arbitrary-range retrieval; fixture observations are Oct1–2.
  const discoveryWindow = { start: '2026-09-28', end: '2026-10-27' };
  const legacyIds = { xero: uuid(730), harvest: conn, clockify: uuid(731), toggl: uuid(732), 'zoho-inventory': uuid(733), katana: uuid(734), loyverse: uuid(740), 'zoho-books': uuid(741), 'wix-orders': uuid(742) };
  const OriginalDate = global.Date, originalFetch = global.fetch, net = require('node:net');
  const originalConnect = net.Socket.prototype.connect;
  let networkAttempts = 0;
  const denyNetwork = () => { networkAttempts++; throw Error('synthetic_network_forbidden'); };
  global.fetch = denyNetwork; net.Socket.prototype.connect = denyNetwork;
  global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-27T12:00:00.000Z'])); } static now() { return OriginalDate.now(); } };
  try {
    await admin(db);
    // Remove baseline fixture originals, not production records. Each case has a
    // fresh in-memory database; no other case's sources may reach its planner.
    await db.exec(`update private.legacy_evidence_bindings set revoked_at=now();
      delete from reporting_history_facts; delete from reporting_history_days; delete from reporting_connections;
      delete from square_customer_private.payments; delete from google_sheets_fact_links;
      delete from google_sheets_source_versions; delete from google_sheets_source_rows; delete from kpis;`);
    const { validateSnapshot } = (() => {
      require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
      return require('../lib/integrations/reporting/adapters.ts');
    })();
    for (const provider of providers.filter(key => ['xero', 'harvest', 'clockify', 'toggl', 'zoho-inventory', 'katana'].includes(key))) {
      const data = fixtures[provider], connection = legacyIds[provider];
      const snapshot = data.snapshot ? validateSnapshot(provider, data.snapshot) : null;
      await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account,snapshot,last_sync_at) values($1,$2,$3,$4,'connected',$5,$6,$7)",
        [connection, w, provider, owner, JSON.stringify({ id: `synthetic-${provider}`, ...(provider === 'clockify' ? { user: 'synthetic-connected-user' } : {}), ...(provider === 'toggl' ? { parent: 'synthetic-organization' } : {}) }), snapshot && JSON.stringify(snapshot), window.observedAt]);
      for (const row of data.records || []) {
        if (variant === 'empty_history' && ['harvest', 'clockify'].includes(provider)) continue;
        await db.query('insert into reporting_history_facts values($1,$2,$3,$4,$5,$6)', [w, provider, connection, row.record_id, row.day, JSON.stringify(row.metrics)]);
      }
      if (data.records) for (const day of ['2026-10-01', '2026-10-02']) await db.query('insert into reporting_history_days values($1,$2,$3,$4,$5,$6,$6)', [w, provider, connection, day, provider === 'xero' ? ['USD'] : [], window.observedAt]);
    }
    if (providers.includes('loyverse')) {
      await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,$5)", [legacyIds.loyverse, w, owner, uuid(750), variant === 'missing_currency' ? null : fixtures.loyverse.currency_code]);
      for (const row of fixtures.loyverse.records) await db.query('insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,created_at,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [w, legacyIds.loyverse, row.receipt_number, row.store_id, row.receipt_date, row.created_at, row.updated_at, row.receipt_type, row.total_money, row.total_tax, row.total_discount, row.cancelled]);
    }
    if (providers.includes('zoho-books')) {
      await db.query("insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,currency_code) values($1,$2,$3,'connected','12345','USD')", [legacyIds['zoho-books'], w, owner]);
      for (const row of fixtures['zoho-books'].records) await db.query('insert into zoho_books_history_facts values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [w, legacyIds['zoho-books'], row.kind, row.source_id, row.day, row.counted, row.currency, row.total, row.outstanding]);
    }
    if (providers.includes('wix-orders')) {
      await db.query("insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash,site_id) values($1,$2,$3,'connected',$4,$5)", [legacyIds['wix-orders'], w, owner, 'a'.repeat(64), uuid(752)]);
      for (const row of fixtures['wix-orders'].records) await db.query('insert into wix_order_facts values($1,$2,$3,$4,$5,$6,$7)', [w, legacyIds['wix-orders'], row.order_id, row.created_at, row.total_amount, row.currency_code, row.payment_status]);
    }
    if (providers.includes('square')) for (const row of fixtures.square.records) await db.query('insert into square_customer_private.payments values($1,$2,$3,$4,$5,$6,$7,$8,$9)', [w, uuid(210), row.payment_id, 'location', row.status, row.created_at, row.updated_at, row.amount_minor, row.currency]);
    if (providers.includes('quickbooks_online')) {
      const p = fixtures.quickbooks_online.projection;
      await db.query("insert into private.integration_connections values($1,$2,$3,'quickbooks_online','production','active',1)", [uuid(720), w, entity]);
      await db.query("insert into private.provider_entity_mappings values($1,$2,$3,$4,'quickbooks_online','production','active',now(),1)", [uuid(721), w, entity, uuid(720)]);
      await db.query("insert into private.external_source_records values($1,$2,$3,$4,$5,'quickbooks_online','provider','active',$6,'Invoice',$7)", [uuid(722), w, entity, uuid(720), uuid(721), uuid(723), p.id]);
      await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection,accounting_currency,accounting_basis,posting_date,observed_at) values($1,$2,$3,$4,$5,'quickbooks_online','provider','Invoice',$6,'valid',$7,'USD','accrual',$8,$9)", [uuid(723), w, entity, uuid(720), uuid(722), p.id, JSON.stringify(p), p.temporal.postingDate, window.observedAt]);
      await db.query("insert into private.qbo_production_source_validation_work values($1,$2,$3,$4,$5,$6,null,'valid')", [w, entity, uuid(720), uuid(721), uuid(722), uuid(723)]);
    }
    if (providers.includes('google_sheets')) for (const [i, row] of fixtures.google_sheets.rows.entries()) {
      const source = uuid(810 + i * 10), version = uuid(811 + i * 10);
      await db.query('insert into google_sheets_source_rows values($1,$2,$3,$4,$5,true)', [source, w, uuid(300), entity, version]);
      await db.query("insert into google_sheets_source_versions values($1,$2,$3,$4,'valid',$5,$6)", [version, w, uuid(300), source, JSON.stringify(row.normalized_projection), `synthetic-row-${i}`]);
      for (const metric of row.normalized_projection.metrics) {
        const kpi = uuid(813 + i * 10 + metric.column);
        await db.query("insert into kpis values($1,$2,$3,$4,$5,'{}',null,null)", [kpi, w, metric.value, row.normalized_projection.date, metric.name]);
        await db.query("insert into google_sheets_fact_links values($1,$2,$3,$4,$5,$6,'accepted',$7)", [w, uuid(300), source, version, uuid(301), kpi, metric.column]);
      }
    }
    await seedReadableSheetsRows(db);
    await login(db);
    for (const provider of providers.filter(key => legacyIds[key])) await map(db, provider, legacyIds[provider]);
    if (variant === 'stale_binding') {
      await admin(db);
      await assert.rejects(db.query("update private.legacy_evidence_bindings set incarnation_hash=$1 where provider=$2 and revoked_at is null", ['f'.repeat(64), providers.find(p => legacyIds[p])]), e => e.code === '42501');
      return { caseId, variant, immutableBindingMutationDenied: true, modelCalls: 0, networkAttempts, limitations };
    }
    const rpcCalls = [], allowed = new Set(['discover_shared_evidence_v1','discover_shared_evidence_v2','preview_shared_legacy_evidence_v1','read_shared_typed_evidence_v1','capture_legacy_evidence_v1','shared_evidence_dependencies_v1','seal_shared_evidence_manifest_v1','validate_shared_evidence_manifest_v1','vsi_mutate_v3','reopen_shared_evidence_target_v1','reopen_shared_evidence_artifact_v1']);
    function client(role, actor = owner, sid = session) {
      return { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }), getClaims: async () => ({ data: { claims: { sub: actor, session_id: sid } }, error: null }) }, rpc: async (name, args) => {
        assert(allowed.has(name)); rpcCalls.push(name); const entries = Object.entries(args); entries.forEach(([key]) => assert(/^p_[a-z_]+$/.test(key)));
        await login(db, actor, sid, role);
        try { return { data: (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) v`, entries.map(([key, value]) => value && typeof value === 'object' && (!Array.isArray(value) || ['p_sources','p_preferences','p_input'].includes(key)) ? JSON.stringify(value) : value))).rows[0].v, error: null }; }
        catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      } };
    }
    const reader = client('authenticated'), service = client('service_role');
    require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {},
      '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => true },
      '@/lib/ai/shared-evidence/qualitative-policy': { qualitativeSynthesisEnabled: () => true },
      './retrieval': { authorizeVsiRead: async () => ({ supabase: reader, workspaceId: w, user: { id: owner }, membership: { role: 'owner' } }), retrieveVsiEvidence: async () => { throw Error('legacy_fallback_denied'); } },
      './product-context': { loadVsiProductContext: async () => ({ authoritative: {}, sources: [], limitations: [syntheticLabel] }) },
      '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async (_reader, id, roots) => { assert.equal(id, ticket); await bindTicketRoots(db, id, roots); return { ticketId: id }; } },
      '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({ Authorization: 'isolated-mock-no-credential' }) },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => service }
    });
    const { prepareSharedGeneration, sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
    if (variant === 'wrong_workspace') {
      await assert.rejects(prepareSharedGeneration(reader, other, discoveryWindow.start, discoveryWindow.end, scenario.question));
      return { caseId, variant, correctlyDenied: true, modelCalls: 0, networkAttempts, limitations };
    }
    const prepared = await prepareSharedGeneration(reader, w, discoveryWindow.start, discoveryWindow.end, scenario.question);
    const admittedProviders = [...new Set(prepared.rows.map(row => row.provider))].sort();
    const expected = variant === 'empty_history' ? providers.filter(p => !['harvest','clockify'].includes(p)) : providers;
    assert.deepEqual(admittedProviders, [...expected].sort(), 'case_provider_coverage');
    if (variant !== 'present') {
      assert(prepared.limitations.length); assert.equal(networkAttempts, 0);
      const moneySuppressed = variant === 'missing_currency' && prepared.rows.filter(r => r.provider === 'loyverse').every(r => r.facts.every(f => f.includes('Monetary comparison is unavailable') && !f.includes('Stored total') && !f.includes(' USD')));
      if (variant === 'missing_currency') assert(moneySuppressed, 'unknown_currency_cannot_license_money');
      return { caseId, variant, admittedProviders, coverage: prepared.coverage, moneySuppressed, limitations: prepared.limitations, platformLimitations: limitations, modelCalls: 0, networkAttempts };
    }
    for (const row of prepared.rows) {
      assert.deepEqual(sharedRow({ identity: row.identity, hash: row.hash, data: row.data }, w).facts, row.facts);
      assert.throws(() => sharedRow({ identity: row.identity, hash: row.hash, data: { ...row.data, workspace_id: other } }, w));
    }
    for (const [provider, patterns] of Object.entries(scenario.expectedFactPatterns)) {
      const text = prepared.rows.filter(row => row.provider === provider).flatMap(row => row.facts).join('\n');
      for (const pattern of patterns) assert(text.includes(pattern), `${provider}: ${pattern}`);
    }
    const engineRequests = [], metrics = [], packing = require('../lib/vsi/answer-context.ts'), actualPack = packing.packVsiAnswerContext;
    packing.packVsiAnswerContext = (...args) => { const before = JSON.stringify(args[0]); const result = actualPack(...args); assert.equal(JSON.stringify(args[0]), before); metrics.push(result.metrics); return result; };
    // Marker exists only in this isolated worker; it is not a credential and can
    // never reach a network socket. The dedicated provider policy stub is used.
    process.env.OPENAI_API_KEY = 'offline-noncredential-marker';
    process.env.VAEROEX_VSI_MAX_INPUT_CHARS = '48000'; process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS = '6000';
    const { runVsiAnswer, VSI_SHARED_SYSTEM_PROMPT } = require('../lib/vsi/engine.ts');
    const { renderSharedAnswer, SHARED_ANSWER_INSTRUCTIONS } = require('../lib/ai/shared-evidence/answer-contract.ts');
    let mockFailure;
    const mockFetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, 'isolated-mock-no-credential');
      const body = JSON.parse(init.body), payload = JSON.parse(body.input[1].content);
      assert.equal(payload.question, scenario.question, 'the planner and answer must receive the reviewed decision question');
      assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.store, false); assert.equal(body.tools, undefined);
      assert(init.body.length <= 48000 && Buffer.byteLength(init.body) <= 192000); assert(engineRequests.length < 2, 'unexpected_internal_call');
      engineRequests.push({ chars: init.body.length, bytes: Buffer.byteLength(init.body), body, payload });
      let answer;
      if (body.text.format.name === 'vsi_research_plan_v1') {
        assert.deepEqual([...payload.sourceDiscovery.sourceTypes].sort(), [...providers].sort());
        answer = { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] };
      } else {
        assert.equal(body.text.format.name, 'vsi_shared_answer_v2');
        assert.equal(body.max_output_tokens, 6000, 'structured references share the existing output ceiling with reasoning');
        assert.equal(body.reasoning.effort, 'medium', 'output sizing must not silently reduce reasoning effort');
        // The shared prompt is intentionally shorter than the legacy prompt.
        // Verify the exact production instructions, not their relative length.
        assert.equal(body.input[0].content, VSI_SHARED_SYSTEM_PROMPT, 'reviewed_shared_prompt_required');
        assert(body.input[0].content.endsWith(`\n\n${SHARED_ANSWER_INSTRUCTIONS}`), 'complete_shared_answer_contract_required');
        assert.deepEqual([...new Set(payload.qualitative_sources.map(s => s.provider))].sort(), [...providers].sort());
        for (const source of payload.qualitative_sources) assert(prepared.rows.some(row => row.hash === source.binding && JSON.stringify(row.facts) === JSON.stringify(source.facts)));
        assert.equal(metrics.at(-1).requestChars, init.body.length); assert.equal(metrics.at(-1).requestBytes, Buffer.byteLength(init.body));
        const { sharedReply } = require('./vsi-shared-answer-test-support.cjs');
        answer = sharedReply(payload);
        // Invoice-focused selection remains the application's exact issued policy.
        const policy = payload.invoiceReviewOrder || [];
        if (policy.length) answer.observations = answer.observations.filter(o => !policy.some(p => p.ref === o.ref) || policy.some(p => p.ref === o.ref && p.eligible.includes(o.factIndex)));
        const premises = providers.map(provider => answer.observations.find(o => payload.qualitative_sources.find(s => s.ref === o.ref)?.provider === provider));
        assert(premises.every(Boolean));
        answer.missing_information = [{ kind: 'selected_fact_time_comparison', premises }];
        answer.next_checks = [{ premises, text: scenario.mockNextCheck }];
        if (!responseAdapter && caseId === 'accounting-and-orders') {
          // Exercise the existing issued financial-stage boundary alongside the
          // new accounting-scope qualification. Never modify supplied model output.
          answer.results = (payload.sharedRelationships || []).filter(result => result.fact.includes('different financial stages')).map(result => result.id);
          assert(answer.results.length > 0, 'issued_financial_stage_boundary_required');
        }
        const context = { sources: payload.qualitative_sources.map(s => ({ ...s, dependencies: [s.binding] })), results: payload.sharedRelationships || [], hypothesesEnabled: true, question: scenario.question };
        // These invalid references are rejected independently of the mock's text.
        assert.throws(() => renderSharedAnswer({ ...answer, observations: [{ ...answer.observations[0], binding: 'f'.repeat(64) }, ...answer.observations.slice(1)] }, context), e => e.rule === 'fact_reference');
        assert.throws(() => renderSharedAnswer({ ...answer, results: ['f'.repeat(64)] }, context), e => e.rule === 'result_reference');
      }
      if (responseAdapter) {
        // Only the synthetic request body crosses the IPC boundary. Headers,
        // database handles and fixture auth claims never reach the coordinator.
        const supplied = await responseAdapter({ caseId, requestId: engineRequests.length, endpoint: url, body: init.body });
        assert.equal(supplied?.httpStatus, 200, 'response_adapter_http_denied');
        const payload = supplied.payload;
        assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'response_adapter_payload_invalid');
        assert.deepEqual(Object.keys(payload).sort(), ['model','output_text','status','usage']);
        assert(/^gpt-6-luna(?:-|$)/.test(payload.model)); assert.equal(payload.status, 'completed');
        assert(typeof payload.output_text === 'string' && payload.output_text.length > 0 && payload.output_text.length <= 200000);
        assert(!/\b(?:Bearer\s+\S+|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(payload.output_text), 'response_adapter_secret_shape_denied');
        assert(payload.usage && typeof payload.usage === 'object' && !Array.isArray(payload.usage));
        assert.deepEqual(Object.keys(payload.usage).sort(), ['input_tokens','output_tokens']);
        assert(Number.isSafeInteger(payload.usage.input_tokens) && payload.usage.input_tokens >= 0 && payload.usage.input_tokens <= 192000);
        assert(Number.isSafeInteger(payload.usage.output_tokens) && payload.usage.output_tokens >= 0 && payload.usage.output_tokens <= body.max_output_tokens);
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      assertMockAnswerMatchesWire(body, answer);
      return new Response(JSON.stringify({ model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 100, output_tokens: 100 }, output_text: JSON.stringify(answer) }), { status: 200 });
    };
    global.fetch = (...args) => mockFetch(...args).catch(error => { mockFailure = error; throw error; });
    let answer;
    try { answer = await runVsiAnswer({ supabase: reader, workspaceId: w, actorUserId: owner, readTicket: { ticketId: ticket }, question: scenario.question, recentMessages: [], requestId: uuid(104), reservedRequest: { id: request, attempt: 1 } }); }
    catch (error) { throw mockFailure || error; }
    finally { global.fetch = denyNetwork; packing.packVsiAnswerContext = actualPack; delete process.env.OPENAI_API_KEY; }
    if (responseAdapter && engineRequests.length === 1) throw Object.assign(Error('planner_clarification'), { safeCategory: 'planner_clarification' });
    assert.equal(engineRequests.length, 2); assert.equal(answer.usage.retries, 0); assert.equal(answer.usage.providerCalls, 2);
    assert.match(answer.content, /Application date check/);
    if (!responseAdapter) assert(answer.content.includes(scenario.mockNextCheck));
    const engineAnswer = answer.content, presentedAnswer = presentSyntheticAnswer(engineAnswer);
    const presentation = { owner: 'isolated_fixture', label: syntheticLabel, engineAnswerUnchanged: true, renderedLabelCount: presentedAnswer.split(syntheticLabel).length - 1 };
    const assertAccountingScope = text => {
      const lines = text.split('\n\n').filter(line => line.startsWith('Accounting scope check (application-owned):'));
      if (caseId !== 'accounting-and-orders') { assert.equal(lines.length, 0, 'unrelated_case_accounting_warning'); return; }
      assert.equal(lines.length, 1, 'accounting_scope_qualification_required_once');
      for (const label of ['QuickBooks Online', 'Xero', 'Zoho Books']) assert(lines[0].includes(label));
      assert(lines[0].includes('may overlap or differ in coverage and accounting basis; duplication is not established'));
      assert(lines[0].includes('do not establish a combined revenue or receivables total'));
      const observedRefs = [...new Set([...text.matchAll(/^Stored observation — (?:quickbooks online|xero|zoho books): .*?\[([BWP]\d+)\]$/gm)].map(match => match[1]))].sort();
      assert(observedRefs.length >= 3, 'selected_accounting_originals_required');
      assert.deepEqual([...new Set([...lines[0].matchAll(/\[([BWP]\d+)\]/g)].map(match => match[1]))].sort(), observedRefs, 'accounting_scope_cites_only_selected_accounting_originals');
      if (!responseAdapter) {
        assert(text.includes('different financial stages, so their amounts must not be added'), 'existing_financial_stage_boundary_preserved');
        assert(/Stored observation — zoho books: .*outstanding: 0 USD/.test(text), 'valid_zero_balance_preserved');
      }
    };
    assertAccountingScope(engineAnswer); assertAccountingScope(presentedAnswer);
    const { settleGeneratedVsi } = require('../lib/vsi/storage.ts'), { reopenSharedCitation } = require('../lib/ai/shared-evidence/citation-reopen.ts');
    await settleGeneratedVsi({ supabase: reader, workspaceId: w, userId: owner, sessionId: session }, { id: request, conversationId: uuid(102), attempt: 1, readTicketId: ticket, question: scenario.question, answer: presentedAnswer, summary: syntheticLabel, citations: answer.citations, usage: answer.usage }, answer.sharedManifestId);
    const reopened = await reopenSharedCitation(reader, { workspaceId: w, kind: 'vsi_exchange', id: request });
    assert.deepEqual([...new Set(reopened.map(row => row.provider))].sort(), [...providers].sort());
    for (const source of engineRequests.at(-1).payload.qualitative_sources) assert(reopened.some(row => row.hash === source.binding && row.provider === source.provider));
    await admin(db);
    const saved = (await db.query('select answer,citations from vsi_exchanges where id=$1', [request])).rows[0];
    // This row is read after the actual protected provenance reopen above. The
    // minimal fixture does not claim full production browser/RLS qualification.
    assert.equal(saved.answer, presentedAnswer); assert.deepEqual(saved.citations, answer.citations);
    assert.equal(saved.answer.split(syntheticLabel).length - 1, 1, 'saved_reopened_synthetic_label_required_once');
    assert.equal(answer.content, engineAnswer, 'engine_answer_must_remain_unchanged');
    presentation.savedReopenedLabelCount = saved.answer.split(syntheticLabel).length - 1;
    assertAccountingScope(saved.answer);
    assert.equal((await db.query('select count(*)::int n from vsi_cost_events where request_id=$1', [request])).rows[0].n, 1);
    await assert.rejects(reopenSharedCitation(reader, { workspaceId: other, kind: 'vsi_exchange', id: request }));
    await assert.rejects(reopenSharedCitation(client('authenticated', owner2, secondSession), { workspaceId: w, kind: 'vsi_exchange', id: request }));
    for (const provider of providers) {
      await admin(db); await db.exec('begin');
      try {
        if (legacyIds[provider]) await db.query('update private.legacy_evidence_bindings set revoked_at=now() where provider=$1 and revoked_at is null', [provider]);
        else if (provider === 'square') await db.exec("update square_customer_private.connections set state='disconnected'");
        else if (provider === 'google_sheets') await db.exec("update google_sheets_connections set status='disconnected'");
        else await db.exec("update private.integration_connections set status='inactive'");
        await assert.rejects(reopenSharedCitation(reader, { workspaceId: w, kind: 'vsi_exchange', id: request }), undefined, `${provider}_revocation`);
      } finally { await db.exec('rollback'); await admin(db); }
    }
    assert.equal(networkAttempts, 0);
    return { caseId, variant, mechanicalPass: true, syntheticLabel, admittedProviders, discoveryWindow, fixtureObservationWindow: window, questionHash: crypto.createHash('sha256').update(scenario.question).digest('hex'),
      requestSizes: engineRequests.map(({ chars, bytes }) => ({ chars, bytes })), deterministicTransportCalls: responseAdapter ? 0 : 2,
      responseAdapterCalls: responseAdapter ? 2 : 0, modelCalls: responseAdapter ? null : 0, providerCalls: responseAdapter ? answer.usage.providerCalls : 0, networkAttempts,
      usage: responseAdapter ? { providerCalls: answer.usage.providerCalls, retries: answer.usage.retries, estimatedCostUsd: answer.usage.estimatedCostUsd } : undefined,
      actualSQLAdmission: true, actualEngine: true, exactSaveAndReopen: true, onceAccounting: true, revokedProvidersDenied: providers.length,
      answer: presentedAnswer, engineAnswer, presentation, citations: answer.citations, requiredUsefulness: scenario.requiredUsefulness,
      manualModelUsefulness: responseAdapter ? 'PENDING_MANUAL_REVIEW' : 'NOT_TESTED_MOCK_OUTPUT', unsupportedNarrativeCanStillPass: true, limitations };
  } finally { global.Date = OriginalDate; global.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; delete process.env.OPENAI_API_KEY; await db.close(); }
}

const workerCategories = new Set(['worker_failed','worker_timeout','ipc_protocol_denied','parent_disconnected','request_timeout',
  'request_denied','transport_failed','http_denied','response_invalid','accounting_uncertain','session_stopped','planner_clarification']);
function safeFailure(error) {
  const diagnostic = error?.usage?.validationFailure;
  const result = { category: workerCategories.has(error?.safeCategory) ? error.safeCategory : diagnostic ? 'engine_validation_failed' : 'worker_failed' };
  const stages = ['answer_json','answer_schema','shared_relationships','qualitative_interpretation','shared_answer_contract','answer_request_contract','planner_clarification','citation_resolution','public_source_coverage'];
  const reasons = ['shared_answer_contract_denied','schema_invalid','malformed_json','unknown_citation','unverified_url','financial_input_missing','uncomposed_interpretation','web_source_missing','unclassified'];
  if (diagnostic && stages.includes(diagnostic.stage) && ['output_validation','citation_validation'].includes(diagnostic.category) && reasons.includes(diagnostic.reason)) {
    result.diagnostic = { stage: diagnostic.stage, category: diagnostic.category, reason: diagnostic.reason };
    const rules = ['context_reference','fact_reference','duplicate_fact','invoice_selection','source_coverage','result_reference','result_dependencies','draft_support','draft_format','numeric_draft','hypothesis_disabled','independent_sources','temporal_assessment_required','environment','answer_bounds'];
    if (rules.includes(diagnostic.contractRule)) result.diagnostic.contractRule = diagnostic.contractRule;
    const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 999) : 0;
    if (diagnostic.coverage) result.diagnostic.coverage = Object.fromEntries(['availableReferences','observedReferences','requiredGroups','missingGroups'].map(key => [key,safeCount(diagnostic.coverage[key])]));
    if (['unknown_ref','binding_mismatch','fact_index_out_of_bounds','source_dependencies_missing'].includes(diagnostic.factReference?.reason)) result.diagnostic.factReference = { reason: diagnostic.factReference.reason };
    if (['invalid_issued_id','duplicate_issued_id','duplicate_selected_id','unknown_selected_id'].includes(diagnostic.resultReference?.reason)) result.diagnostic.resultReference = { reason: diagnostic.resultReference.reason, issuedCount: safeCount(diagnostic.resultReference.issuedCount), selectedCount: safeCount(diagnostic.resultReference.selectedCount) };
  }
  return result;
}

async function ipcWorker(caseId) {
  assert.equal(process.env.VAEROEX_ALL12_IPC_WORKER, '1', 'explicit_ipc_worker_required');
  assert.equal(typeof process.send, 'function', 'ipc_channel_required');
  assert(cases.some(test => test.id === caseId), 'fixed_case_required');
  // macOS injects this locale hint even into an explicitly empty child env.
  // Discard it without reading its value; it is not an evaluator input.
  delete process.env.__CF_USER_TEXT_ENCODING;
  for (const key of Object.keys(process.env)) assert(['VAEROEX_ALL12_IPC_WORKER','SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR','TZ'].includes(key), 'sanitized_worker_environment_required');
  assert(process.env.TZ === undefined || process.env.TZ === 'UTC');
  let pending, calls = 0, closed = false, finished = false;
  const error = category => Object.assign(Error(category), { safeCategory: category });
  const abort = category => { closed = true; if (pending) { clearTimeout(pending.timer); pending.reject(error(category)); pending = undefined; } };
  const send = message => new Promise((resolve, reject) => process.send(message, failure => failure ? reject(error('parent_disconnected')) : resolve()));
  const onMessage = message => {
    if (finished) return;
    try {
      assert(message && typeof message === 'object' && !Array.isArray(message));
      assert(pending, 'pending_response_required');
      assert.equal(message.protocol, 1); assert.equal(message.caseId, caseId); assert.equal(message.requestId, pending.requestId);
      if (message.type === 'provider_error') {
        assert.deepEqual(Object.keys(message).sort(), ['caseId','category','protocol','requestId','type']);
        assert(workerCategories.has(message.category)); abort(message.category); return;
      }
      assert.equal(message.type, 'provider_response');
      assert.deepEqual(Object.keys(message).sort(), ['caseId','httpStatus','payload','protocol','requestId','type']);
      const next = pending; pending = undefined; clearTimeout(next.timer);
      next.resolve({ httpStatus: message.httpStatus, payload: message.payload });
    } catch { abort('ipc_protocol_denied'); }
  };
  const onDisconnect = () => { abort('parent_disconnected'); if (!finished) process.exitCode = 1; };
  process.on('message', onMessage); process.on('disconnect', onDisconnect);
  const deadline = setTimeout(() => {
    abort('worker_timeout');
    if (!finished) { finished = true; if (process.connected) process.send({ type: 'case_failure', protocol: 1, caseId, category: 'worker_timeout' }, () => process.exit(1)); else process.exit(1); }
  }, 240000);
  try {
    const result = await runCase(caseId, 'present', { responseAdapter: async request => {
      assert(!closed && !pending && calls < 2, 'bounded_serial_ipc_required');
      calls++; assert.equal(request.requestId, calls);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => abort('request_timeout'), 90000);
        pending = { requestId: calls, resolve, reject, timer };
        send({ type: 'provider_request', protocol: 1, ...request }).catch(() => abort('parent_disconnected'));
      });
    } });
    assert(!closed && !pending && calls === 2);
    finished = true;
    await send({ type: 'case_result', protocol: 1, caseId, result });
  } catch (failure) {
    process.exitCode = 1;
    if (!finished) {
      finished = true;
      if (process.connected) await send({ type: 'case_failure', protocol: 1, caseId, ...safeFailure(failure) });
    }
  } finally {
    clearTimeout(deadline); abort('session_stopped');
    process.removeListener('message', onMessage); process.removeListener('disconnect', onDisconnect);
    if (process.connected) process.disconnect();
  }
}

if (require.main === module) {
  if (process.argv[2] === '--ipc-case' && process.argv.length === 4) {
    ipcWorker(process.argv[3]).catch(() => { if (process.connected) process.send({ type: 'case_failure', protocol: 1, caseId: cases.some(test => test.id === process.argv[3]) ? process.argv[3] : 'invalid', category: 'ipc_protocol_denied' }, () => process.disconnect()); process.exitCode = 1; });
  } else {
    assert.equal(process.argv[2], '--case', 'only_offline_case_mode');
    runCase(process.argv[3], process.argv[4] || 'present').then(result => console.log('SYNTHETIC_RESULT ' + JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
  }
}
module.exports = { runCase, presentSyntheticAnswer, assertMockAnswerMatchesWire };
