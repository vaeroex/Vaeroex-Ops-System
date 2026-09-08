// Synthetic, local-only test: the only listener and client target are loopback.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createAcmeBootstrap } from './acme-bootstrap.mjs';
import { validateHostPolicy, validateGuestAgentConfig } from './host-preflight.mjs';

let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions += 1; }
function denies(fn, message) { assert.throws(fn, /host_preflight_denied|acme_configuration_denied/, message); assertions += 1; }
const opsDir = dirname(fileURLToPath(import.meta.url));
const serviceRoot = resolve(opsDir, '..');
const policy = {
  schemaVersion: 1, approvedUntil: '2030-01-02T00:00:00Z', operator: 'synthetic-operator',
  configurationEvidenceId: 'synthetic-host', budgetDeliveryEvidenceId: 'synthetic-budget',
  nodeVersion: 'v24.0.0', artifactSha256: 'a'.repeat(64),
  hostConfigurationReviewed: true, syntheticPrivacyPassed: true,
};
const now = Date.parse('2030-01-01T00:00:00Z');
check(validateHostPolicy(policy, now), 'complete synthetic policy accepted');
denies(() => validateHostPolicy(JSON.parse(readFileSync(join(opsDir, 'host-policy.example.json'), 'utf8')), now), 'unconfigured example denied');
for (const key of Object.keys(policy)) {
  const missing = { ...policy }; delete missing[key];
  denies(() => validateHostPolicy(missing, now), `missing ${key}`);
  denies(() => validateHostPolicy({ ...policy, [key]: null }, now), `null ${key}`);
}
for (const change of [
  { approvedUntil: '2029-12-31T00:00:00Z' }, { approvedUntil: '2031-01-01T00:00:00Z' },
  { schemaVersion: 2 }, { nodeVersion: 'v22.0.0' }, { nodeVersion: 'v24.0' },
  { hostConfigurationReviewed: false }, { syntheticPrivacyPassed: false },
  { artifactSha256: 'g'.repeat(64) }, { unexpected: true }, { operator: 'code?state' },
]) denies(() => validateHostPolicy({ ...policy, ...change }, now), 'invalid policy denied');
check(validateGuestAgentConfig(readFileSync(join(opsDir, 'instance_configs.cfg'), 'utf8')), 'exact Core config accepted');
for (const bad of [
  '[Core]\ncloud_logging_enabled=true\nacs_client=false',
  '[Core]\ncloud_logging_enabled=true\nacs_client=true\n[Other]\ncloud_logging_enabled=false\nacs_client=false',
  '[Core]\ncloud_logging_enabled=false\ncloud_logging_enabled=true\nacs_client=false',
  '[Core]\ncloud_logging_enabled=false\nacs_client=false\n[Core]',
  '[Core]\ncloud_logging_enabled=false\nacs_client=true',
]) denies(() => validateGuestAgentConfig(bad), 'effective/duplicate guest config denied');

