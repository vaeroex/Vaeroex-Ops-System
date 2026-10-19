/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { catalogFixture, model } = require('./plugin-catalog-test-support.cjs');
const { providers } = require('./integrations-ui-test-support').loadSource('lib/integrations/reporting/catalog.ts');

test('categories reflect connector capabilities, not unsupported product features', async () => {
  const { entries } = await catalogFixture({ reportingEnabled: providers, legacyEnabled: ['loyverse', 'zoho-books', 'wix-orders'], sheetsEnabled: true });
  assert.equal(entries.length, 12);
  const ids = category => entries.filter(entry => model.inCategory(entry, category)).map(entry => entry.id);
  assert.deepEqual(ids('accounting'), ['quickbooks', 'zoho-books', 'xero']);
  assert.deepEqual(ids('sales'), ['square', 'loyverse']);
  assert.deepEqual(ids('inventory'), ['zoho-inventory', 'katana']);
  assert.deepEqual(ids('time'), ['harvest', 'clockify', 'toggl']);
  assert.deepEqual(ids('orders'), ['wix-orders']);
  assert.deepEqual(ids('data'), ['google-sheets']);
  assert.deepEqual(ids('all'), entries.map(entry => entry.id));
  for (const unsupported of ['payroll', 'scheduling', 'reservations', 'FreeAgent', 'BambooHR', 'FreshBooks', 'Planday']) {
    assert.equal(entries.filter(entry => model.matchesSearch(entry, unsupported)).length, 0);
  }
});

test('search combines words, punctuation, case and category filters', async () => {
  const { entries } = await catalogFixture({ reportingEnabled: providers });
  const results = (query, category = 'all') => entries.filter(entry => model.matchesSearch(entry, query) && model.inCategory(entry, category)).map(entry => entry.id);
  assert.deepEqual(results('  zOhO   INVENTORY  '), ['zoho-inventory']);
  assert.deepEqual(results('e commerce'), ['wix-orders']);
  assert.deepEqual(results('bookkeeping'), ['quickbooks', 'xero']);
  assert.deepEqual(results('hours', 'time'), ['harvest', 'clockify', 'toggl']);
  assert.deepEqual(results('hours', 'accounting'), []);
  assert.deepEqual(results('no-such-plug-in'), []);
  assert.equal(results('   ').length, entries.length);
});

test('gated cards retain setup destinations without claiming a disconnected or available connection', async () => {
  const { entries, h } = await catalogFixture({ qboEnabled: false, squareEnabled: false });
  assert.equal(entries.length, 8);
  assert.deepEqual(h.queries, []);
  for (const entry of entries) {
    assert.match(entry.html, /Availability/);
    assert.doesNotMatch(entry.html, /Connection status|Not connected|>Connected</);
  }
  assert.match(entries.find(entry => entry.id === 'google-sheets').html, /not generally available/);
  assert.match(entries.find(entry => entry.id === 'katana').html, /Public OAuth partnership is not approved/);
  assert.match(entries.find(entry => entry.id === 'wix-orders').html, /Public App Market review is separate/);
});

test('a member with only a reporting or Wix connector enabled sees that connector', async () => {
  for (const provider of ['harvest', 'wix-orders']) {
    const { entries } = await catalogFixture({ role: 'viewer', qboEnabled: false, squareEnabled: false,
      reportingEnabled: provider === 'harvest' ? ['harvest'] : [], legacyEnabled: provider === 'wix-orders' ? ['wix-orders'] : [] });
    assert.deepEqual(entries.map(entry => entry.id), [provider]);
    assert.match(entries[0].html, /Manage /);
  }
  assert.deepEqual((await catalogFixture({ role: 'viewer', qboEnabled: false, squareEnabled: false })).entries, []);
});

test('availability and connection states remain separate, including errors and pending consent', async () => {
  const { entries } = await catalogFixture({ reportingEnabled: providers, sheetsEnabled: true,
    sheetsConnections: [{ status: 'connected', active_approval_id: 'approval' }],
    rows: { reporting_connections: [{ provider: 'harvest', status: 'pending' }, { provider: 'xero', status: 'reauthorization_required' }] } });
  assert.match(entries.find(entry => entry.id === 'google-sheets').html, /Limited pilot[\s\S]*Connection status[\s\S]*>Connected</);
  assert.match(entries.find(entry => entry.id === 'harvest').html, /Waiting for authorization/);
  assert.match(entries.find(entry => entry.id === 'xero').html, /Reauthorization required/);
  const failed = await catalogFixture({ reportingEnabled: ['harvest'], errorTable: 'reporting_connections' });
  assert.match(failed.entries.find(entry => entry.id === 'harvest').html, /Status unavailable/);
  assert.doesNotMatch(failed.entries.find(entry => entry.id === 'harvest').html, /Not connected/);
});

test('every card preserves management routing and spreadsheet upload fallback', async () => {
  const { entries } = await catalogFixture({ reportingEnabled: providers, legacyEnabled: ['loyverse', 'zoho-books', 'wix-orders'], sheetsEnabled: true, squareEvidence: {} });
  const destinations = { square: '/app/settings/integrations/square', quickbooks: '/app/settings/integrations/quickbooks',
    'google-sheets': '/app/settings/integrations/google-sheets', 'square-sandbox': '/app/integrations/square' };
  for (const entry of entries) {
    assert(entry.html.includes(`href="${destinations[entry.id] ?? `/app/integrations/${entry.id}`}"`), entry.id);
    assert.doesNotMatch(entry.html, /<form|\/api\/integrations\//);
  }
  assert.match(entries.find(entry => entry.id === 'google-sheets').html, /href="\/app\/sources"/);
});
