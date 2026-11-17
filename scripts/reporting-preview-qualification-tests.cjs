/* eslint-disable @typescript-eslint/no-require-imports -- Exact deployment/actor fixture, no network or credentials. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
let actor = id(1), workspace = id(2), role = 'owner', writes = 0;
installLoader({ '@/lib/security/require-workspace-access': { requireWorkspaceAccess: async () => ({ user: { id: actor }, workspaceId: workspace, membership: { role } }) } });
const { reportingPreviewOrigin, assertReportingPreviewActor } = require('../lib/integrations/reporting/preview-qualification.ts');
const security = require('../lib/integrations/reporting/security.ts');
const originalAdmin = security.admin, originalEnv = { ...process.env };
security.admin = () => ({ rpc: async name => { assert.equal(name, 'disconnect_reporting_connection'); writes++; return { data: true, error: null }; } });
const { post } = require('../lib/integrations/reporting/routes.ts');
const host = 'vaeroex-isolated-test-123.vercel.app', now = Date.now();
const manifest = { deploymentHost: host, actorUserId: id(1), workspaceId: id(2), startsAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 600000).toISOString(), providers: ['clockify', 'katana'] };
function configure(value = manifest) {
  process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_URL = host; process.env.REPORTING_PREVIEW_QUALIFICATION = JSON.stringify(value);
  actor = id(1); workspace = id(2); role = 'owner'; writes = 0;
}
function request(provider = 'clockify', action = 'disconnect', headers = {}) {
  return new Request(`https://${host}/api/integrations/${provider}/${action}`, { method: 'POST', headers: {
    host, origin: `https://${host}`, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ connectionId: id(3), confirmation: 'disconnect' }) });
}
after(() => { security.admin = originalAdmin; process.env = originalEnv; });
test('preview qualification binds immutable deployment, time, provider and exact non-OAuth action', () => {
  configure(); const req = request(); assert.equal(reportingPreviewOrigin(req, 'clockify', 'disconnect'), `https://${host}`);
  security.assertRequest(req, false, { provider: 'clockify', action: 'disconnect' });
  assertReportingPreviewActor(req, 'clockify', 'disconnect', { user: { id: actor }, workspaceId: workspace });
  for (const value of [{ ...manifest, expiresAt: new Date(now - 1).toISOString() }, { ...manifest, expiresAt: new Date(now + 7200000).toISOString() },
    { ...manifest, providers: ['clockify', 'clockify'] }, { ...manifest, providers: ['xero'] }]) {
    configure(value); assert.equal(reportingPreviewOrigin(req, 'clockify', 'disconnect'), null);
  }
  configure(); process.env.VERCEL_ENV = 'production'; assert.equal(reportingPreviewOrigin(req, 'clockify', 'disconnect'), null);
  configure(); process.env.VERCEL_URL = 'different.vercel.app'; assert.equal(reportingPreviewOrigin(req, 'clockify', 'disconnect'), null);
  configure(); assert.equal(reportingPreviewOrigin(request('xero'), 'xero', 'disconnect'), null);
  assert.equal(reportingPreviewOrigin(request('clockify', 'callback'), 'clockify', 'callback'), null);
  assert.equal(reportingPreviewOrigin(req, 'katana', 'disconnect'), null);
});
test('preview headers and actor/workspace checks precede any mutation and redirects stay on approved origin', async () => {
  const context = { params: Promise.resolve({ provider: 'clockify', action: 'disconnect' }) };
  configure(); const result = await post(request(), context); assert.equal(writes, 1);
  assert.equal(new URL(result.headers.get('location')).origin, `https://${host}`);
  for (const headers of [{ origin: 'https://evil.invalid' }, { host: 'evil.invalid' }, { 'x-forwarded-host': 'evil.invalid' }, { 'x-forwarded-proto': 'http' }]) {
    configure(); await post(request('clockify', 'disconnect', headers), context); assert.equal(writes, 0);
  }
  for (const change of ['actor', 'workspace', 'role']) {
    configure(); if (change === 'actor') actor = id(99); else if (change === 'workspace') workspace = id(99); else role = 'viewer';
    await post(request(), context); assert.equal(writes, 0);
  }
  configure(); delete process.env.REPORTING_PREVIEW_QUALIFICATION;
  await post(request(), context); assert.equal(writes, 0);
  security.assertRequest(new Request('https://www.vaeroex.com/api/integrations/clockify/disconnect', {
    method: 'POST', headers: { host: 'www.vaeroex.com', origin: 'https://www.vaeroex.com' } }));
});
