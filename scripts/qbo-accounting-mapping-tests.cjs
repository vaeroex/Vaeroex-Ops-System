/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic provider mapping tests. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./qbo-customer-test-support.cjs').installLoader();
const { minimizeQboSourceRecord } = require('../lib/integrations/providers/qbo/minimizers.ts');
const { qboMinimizedRecordToExternalSourceVersion, qboReportToExternalSourceVersion } = require('../lib/integrations/providers/qbo/source-records.ts');
const { externalSourceFingerprint, contractSha256 } = require('../lib/integrations/contracts/canonical.ts');
const { externalSourceIdentityFingerprint } = require('../lib/integrations/persistence/identity.ts');
const { deriveQboRevenueMappingAuthority, mapValidatedQboRevenueSource, mapValidatedQboProfitAndLossControl } = require('../lib/integrations/provider-runtime/qbo/canonical-mapping.ts');
const { mapProductionQboAccountingSource } = require('../lib/integrations/provider-runtime/qbo/production-canonical-mapping.ts');
const { validateProductionQboSourceClaim } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');
const fixtures = require('../lib/integrations/providers/qbo/fixtures/v1.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-30T12:00:00.000Z';
const provider = { ...fixtures.QBO_SYNTHETIC_PROVIDER, sourceEnvironment: 'sandbox' };
const context = { workspaceId: id(1), businessEntityId: id(2), connectionId: id(3), providerKey: 'quickbooks_online', providerEnvironment: 'sandbox' };
function source(type, raw, n, scope = {}) {
  const record = minimizeQboSourceRecord({ recordType: type, raw, provider });
  const pending = qboMinimizedRecordToExternalSourceVersion({ context: { ...context, ...scope }, record,
    id: id(n), immutableVersion: 1, priorVersionId: null, previousRecord: null,
    observedAt: at, synchronizedAt: at, ingestedAt: at, receivedAt: at });
  // Synthetic already-validated source, never an RPC or live authority claim.
  const valid = { ...pending, validation: { state: 'valid', validatorVersion: 'synthetic_validator_v1', issues: [] } };
  return { ...valid, sourceFingerprint: externalSourceFingerprint(valid) };
}
function masters(scope = {}) {
  return [source('Account', fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Account, 10, scope),
    source('Item', fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Item, 11, scope)];
}
function authority(versions = masters()) {
  return deriveQboRevenueMappingAuthority({ sourceVersions: versions, expectedRealmId: provider.realmId, providerEnvironment: 'sandbox' });
}
function invoice(modify = () => {}) {
  const raw = structuredClone(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice);
  modify(raw);
  return source('Invoice', raw, 20);
}
function map(version = invoice(), revenueAuthority = authority(), overrides = {}) {
  return mapValidatedQboRevenueSource({ sourceVersion: version, sourceIdentityFingerprint: externalSourceIdentityFingerprint(version),
    reportingCurrency: 'USD', accountingBasis: 'accrual', revenueAuthority, mappedAt: at,
    identityForFact: (_, ordinal) => ({ id: id(30 + ordinal), immutableVersion: 1, priorVersionId: null }),
    representationIdForFact: (_, ordinal) => id(40 + ordinal), ...overrides });
}
test('unchanged synthetic supported sales detail retains its value and immutable provenance', () => {
  const version = invoice(), result = map(version);
  assert.equal(result.disposition, 'mapped');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].fact.value.amount, '1250');
  assert.equal(result.candidates[0].fact.sources[0].sourceRecordVersionId, version.id);
});
test('transaction ItemAccountRef is retained and overrides an income item default', () => {
  const version = invoice(raw => { delete raw.Line[0].SalesItemLineDetail.AccountRef;
    raw.Line[0].SalesItemLineDetail.ItemAccountRef = { value: 'non-income-override' }; });
  assert.equal(version.normalizedProjection.lines[0].accountRef.value, 'non-income-override');
  assert.equal(map(version).disposition, 'quarantined');
});
test('explicit income account override remains eligible with an ItemRef', () => {
  assert.equal(map(invoice(raw => { raw.Line[0].SalesItemLineDetail.ItemAccountRef = { value: '401' }; })).disposition, 'mapped');
});
test('conflicting explicit account references fail closed during minimization', () => {
  assert.throws(() => invoice(raw => { raw.Line[0].SalesItemLineDetail.ItemAccountRef = { value: '401' };
    raw.Line[0].SalesItemLineDetail.AccountRef = { value: 'different-account' }; }));
});
test('document-only sales lines without an ItemRef cannot become revenue', () => {
  assert.equal(map(invoice(raw => { delete raw.Line[0].SalesItemLineDetail.ItemRef;
    raw.Line[0].SalesItemLineDetail.ItemAccountRef = { value: '401' }; })).disposition, 'quarantined');
});
test('duplicate line IDs cannot bypass unsupported-economic-line detection or duplicate facts', () => {
  const version = invoice(raw => { raw.Line.push({ Id: raw.Line[0].Id, DetailType: 'DiscountLineDetail', Amount: '10', DiscountLineDetail: {} }); });
  const result = map(version);
  assert.equal(result.disposition, 'quarantined');
  assert.deepEqual(result.reasonCodes, ['qbo_revenue_line_identity_ambiguous']);
  assert.deepEqual(result.candidates, []);
});
for (const key of ['workspaceId', 'businessEntityId', 'connectionId']) {
  test(`master evidence from another ${key} is denied even with the same realm`, () => {
    assert.throws(() => authority([masters()[0], masters({ [key]: id(999) })[1]]), /scope_denied/);
    assert.throws(() => map(invoice(), authority(masters({ [key]: id(999) }))), /authority_denied/);
  });
}
test('stale/tampered master or transaction fingerprint is denied', () => {
  const badMasters = masters(); badMasters[0].normalizedProjection.relationships.AccountType.value = 'Other Income';
  assert.throws(() => authority(badMasters), /source_denied/);
  const badInvoice = invoice(); badInvoice.normalizedProjection.lines[0].amount.amount = '999';
  assert.throws(() => map(badInvoice), /source_denied/);
});
test('unrelated source identity cannot be attached to a mapped fact', () => {
  assert.throws(() => map(invoice(), authority(), { sourceIdentityFingerprint: `sha256:${'0'.repeat(64)}` }), /source_identity_denied/);
});
test('payment and transfer remain non-revenue even when their document amount matches', () => {
  for (const type of ['Payment', 'Transfer']) {
    const result = map(source(type, fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES[type], 60));
    assert.equal(result.disposition, 'not_applicable');
    assert.deepEqual(result.candidates, []);
  }
});

