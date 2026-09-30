/* eslint-disable @typescript-eslint/no-require-imports -- Execute actual TypeScript with synthetic transports/RPCs. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@/lib/supabase/admin') return new Proxy({}, { get() { throw Error('live_database_denied'); } });
  return load.call(this, request, parent, isMain);
};
global.fetch = async () => { throw Error('live_network_denied'); };
const { fetchCompleteQboCdc, QboCdcCoverageError } = require('../services/external-integrations-qbo/src/cdc.ts');
const { executeQboProductionRead } = require('../services/external-integrations-qbo/src/executor.ts');
const { scheduleQboProductionWork, runQboSchedulerMaintenance } = require('../services/external-integrations-qbo/src/scheduler.ts');
const { QboReadOnlyClient } = require('../lib/integrations/provider-runtime/qbo/client.ts');
const { classifyQboProviderError } = require('../lib/integrations/providers/qbo/errors.ts');
const { recoverQboProductionValidation } = require('../services/external-integrations-qbo/src/validation-recovery.ts');
const { contractSha256, externalSourceFingerprint } = require('../lib/integrations/contracts/canonical.ts');
const { minimizeQboSourceRecord } = require('../lib/integrations/providers/qbo/minimizers.ts');
const { parseQboCdcTombstone } = require('../lib/integrations/providers/qbo/tombstones.ts');
const { qboCdcTombstoneToExternalSourceVersion } = require('../lib/integrations/providers/qbo/source-records.ts');
const { externalSourceIdentityFingerprint } = require('../lib/integrations/persistence/identity.ts');
const { validateProductionQboSourceClaim } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');

const clock = new Date('2026-09-29T12:00:00.000Z');
const until = '2026-09-29T11:30:00.000Z', since = '2026-09-29T11:00:00.000Z';
const accessToken = 'synthetic-access-token';
const window = { changedSince: since, until, accessToken, now: () => clock };
const json = body => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`ok ${passed} - ${name}`); }
const coverageError = code => error => error instanceof QboCdcCoverageError && error.code === code;
const provider = { providerKey: 'quickbooks_online', sourceEnvironment: 'production', realmId: 'synthetic-realm' };
const realmFingerprint = contractSha256({ fingerprintPurpose: 'provider_authorized_entity_reference',
  fingerprintVersion: 'provider_authorized_entity_reference_fingerprint_v1', value: provider.realmId });
// Synthetic lifecycle fixtures, verified against Intuit's public docs on 2026-09-29:
// All-state list filter: https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries.html
// Sparse deletion shape: https://static.developer.intuit.com/output_html/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture.html
// Invoice marker and zeros: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/invoice#void-an-invoice
// Payment marker, zero TotalAmt/UnappliedAmt and empty Line: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment#void-a-payment
const deletion = () => ({ Id: '123', status: 'Deleted', domain: 'QBO', MetaData: { LastUpdatedTime: until } });
const invoice = () => ({ Id: '123', SyncToken: '2', MetaData: { CreateTime: since, LastUpdatedTime: until },
  TxnDate: '2026-09-29', CurrencyRef: { value: 'USD' }, TotalAmt: '0.00', Balance: 0, PrivateNote: 'Voided',
  Line: [{ Amount: '0', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { Qty: 0, UnitPrice: '0.00' } }] });

function executorFixture(respond) {
  const calls = [], requests = [], sourceCalls = [];
  const task = { taskId: randomUUID(), workspaceId: randomUUID(), businessEntityId: randomUUID(), connectionId: randomUUID(),
    connectionGeneration: 2, syncRunId: randomUUID(), streamKey: 'qbo_cdc', taskKind: 'incremental', rowVersion: 3,
    controlMetadata: { checkpointId: randomUUID(), mappingId: randomUUID(), pageOrdinal: 0, cursorVersion: 7,
      windowStartAt: since, windowEndAt: until } };
  const input = { task, leaseId: randomUUID(), owner: 'sha256:' + 'a'.repeat(64), accessToken,
    credentialReadEvidenceId: randomUUID(), realmId: provider.realmId, providerTenantReferenceFingerprint: realmFingerprint,
    connectionConfigurationVersion: 1, mappingVersion: 1, now: () => clock,
    transport: { async request(request) { requests.push(request); return json(await respond(new URL(request.url))); } },
    sourceClient: { async rpc(...args) {
      sourceCalls.push(args);
      if (args[0] === 'claim_qbo_production_source_validation_v1') return { data: [], error: null };
      throw Error('unexpected_source_commit');
    } },
    runtimeClient: { async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'record_qbo_provider_result_v2') {
        const command = args.p_command;
        return { data: { providerResultEvidenceId: randomUUID(), credentialReadEvidenceId: command.credentialReadEvidenceId,
          requestOrdinal: command.requestOrdinal, endpointDomain: command.endpointDomain, endpointClass: command.endpointClass,
          providerOutcome: command.providerOutcome, observedAt: clock.toISOString(), idempotent: false }, error: null };
      }
      assert.equal(name, 'complete_qbo_runtime_task_v2');
      return { data: { state: 'succeeded', continuationTaskId: null, continuationCreated: false }, error: null };
    } }
  };
  return { input, calls, requests, sourceCalls };
}

function sourceFixture(fixture) {
  const versions = [], sourceRecordId = randomUUID();
  let state = { state: 'missing' };
  fixture.input.sourceClient = { async rpc(name, args) {
    fixture.sourceCalls.push([name, args]);
    if (name === 'claim_qbo_production_source_validation_v1') return { data: [], error: null };
    assert.equal(args.p_command.taskId, fixture.input.task.taskId);
    assert.equal(args.p_command.mappingId, fixture.input.task.controlMetadata.mappingId);
    assert.equal(args.p_command.leaseId, fixture.input.leaseId);
    if (name === 'read_provider_external_source_record_state_v1') {
      assert.equal(args.p_command.providerRecordType, fixture.input.task.streamKey === 'qbo_payment' ? 'Payment' : 'Invoice');
      assert.equal(args.p_command.providerRecordId, '123');
      return { data: state, error: null };
    }
    assert.equal(name, 'commit_provider_external_source_record_version_v1');
    const version = args.p_command.version;
    versions.push(version);
    state = { state: 'available', sourceRecordId, currentVersionId: version.id, immutableVersion: version.immutableVersion,
      sourceFingerprint: version.sourceFingerprint, validationState: 'pending', changeKind: version.changeKind,
      providerVersionReference: version.source.providerVersionReference, normalizedProjection: version.normalizedProjection };
    return { error: null, data: { sourceRecordId, sourceVersionId: version.id, immutableVersion: version.immutableVersion,
      sourceIdentityFingerprint: args.p_command.sourceIdentityFingerprint, sourceFingerprint: version.sourceFingerprint,
      currentVersionId: version.id, idempotent: false, validationState: 'pending', trust: 'untrusted_external_input' } };
  } };
  return versions;
}

function validateProducedVersion(fixture, pendingVersion) {
  const task = fixture.input.task;
  const result = validateProductionQboSourceClaim({
    sourceVersionId: pendingVersion.id, sourceRecordId: randomUUID(), taskId: task.taskId,
    workspaceId: task.workspaceId, businessEntityId: task.businessEntityId, connectionId: task.connectionId,
    connectionGeneration: task.connectionGeneration, mappingId: task.controlMetadata.mappingId, syncRunId: task.syncRunId,
    streamKey: task.streamKey, sourceIdentityFingerprint: externalSourceIdentityFingerprint(pendingVersion),
    realmFingerprint, claimId: randomUUID(), claimExpiresAt: '2026-09-29T12:06:00.000Z',
    validatedVersionId: randomUUID(), validatedAt: '2026-09-29T12:01:00.000Z', pendingVersion
  });
  assert.equal(result.validatedVersion.validation.state, 'valid');
  assert.equal(result.economicPromotionAllowed, false, 'the DB must still prove no downstream effects');
}

async function main() {
  await test('all four list queries include active and inactive records on every page', async () => {
    for (const recordType of ['Account', 'Customer', 'Vendor', 'Item']) {
      const queries = [];
      const client = new QboReadOnlyClient({ realmId: provider.realmId, providerEnvironment: 'production',
        transport: { async request(request) {
          const query = new URL(request.url).searchParams.get('query'); queries.push(query);
          return json({ QueryResponse: { [recordType]: [{ Id: '1', Active: false }] } });
        } } });
      for (const startPosition of [1, 501]) {
        const page = await client.fetchEntityPage({ recordType, startPosition, maximumResults: 500, accessToken });
        assert.equal(page.records[0].Active, false);
        assert.equal(queries.at(-1), `SELECT * FROM ${recordType} WHERE Active IN (true, false) STARTPOSITION ${startPosition} MAXRESULTS 500`);
      }
      assert.throws(() => minimizeQboSourceRecord({ recordType, provider, raw: { Id: 'bad', Active: 'false' } }));
      const record = minimizeQboSourceRecord({ recordType, provider, raw: { Id: '1', Active: false,
        MetaData: { LastUpdatedTime: until } } });
      assert.equal(record.status, 'inactive'); assert.equal(record.active, false);
    }
  });
  await test('transaction and Preferences queries do not gain a list-only active filter', async () => {
    for (const recordType of ['Invoice', 'Preferences']) {
      const client = new QboReadOnlyClient({ realmId: provider.realmId, providerEnvironment: 'production',
        transport: { async request(request) {
          const query = new URL(request.url).searchParams.get('query');
          assert(!query.includes('Active'));
          if (recordType === 'Invoice') assert(query.includes("WHERE TxnDate >= '2026-09-01' AND TxnDate <= '2026-09-29'"));
          return json({ QueryResponse: {} });
        } } });
      await client.fetchEntityPage({ recordType, accessToken,
        postingWindow: recordType === 'Invoice' ? { startDate: '2026-09-01', endDate: '2026-09-29' } : null });
    }
  });
  await test('documented Invoice void marker and authoritative zeros yield only bounded lifecycle data', async () => {
    for (const note of ['Voided', 'Voided\nprivate-original-note', 'Voided: private-original-note']) {
      const record = minimizeQboSourceRecord({ recordType: 'Invoice', provider, raw: { ...invoice(), PrivateNote: note } });
      assert.equal(record.status, 'voided');
      assert(!JSON.stringify(record).includes('private-original-note'));
      assert(!JSON.stringify(record).includes('PrivateNote'));
    }
  });
  await test('zero alone, free text, non-Invoice markers and contradictory values cannot infer a void', async () => {
    const mutations = [raw => { delete raw.PrivateNote; }, raw => { raw.PrivateNote = 'please mark Voided'; },
      raw => { raw.PrivateNote = 'voided'; }, raw => { raw.PrivateNote = 'Voidedness'; },
      raw => { raw.PrivateNote = 'Voided ' + 'x'.repeat(4000); }, raw => { raw.TotalAmt = '10'; },
      raw => { raw.Balance = '10'; }, raw => { delete raw.Balance; }, raw => { delete raw.Line; },
      raw => { raw.Line[0].Amount = '10'; }, raw => { raw.Line[0].SalesItemLineDetail.Qty = 2; },
      raw => { raw.Line[0].SalesItemLineDetail.UnitPrice = '10'; }, raw => { raw.TxnTaxDetail = { TotalTax: '10' }; },
      raw => { raw.TxnTaxDetail = { TotalTax: 0, TaxLine: [{ Amount: 10 }] }; },
      raw => { raw.Line = [{ Amount: 0, GroupLineDetail: { Quantity: 0, Line: [{ Amount: 10 }] } }]; }];
    for (const mutate of mutations) {
      const raw = invoice(); mutate(raw);
      assert.equal(minimizeQboSourceRecord({ recordType: 'Invoice', provider, raw }).status, 'active');
    }
    assert.equal(minimizeQboSourceRecord({ recordType: 'Bill', provider, raw: invoice() }).status, 'active');
  });
  await test('typed sparse CDC deletion needs no invented transaction amounts or currency', async () => {
    const fixture = executorFixture(() => ({ CDCResponse: [{ QueryResponse: [{ Invoice: [deletion()] }] }] }));
    const versions = sourceFixture(fixture);
    const result = await executeQboProductionRead(fixture.input);
    assert.equal(result.committed, 1);
    const version = versions[0];
    assert.equal(version.changeKind, 'deleted'); assert.equal(version.normalizedProjection, null);
    assert.deepEqual(version.accounting, { basis: 'unknown', currency: null });
    assert.equal(version.temporal.providerUpdatedAt, until); assert.equal(version.temporal.postingDate, null);
    assert.equal(version.source.providerRecordType, 'Invoice'); assert.equal(version.source.providerRecordId, '123');
    assert.equal(version.normalizedSchemaVersion, 'qbo_cdc_tombstone_v1');
    assert.equal(version.sourceFingerprint, externalSourceFingerprint(version));
    validateProducedVersion(fixture, version);
    assert(fixture.calls.find(call => call.name === 'record_qbo_provider_result_v2').args.p_command.endpointDomain === 'cdc');
    assert(fixture.sourceCalls.findIndex(([name]) => name === 'claim_qbo_production_source_validation_v1') >
      fixture.sourceCalls.findIndex(([name]) => name === 'commit_provider_external_source_record_version_v1'));
  });
  await test('replayed deleted/null source state is idempotent even with a later observation time', async () => {
    const fixture = executorFixture(() => ({ CDCResponse: [{ QueryResponse: [{ Invoice: [deletion()] }] }] }));
    const versions = sourceFixture(fixture);
    await executeQboProductionRead(fixture.input);
    fixture.input.now = () => new Date(clock.getTime() + 60_000);
    const second = await executeQboProductionRead(fixture.input);
    assert.equal(second.committed, 0); assert.equal(versions.length, 1);
    assert.equal(versions[0].immutableVersion, 1);
  });
  await test('all malformed CDC tombstones are rejected before any source commit or checkpoint', async () => {
    for (const mutate of [raw => { delete raw.Id; }, raw => { raw.Id = ''; }, raw => { delete raw.MetaData; },
      raw => { raw.MetaData.LastUpdatedTime = 'not-a-date'; }, raw => { raw.domain = 'QBW'; },
      raw => { raw.CurrencyRef = { value: 'USD' }; }, raw => { raw.PrivateNote = 'private-note'; },
      raw => { raw.MetaData.LastUpdatedTime = '2026-09-30T00:00:00Z'; }]) {
      const raw = deletion(); mutate(raw);
      const fixture = executorFixture(() => ({ CDCResponse: [{ QueryResponse: [{ Invoice: [invoice(), raw] }] }] }));
      await assert.rejects(executeQboProductionRead(fixture.input));
      assert.equal(fixture.sourceCalls.length, 0);
      assert(!fixture.calls.some(call => call.name === 'complete_qbo_runtime_task_v2'));
    }
  });
  await test('a CDC tombstone cannot cross the bound realm or bypass native provider evidence', async () => {
    const fixture = executorFixture(() => ({ CDCResponse: [{ QueryResponse: [{ Invoice: [deletion()] }] }] }));
    fixture.input.providerTenantReferenceFingerprint = 'sha256:' + 'c'.repeat(64);
    await assert.rejects(executeQboProductionRead(fixture.input), /binding_mismatch/);
    assert.equal(fixture.sourceCalls.length, 0);
    fixture.input.providerTenantReferenceFingerprint = realmFingerprint;
    fixture.input.runtimeClient = { async rpc() { return { data: null, error: { code: '42501' } }; } };
    await assert.rejects(executeQboProductionRead(fixture.input));
    assert.equal(fixture.sourceCalls.length, 0);
  });
  await test('tombstone conversion enforces exact task, connection, generation, provider and type', async () => {
    const fixture = executorFixture(() => ({}));
    const task = fixture.input.task;
    const tombstone = parseQboCdcTombstone({ raw: deletion(), recordType: 'Invoice', provider,
      evidence: { taskId: task.taskId, connectionId: task.connectionId, connectionGeneration: 2,
        providerResultEvidenceId: randomUUID(), providerRequestFingerprint: 'sha256:' + 'd'.repeat(64) } });
    const input = { context: { workspaceId: task.workspaceId, businessEntityId: task.businessEntityId, connectionId: task.connectionId,
      providerKey: 'quickbooks_online', providerEnvironment: 'production', providerTenantReferenceFingerprint: realmFingerprint,
      connectionConfigurationVersion: 1, mappingVersion: 1 }, taskId: task.taskId, connectionGeneration: 2,
      tombstone, id: randomUUID(), immutableVersion: 1, priorVersionId: null, observedAt: clock.toISOString() };
    assert.equal(qboCdcTombstoneToExternalSourceVersion(input).changeKind, 'deleted');
    for (const mutate of [value => { value.taskId = randomUUID(); }, value => { value.connectionGeneration = 3; },
      value => { value.context.connectionId = randomUUID(); }, value => { value.context.providerEnvironment = 'sandbox'; },
      value => { value.tombstone.recordType = 'ProfitAndLoss'; }, value => { value.tombstone.recordType = 'CompanyInfo'; },
      value => { value.tombstone.evidence.providerResultEvidenceId = null; }, value => { value.tombstone.evidence.connectionGeneration = 0; }]) {
      const changed = structuredClone(input); mutate(changed); assert.throws(() => qboCdcTombstoneToExternalSourceVersion(changed));
    }
    for (const raw of [null, {}, { Id: '123' }, { ...deletion(), status: 'deleted' }, { ...deletion(), status: 'Voided' }]) {
      assert.equal(parseQboCdcTombstone({ raw, recordType: 'Invoice', provider, evidence: tombstone.evidence }), null);
    }
    assert.throws(() => minimizeQboSourceRecord({ raw: deletion(), recordType: 'Invoice', provider }), /requires_cdc_tombstone/);
  });
  await test('the actual Invoice executor commits a voided lifecycle without retaining private text', async () => {
    const fixture = executorFixture(() => ({ QueryResponse: { Invoice: [{ ...invoice(), PrivateNote: 'Voided\nprivate-original-note' }] } }));
    fixture.input.task.streamKey = 'qbo_invoice';
    const versions = sourceFixture(fixture);
    await executeQboProductionRead(fixture.input);
    assert.equal(versions[0].changeKind, 'voided');
    assert.equal(versions[0].normalizedProjection.status, 'voided');
    assert(!JSON.stringify(versions).includes('private-original-note'));
    validateProducedVersion(fixture, versions[0]);
  });
  await test('documented Payment void is typed, private-note-free and effect-free-validation eligible', async () => {
    const raw = { ...invoice(), UnappliedAmt: '0.00', Line: [], PrivateNote: 'Voided\nprivate-payment-note' };
    delete raw.Balance;
    const fixture = executorFixture(() => ({ QueryResponse: { Payment: [raw] } }));
    fixture.input.task.streamKey = 'qbo_payment';
    const versions = sourceFixture(fixture);
    await executeQboProductionRead(fixture.input);
    assert.equal(versions[0].changeKind, 'voided');
    assert.equal(versions[0].normalizedProjection.status, 'voided');
    assert(!JSON.stringify(versions).includes('private-payment-note'));
    validateProducedVersion(fixture, versions[0]);
  });
  await test('Payment zeros or arbitrary notes alone never imply a void', async () => {
    for (const mutate of [raw => { delete raw.PrivateNote; }, raw => { raw.PrivateNote = 'please mark Voided'; },
      raw => { raw.PrivateNote = 'Voidedness'; }, raw => { raw.TotalAmt = '1'; }, raw => { raw.UnappliedAmt = '1'; },
      raw => { delete raw.UnappliedAmt; }, raw => { delete raw.Line; }, raw => { raw.Line = [{ Amount: 0 }]; }]) {
      const raw = { ...invoice(), UnappliedAmt: '0', Line: [] }; mutate(raw);
      assert.equal(minimizeQboSourceRecord({ recordType: 'Payment', provider, raw }).status, 'active');
    }
  });
  await test('validation outages do not skip bounded disconnect finalization', async () => {
    let disconnected = false;
    const result = await runQboSchedulerMaintenance({ validate: async () => { throw Error('synthetic-outage'); },
      disconnect: async () => { disconnected = true; return { disconnectedCount: 0, providerRevokedCount: 0,
        providerUnconfirmedCount: 1, promotionAuthorized: false, modelCallCount: 0 }; } });
    assert(disconnected);
    assert.equal(result.validationFailed, true);
    assert.equal(result.disconnectFailed, false);
    assert.equal(result.disconnect.providerUnconfirmedCount, 1);
  });
  await test('maintenance rejects malformed or authority-expanding broker results', async () => {
    const result = await runQboSchedulerMaintenance({ validate: async () => ({ discoveredTaskCount: 0, validatedCount: 0,
      quarantinedCount: 0, supersededCount: 0, fullPageCount: 0 }), disconnect: async () => ({
        disconnectedCount: 1, providerRevokedCount: 1, providerUnconfirmedCount: 0, promotionAuthorized: true, modelCallCount: 0 }) });
    assert.equal(result.validationFailed, false);
    assert.equal(result.disconnectFailed, true);
  });
  await test('validation recovery is bounded and never equates an empty claim with task completion', async () => {
    const tasks = [randomUUID(), randomUUID()], calls = [];
    const result = await recoverQboProductionValidation({ async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'discover_qbo_production_source_validation_tasks_v1') {
        assert.equal(args.p_maximum_tasks, 2); return { data: tasks, error: null };
      }
      assert.equal(name, 'claim_qbo_production_source_validation_v1');
      assert.equal(args.p_maximum_results, 100);
      assert(tasks.includes(args.p_task_id));
      return { data: [], error: null };
    } }, 2);
    assert.deepEqual(result, { discoveredTaskCount: 2, validatedCount: 0, quarantinedCount: 0, supersededCount: 0, fullPageCount: 0 });
    assert.equal(calls.length, 3);
  });
  await test('validation recovery rejects oversized discovery before draining', async () => {
    let calls = 0;
    await assert.rejects(recoverQboProductionValidation({ async rpc() {
      calls++; return { data: [randomUUID(), randomUUID()], error: null };
    } }, 1), /qbo_validation_discovery_invalid|at most 1/);
    assert.equal(calls, 1);
  });
  await test('429 honors the documented 60-second floor and longer provider hints', async () => {
    for (const value of [undefined, '0', '5', 'bad-header']) {
      const result = classifyQboProviderError({ httpStatus: 429, headers: { 'Retry-After': value } });
      assert.equal(result.retryAfterMs, 60_000);
      assert.equal(result.retryDisposition, 'retry_with_backoff');
    }
    assert.equal(classifyQboProviderError({ httpStatus: 429, headers: { 'Retry-After': '120' } }).retryAfterMs, 120_000);
    assert.equal(classifyQboProviderError({ httpStatus: 503 }).retryAfterMs, null);
  });
  await test('expired CDC coverage fails before any provider request', async () => {
    let count = 0;
    await assert.rejects(fetchCompleteQboCdc({ ...window, changedSince: '2026-08-01T00:00:00.000Z',
      client: { async fetchCdc() { count++; } } }), coverageError('qbo_cdc_lookback_gap'));
    assert.equal(count, 0);
  });
  await test('queue delay is checked against execution time, not scheduled window end', async () => {
    await assert.rejects(fetchCompleteQboCdc({ ...window, changedSince: '2026-08-30T11:45:00.000Z',
      client: { async fetchCdc() { assert.fail('must not truncate the missing interval'); } } }), coverageError('qbo_cdc_lookback_gap'));
  });
  await test('inverted and future windows are rejected', async () => {
    const client = { async fetchCdc() { assert.fail('invalid read'); } };
    await assert.rejects(fetchCompleteQboCdc({ ...window, client, changedSince: until, until: since }), coverageError('qbo_cdc_window_invalid'));
    await assert.rejects(fetchCompleteQboCdc({ ...window, client, until: '2026-09-30T00:00:00.000Z' }), coverageError('qbo_cdc_window_invalid'));
  });
  await test('CDC cap splits entity sets and preserves one lower bound', async () => {
    const calls = [];
    const result = await fetchCompleteQboCdc({ ...window, client: { async fetchCdc(request) {
      calls.push(request);
      return calls.length === 1 ? { observedObjectCount: 1000, records: [] }
        : { observedObjectCount: 1, records: [{ recordType: request.recordTypes[0], raw: {} }] };
    } } });
    assert.equal(result.requestCount, 3);
    assert.equal(result.records.length, 2);
    assert.equal(result.watermarkAt, until);
    assert.deepEqual([...calls[1].recordTypes, ...calls[2].recordTypes], calls[0].recordTypes);
    assert(calls.every(call => call.changedSince === '2026-09-29T10:55:00.000Z'));
    assert(calls.every(call => !('until' in call)), 'CDC does not support an upper-bound parameter');
  });
  await test('single entity cap is a coverage failure', async () => {
    await assert.rejects(fetchCompleteQboCdc({ ...window, client: { async fetchCdc() {
      return { observedObjectCount: 1000, records: [] };
    } } }), coverageError('qbo_cdc_single_entity_cap'));
  });
  await test('coverage is rechecked when time advances between entity partitions', async () => {
    let now = new Date('2026-09-29T11:00:00Z'), calls = 0;
    await assert.rejects(fetchCompleteQboCdc({ ...window, changedSince: '2026-08-30T11:00:00Z', until: now.toISOString(),
      now: () => now, client: { async fetchCdc() {
        calls++; now = new Date(now.getTime() + 1000); return { observedObjectCount: 1000, records: [] };
      } } }), coverageError('qbo_cdc_lookback_gap'));
    assert.equal(calls, 1);
  });
  await test('actual client reads the repeated QueryResponse CDC envelope', async () => {
    const client = new QboReadOnlyClient({ realmId: 'synthetic-realm', providerEnvironment: 'production',
      transport: { async request() { return json({ CDCResponse: [{ QueryResponse: [{ Invoice: [{ Id: '1' }] }, { Customer: [{ Id: '2' }] }] }] }); } } });
    const page = await client.fetchCdc({ recordTypes: ['Invoice', 'Customer'], changedSince: since, accessToken });
    assert.deepEqual(page.records.map(item => item.recordType), ['Invoice', 'Customer']);
  });
  await test('executor cap makes zero source writes and zero checkpoint completions', async () => {
    const fixture = executorFixture(url => {
      const types = url.searchParams.get('entities').split(',');
      const count = types.includes('Invoice') ? 1000 : 1;
      // A malformed first partition deliberately proves no source is parsed or
      // written until every subsequent partition has established coverage.
      return { CDCResponse: [{ QueryResponse: [{ [types[0]]: Array.from({ length: count }, () => ({ Id: 'synthetic' })) }] }] };
    });
    await assert.rejects(executeQboProductionRead(fixture.input), coverageError('qbo_cdc_single_entity_cap'));
    assert.equal(fixture.sourceCalls.length, 0);
    assert(fixture.calls.every(call => call.name === 'record_qbo_provider_result_v2'));
    assert(fixture.requests.length > 1);
  });
  await test('executor gap makes zero provider/source/checkpoint calls', async () => {
    const fixture = executorFixture(() => assert.fail('no request expected'));
    fixture.input.task.controlMetadata.windowStartAt = '2026-08-01T00:00:00Z';
    await assert.rejects(executeQboProductionRead(fixture.input), coverageError('qbo_cdc_lookback_gap'));
    assert.equal(fixture.calls.length + fixture.requests.length + fixture.sourceCalls.length, 0);
  });
  await test('successful CDC advances only to the scheduled boundary and keeps native completion contract', async () => {
    const fixture = executorFixture(() => ({ CDCResponse: [{ QueryResponse: [] }] }));
    const result = await executeQboProductionRead(fixture.input);
    assert.equal(result.cdcRequestCount, 1);
    const { completion, continuation } = fixture.calls.at(-1).args.p_command;
    assert.equal(completion.checkpoint.providerWatermarkAt, until);
    assert.equal(completion.checkpoint.expectedCheckpointVersion, 7);
    assert.equal(completion.checkpoint.cursorVersion, 8);
    assert.equal(completion.connectionGeneration, 2);
    assert.equal(continuation, null);
  });
  await test('nested provider CDC faults never complete a checkpoint', async () => {
    const fixture = executorFixture(() => ({ CDCResponse: [{ QueryResponse: [{ Fault: { Error: [] } }] }] }));
    await assert.rejects(executeQboProductionRead(fixture.input), /qbo_cdc_response_fault/);
    assert(fixture.calls.every(call => call.name === 'record_qbo_provider_result_v2'));
    assert.equal(fixture.sourceCalls.length, 0);
  });
  await test('scheduler shares the batch budget and still settles when initialization fills it', async () => {
    const calls = [], run = { workspaceId: randomUUID(), businessEntityId: randomUUID(), connectionId: randomUUID(),
      connectionGeneration: 2, syncRunId: randomUUID(), taskCount: 24 };
    const result = await scheduleQboProductionWork(1, 'synthetic-schedule', { async rpc(name, args) {
      calls.push({ name, args });
      return { error: null, data: name === 'schedule_qbo_initialization_v2'
        ? { scheduledConnectionCount: 1, scheduledTaskCount: 24, runs: [run] }
        : { scheduledConnectionCount: 0, scheduledTaskCount: 0, settledRunCount: 2, blockedCdcCount: 0, runs: [] } };
    } });
    assert.equal(calls[1].name, 'schedule_qbo_ongoing_v1');
    assert.equal(calls[1].args.p_limit, 0);
    assert.equal(result.settledRunCount, 2);
    assert.equal(result.scheduledTaskCount, 24);
  });
  await test('scheduler rejects inconsistent or failed RPC results', async () => {
    const client = data => ({ async rpc(name) { return { error: null, data: name === 'schedule_qbo_initialization_v2'
      ? { scheduledConnectionCount: 0, scheduledTaskCount: 0, runs: [] } : data }; } });
    await assert.rejects(scheduleQboProductionWork(1, 'synthetic-invalid', client({ scheduledConnectionCount: 1,
      scheduledTaskCount: 1, settledRunCount: 0, blockedCdcCount: 0, runs: [] })), /inconsistent/);
    await assert.rejects(scheduleQboProductionWork(0, 'synthetic-invalid', client({})));
  });
  console.log(`${passed} QBO runtime/scheduler tests passed; all provider and database capabilities synthetic.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
