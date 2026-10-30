/* eslint-disable @typescript-eslint/no-require-imports -- Actual policy snapshots and acceptance reads with an in-memory ledger. */
const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { legalDocuments } = require('../lib/legal/content.ts');
const { PRE_CHECKOUT_ACCEPTANCE_SET_VERSION, PRE_CHECKOUT_REQUIRED_POLICY_IDS,
  preCheckoutAcceptanceSnapshot, hasAcceptedCurrentPreCheckoutPolicies } = require('../lib/legal/pre-checkout-acceptance.ts');

const userId = '00000000-0000-4000-8000-000000000001';
const snapshot = preCheckoutAcceptanceSnapshot();
const accepted = { id: 'synthetic-acceptance', user_id: userId,
  acceptance_set_id: snapshot.acceptanceSetId, acceptance_set_version: snapshot.acceptanceSetVersion,
  required_policy_hash: snapshot.requiredPolicyHash, record_class: snapshot.recordClass };
function ledger(row, error = null) {
  const filters = [];
  const query = {
    select(value) { assert.equal(value, 'id'); return this; },
    eq(column, value) { filters.push([column, value]); return this; },
    order(column, options) { assert.equal(column, 'accepted_at'); assert.equal(options.ascending, false); return this; },
    limit(value) { assert.equal(value, 1); return this; },
    async maybeSingle() { return { data: row && filters.every(([key, value]) => row[key] === value) ? { id: row.id } : null, error }; }
  };
  return { from(table) { assert.equal(table, 'checkout_legal_acceptances'); return query; } };
}
(async () => {
  assert.equal(PRE_CHECKOUT_ACCEPTANCE_SET_VERSION, '2026-10-12.sheets1');
  assert.deepEqual([...PRE_CHECKOUT_REQUIRED_POLICY_IDS], ['terms', 'privacy', 'subscription-billing-terms',
    'refund-policy', 'acceptable-use', 'ai-disclaimer', 'sensitive-data-policy', 'data-retention', 'human-review']);
  assert.deepEqual(preCheckoutAcceptanceSnapshot(), snapshot, 'unchanged content has deterministic hashes');
  assert.match(snapshot.requiredPolicyHash, /^[a-f0-9]{64}$/);
  assert.equal(await hasAcceptedCurrentPreCheckoutPolicies(ledger(accepted), userId), true);
  let rejected = 0;
  for (const patch of [{ user_id: 'another-user' }, { acceptance_set_id: 'another-set' },
    { acceptance_set_version: '2026-08-20.2' }, { required_policy_hash: '0'.repeat(64) },
    { record_class: 'another-class' }]) {
    assert.equal(await hasAcceptedCurrentPreCheckoutPolicies(ledger({ ...accepted, ...patch }), userId), false);
    rejected++;
  }
  assert.equal(await hasAcceptedCurrentPreCheckoutPolicies(ledger(null), userId), false);
  assert.equal(await hasAcceptedCurrentPreCheckoutPolicies(ledger(accepted, { message: 'synthetic read failure' }), userId), false);
  rejected += 2;
  for (const policy of snapshot.requiredPolicies) {
    assert.match(policy.contentHash, /^[a-f0-9]{64}$/);
    const document = legalDocuments[policy.id];
    for (const field of ['summary', 'updated']) {
      const original = document[field];
      try {
        document[field] = `${original} synthetic change`;
        const changed = preCheckoutAcceptanceSnapshot();
        assert.notEqual(changed.requiredPolicies.find(item => item.id === policy.id).contentHash, policy.contentHash);
        assert.notEqual(changed.requiredPolicyHash, snapshot.requiredPolicyHash);
        assert.equal(await hasAcceptedCurrentPreCheckoutPolicies(ledger(accepted), userId), false,
          'earlier consent cannot satisfy changed policy content or versions');
        rejected++;
      } finally { document[field] = original; }
    }
  }
  assert.deepEqual(preCheckoutAcceptanceSnapshot(), snapshot);
  console.log(JSON.stringify({ passed: true, requiredPolicies: 9, rejected, actualAcceptanceReader: true,
    staleVersionsAndContentDenied: true, externalCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