const productionProvider = { ...provider, sourceEnvironment: 'production' };
const productionContext = { ...context, providerEnvironment: 'production' };
const accountingContext = { workspaceId: id(1), businessEntityId: id(2), connectionId: id(3),
  realmId: provider.realmId, providerEnvironment: 'production', sourceAuthorityPolicyVersionId: id(80),
  policyEffectiveFrom: '2026-09-29T00:00:00.000Z', accountingBasis: 'accrual', reportingCurrency: 'USD',
  postingDateFrom: '2026-09-01', postingDateThrough: '2026-09-30', revenueAccountRefs: ['401'] };

function validatedProduction(pending, streamKey) {
  const result = validateProductionQboSourceClaim({ sourceVersionId: pending.id, sourceRecordId: id(100), taskId: id(101),
    workspaceId: pending.workspaceId, businessEntityId: pending.businessEntityId, connectionId: pending.connectionId,
    connectionGeneration: 1, mappingId: id(102), syncRunId: id(103), streamKey,
    sourceIdentityFingerprint: externalSourceIdentityFingerprint(pending),
    realmFingerprint: contractSha256({ fingerprintPurpose: 'provider_authorized_entity_reference',
      fingerprintVersion: 'provider_authorized_entity_reference_fingerprint_v1', value: provider.realmId }),
    claimId: id(104), claimExpiresAt: '2026-09-30T12:01:00.000Z', validatedVersionId: id(Number(pending.id.slice(-12)) + 1000),
    validatedAt: at, pendingVersion: pending });
  assert.equal(result.validatedVersion.validation.state, 'valid', JSON.stringify(result.validatedVersion.validation.issues));
  assert.equal(result.economicPromotionAllowed, false);
  return result.validatedVersion;
}

function productionSource(type, raw, n = 200, scope = {}) {
  const record = minimizeQboSourceRecord({ recordType: type, raw, provider: productionProvider });
  const pending = qboMinimizedRecordToExternalSourceVersion({ context: { ...productionContext, ...scope }, record,
    id: id(n), immutableVersion: 1, priorVersionId: null, previousRecord: null,
    observedAt: at, synchronizedAt: at, ingestedAt: at, receivedAt: at });
  const stream = { Account: 'accounts', Item: 'items_minimized', Preferences: 'preferences', CompanyInfo: 'company_info' }[type]
    ?? `qbo_${type.toLowerCase()}`;
  return validatedProduction(pending, stream);
}

// Intuit-shaped, fictional provider objects. Decimal lexemes stay strings, as at the lossless transport boundary.
// SalesItemLineDetail semantics: https://static.developer.intuit.com/sdkdocs/qbv3doc/ippdotnetdevkitv3/html/0efbacc4-d46c-1b41-513e-6eca01825ab4.htm
function ordinarySales(modify = () => {}) {
  const raw = { Id: 'sales-500', SyncToken: '3', MetaData: { CreateTime: '2026-09-29T08:00:00Z', LastUpdatedTime: '2026-09-29T08:00:00Z' },
    TxnDate: '2026-09-29', CurrencyRef: { value: 'USD' }, TotalAmt: '100.25', GlobalTaxCalculation: 'NotApplicable',
    Line: [{ Id: '1', LineNum: 1, Amount: '100.25', DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: { ItemRef: { value: '301' }, ItemAccountRef: { value: '401' }, Qty: '1', UnitPrice: '100.25', TaxCodeRef: { value: 'NON' } } },
    { DetailType: 'SubTotalLineDetail', Amount: '100.25', SubTotalLineDetail: {} }] };
  modify(raw);
  return raw;
}

