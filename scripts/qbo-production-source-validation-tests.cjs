/* eslint-disable @typescript-eslint/no-require-imports -- Executable TypeScript contract tests. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const { contractSha256, externalSourceFingerprint } = require('../lib/integrations/contracts/canonical.ts');
const { externalSourceIdentityFingerprint } = require('../lib/integrations/persistence/identity.ts');
const { minimizeQboSourceRecord } = require('../lib/integrations/providers/qbo/minimizers.ts');
const { qboMinimizedRecordToExternalSourceVersion, qboReportToExternalSourceVersion } = require('../lib/integrations/providers/qbo/source-records.ts');
const { validateProductionQboSourceClaim } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');
const { validateQboProductionSourcePage, discoverQboProductionValidationTasks } = require('../lib/integrations/persistence/qbo-production-validation-repository.ts');
const { executeQboProductionRead } = require('../services/external-integrations-qbo/src/executor.ts');
const observed = '2026-09-30T00:00:00.000Z';
const realm = 'synthetic-production-realm';
const realmFingerprint = contractSha256({ fingerprintPurpose: 'provider_authorized_entity_reference',
  fingerprintVersion: 'provider_authorized_entity_reference_fingerprint_v1', value: realm });
const provider = { providerKey: 'quickbooks_online', realmId: realm, sourceEnvironment: 'production' };
const masterStreams = { Account: 'accounts', CompanyInfo: 'company_info', Preferences: 'preferences',
  Customer: 'customers_minimized', Vendor: 'vendors_minimized', Item: 'items_minimized' };

function fixture(reportType = null, recordType = 'Invoice') {
  const workspaceId = randomUUID(), businessEntityId = randomUUID(), connectionId = randomUUID();
  const context = { workspaceId, businessEntityId, connectionId, providerKey: 'quickbooks_online', providerEnvironment: 'production',
    providerTenantReferenceFingerprint: realmFingerprint, connectionConfigurationVersion: 1, mappingVersion: 1 };
  const common = { context, id: randomUUID(), immutableVersion: 1, priorVersionId: null,
    observedAt: observed, synchronizedAt: observed, ingestedAt: observed, receivedAt: observed };
  const pending = reportType ? qboReportToExternalSourceVersion({ ...common, report: {
    contractVersion: 'qbo_report_control_observation_v1', provider, reportType, reportBasis: 'accrual', sourceCurrency: 'USD',
    periodStart: reportType.endsWith('AgingSummary') ? null : '2026-09-01', periodEnd: '2026-09-29',
    columns: [{ columnKey: 'total', title: 'Total', type: 'Money' }], rows: [],
    contributionFamily: 'control_observation', additive: false, parserVersion: 'qbo_report_parser_v1'
  } }) : qboMinimizedRecordToExternalSourceVersion({ ...common, previousRecord: null,
    record: minimizeQboSourceRecord({ recordType, provider, raw: { Id: 'synthetic-invoice',
      SyncToken: '1', MetaData: { CreateTime: observed, LastUpdatedTime: observed },
      ...(masterStreams[recordType] ? {} : { TxnDate: '2026-09-29', CurrencyRef: { value: 'USD' }, TotalAmt: '12.50', Line: [] }) } }) });
  return { sourceVersionId: pending.id, sourceRecordId: randomUUID(), taskId: randomUUID(), workspaceId, businessEntityId,
    connectionId, connectionGeneration: 1, mappingId: randomUUID(), syncRunId: randomUUID(),
    streamKey: reportType ? `qbo_${reportType.toLowerCase()}` : masterStreams[recordType] ?? `qbo_${recordType.toLowerCase()}`,
    sourceIdentityFingerprint: externalSourceIdentityFingerprint(pending), realmFingerprint, claimId: randomUUID(),
    claimExpiresAt: '2026-09-30T00:06:00.000Z', validatedVersionId: randomUUID(), validatedAt: '2026-09-30T00:01:00.000Z',
    pendingVersion: pending };
}
function changed(claim, mutate) {
  const value = structuredClone(claim); mutate(value);
  value.pendingVersion.sourceFingerprint = externalSourceFingerprint(value.pendingVersion);
  value.sourceIdentityFingerprint = externalSourceIdentityFingerprint(value.pendingVersion);
  return value;
}
let assertions = 0;
function check(label, fn) { fn(); assertions++; }
function quarantines(claim, code) {
  const result = validateProductionQboSourceClaim(claim);
  assert.equal(result.validatedVersion.validation.state, 'quarantined');
  assert(result.validatedVersion.validation.issues.some(issue => issue.code === code));
  assert.equal(result.economicPromotionAllowed, false);
}

async function main() {
  const invoice = fixture();
  check('valid transaction is display-valid, never economic authority', () => {
    const result = validateProductionQboSourceClaim(invoice);
    assert.equal(result.validatedVersion.validation.state, 'valid');
    assert.equal(result.validatedVersion.validation.validatorVersion, 'qbo_production_source_validator_v1');
    assert.equal(result.validatedVersion.trust, 'untrusted_external_input');
    assert.equal(result.validatedVersion.priorVersionId, invoice.sourceVersionId);
    assert.equal(result.economicPromotionAllowed, false);
    assert.deepEqual(validateProductionQboSourceClaim(invoice), result);
  });
  for (const report of ['ARAgingSummary', 'APAgingSummary', 'ProfitAndLoss', 'BalanceSheet', 'CashFlow', 'TrialBalance']) check(`${report} validated nonadditive`, () => {
    const claim = fixture(report); const result = validateProductionQboSourceClaim(claim);
    assert.equal(result.validatedVersion.validation.state, 'valid');
    assert.equal(result.validatedVersion.normalizedProjection.additive, false);
  });
  for (const recordType of [...Object.keys(masterStreams), 'Invoice', 'SalesReceipt', 'Payment', 'CreditMemo', 'RefundReceipt',
    'Bill', 'BillPayment', 'Purchase', 'VendorCredit', 'Deposit', 'JournalEntry', 'Transfer']) check(`${recordType} canonical mapping validates`, () => {
    const result = validateProductionQboSourceClaim(fixture(null, recordType));
    assert.equal(result.validatedVersion.validation.state, 'valid');
    assert.equal(result.economicPromotionAllowed, false);
  });
  for (const key of ['workspaceId', 'businessEntityId', 'connectionId', 'sourceVersionId']) check(`wrong ${key} denied`, () => {
    assert.throws(() => validateProductionQboSourceClaim({ ...invoice, [key]: randomUUID() }), /binding_denied/);
  });
  for (const key of ['sourceIdentityFingerprint']) check(`wrong ${key} denied`, () => {
    assert.throws(() => validateProductionQboSourceClaim({ ...invoice, [key]: contractSha256('wrong') }), /binding_denied/);
  });
  check('wrong stored source fingerprint denied', () => assert.throws(() => validateProductionQboSourceClaim({ ...invoice,
    pendingVersion: { ...invoice.pendingVersion, sourceFingerprint: contractSha256('wrong') } }), /binding_denied/));
  check('wrong realm quarantines', () => quarantines({ ...invoice, realmFingerprint: contractSha256('wrong') }, 'qbo_realm_binding_mismatch'));
  check('sandbox projection never validates in Production', () => quarantines(changed(invoice, v => {
    v.pendingVersion.normalizedProjection.provider.sourceEnvironment = 'sandbox';
  }), 'qbo_environment_binding_mismatch'));
  check('wrong stream quarantines', () => quarantines({ ...invoice, streamKey: 'qbo_bill' }, 'qbo_stream_binding_mismatch'));
  check('record ID mismatch quarantines', () => quarantines(changed(invoice, v => {
    v.pendingVersion.normalizedProjection.id = 'another-record';
  }), 'qbo_record_identity_mismatch'));
  check('currency mismatch quarantines', () => quarantines(changed(invoice, v => {
    v.pendingVersion.accounting.currency = 'EUR';
  }), 'qbo_metadata_binding_mismatch'));
  check('invalid calendar date quarantines', () => quarantines(changed(invoice, v => {
    v.pendingVersion.temporal.postingDate = '2026-02-30';
  }), 'qbo_source_time_invalid'));
  for (const status of ['inactive', 'voided', 'deleted']) check(`unbound ${status} cannot resurrect economic authority`, () => quarantines(changed(invoice, v => {
    v.pendingVersion.normalizedProjection.status = status;
  }), 'qbo_inactive_source_requires_review'));
  for (const type of ['Account','Customer','Vendor','Item']) check(`${type} inactive reference is display-valid only`, () => {
    const result=validateProductionQboSourceClaim(changed(fixture(null,type),v=>{
      v.pendingVersion.normalizedProjection.active=false;v.pendingVersion.normalizedProjection.status='inactive';
    }));
    assert.equal(result.validatedVersion.validation.state,'valid');assert.equal(result.economicPromotionAllowed,false);
    assert.equal(result.validatedVersion.normalizedProjection.active,false);
  });
  for (const type of ['CompanyInfo','Preferences','Invoice']) check(`${type} Active=false is not the inactive-reference exception`, () =>
    quarantines(changed(fixture(null,type),v=>{v.pendingVersion.normalizedProjection.active=false;
      v.pendingVersion.normalizedProjection.status='inactive';}),'qbo_inactive_source_requires_review'));
  check('bound null deletion is structurally valid, database effects check still required', () => {
    const result=validateProductionQboSourceClaim(changed(invoice, v => {
    v.pendingVersion.changeKind = 'deleted'; v.pendingVersion.normalizedProjection = null;
    }));assert.equal(result.validatedVersion.validation.state,'valid');assert.equal(result.economicPromotionAllowed,false);
  });
  check('sparse typed CDC tombstone needs no fabricated currency or posting date',()=>{
    const result=validateProductionQboSourceClaim(changed(invoice,v=>{
      v.streamKey='qbo_cdc';v.pendingVersion.changeKind='deleted';v.pendingVersion.normalizedProjection=null;
      v.pendingVersion.normalizedSchemaVersion='qbo_cdc_tombstone_v1';
      v.pendingVersion.accounting={basis:'unknown',currency:null};v.pendingVersion.temporal.postingDate=null;
      v.pendingVersion.temporal.effectiveAt=null;
    }));assert.equal(result.validatedVersion.validation.state,'valid');assert.equal(result.economicPromotionAllowed,false);
  });
  check('deletion without provider timestamp stays quarantined',()=>quarantines(changed(invoice,v=>{
    v.pendingVersion.changeKind='deleted';v.pendingVersion.normalizedProjection=null;v.pendingVersion.temporal.providerUpdatedAt=null;
  }),'qbo_deleted_source_requires_review'));
  check('CompanyInfo cannot be a deletable reference',()=>quarantines(changed(fixture(null,'CompanyInfo'),v=>{
    v.pendingVersion.changeKind='deleted';v.pendingVersion.normalizedProjection=null;
  }),'qbo_deleted_source_requires_review'));
  check('explicit bound void validates structurally without economic authority',()=>{
    const result=validateProductionQboSourceClaim(changed(invoice,v=>{
      v.pendingVersion.changeKind='voided';v.pendingVersion.normalizedProjection.status='voided';
    }));assert.equal(result.validatedVersion.validation.state,'valid');assert.equal(result.economicPromotionAllowed,false);
  });
  check('empty properties are not deletion or void evidence',()=>{
    const result=validateProductionQboSourceClaim(changed(invoice,v=>{
      v.pendingVersion.normalizedProjection.amounts={};v.pendingVersion.normalizedProjection.lines=[];
    }));assert.equal(result.validatedVersion.validation.state,'valid');
    assert.equal(result.pendingVersion.changeKind,'created');assert.notEqual(result.validatedVersion.normalizedProjection,null);
    assert.notEqual(result.validatedVersion.normalizedProjection.status,'voided');
  });
  check('explicit zero amounts are not deletion or void evidence',()=>{
    const result=validateProductionQboSourceClaim(changed(invoice,v=>{
      v.pendingVersion.normalizedProjection.amounts={total:{amount:'0',currency:'USD'},balance:{amount:'0',currency:'USD'}};
      v.pendingVersion.normalizedProjection.lines=[];
    }));assert.equal(result.validatedVersion.validation.state,'valid');
    assert.equal(result.pendingVersion.changeKind,'created');assert.notEqual(result.validatedVersion.normalizedProjection,null);
    assert.notEqual(result.validatedVersion.normalizedProjection.status,'voided');
  });
  check('unknown contract quarantines', () => quarantines(changed(invoice, v => {
    v.pendingVersion.normalizedProjection.contractVersion = 'unsupported';
  }), 'qbo_projection_contract_unsupported'));
  check('malformed minimized data quarantines', () => quarantines(changed(invoice, v => {
    v.pendingVersion.normalizedProjection.lines = 'not-an-array';
  }), 'qbo_projection_contract_invalid'));
  check('reports cannot arrive via CDC', () => quarantines({ ...fixture('ARAgingSummary'), streamKey: 'qbo_cdc' }, 'qbo_stream_binding_mismatch'));
  check('pending version remains immutable', () => assert.equal(invoice.pendingVersion.validation.state, 'pending'));
  check('bounded diagnostic contains no business values', () => {
    const result = validateProductionQboSourceClaim(changed(invoice, v => { v.pendingVersion.normalizedProjection.contractVersion = 'unsupported'; }));
    const text = JSON.stringify(result.validatedVersion.validation);
    for (const value of [realm, 'synthetic-invoice', '12.50']) assert(!text.includes(value));
  });
  const claims = Array.from({ length: 101 }, () => fixture());
  for (const claim of claims) claim.taskId = invoice.taskId;
  const committed = new Map(); let pageCalls = 0;
  const mock = { rpc: async (name, args) => {
    if (name === 'claim_qbo_production_source_validation_v1') {
      assert.equal(args.p_task_id, invoice.taskId); pageCalls++;
      return { data: claims.filter(claim => !committed.has(claim.sourceVersionId)).slice(0, args.p_maximum_results), error: null };
    }
    if (name === 'complete_qbo_production_source_validation_v1') {
      const claim = claims.find(item => item.sourceVersionId === args.p_source_version_id);
      assert.equal(args.p_claim_id, claim.claimId); assert.equal(args.p_validated_version.priorVersionId, claim.sourceVersionId);
      const response = { sourceVersionId: claim.sourceVersionId, validatedVersionId: claim.validatedVersionId,
        state: args.p_validated_version.validation.state, idempotent: committed.has(claim.sourceVersionId) };
      committed.set(claim.sourceVersionId, response); return { data: response, error: null };
    }
    if (name === 'discover_qbo_production_source_validation_tasks_v1') return { data: [invoice.taskId], error: null };
    throw Error('unexpected_mutation');
  } };
  const input = { taskId: invoice.taskId, workerFingerprint: contractSha256('worker'), maximumResults: 100, requestId: 'synthetic-validation' };
  const first = await validateQboProductionSourcePage(input, mock), second = await validateQboProductionSourcePage(input, mock);
  check('bounded pagination processes 101 without truncation', () => {
    assert.equal(first.results.length, 100); assert.equal(first.fullPage, true);
    assert.equal(second.results.length, 1); assert.equal(second.fullPage, false); assert.equal(committed.size, 101);
  });
  const replay = await validateQboProductionSourcePage(input, mock);
  check('replay cannot append duplicate validation versions', () => { assert.equal(replay.results.length, 0); assert.equal(committed.size, 101); });
  await assert.rejects(() => validateQboProductionSourcePage({ ...input, maximumResults: 101 }, mock)); assertions++;
  assert.equal(pageCalls, 3);
  const discovered = await discoverQboProductionValidationTasks(mock);
  check('durable task recovery discovery', () => assert.deepEqual(discovered, [invoice.taskId]));
  await assert.rejects(() => validateQboProductionSourcePage(input, { rpc: async () => ({ data: [{ ...invoice, taskId: randomUUID() }], error: null }) }), /task_binding_denied/); assertions++;
  await assert.rejects(() => validateQboProductionSourcePage(input, { rpc: async () => ({ data: null, error: { code: '42501', message: 'sensitive' } }) }), /^Error: qbo_source_validation_denied$/); assertions++;
  await assert.rejects(() => discoverQboProductionValidationTasks({ rpc: async () => ({ data: [randomUUID(),randomUUID()], error: null }) }, 1)); assertions++;
  const wrongResultClient = { rpc: async name => ({ error: null, data: name === 'claim_qbo_production_source_validation_v1'
    ? [invoice] : { sourceVersionId: randomUUID(), validatedVersionId: invoice.validatedVersionId, state: 'valid', idempotent: false } }) };
  await assert.rejects(() => validateQboProductionSourcePage(input, wrongResultClient), /result_binding_denied/); assertions++;

  for (const outcome of ['valid','quarantined','other_claim_owner']) {
    const sample = fixture(), calls = []; let persisted, claimed = false, completed = false;
    const sourceClient = { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'read_provider_external_source_record_state_v1') return { data: { state: 'missing' }, error: null };
      if (name === 'commit_provider_external_source_record_version_v1') {
        persisted = args.p_command.version;
        return { error: null, data: { sourceRecordId: sample.sourceRecordId, sourceVersionId: persisted.id,
          immutableVersion: 1, sourceIdentityFingerprint: args.p_command.sourceIdentityFingerprint,
          sourceFingerprint: persisted.sourceFingerprint, currentVersionId: persisted.id, idempotent: false,
          validationState: 'pending', trust: 'untrusted_external_input' } };
      }
      if (name === 'claim_qbo_production_source_validation_v1') {
        assert(persisted, 'validation must follow durable commit');
        if (outcome === 'other_claim_owner' || claimed) return { data: [], error: null };
        claimed = true;
        return { error: null, data: [{ ...sample, sourceVersionId: persisted.id, pendingVersion: persisted,
          sourceIdentityFingerprint: externalSourceIdentityFingerprint(persisted),
          realmFingerprint: outcome === 'quarantined' ? contractSha256('different-realm') : sample.realmFingerprint }] };
      }
      assert.equal(name, 'complete_qbo_production_source_validation_v1');
      assert.equal(args.p_validated_version.validation.state, outcome);
      return { error: null, data: { sourceVersionId: persisted.id, validatedVersionId: sample.validatedVersionId,
        state: outcome, idempotent: false } };
    } };
    const runtimeClient = { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'record_qbo_provider_result_v2') return { error: null, data: {
        providerResultEvidenceId: randomUUID(), credentialReadEvidenceId: args.p_command.credentialReadEvidenceId,
        requestOrdinal: args.p_command.requestOrdinal, endpointDomain: args.p_command.endpointDomain,
        endpointClass: args.p_command.endpointClass, providerOutcome: args.p_command.providerOutcome,
        observedAt: observed, idempotent: false } };
      assert.equal(name, 'complete_qbo_runtime_task_v2');
      if (outcome === 'other_claim_owner') return { data: null, error: { code: '42501', message: 'validation_incomplete' } };
      completed = true;
      return { error: null, data: { state: 'succeeded', continuationTaskId: null, continuationCreated: false } };
    } };
    const execution = { task: { ...sample, taskKind: 'initial_historical', rowVersion: 3,
      controlMetadata: { checkpointId: randomUUID(), mappingId: sample.mappingId, pageOrdinal: 0, cursorVersion: 0,
        windowStartAt: '2026-09-01T00:00:00Z', windowEndAt: observed } }, leaseId: randomUUID(), owner: input.workerFingerprint,
      accessToken: 'synthetic-access-token', credentialReadEvidenceId: randomUUID(), realmId: realm,
      providerTenantReferenceFingerprint: realmFingerprint, connectionConfigurationVersion: 1, mappingVersion: 1,
      now: () => new Date(observed), sourceClient, runtimeClient,
      transport: { request: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({
        QueryResponse: { Invoice: [{ Id: 'synthetic-invoice', SyncToken: '1', MetaData: { CreateTime: observed, LastUpdatedTime: observed },
          TxnDate: '2026-09-29', CurrencyRef: { value: 'USD' }, TotalAmt: '12.50', Line: [] }] }
      })) }) } };
    if (outcome === 'valid') {
      await executeQboProductionRead(execution);
      assert.equal(completed, true);
      assert(calls.indexOf('complete_qbo_production_source_validation_v1') < calls.indexOf('complete_qbo_runtime_task_v2'));
    } else {
      await assert.rejects(() => executeQboProductionRead(execution));
      assert.equal(completed, false);
      if (outcome === 'quarantined') assert(!calls.includes('complete_qbo_runtime_task_v2'));
    }
    assertions++;
  }
  console.log(JSON.stringify({ suite: 'qbo_production_source_validation', assertions, providerCalls: 0, modelCalls: 0, economicPromotionAllowed: false }));
}
module.exports = { fixture, changed };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
