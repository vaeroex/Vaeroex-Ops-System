/* eslint-disable @typescript-eslint/no-require-imports -- Offline RPC mocks with the real accounting normalizer. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./qbo-customer-test-support.cjs').installLoader();
const { contractSha256, canonicalFactFingerprint, externalSourceFingerprint } = require('../lib/integrations/contracts/canonical.ts');
const { externalSourceIdentityFingerprint } = require('../lib/integrations/persistence/identity.ts');
const { minimizeQboSourceRecord } = require('../lib/integrations/providers/qbo/minimizers.ts');
const { qboMinimizedRecordToExternalSourceVersion, qboReportToExternalSourceVersion } = require('../lib/integrations/providers/qbo/source-records.ts');
const { validateProductionQboSourceClaim } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');
const { discoverQboProductionAccountingConnections: discover, applyQboProductionAccountingPage: apply,
  drainQboProductionAccounting: drain } = require('../lib/integrations/persistence/qbo-production-accounting-repository.ts');
const fixtures = require('../lib/integrations/providers/qbo/fixtures/v1.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-30T12:00:00.000Z';
const provider = { ...fixtures.QBO_SYNTHETIC_PROVIDER, sourceEnvironment: 'production' };
const context = { workspaceId: id(1), businessEntityId: id(2), connectionId: id(3),
  realmId: provider.realmId, providerEnvironment: 'production', sourceAuthorityPolicyVersionId: id(4),
  policyEffectiveFrom: '2026-09-29T00:00:00.000Z', accountingBasis: 'accrual', reportingCurrency: 'USD',
  postingDateFrom: '2026-09-01', postingDateThrough: '2026-09-30', revenueAccountRefs: ['401'] };
const sourceContext = { workspaceId: context.workspaceId, businessEntityId: context.businessEntityId,
  connectionId: context.connectionId, providerKey: 'quickbooks_online', providerEnvironment: 'production' };

function validate(pending, n, stream) {
  const result = validateProductionQboSourceClaim({ sourceVersionId: pending.id, sourceRecordId: id(n + 1000), taskId: id(n + 2000),
    workspaceId: context.workspaceId, businessEntityId: context.businessEntityId, connectionId: context.connectionId,
    connectionGeneration: 1, mappingId: id(6), syncRunId: id(7), streamKey: stream,
    sourceIdentityFingerprint: externalSourceIdentityFingerprint(pending),
    realmFingerprint: contractSha256({ fingerprintPurpose: 'provider_authorized_entity_reference',
      fingerprintVersion: 'provider_authorized_entity_reference_fingerprint_v1', value: provider.realmId }),
    claimId: id(n + 3000), claimExpiresAt: '2026-09-30T12:01:00.000Z', validatedVersionId: id(n + 10000), validatedAt: at,
    pendingVersion: pending });
  assert.equal(result.validatedVersion.validation.state, 'valid');
  return result.validatedVersion;
}
function source(type, raw, n) {
  const record = minimizeQboSourceRecord({ recordType: type, raw, provider });
  const pending = qboMinimizedRecordToExternalSourceVersion({ context: sourceContext, record,
    id: id(n), immutableVersion: 1, priorVersionId: null, previousRecord: null,
    observedAt: at, synchronizedAt: at, ingestedAt: at, receivedAt: at });
  return validate(pending, n, type === 'Account' ? 'accounts' : `qbo_${type.toLowerCase()}`);
}
function invoice(n = 300) {
  return source('Invoice', { Id: `fictional-sale-${n}`, SyncToken: '3',
    MetaData: { CreateTime: '2026-09-29T08:00:00Z', LastUpdatedTime: '2026-09-29T08:00:00Z' },
    TxnDate: '2026-09-29', CurrencyRef: { value: 'USD' }, TotalAmt: '100.25', GlobalTaxCalculation: 'NotApplicable',
    Line: [{ Id: '1', Amount: '100.25', DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: '301' }, ItemAccountRef: { value: '401' }, TaxCodeRef: { value: 'NON' } } },
    { Amount: '100.25', DetailType: 'SubTotalLineDetail', SubTotalLineDetail: {} }] }, n);
}
function entry(version = invoice(), n = 1300) {
  return { sourceRecordId: id(n), sourceIdentityFingerprint: externalSourceIdentityFingerprint(version), sourceVersion: version,
    priorSourceVersion: null, priorFacts: [], factHeads: [] };
}
function page(sources = [entry()]) {
  const version = source('Account', { ...structuredClone(fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Account),
    Id: '401', AccountType: 'Income' }, 200);
  const accountSources = [{ sourceRecordId: id(1200), sourceVersionId: version.id,
    sourceFingerprint: version.sourceFingerprint, version }];
  return { authorityId: id(5), connectionGeneration: 1, mappingId: id(6), mappedAt: at, context: structuredClone(context),
    accountContextFingerprint: contractSha256(accountSources), accountSources, sources };
}
const request = { connectionId: context.connectionId, afterSourceId: null, maximumSources: 25, requestId: 'offline-accounting-test' };
function mock(value = page(), options = {}) {
  const calls = [], plans = new Map();
  return { calls, client: { async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'discover_qbo_accounting_connections_v1') return { data: options.connections ?? [context.connectionId], error: null };
    if (name === 'read_qbo_accounting_page_v1') return { data: structuredClone(value), error: null };
    assert.equal(name, 'commit_qbo_accounting_source_v1');
    if (options.commit) return options.commit(args);
    const key = `${args.p_source_version_id}:${args.p_authority_id}:${args.p_account_context_fingerprint}`;
    const semantic = contractSha256({ source: args.p_source_version_id, authority: args.p_authority_id,
      accounts: args.p_account_context_fingerprint, disposition: args.p_disposition, reasons: args.p_reason_codes,
      facts: args.p_facts.map(fact => [fact.factKey, fact.factFingerprint]).sort((a, b) => a[0].localeCompare(b[0])) });
    const old = plans.get(key);
    if (old) { assert.equal(semantic, old.semantic); return { data: { ...old.result, idempotent: true }, error: null }; }
    const prior = value.sources.find(item => item.sourceRecordId === args.p_source_record_id)?.priorFacts ?? [];
    const result = { applicationId: id(5000 + plans.size), factVersionIds: args.p_facts.map(fact =>
      prior.find(oldFact => oldFact.factKey === fact.factKey && oldFact.factFingerprint === fact.factFingerprint)?.id ?? fact.id) };
    plans.set(key, { semantic, result });
    return { data: { ...result, retractedCount: 0, idempotent: false }, error: null };
  } } };
}
const commits = m => m.calls.filter(call => call.name === 'commit_qbo_accounting_source_v1');
function resign(version) { version.sourceFingerprint = externalSourceFingerprint(version); return version; }

test('real mapper admits only the native-authorized partial source and commits once', async () => {
  const value = page(), m = mock(value), result = await apply(request, m.client);
  assert.equal(result.coverage, 'not_assessed'); assert.equal(result.fullPostedRevenue, false);
  assert.equal(result.applications[0].disposition, 'mapped_partial');
  assert.equal(commits(m).length, 1);
  const args = commits(m)[0].args;
  assert.equal(args.p_authority_id, value.authorityId);
  assert.equal(args.p_account_context_fingerprint, contractSha256(value.accountSources));
  assert.equal(args.p_source_record_id, value.sources[0].sourceRecordId);
  assert.equal(args.p_source_version_id, value.sources[0].sourceVersion.id);
  assert.equal(args.p_facts[0].value.amount, '100.25');
  assert.equal(args.p_facts[0].factFingerprint, canonicalFactFingerprint(args.p_facts[0]));
  assert.equal(args.p_facts[0].immutableVersion, 1);
  assert.deepEqual(args.p_facts[0].sources.map(edge => edge.contributionWeight), ['1', '0']);
  assert.equal(JSON.stringify(result).includes(provider.realmId), false);
  assert.equal(JSON.stringify(result).includes('fictional-sale'), false);
});
test('same native snapshot produces identical IDs and payloads; native replay creates no second mutation', async () => {
  const m = mock(), first = await apply(request, m.client), second = await apply({ ...request, requestId: 'replay' }, m.client);
  assert.equal(first.applications[0].idempotent, false); assert.equal(second.applications[0].idempotent, true);
  assert.equal(first.applications[0].applicationId, second.applications[0].applicationId);
  assert.deepEqual(commits(m)[0].args.p_facts, commits(m)[1].args.p_facts);
  assert.equal(second.applications[0].retractedCount, null);
});
test('separate reads with different mapping clocks have the same semantic plan and native replay receipt', async () => {
  const m = mock(), rpc = m.client.rpc; let reads = 0;
  m.client.rpc = async (name, args) => {
    const response = await rpc(name, args);
    if (name === 'read_qbo_accounting_page_v1' && reads++ > 0) response.data.mappedAt = '2026-09-30T12:01:00.000Z';
    return response;
  };
  const first = await apply(request, m.client), second = await apply(request, m.client);
  const a = commits(m)[0].args.p_facts[0], b = commits(m)[1].args.p_facts[0];
  assert.notEqual(a.createdAt, b.createdAt); assert.notEqual(a.decision.decidedAt, b.decision.decidedAt);
  assert.equal(a.id, b.id); assert.equal(a.factFingerprint, b.factFingerprint);
  assert.equal(first.applications[0].applicationId, second.applications[0].applicationId);
  assert.equal(second.applications[0].idempotent, true);
});
test('current tombstone head allocates the next version, never restarts at version one', async () => {
  const baseline = mock(); await apply(request, baseline.client);
  const fact = commits(baseline)[0].args.p_facts[0], value = page();
  value.sources[0].priorSourceVersion = structuredClone(value.sources[0].sourceVersion);
  value.sources[0].factHeads = [{ factKey: fact.factKey, id: id(700), immutableVersion: 5 }];
  const m = mock(value); await apply(request, m.client);
  assert.equal(commits(m)[0].args.p_facts[0].immutableVersion, 6);
  assert.notEqual(commits(m)[0].args.p_facts[0].id, id(700));
});
test('accepted prior fact must be exactly the native head and advances its version', async () => {
  const baseline = mock(); await apply(request, baseline.client);
  const fact = commits(baseline)[0].args.p_facts[0], value = page();
  value.sources[0].priorSourceVersion = structuredClone(value.sources[0].sourceVersion);
  value.sources[0].priorFacts = [fact];
  value.sources[0].factHeads = [{ factKey: fact.factKey, id: fact.id, immutableVersion: fact.immutableVersion }];
  const m = mock(value); await apply(request, m.client);
  assert.equal(commits(m)[0].args.p_facts[0].immutableVersion, 2);
  assert.notEqual(commits(m)[0].args.p_facts[0].id, fact.id);
  value.sources[0].factHeads[0].id = id(799);
  const wrong = mock(value); await assert.rejects(apply(request, wrong.client), /prior_fact_head_binding_denied/);
  assert.equal(commits(wrong).length, 0);
});
for (const mode of ['unrelated account change', 'reconsent']) {
  test(`native unchanged-fact reuse retains only the exact prior head ID for ${mode}`, async () => {
    const baseline = mock(); await apply(request, baseline.client);
    const fact = commits(baseline)[0].args.p_facts[0], value = page(), item = value.sources[0];
    item.priorSourceVersion = structuredClone(item.sourceVersion); item.priorFacts = [fact];
    item.factHeads = [{ factKey: fact.factKey, id: fact.id, immutableVersion: fact.immutableVersion }];
    if (mode === 'unrelated account change') {
      const version = source('Account', { ...structuredClone(fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Account),
        Id: '999', AccountType: 'Expense' }, 201);
      value.accountSources.push({ sourceRecordId: id(1201), sourceVersionId: version.id,
        sourceFingerprint: version.sourceFingerprint, version });
      value.accountContextFingerprint = contractSha256(value.accountSources);
    } else { value.authorityId = id(88); value.context.sourceAuthorityPolicyVersionId = id(89); }
    const m = mock(value), result = await apply(request, m.client), candidate = commits(m)[0].args.p_facts[0];
    assert.notEqual(candidate.id, fact.id); assert.equal(candidate.factFingerprint, fact.factFingerprint);
    assert.deepEqual(result.applications[0].factVersionIds, [fact.id]);
    assert.equal(result.fullPostedRevenue, false);
  });
}
test('same-key old ID with different canonical content cannot satisfy the native result binding', async () => {
  const baseline = mock(); await apply(request, baseline.client);
  const fact = commits(baseline)[0].args.p_facts[0], value = page(), item = value.sources[0];
  item.priorSourceVersion = structuredClone(item.sourceVersion); item.priorFacts = [fact];
  item.factHeads = [{ factKey: fact.factKey, id: fact.id, immutableVersion: fact.immutableVersion }];
  item.sourceVersion.id = id(11100); item.sourceVersion.immutableVersion += 1; item.sourceVersion.priorVersionId = item.priorSourceVersion.id;
  item.sourceVersion.normalizedProjection.amounts.total.amount = '200.5';
  item.sourceVersion.normalizedProjection.lines[0].amount.amount = '200.5';
  resign(item.sourceVersion);
  const m = mock(value, { commit: args => {
    assert.notEqual(args.p_facts[0].factFingerprint, fact.factFingerprint);
    return { data: { applicationId: id(5000), factVersionIds: [fact.id], retractedCount: 1, idempotent: false }, error: null };
  } });
  await assert.rejects(apply(request, m.client), /commit_fact_binding_denied/); assert.equal(commits(m).length, 1);
});
test('a forged old fingerprint cannot authorize unchanged-fact reuse before the first mutation', async () => {
  const baseline = mock(); await apply(request, baseline.client);
  const fact = commits(baseline)[0].args.p_facts[0], value = page(), item = value.sources[0];
  item.priorSourceVersion = structuredClone(item.sourceVersion); item.priorFacts = [{ ...fact, factFingerprint: `sha256:${'0'.repeat(64)}` }];
  item.factHeads = [{ factKey: fact.factKey, id: fact.id, immutableVersion: fact.immutableVersion }];
  const m = mock(value); await assert.rejects(apply(request, m.client), /prior_fact_head_binding_denied/); assert.equal(commits(m).length, 0);
});
for (const kind of ['missing', 'duplicate-key', 'duplicate-id', 'overflow']) {
  test(`missing or malformed native fact heads fail closed: ${kind}`, async () => {
    const value = page(), item = value.sources[0];
    if (kind === 'missing') delete item.factHeads;
    else { item.priorSourceVersion = structuredClone(item.sourceVersion);
      item.factHeads = [{ factKey: 'one', id: id(90), immutableVersion: 1 }];
      if (kind === 'duplicate-key') item.factHeads.push({ factKey: 'one', id: id(91), immutableVersion: 1 });
      if (kind === 'duplicate-id') item.factHeads.push({ factKey: 'two', id: id(90), immutableVersion: 1 });
      if (kind === 'overflow') item.factHeads[0].immutableVersion = Number.MAX_SAFE_INTEGER;
    }
    const m = mock(value); await assert.rejects(apply(request, m.client), /qbo_accounting_/); assert.equal(commits(m).length, 0);
  });
}
for (const field of ['workspaceId', 'businessEntityId', 'connectionId']) {
  test(`cross-${field} source rejected even after recomputing its fingerprint`, async () => {
    const value = page(), item = value.sources[0]; item.sourceVersion[field] = id(999); resign(item.sourceVersion);
    item.sourceIdentityFingerprint = externalSourceIdentityFingerprint(item.sourceVersion);
    const m = mock(value); await assert.rejects(apply(request, m.client), /source_binding_denied/); assert.equal(commits(m).length, 0);
  });
}
test('wrong native connection or source identity cannot be mapped', async () => {
  for (const kind of ['connection', 'source']) {
    const value = page();
    if (kind === 'connection') value.context.connectionId = id(999);
    else value.sources[0].sourceIdentityFingerprint = `sha256:${'0'.repeat(64)}`;
    const m = mock(value); await assert.rejects(apply(request, m.client), /binding_denied|identity_denied/);
    assert.equal(commits(m).length, 0);
  }
});
test('SQL account context hash includes source-record metadata, not just the version list', async () => {
  const value = page(); value.accountContextFingerprint = contractSha256(value.accountSources.map(account => account.version));
  const m = mock(value); await assert.rejects(apply(request, m.client), /account_context_fingerprint_mismatch/); assert.equal(commits(m).length, 0);
});
test('tampered account fingerprint or authorized account classification cannot acquire authority', async () => {
  for (const kind of ['fingerprint', 'scope', 'classification', 'realm', 'version']) {
    const value = page(), account = value.accountSources[0];
    if (kind === 'fingerprint') account.sourceFingerprint = `sha256:${'0'.repeat(64)}`;
    if (kind === 'scope') { account.version.workspaceId = id(99); resign(account.version); account.sourceFingerprint = account.version.sourceFingerprint; }
    if (kind === 'classification') { account.version.normalizedProjection.relationships.AccountType.value = 'Expense';
      resign(account.version); account.sourceFingerprint = account.version.sourceFingerprint; }
    if (kind === 'realm') { account.version.normalizedProjection.provider.realmId = 'another-realm';
      resign(account.version); account.sourceFingerprint = account.version.sourceFingerprint; }
    if (kind === 'version') account.sourceVersionId = id(77);
    value.accountContextFingerprint = contractSha256(value.accountSources);
    const m = mock(value); await assert.rejects(apply(request, m.client), /qbo_accounting_/); assert.equal(commits(m).length, 0);
  }
});
test('old version-only account response cannot bypass context fingerprint parity', async () => {
  const value = page(); value.accountSourceVersions = value.accountSources.map(item => item.version); delete value.accountSources;
  const m = mock(value); await assert.rejects(apply(request, m.client), /page_invalid/); assert.equal(commits(m).length, 0);
});
test('all source and mapper bindings are checked before the first page mutation', async () => {
  const good = entry(), bad = entry(invoice(301), 1301);
  bad.sourceVersion.normalizedProjection.provider.realmId = 'other-realm'; resign(bad.sourceVersion);
  const m = mock(page([good, bad])); await assert.rejects(apply(request, m.client), /mapping_denied/); assert.equal(commits(m).length, 0);
});
test('pending, quarantined, or invalid-version authority cannot become accounting authority', async () => {
  for (const kind of ['pending', 'quarantined', 'validator']) {
    const value = page();
    if (kind === 'validator') value.sources[0].sourceVersion.validation.validatorVersion = 'untrusted_validator';
    else value.sources[0].sourceVersion.validation.state = kind;
    const m = mock(value); await assert.rejects(apply(request, m.client), /source_validation_required/); assert.equal(commits(m).length, 0);
  }
});
test('effective-validation flag cannot authorize an ordinary pending transaction', async () => {
  const value = page(); value.sources[0].effectiveValidationState = 'valid'; value.sources[0].sourceVersion.validation.state = 'pending';
  const m = mock(value); await assert.rejects(apply(request, m.client), /source_validation_required/); assert.equal(commits(m).length, 0);
});
function pendingDeletion(original, schema = 'qbo_cdc_tombstone_v1') {
  const value = structuredClone(original);
  value.id = id(390); value.immutableVersion = original.immutableVersion + 1; value.priorVersionId = original.id;
  value.normalizedSchemaVersion = schema; value.normalizedProjection = null; value.changeKind = 'deleted';
  value.validation = { state: 'pending', validatorVersion: 'qbo_phase_7_contract_validator_v1', issues: [] };
  if (schema === 'qbo_cdc_tombstone_v1') {
    value.temporal.postingDate = null; value.temporal.effectiveAt = null; value.accounting = { basis: 'unknown', currency: null };
  }
  return resign(value);
}
for (const schema of ['qbo_minimizer_v1', 'qbo_minimizer_v2', 'qbo_cdc_tombstone_v1']) {
  test(`native effective-validation signal reaches the real mapper without overlaying the ${schema} deletion`, async () => {
    const original = invoice(), deletion = pendingDeletion(original, schema), value = page([entry(deletion)]);
    value.sources[0].effectiveValidationState = 'valid'; value.sources[0].priorEffectiveValidationState = null;
    const before = JSON.stringify(value), m = mock(value), result = await apply(request, m.client);
    assert.equal(result.applications[0].disposition, 'retraction_required');
    assert.deepEqual(commits(m)[0].args.p_facts, []); assert.equal(commits(m)[0].args.p_source_version_id, deletion.id);
    assert.equal(JSON.stringify(value), before); assert.equal(deletion.validation.state, 'pending');
    delete value.sources[0].effectiveValidationState;
    const missing = mock(value); await assert.rejects(apply(request, missing.client), /source_validation_required/);
    assert.equal(commits(missing).length, 0);
  });
}
test('prior native deletion signal permits restoration at the tombstone head next version', async () => {
  const baseline = mock(); await apply(request, baseline.client);
  const fact = commits(baseline)[0].args.p_facts[0], original = invoice(), deletion = pendingDeletion(original);
  const restored = structuredClone(original); restored.id = id(10400); restored.immutableVersion = deletion.immutableVersion + 1;
  restored.priorVersionId = deletion.id; resign(restored);
  const value = page([entry(restored)]), item = value.sources[0];
  item.priorSourceVersion = deletion; item.priorEffectiveValidationState = 'valid';
  item.factHeads = [{ factKey: fact.factKey, id: id(700), immutableVersion: 5 }];
  const before = JSON.stringify(value), m = mock(value), result = await apply(request, m.client);
  assert.equal(result.applications[0].disposition, 'mapped_partial');
  assert.equal(commits(m)[0].args.p_facts[0].immutableVersion, 6); assert.equal(JSON.stringify(value), before);
  delete item.priorEffectiveValidationState;
  const missing = mock(value); await assert.rejects(apply(request, missing.client), /source_validation_required/);
  assert.equal(commits(missing).length, 0);
});
test('deletion effective signal cannot bypass the real mapper validator or schema checks', async () => {
  for (const kind of ['schema', 'validator', 'errors']) {
    const version = pendingDeletion(invoice()), value = page([entry(version)]);
    if (kind === 'schema') { version.normalizedSchemaVersion = 'untrusted_schema'; resign(version); }
    if (kind === 'validator') version.validation.validatorVersion = 'untrusted_validator';
    if (kind === 'errors') version.validation.issues = [{ code: 'bad_binding', severity: 'error', field: null, detail: 'Synthetic invalid source.' }];
    value.sources[0].effectiveValidationState = 'valid';
    const m = mock(value); await assert.rejects(apply(request, m.client), /mapping_denied/); assert.equal(commits(m).length, 0);
  }
});
test('unsupported economic semantics are committed as review-required, never accepted revenue', async () => {
  const version = invoice(); version.normalizedProjection.accountingEvidence.hasDiscountDetail = true; resign(version);
  const m = mock(page([entry(version)])), result = await apply(request, m.client);
  assert.equal(result.applications[0].disposition, 'review_required'); assert.deepEqual(commits(m)[0].args.p_facts, []);
  assert.equal(result.fullPostedRevenue, false);
});
test('validated reports remain non-additive and never emit a financial candidate', async () => {
  const report = { ...require('./qbo-customer-test-support.cjs').report(), provider, periodEnd: '2026-09-29' };
  const pending = qboReportToExternalSourceVersion({ context: sourceContext, report, id: id(400), immutableVersion: 1,
    priorVersionId: null, observedAt: at, synchronizedAt: at, ingestedAt: at, receivedAt: at });
  const version = validate(pending, 400, 'qbo_profitandloss');
  const m = mock(page([entry(version)])), result = await apply(request, m.client);
  assert.equal(result.applications[0].disposition, 'non_contributing'); assert.deepEqual(commits(m)[0].args.p_facts, []);
});
test('empty native page does not commit or claim complete financial coverage', async () => {
  const m = mock(page([])), result = await apply(request, m.client);
  assert.deepEqual(result.applications, []); assert.equal(result.fullPage, false); assert.equal(result.nextSourceId, null);
  assert.equal(commits(m).length, 0); assert.equal(result.fullPostedRevenue, false);
});
test('one complete source page returns its exact continuation cursor without auto-draining', async () => {
  const m = mock(), result = await apply({ ...request, maximumSources: 1 }, m.client);
  assert.equal(result.fullPage, true); assert.equal(result.nextSourceId, id(1300)); assert.equal(commits(m).length, 1);
});
for (const kind of ['duplicate', 'out-of-order', 'at-cursor', 'too-many']) {
  test(`invalid source pagination fails closed: ${kind}`, async () => {
    const value = page([entry(), entry(invoice(301), 1301)]), args = { ...request };
    if (kind === 'duplicate') value.sources[1].sourceRecordId = value.sources[0].sourceRecordId;
    if (kind === 'out-of-order') value.sources.reverse();
    if (kind === 'at-cursor') args.afterSourceId = value.sources[0].sourceRecordId;
    if (kind === 'too-many') args.maximumSources = 1;
    const m = mock(value); await assert.rejects(apply(args, m.client), /qbo_accounting_/); assert.equal(commits(m).length, 0);
  });
}
test('database denial, CAS conflict, transport error and parse errors are redacted and never retried', async () => {
  for (const code of ['42501', '40001', 'XX000']) {
    const m = mock(page(), { commit: () => ({ data: null, error: { code, message: 'secret-payload-do-not-log' } }) });
    await assert.rejects(apply(request, m.client), error => /^qbo_accounting_(authority_denied|snapshot_stale|rpc_failed)$/.test(error.message));
    assert.equal(commits(m).length, 1);
  }
  const m = mock(page(), { commit: () => { throw new Error('secret-payload-do-not-log'); } });
  await assert.rejects(apply(request, m.client), /^Error: qbo_accounting_rpc_failed$/); assert.equal(commits(m).length, 1);
  const value = page(); value.context.realmId = { secret: 'secret-payload-do-not-log' };
  await assert.rejects(apply(request, mock(value).client), /^Error: qbo_accounting_page_invalid$/);
});
test('commit response cannot substitute fact IDs or unexpected fields and stops later commits', async () => {
  for (const bad of ['wrong-id', 'duplicate', 'extra-field', 'missing-count']) {
    const m = mock(page([entry(), entry(invoice(301), 1301)]), { commit: args => {
      const result = { applicationId: id(5000), factVersionIds: args.p_facts.map(fact => fact.id), idempotent: false, retractedCount: 0 };
      if (bad === 'wrong-id') result.factVersionIds = [id(999)];
      if (bad === 'duplicate') result.factVersionIds.push(result.factVersionIds[0]);
      if (bad === 'extra-field') result.token = 'do-not-expose';
      if (bad === 'missing-count') delete result.retractedCount;
      return { data: result, error: null };
    } });
    await assert.rejects(apply(request, m.client), /qbo_accounting_/); assert.equal(commits(m).length, 1);
  }
});
test('bounded discovery cursor advances over complete pages and wraps only after the scan ends', async () => {
  const m = mock(page([]), { connections: [id(3), id(4)] });
  const first = await discover({ afterConnectionId: id(2), maximumConnections: 2 }, m.client);
  assert.deepEqual(first, { connectionIds: [id(3), id(4)], nextConnectionId: id(4), scanComplete: false });
  assert.deepEqual(m.calls[0].args, { p_after_connection_id: id(2), p_maximum_results: 2 });
  const end = await discover({ afterConnectionId: id(4), maximumConnections: 2 }, mock(page([]), { connections: [] }).client);
  assert.deepEqual(end, { connectionIds: [], nextConnectionId: null, scanComplete: true });
});
test('malformed, duplicate, regressing or excessive connection discovery cannot starve other tenants silently', async () => {
  for (const connections of [[id(3), id(3)], [id(4), id(3)], [id(2)], [id(3), id(4), id(5)], { connectionIds: [id(3)] }]) {
    await assert.rejects(discover({ afterConnectionId: id(2), maximumConnections: 2 }, mock(page([]), { connections }).client), /qbo_accounting_/);
  }
});
test('drain gives each discovered connection one bounded page and returns a persistable cursor', async () => {
  const m = mock(page(), { connections: [context.connectionId] });
  const result = await drain({ afterConnectionId: null, maximumConnections: 1, maximumSourcesPerConnection: 1,
    requestId: 'bounded-drain' }, m.client);
  assert.equal(result.nextConnectionId, context.connectionId); assert.equal(result.scanComplete, false);
  assert.equal(result.connections.length, 1); assert.equal(result.connections[0].fullPage, true);
  assert.deepEqual(m.calls.map(call => call.name), ['discover_qbo_accounting_connections_v1', 'read_qbo_accounting_page_v1', 'commit_qbo_accounting_source_v1']);
  assert.equal(result.coverage, 'not_assessed'); assert.equal(result.fullPostedRevenue, false);
});
test('each bounded cycle revisits lower source IDs; native application filtering, not a permanent source cursor, advances work', async () => {
  const m = mock(page([]));
  await drain({ afterConnectionId: null, maximumConnections: 2, maximumSourcesPerConnection: 25, requestId: 'first' }, m.client);
  await drain({ afterConnectionId: null, maximumConnections: 2, maximumSourcesPerConnection: 25, requestId: 'second' }, m.client);
  assert.deepEqual(m.calls.filter(call => call.name === 'read_qbo_accounting_page_v1').map(call => call.args.p_after_source_id), [null, null]);
});
test('invalid bounds and request IDs are rejected before even discovery', async () => {
  for (const override of [{ maximumConnections: 26 }, { maximumConnections: 0 }, { maximumSourcesPerConnection: 26 },
    { maximumSourcesPerConnection: 0 }, { requestId: '' }, { afterConnectionId: 'not-a-cursor' }]) {
    const m = mock(); await assert.rejects(drain({ afterConnectionId: null, maximumConnections: 25, maximumSourcesPerConnection: 25,
      requestId: 'bounded', ...override }, m.client), /qbo_accounting_/); assert.equal(m.calls.length, 0);
  }
});
test('concurrent distinct sources do not cross-bind facts or native commit identities', async () => {
  const first = mock(page([entry(invoice(300), 1300)])), second = mock(page([entry(invoice(301), 1301)]));
  // Start both mock-only paths before awaiting either; no external services exist in this fixture.
  const left = apply(request, first.client), right = apply(request, second.client);
  await left; await right;
  const a = commits(first)[0].args, b = commits(second)[0].args;
  assert.notEqual(a.p_source_record_id, b.p_source_record_id); assert.notEqual(a.p_source_version_id, b.p_source_version_id);
  assert.notEqual(a.p_facts[0].id, b.p_facts[0].id); assert.notEqual(a.p_facts[0].factKey, b.p_facts[0].factKey);
  assert.equal(a.p_facts[0].sources[0].sourceRecordVersionId, a.p_source_version_id);
  assert.equal(b.p_facts[0].sources[0].sourceRecordVersionId, b.p_source_version_id);
});