function productionAccounts(scope = {}) {
  const account = (ref, type, n) => productionSource('Account', { ...structuredClone(fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Account),
    Id: ref, AccountType: type }, n, scope);
  return [account('401', 'Income', 210), account('110', 'Accounts Receivable', 211), account('44', 'Other Current Liability', 212)];
}

function productionMap(version = productionSource('Invoice', ordinarySales()), overrides = {}) {
  return mapProductionQboAccountingSource({ sourceVersion: version, sourceIdentityFingerprint: externalSourceIdentityFingerprint(version),
    context: accountingContext, accountSourceVersions: productionAccounts(), mappedAt: at, priorSourceVersion: null, priorFacts: [],
    identityForFact: (_, ordinal) => ({ id: id(300 + ordinal), immutableVersion: 1, priorVersionId: null }),
    representationIdForFact: (_, ordinal) => id(400 + ordinal), ...overrides });
}

function resigned(value, mutate) {
  const changed = structuredClone(value); mutate(changed);
  return { ...changed, sourceFingerprint: externalSourceFingerprint(changed) };
}

function held(raw, code, type = 'Invoice') {
  const result = productionMap(productionSource(type, raw));
  assert.equal(result.disposition, 'review_required');
  assert.equal(result.lifecycle.action, 'hold');
  assert.deepEqual(result.candidates, []);
  assert.ok(result.reasonCodes.includes(code), JSON.stringify(result.reasonCodes));
  assert.equal(result.coverage, 'not_assessed');
  assert.equal(result.fullPostedRevenue, false);
}

test('Production v2 interoperates with the actual source serializer and validator, with exact source/account provenance', () => {
  const version = productionSource('Invoice', ordinarySales()), result = productionMap(version);
  assert.equal(version.normalizedSchemaVersion, 'qbo_minimizer_v2');
  assert.equal(version.normalizedProjection.minimizationVersion, 'qbo_minimizer_v2');
  assert.equal(result.disposition, 'mapped_partial');
  assert.equal(result.coverage, 'not_assessed');
  assert.equal(result.fullPostedRevenue, false);
  assert.equal(result.lifecycle.action, 'replace_fact_set');
  assert.deepEqual(result.lifecycle.priorFactVersionIds, []);
  assert.equal(result.candidates[0].fact.value.amount, '100.25');
  assert.deepEqual(result.candidates[0].fact.sources.map(edge => [edge.sourceRecordVersionId, edge.sourceRole, edge.contributionWeight]),
    [[version.id, 'primary', '1'], [productionAccounts()[0].id, 'corroborating', '0']]);
  assert.equal(result.sourceAuthorityPolicyVersionId, accountingContext.sourceAuthorityPolicyVersionId);
});

test('sandbox stays v1 and its qualifier cannot admit Production sales or reports', () => {
  assert.equal(invoice().normalizedSchemaVersion, 'qbo_minimizer_v1');
  assert.equal(invoice().normalizedProjection.accountingEvidence, undefined);
  const result = map(productionSource('Invoice', ordinarySales()));
  assert.deepEqual(result.reasonCodes, ['qbo_production_accounting_normalizer_required']);
});

test('old minimized projections cannot acquire Production eligibility or recover lost overrides', () => {
  const old = resigned(productionSource('Invoice', ordinarySales()), version => {
    version.normalizedSchemaVersion = version.normalizedProjection.minimizationVersion = 'qbo_minimizer_v1';
    delete version.normalizedProjection.accountingEvidence;
    for (const line of version.normalizedProjection.lines) delete line.accountingEvidence;
  });
  const result = productionMap(old);
  assert.equal(result.disposition, 'review_required');
  assert.deepEqual(result.reasonCodes, ['qbo_legacy_projection_accounting_evidence_insufficient']);
  const missing = resigned(productionSource('Invoice', ordinarySales()), version => { delete version.normalizedProjection.lines[0].accountingEvidence; });
  assert.throws(() => productionMap(missing));
});

test('Production never falls back to current Item income mapping or undocumented sales AccountRef', () => {
  held(ordinarySales(raw => { delete raw.Line[0].SalesItemLineDetail.ItemAccountRef; }), 'qbo_transaction_posting_account_unproven');
  held(ordinarySales(raw => { delete raw.Line[0].SalesItemLineDetail.ItemAccountRef;
    raw.Line[0].SalesItemLineDetail.AccountRef = { value: '401' }; }), 'qbo_transaction_posting_account_unproven');
  const result = productionMap(productionSource('Invoice', ordinarySales(raw => { raw.Line[0].SalesItemLineDetail.ItemAccountRef = { value: '44' }; })));
  assert.equal(result.disposition, 'non_contributing');
  assert.equal(result.lifecycle.action, 'replace_fact_set');
  assert.deepEqual(result.candidates, []);
});