const unit = readFileSync(join(opsDir, 'vaeroex-square-callback.service'), 'utf8');
for (const line of ['Restart=no', 'RuntimeMaxSec=3600', 'StandardOutput=null', 'StandardError=null',
  'LimitCORE=0', 'MemorySwapMax=0', 'User=vaeroex-square-callback', 'ProtectSystem=strict',
  'AmbientCapabilities=CAP_NET_BIND_SERVICE', 'LoadCredential=tls-key:', 'LoadCredential=tls-cert:',
  'BindReadOnlyPaths=/var/lib/vaeroex-square-acme:/run/vaeroex-square-callback/acme',
  '--preflight --config /etc/vaeroex-square-callback/config.json', '--serve --config /etc/vaeroex-square-callback/config.json']) {
  check(unit.includes(line), `unit requires ${line}`);
}
check(!/^WantedBy=|^ExecReload=|^EnvironmentFile=/m.test(unit), 'no boot activation, unsafe reload, or secret envfile');
const unsetEnvironment = unit.match(/^UnsetEnvironment=(.*)$/m)?.[1].split(/\s+/) ?? [];
for (const name of ['NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'OPENSSL_CONF', 'SQUARE_SANDBOX_DATABASE_CA_PEM']) {
  check(unsetEnvironment.includes(name), `TLS trust override ${name} removed before Node startup`);
}
const bootstrapUnit = readFileSync(join(opsDir, 'vaeroex-square-acme-bootstrap.service'), 'utf8');
check(!/^Conflicts=/m.test(bootstrapUnit), 'renewal bootstrap race cannot stop an OAuth window');
const hook = readFileSync(join(opsDir, 'certbot-deploy-hook.sh'), 'utf8');
check(!/^.*systemctl.*(?:start|restart)/m.test(hook), 'renewal does not restart OAuth or reset budgets');
for (const file of ['certbot-deploy-hook.sh', 'renew-certificate.sh']) {
  const result = spawnSync('/bin/sh', ['-n', join(opsDir, file)], { stdio: 'ignore' });
  check(result.status === 0, `${file} shell syntax`);
}
const tf = ['main.tf', 'variables.tf', 'versions.tf', 'outputs.tf'].map((file) => readFileSync(join(serviceRoot, 'infra', file), 'utf8')).join('\n');
const forbiddenResource = /resource\s+"(?:google_(?:service_account|service_account_key|kms_crypto_key|kms_crypto_key_version|secret_manager_secret_version|compute_router_nat|cloud_run\w*|storage_bucket|dns_managed_zone|project_iam\w*))"/;
check(!forbiddenResource.test(tf), 'no extra fixed resources, key material, project grants or versions');
check(!/^\s*(?:data|provisioner|backend)\s+"/m.test(tf), 'no secret reads, provisioner, remote state or provider data reads');
check(!/^\s*(?:secret_data|credentials|access_token|metadata_startup_script)\s*=/m.test(tf), 'no credential payload or startup write path');
for (const setting of [/provisioning_model\s*=\s*"SPOT"/, /preemptible\s*=\s*true/, /instance_termination_action\s*=\s*"STOP"/,
  /on_host_maintenance\s*=\s*"TERMINATE"/, /automatic_restart\s*=\s*false/, /auto_delete\s*=\s*false/]) {
  check(setting.test(tf), 'Spot stops without migration, restart or disk deletion');
}
const terraformTests = readFileSync(join(serviceRoot, 'infra/tests/sandbox.tftest.hcl'), 'utf8');
check(/^mock_provider "google"/m.test(terraformTests), 'Terraform qualification uses only mocked Google');

const temporary = mkdtempSync(join(tmpdir(), 'vaeroex-square-acme-test-'));
let server;
try {
  // Model the installed /current -> release directory, including /current/ops.
  // Both normal resolution and preserved main-module symlinks must enter the
  // guard. Invalid startup must refuse silently, never masquerade as exit 0.
  const linkedRelease = join(temporary, 'current');
  symlinkSync(serviceRoot, linkedRelease, 'dir');
  const invocations = [
    { name: 'default', flags: [], environment: {} },
    { name: 'CLI preserve-main', flags: ['--preserve-symlinks-main'], environment: {} },
    { name: 'NODE_OPTIONS preserve-main', flags: [], environment: { NODE_OPTIONS: '--preserve-symlinks-main' } },
  ];
  for (const file of ['acme-bootstrap.mjs', 'host-preflight.mjs']) {
    for (const [pathName, directory] of [['direct', opsDir], ['installed symlink', join(linkedRelease, 'ops')]]) {
      for (const { name, flags, environment } of invocations) {
        const result = spawnSync(process.execPath, [...flags, join(directory, file), '--synthetic-invalid-argument'], {
          encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, ...environment },
        });
        const label = `${file}, ${pathName}, ${name}`;
        check(!result.error && result.status === 78, `${label}: executes fail-closed validation`);
        check(result.stdout === '' && result.stderr === '', `${label}: refusal is silent`);
      }
    }
  }
  const webroot = join(temporary, 'webroot');
  const challenges = join(webroot, '.well-known', 'acme-challenge');
  mkdirSync(challenges, { recursive: true, mode: 0o755 });
  const token = 'a'.repeat(43);
  const payload = `${token}.${'b'.repeat(43)}`;
  writeFileSync(join(challenges, token), payload, { mode: 0o644 });
  server = createAcmeBootstrap({ webroot, hostname: 'square-sandbox.vaeroex.com', ownerUid: process.getuid() });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  const port = server.address().port;
  async function call(path, { method = 'GET', host = 'square-sandbox.vaeroex.com', headers = {} } = {}) {
    return await new Promise((resolvePromise, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers }, agent: false, timeout: 2000 }, (response) => {
        const chunks = []; let bytes = 0;
        response.on('data', (chunk) => { bytes += chunk.length; if (bytes > 512) request.destroy(new Error('synthetic_response_limit')); else chunks.push(chunk); });
        response.on('end', () => resolvePromise({ status: response.statusCode, body: Buffer.concat(chunks).toString(), headers: response.headers }));
      });
      request.once('error', reject);
      request.once('timeout', () => request.destroy(new Error('synthetic_timeout')));
      request.end();
    });
  }
  const challengePath = `/.well-known/acme-challenge/${token}`;
  const positive = await call(challengePath);
  check(positive.status === 200 && positive.body === payload, 'exact rooted ACME challenge served');
  check(positive.headers['cache-control'] === 'no-store' && positive.headers['referrer-policy'] === 'no-referrer', 'challenge privacy headers');
  const negatives = [
    ['/?code=SYNTHETIC_CODE&state=SYNTHETIC_STATE'], ['/api/integrations/square/callback?error=SYNTHETIC_ERROR'],
    [challengePath + '?state=SYNTHETIC_STATE'], [challengePath + '#fragment'],
    ['/.well-known/acme-challenge/%2e%2e/config.json'], ['/.well-known/acme-challenge/' + 'a'.repeat(44)],
    [challengePath, { method: 'POST' }], [challengePath, { method: 'HEAD' }],
    [challengePath, { host: 'foreign.invalid' }], [challengePath, { headers: { 'Content-Length': '0' } }],
  ];
  for (const [path, options] of negatives) {
    const response = await call(path, options);
    check(response.status === 404 && response.body === '', 'non-exact input has empty fixed rejection');
    check(!response.headers.location && response.headers['cache-control'] === 'no-store' && response.headers['referrer-policy'] === 'no-referrer', 'no URL redirect or reflection');
  }
  chmodSync(join(challenges, token), 0o666);
  check((await call(challengePath)).status === 404, 'writable file denied');
  chmodSync(join(challenges, token), 0o644);
  writeFileSync(join(challenges, token), `${token}.${'b'.repeat(43)}SYNTHETIC_EXTRA`);
  check((await call(challengePath)).status === 404, 'oversized file denied');
  rmSync(join(challenges, token));
  writeFileSync(join(temporary, 'outside'), payload, { mode: 0o644 });
  symlinkSync(join(temporary, 'outside'), join(challenges, token));
  check((await call(challengePath)).status === 404, 'symlink file denied');
  check(server.maxConnections === 16 && server.maxRequestsPerSocket === 1 && server.requestTimeout === 5000, 'bootstrap finite socket and time limits');
  // A deliberately unsafe reflection is detected, without sending it to a log.
  const canary = 'SYNTHETIC_STATE';
  const detects = (value) => value.includes(canary);
  check(detects(`unsafe request ?state=${canary}`), 'privacy detector positive control');
  check(!detects(JSON.stringify(await call('/?state=' + canary))), 'actual rejection has no protected reflection');
} finally {
  if (server) { server.closeAllConnections(); await new Promise((resolvePromise) => server.close(resolvePromise)); }
  rmSync(temporary, { recursive: true, force: true });
}
process.stdout.write(`Square callback ops qualification: ${assertions} assertions passed (local synthetic only).\n`);