test('itemless documentation and subtotal amounts never inflate or block proven sibling postings', () => {
  const raw = ordinarySales(raw => raw.Line.push({ Id: '2', Amount: '99999', DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: { ItemAccountRef: { value: '401' }, TaxCodeRef: { value: 'TAX' } } }));
  const result = productionMap(productionSource('Invoice', raw));
  assert.equal(result.disposition, 'mapped_partial');
  assert.deepEqual(result.candidates.map(c => c.fact.value.amount), ['100.25']);
});

for (const [name, modify, code] of [
  ['discount line', raw => raw.Line.push({ Id: '2', Amount: '5', DetailType: 'DiscountLineDetail', DiscountLineDetail: { DiscountAccountRef: { value: '401' } } }), 'qbo_discount_semantics_unproven'],
  ['line discount', raw => { raw.Line[0].SalesItemLineDetail.DiscountAmt = '5'; }, 'qbo_discount_semantics_unproven'],
  ['header discount', raw => { raw.DiscountRate = '5'; }, 'qbo_discount_semantics_unproven'],
  ['tax-inclusive amount', raw => { raw.Line[0].SalesItemLineDetail.TaxInclusiveAmt = '109.25'; }, 'qbo_tax_semantics_unproven'],
  ['tax mode', raw => { raw.GlobalTaxCalculation = 'TaxInclusive'; }, 'qbo_tax_semantics_unproven'],
  ['tax total', raw => { raw.TxnTaxDetail = { TotalTax: '9' }; }, 'qbo_tax_semantics_unproven'],
  ['unproven tax code', raw => { raw.Line[0].SalesItemLineDetail.TaxCodeRef = { value: 'TAX' }; }, 'qbo_tax_semantics_unproven'],
  ['group without parent amount', raw => raw.Line.push({ Id: '2', DetailType: 'GroupLineDetail', GroupLineDetail: { Line: [{ Amount: '90' }] } }), 'qbo_group_postings_unproven'],
  ['unknown line without amount', raw => raw.Line.push({ Id: '2', DetailType: 'FutureEconomicLineDetail' }), 'qbo_economic_line_kind_unproven'],
  ['duplicate IDs', raw => raw.Line.push({ ...raw.Line[0] }), 'qbo_revenue_line_identity_ambiguous'],
  ['missing amount', raw => { delete raw.Line[0].Amount; }, 'qbo_economic_line_incomplete'],
  ['sparse response', raw => { raw.sparse = true; }, 'qbo_full_transaction_required'],
  ['unexplained total', raw => { raw.TotalAmt = '200'; }, 'qbo_document_amounts_not_reconciled']
]) test(`Production holds the entire source for ${name}`, () => held(ordinarySales(modify), code));

for (const type of ['Invoice', 'SalesReceipt', 'CreditMemo', 'RefundReceipt']) {
  test(`Production ${type} preserves signed line amounts and applies document polarity exactly once`, () => {
    const raw = ordinarySales(raw => { raw.Line[0].Amount = '100.25'; raw.Line.splice(1, 0, {
      ...structuredClone(raw.Line[0]), Id: '2', Amount: '-0.25' }); raw.TotalAmt = '100'; });
    const result = productionMap(productionSource(type, raw));
    assert.equal(result.disposition, 'mapped_partial');
    assert.deepEqual(result.candidates.map(c => c.fact.value.amount), ['CreditMemo', 'RefundReceipt'].includes(type)
      ? ['-100.25', '0.25'] : ['100.25', '-0.25']);
  });
}

function ordinaryJournal(modify = () => {}) {
  const raw = { ...ordinarySales(), Id: 'journal-500', Line: [
    { Id: '1', Amount: '100.25', DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Debit', AccountRef: { value: '110' } } },
    { Id: '2', Amount: '100.25', DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: 'Credit', AccountRef: { value: '401' } } }] };
  modify(raw); return raw;
}

test('balanced journals recognize only authorized account postings with credit/debit polarity', () => {
  for (const reverse of [false, true]) {
    const raw = ordinaryJournal(raw => { if (reverse) for (const line of raw.Line) line.JournalEntryLineDetail.PostingType =
      line.JournalEntryLineDetail.PostingType === 'Debit' ? 'Credit' : 'Debit'; });
    const result = productionMap(productionSource('JournalEntry', raw));
    assert.equal(result.disposition, 'mapped_partial');
    assert.deepEqual(result.candidates.map(c => c.fact.value.amount), [reverse ? '-100.25' : '100.25']);
  }
});

test('journal unknown signs, negative magnitudes, missing accounts and unbalanced entries require review', () => {
  held(ordinaryJournal(raw => { raw.Line[0].JournalEntryLineDetail.PostingType = 'Other'; }), 'qbo_journal_posting_sign_unproven', 'JournalEntry');
  held(ordinaryJournal(raw => { raw.Line[0].Amount = '-100.25'; }), 'qbo_journal_posting_sign_unproven', 'JournalEntry');
  held(ordinaryJournal(raw => { delete raw.Line[0].JournalEntryLineDetail.AccountRef; }), 'qbo_transaction_posting_account_unproven', 'JournalEntry');
  held(ordinaryJournal(raw => { raw.Line[0].Amount = '100'; }), 'qbo_journal_not_balanced', 'JournalEntry');
});

for (const type of ['Payment', 'Deposit', 'Transfer', 'Bill', 'BillPayment', 'VendorCredit', 'Purchase']) {
  test(`${type} cannot silently disappear from Production accounting coverage`, () => {
    held(ordinarySales(), 'qbo_transaction_posted_revenue_effect_unproven', type);
  });
}

for (const key of ['workspaceId', 'businessEntityId', 'connectionId']) {
  test(`Production rejects mixed ${key} in immutable account evidence and checked context`, () => {
    assert.throws(() => productionMap(undefined, { accountSourceVersions: productionAccounts({ [key]: id(999) }) }), /source_binding_denied/);
    assert.throws(() => productionMap(undefined, { context: { ...accountingContext, [key]: id(999) } }), /source_binding_denied/);
  });
}

test('Production denies tampering, substituted record identity, realm, environment, provider and source identity', () => {
  const original = productionSource('Invoice', ordinarySales());
  const tampered = structuredClone(original); tampered.normalizedProjection.lines[0].amount.amount = '3';
  assert.throws(() => productionMap(tampered), /source_binding_denied/);
  assert.throws(() => productionMap(original, { sourceIdentityFingerprint: `sha256:${'0'.repeat(64)}` }), /source_identity_denied/);
  for (const mutate of [
    v => { v.normalizedProjection.id = 'another-record'; },
    v => { v.normalizedProjection.provider.realmId = 'another-realm'; },
    v => { v.normalizedProjection.provider.sourceEnvironment = 'sandbox'; }
  ]) assert.throws(() => productionMap(resigned(original, mutate)), /projection_binding_denied/);
  assert.throws(() => productionMap(resigned(original, v => { v.source.providerKey = 'square'; })), /source_binding_denied/);
});

test('inactive account evidence does not erase historical explicit postings', () => {
  const accounts = productionAccounts();
  accounts[0] = productionSource('Account', { ...fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Account, Active: false }, 210);
  assert.equal(productionMap(undefined, { accountSourceVersions: accounts }).disposition, 'mapped_partial');
});

test('posting date must fit both the explicit task window and owner policy effective date', () => {
  const historical = productionSource('Invoice', ordinarySales(raw => { raw.TxnDate = '2026-09-02'; }));
  assert.equal(productionMap(historical).disposition, 'review_required');
  assert.deepEqual(productionMap(historical).reasonCodes, ['qbo_posting_date_outside_authorized_scope']);
  assert.equal(productionMap(historical, { context: { ...accountingContext,
    policyEffectiveFrom: '2026-09-01T00:00:00Z' } }).candidates[0].fact.temporal.postingDate, '2026-09-02');
  assert.equal(productionMap(historical, { context: { ...accountingContext, postingDateFrom: '2026-09-29' } }).disposition, 'review_required');
  held(ordinarySales(raw => { raw.TxnDate = '2026-10-01'; }), 'qbo_posting_date_outside_authorized_scope');
  assert.throws(() => productionMap(undefined, { context: { ...accountingContext, policyEffectiveFrom: '2026-10-01T00:00:00Z' } }), /context_not_effective/);
});

test('corrections preserve line identity, identify complete prior fact set, and move posting date without mutating prior facts', () => {
  const priorSource = productionSource('Invoice', ordinarySales(raw => { raw.Line.splice(1, 0, { ...structuredClone(raw.Line[0]), Id: '2', Amount: '50' }); raw.TotalAmt = '150.25'; }));
  const priorFacts = productionMap(priorSource).candidates.map(c => c.fact), before = JSON.stringify(priorFacts);
  const current = resigned(productionSource('Invoice', ordinarySales(raw => { raw.TxnDate = '2026-09-30'; raw.SyncToken = '4'; }), 201), v => { v.immutableVersion = 4; });
  const result = productionMap(current, { priorSourceVersion: priorSource, priorFacts,
    identityForFact: (key, ordinal) => { const prior = priorFacts.find(f => f.factKey === key);
      return { id: id(500 + ordinal), immutableVersion: prior ? prior.immutableVersion + 1 : 1, priorVersionId: prior?.id ?? null }; } });
  assert.equal(result.disposition, 'mapped_partial');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].fact.factKey, priorFacts[0].factKey);
  assert.equal(result.candidates[0].representation.lineage.priorCanonicalFactVersionId, priorFacts[0].id);
  assert.deepEqual(result.lifecycle.priorFactVersionIds, priorFacts.map(f => f.id).sort());
  assert.equal(result.candidates[0].fact.temporal.postingDate, '2026-09-30');
  assert.equal(JSON.stringify(priorFacts), before);
  assert.throws(() => productionMap(current, { priorSourceVersion: priorSource, priorFacts }), /prior_fact_binding_denied/);
  assert.throws(() => productionMap(current, { priorSourceVersion: null, priorFacts }), /prior_source_required/);
});

test('validated voids and CDC deletions request atomic retraction rather than mapping zero revenue', () => {
  const priorSource = productionSource('Invoice', ordinarySales()), priorFacts = productionMap(priorSource).candidates.map(c => c.fact);
  const voided = resigned(productionSource('Invoice', ordinarySales(raw => { raw.Voided = true; }), 201), v => { v.immutableVersion = 4; });
  assert.equal(voided.changeKind, 'unchanged');
  const pendingDeletion = resigned(priorSource, v => { v.id = id(202); v.immutableVersion = 3; v.priorVersionId = priorSource.id;
    v.changeKind = 'deleted'; v.normalizedSchemaVersion = 'qbo_cdc_tombstone_v1'; v.normalizedProjection = null;
    v.validation = { state: 'pending', validatorVersion: 'qbo_phase_7_contract_validator_v1', issues: [] }; });
  const deleted = validatedProduction(pendingDeletion, 'qbo_cdc');
  for (const version of [voided, deleted]) {
    const result = productionMap(version, { priorSourceVersion: priorSource, priorFacts });
    assert.equal(result.disposition, 'retraction_required');
    assert.equal(result.lifecycle.action, 'retract_fact_set');
    assert.deepEqual(result.lifecycle.priorFactVersionIds, priorFacts.map(f => f.id));
    assert.deepEqual(result.candidates, []);
    assert.equal(result.fullPostedRevenue, false);
  }
});

function nativePendingDeletion(prior, schema = 'qbo_cdc_tombstone_v1', n = 900) {
  return resigned(prior, v => {
    v.id = id(n); v.immutableVersion = prior.immutableVersion + 1; v.priorVersionId = prior.id;
    v.changeKind = 'deleted'; v.normalizedProjection = null; v.normalizedSchemaVersion = schema;
    v.validation = { state: 'pending', validatorVersion: 'qbo_phase_7_contract_validator_v1', issues: [] };
    if (schema === 'qbo_cdc_tombstone_v1') {
      v.temporal.postingDate = null; v.temporal.effectiveAt = null;
      v.accounting = { basis: 'unknown', currency: null };
    }
  });
}

for (const schema of ['qbo_minimizer_v1', 'qbo_minimizer_v2', 'qbo_cdc_tombstone_v1']) {
  test(`explicit native validation admits only negative processing of an immutable pending ${schema} deletion`, () => {
    const prior = productionSource('Invoice', ordinarySales()), priorFacts = productionMap(prior).candidates.map(c => c.fact);
    const deletion = nativePendingDeletion(prior, schema), before = JSON.stringify(deletion);
    // The validator succeeds, but native completion deliberately retains the original pending version.
    assert.equal(validatedProduction(deletion, 'qbo_cdc').validation.state, 'valid');
    assert.throws(() => productionMap(deletion, { priorSourceVersion: prior, priorFacts }), /source_binding_denied/);
    const result = productionMap(deletion, { effectiveValidationState: 'valid', priorSourceVersion: prior, priorFacts });
    assert.equal(result.disposition, 'retraction_required'); assert.equal(result.lifecycle.action, 'retract_fact_set');
    assert.deepEqual(result.candidates, []); assert.deepEqual(result.lifecycle.priorFactVersionIds, priorFacts.map(f => f.id));
    assert.equal(result.sourceRecordVersionId, deletion.id); assert.equal(result.sourceFingerprint, deletion.sourceFingerprint);
    assert.equal(result.sourceIdentityFingerprint, externalSourceIdentityFingerprint(deletion));
    assert.equal(result.fullPostedRevenue, false); assert.equal(JSON.stringify(deletion), before);
    assert.equal(deletion.validation.state, 'pending');
  });
}

test('restoration requires the explicit prior deletion signal without rewriting prior history', () => {
  const original = productionSource('Invoice', ordinarySales()), deletion = nativePendingDeletion(original);
  const restored = resigned(productionSource('Invoice', ordinarySales(), 201), v => {
    v.immutableVersion = deletion.immutableVersion + 1; v.priorVersionId = deletion.id;
  });
  const before = JSON.stringify(deletion);
  assert.throws(() => productionMap(restored, { priorSourceVersion: deletion }), /source_binding_denied/);
  const result = productionMap(restored, { priorSourceVersion: deletion, priorEffectiveValidationState: 'valid',
    identityForFact: (_, ordinal) => ({ id: id(950 + ordinal), immutableVersion: 6, priorVersionId: id(940 + ordinal) }) });
  assert.equal(result.disposition, 'mapped_partial'); assert.equal(result.candidates[0].fact.immutableVersion, 6);
  assert.deepEqual(result.lifecycle.priorFactVersionIds, []); assert.equal(JSON.stringify(deletion), before);
});

test('current and prior pending deletions require independent signals and preserve both exact versions', () => {
  const original = productionSource('Invoice', ordinarySales()), prior = nativePendingDeletion(original);
  const current = nativePendingDeletion(prior, 'qbo_cdc_tombstone_v1', 901), before = JSON.stringify([prior, current]);
  assert.throws(() => productionMap(current, { effectiveValidationState: 'valid', priorSourceVersion: prior }), /source_binding_denied/);
  assert.throws(() => productionMap(current, { priorEffectiveValidationState: 'valid', priorSourceVersion: prior }), /source_binding_denied/);
  const result = productionMap(current, { effectiveValidationState: 'valid', priorEffectiveValidationState: 'valid', priorSourceVersion: prior });
  assert.equal(result.disposition, 'retraction_required'); assert.deepEqual(result.candidates, []);
  assert.equal(JSON.stringify([prior, current]), before);
});

test('native deletion signals do not upgrade ordinary pending, quarantined, invalid or errored sources', () => {
  const valid = productionSource('Invoice', ordinarySales());
  const ordinary = resigned(valid, v => { v.validation = { state: 'pending', validatorVersion: 'qbo_phase_7_contract_validator_v1', issues: [] }; });
  assert.throws(() => productionMap(ordinary, { effectiveValidationState: 'valid' }), /source_binding_denied/);
  for (const state of ['invalid', 'quarantined']) {
    const deletion = nativePendingDeletion(valid); deletion.validation.state = state;
    assert.throws(() => productionMap(deletion, { effectiveValidationState: 'valid' }), /source_binding_denied/);
  }
  const errored = nativePendingDeletion(valid);
  errored.validation.issues = [{ code: 'qbo_source_time_invalid', severity: 'error', field: null, detail: 'Invalid synthetic source.' }];
  assert.throws(() => productionMap(errored, { effectiveValidationState: 'valid' }), /source_binding_denied/);
  const wrongValidator = nativePendingDeletion(valid); wrongValidator.validation.validatorVersion = 'untrusted_validator';
  assert.throws(() => productionMap(wrongValidator, { effectiveValidationState: 'valid' }), /source_binding_denied/);
});

for (const [name, modify] of [
  ['unknown schema', v => { v.normalizedSchemaVersion = 'unknown_schema'; }],
  ['report deletion', v => { v.source.providerRecordType = 'ProfitAndLoss'; v.recordKind = 'qbo_profit_and_loss'; }],
  ['company deletion', v => { v.source.providerRecordType = 'CompanyInfo'; v.recordKind = 'qbo_company_info'; }],
  ['wrong record kind', v => { v.recordKind = 'qbo_payment'; }],
  ['missing provider timestamp', v => { v.temporal.providerUpdatedAt = null; }],
  ['future provider timestamp', v => { v.temporal.providerUpdatedAt = '2026-10-01T00:00:00.000Z'; }],
  ['reversed provider chronology', v => { v.temporal.providerCreatedAt = '2026-09-30T00:00:00.000Z'; }],
  ['point-in-time basis', v => { v.temporal.basis = 'point_in_time'; }],
  ['period boundary', v => { v.temporal.basis = 'period'; v.temporal.periodStart = '2026-09-01'; v.temporal.periodEnd = '2026-09-29'; }],
  ['effective time mismatch', v => { v.temporal.effectiveAt = '2026-09-29T00:00:00.000Z'; }],
  ['foreign workspace', v => { v.workspaceId = id(999); }],
  ['foreign entity', v => { v.businessEntityId = id(999); }],
  ['foreign connection', v => { v.connectionId = id(999); }],
  ['wrong provider', v => { v.source.providerKey = 'square'; }]
]) {
  test(`explicit deletion signal cannot bypass ${name}`, () => {
    const deletion = resigned(nativePendingDeletion(productionSource('Invoice', ordinarySales())), modify);
    assert.throws(() => productionMap(deletion, { effectiveValidationState: 'valid' }), /source_binding_denied/);
  });
}

test('explicit deletion signals remain bound to exact fingerprints, identities and prior source', () => {
  const original = productionSource('Invoice', ordinarySales()), deletion = nativePendingDeletion(original);
  const tampered = structuredClone(deletion); tampered.source.providerRecordId = 'another-record';
  assert.throws(() => productionMap(tampered, { effectiveValidationState: 'valid' }), /source_binding_denied/);
  assert.throws(() => productionMap(deletion, { effectiveValidationState: 'valid', sourceIdentityFingerprint: `sha256:${'0'.repeat(64)}` }), /source_identity_denied/);
  const unrelated = resigned(deletion, v => { v.source.providerRecordId = 'unrelated'; });
  assert.throws(() => productionMap(original, { priorSourceVersion: unrelated, priorEffectiveValidationState: 'valid' }), /prior_source_binding_denied/);
  for (const signal of [true, 'invalid', null, 'valid ']) {
    assert.throws(() => productionMap(deletion, { effectiveValidationState: signal }));
    assert.throws(() => productionMap(original, { priorEffectiveValidationState: signal }));
  }
});

test('Production reports remain nonadditive regardless of Total Income labels, and report source identity is checked', () => {
  const report = { ...require('./qbo-customer-test-support.cjs').report(), provider: productionProvider };
  report.rows[0].cells[0].value = 'Total Income';
  const pending = qboReportToExternalSourceVersion({ context: productionContext, report, id: id(250), immutableVersion: 1,
    priorVersionId: null, previousReport: null, observedAt: at, synchronizedAt: at, ingestedAt: at, receivedAt: at });
  const version = validatedProduction(pending, 'qbo_profitandloss'), result = productionMap(version);
  assert.equal(result.disposition, 'non_contributing');
  assert.equal(result.lifecycle.action, 'none');
  assert.deepEqual(result.candidates, []);
  const args = { sourceVersion: version, sourceIdentityFingerprint: externalSourceIdentityFingerprint(version), mappedAt: at,
    factIdentity: { id: id(301), immutableVersion: 1, priorVersionId: null }, representationId: id(401) };
  assert.equal(mapValidatedQboProfitAndLossControl(args).disposition, 'quarantined');
  assert.throws(() => mapValidatedQboProfitAndLossControl({ ...args, sourceIdentityFingerprint: `sha256:${'0'.repeat(64)}` }), /source_identity_denied/);
});

test('contradictory line-detail payloads cannot hide tax, discount or journal postings', () => {
  assert.throws(() => productionSource('Invoice', ordinarySales(raw => {
    raw.Line[0].JournalEntryLineDetail = { AccountRef: { value: '401' }, PostingType: 'Debit' };
  })), /Line.DetailType/);
});

test('foreign currency and exchange-rate evidence cannot be treated as reporting-currency revenue', () => {
  held(ordinarySales(raw => { raw.CurrencyRef.value = 'EUR'; }), 'qbo_accounting_currency_unsupported');
  held(ordinarySales(raw => { raw.ExchangeRate = '1.1'; }), 'qbo_accounting_currency_unsupported');
});

test('account evidence must be complete and single-version; omitted proof is review, mixed versions are denied', () => {
  const accounts = productionAccounts();
  assert.equal(productionMap(undefined, { accountSourceVersions: accounts.slice(1) }).disposition, 'review_required');
  assert.throws(() => productionMap(undefined, { accountSourceVersions: [...accounts, accounts[0]] }), /account_evidence_denied/);
  const result = productionMap();
  assert.deepEqual(result.accountEvidence.map(edge => edge.sourceRecordVersionId), accounts.map(source => source.id).sort());
});

test('a newly ambiguous correction holds prior facts and cannot publish a smaller partial document', () => {
  const priorSource = productionSource('Invoice', ordinarySales()), priorFacts = productionMap(priorSource).candidates.map(c => c.fact);
  const current = resigned(productionSource('Invoice', ordinarySales(raw => { raw.Line[0].SalesItemLineDetail.DiscountRate = '10'; }), 201),
    v => { v.immutableVersion = 4; });
  const result = productionMap(current, { priorSourceVersion: priorSource, priorFacts });
  assert.equal(result.disposition, 'review_required');
  assert.equal(result.lifecycle.action, 'hold');
  assert.deepEqual(result.lifecycle.priorFactVersionIds, priorFacts.map(f => f.id));
  assert.deepEqual(result.candidates, []);
});

test('proven reclassification out of revenue returns an empty replacement set with exact prior fact identities', () => {
  const priorSource = productionSource('Invoice', ordinarySales()), priorFacts = productionMap(priorSource).candidates.map(c => c.fact);
  const current = resigned(productionSource('Invoice', ordinarySales(raw => { raw.Line[0].SalesItemLineDetail.ItemAccountRef.value = '44'; }), 201),
    v => { v.immutableVersion = 4; });
  const result = productionMap(current, { priorSourceVersion: priorSource, priorFacts });
  assert.equal(result.disposition, 'non_contributing');
  assert.equal(result.lifecycle.action, 'replace_fact_set');
  assert.deepEqual(result.lifecycle.priorFactVersionIds, priorFacts.map(f => f.id));
  assert.deepEqual(result.candidates, []);
});

test('prior facts from another source cannot be used as correction or deletion targets', () => {
  const unrelated = productionSource('Invoice', ordinarySales(raw => { raw.Id = 'different-sale'; }));
  const priorFacts = productionMap(unrelated).candidates.map(c => c.fact);
  assert.throws(() => productionMap(undefined, { priorSourceVersion: unrelated, priorFacts }), /prior_source_binding_denied/);
  assert.throws(() => productionMap(undefined, { priorSourceVersion: productionSource('Invoice', ordinarySales()), priorFacts }), /prior_fact_binding_denied/);
});
