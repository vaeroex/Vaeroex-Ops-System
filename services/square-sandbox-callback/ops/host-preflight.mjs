// Linux guest only, local checks only, fixed exit code, never print config/errors.
// This evidence gate is not a replacement for cryptographic host/DB authority.
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const unit = 'vaeroex-square-callback.service';
const root = '/opt/vaeroex-square-callback/current';
const policyPath = '/etc/vaeroex-square-callback/host-policy.json';

function requireCondition(condition) {
  if (!condition) throw new Error('host_preflight_denied');
}

function boundedText(path, maxBytes = 16384) {
  const info = statSync(path);
  requireCondition(info.isFile() && info.size <= maxBytes);
  // procfs reports size zero; the post-read check remains necessary.
  const bytes = readFileSync(path);
  requireCondition(bytes.length <= maxBytes);
  return bytes.toString('utf8');
}

function rootOwned(path, exactMode) {
  const info = statSync(path);
  requireCondition(info.uid === 0 && (info.mode & 0o777) === exactMode);
}

function systemctl(...args) {
  const result = spawnSync('/usr/bin/systemctl', args, {
    encoding: 'utf8', timeout: 2000, maxBuffer: 4096,
    stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin' },
  });
  const value = result.stdout?.trim();
  requireCondition(!result.error && (result.status === 0 ||
    (args[0] === 'is-enabled' && result.status === 1 && value === 'masked')));
  return value;
}

export function validateHostPolicy(policy, now = Date.now()) {
  requireCondition(policy !== null && typeof policy === 'object' && !Array.isArray(policy));
  const keys = ['schemaVersion', 'approvedUntil', 'operator', 'configurationEvidenceId',
    'budgetDeliveryEvidenceId', 'nodeVersion', 'artifactSha256',
    'hostConfigurationReviewed', 'syntheticPrivacyPassed'];
  requireCondition(Object.keys(policy).length === keys.length && keys.every((key) => Object.hasOwn(policy, key)));
  requireCondition(policy.schemaVersion === 1);
  requireCondition(typeof policy.approvedUntil === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(policy.approvedUntil));
  const expiry = Date.parse(policy.approvedUntil);
  requireCondition(Number.isFinite(expiry) && expiry > now && expiry <= now + 31 * 86400000);
  requireCondition(new Date(expiry).toISOString() === policy.approvedUntil.replace('Z', '.000Z'));
  for (const key of ['operator', 'configurationEvidenceId', 'budgetDeliveryEvidenceId']) {
    requireCondition(typeof policy[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{2,127}$/.test(policy[key]));
  }
  requireCondition(typeof policy.nodeVersion === 'string' && /^v24\.\d+\.\d+$/.test(policy.nodeVersion));
  requireCondition(typeof policy.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(policy.artifactSha256));
  requireCondition(policy.hostConfigurationReviewed === true && policy.syntheticPrivacyPassed === true);
  return true;
}

export function validateGuestAgentConfig(text) {
  requireCondition(typeof text === 'string' && text.length <= 16384);
  let section = '';
  let coreSections = 0;
  const core = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1]; if (section === 'Core') coreSections += 1; continue; }
    if (section !== 'Core') continue;
    const setting = /^([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    requireCondition(setting !== null && !core.has(setting[1]));
    core.set(setting[1], setting[2]);
  }
  requireCondition(coreSections === 1 && core.get('cloud_logging_enabled') === 'false' && core.get('acs_client') === 'false');
  return true;
}

export function verifyHost() {
  requireCondition(process.platform === 'linux' && process.getuid() === 0);
  requireCondition(process.execArgv.length === 0);
  for (const key of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'SSLKEYLOGFILE',
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_OAUTH_ACCESS_TOKEN']) {
    requireCondition(!process.env[key]);
  }
  rootOwned(policyPath, 0o640);
  rootOwned('/etc/vaeroex-square-callback/config.json', 0o640);
  const policy = JSON.parse(boundedText(policyPath));
  validateHostPolicy(policy);
  requireCondition(process.version === policy.nodeVersion);
  const artifact = realpathSync(`${root}/dist/index.js`);
  requireCondition(artifact.startsWith('/opt/vaeroex-square-callback/releases/'));
  rootOwned(artifact, 0o444);
  const artifactInfo = statSync(artifact);
  requireCondition(artifactInfo.size > 0 && artifactInfo.size <= 32 * 1024 * 1024);
  requireCondition(createHash('sha256').update(readFileSync(artifact)).digest('hex') === policy.artifactSha256);
  requireCondition(boundedText('/proc/swaps').trim().split('\n').length === 1);
  requireCondition(boundedText('/proc/sys/kernel/core_pattern').trim() === '|/bin/false');
  requireCondition(boundedText('/proc/sys/fs/suid_dumpable').trim() === '0');
  requireCondition(boundedText('/sys/kernel/kexec_crash_loaded').trim() === '0');
  requireCondition(!/(^|\s)crashkernel=/.test(boundedText('/proc/cmdline')));
  for (const target of ['sleep.target', 'suspend.target', 'hibernate.target', 'hybrid-sleep.target', 'suspend-then-hibernate.target']) {
    requireCondition(systemctl('is-enabled', target) === 'masked');
  }
  for (const service of ['apport.service', 'kdump-tools.service', 'google-cloud-ops-agent.service', 'google-osconfig-agent.service']) {
    const state = spawnSync('/usr/bin/systemctl', ['is-active', '--quiet', service], {
      timeout: 2000, stdio: 'ignore', env: { PATH: '/usr/bin:/bin' },
    });
    requireCondition(!state.error && (state.status === 3 || state.status === 4));
  }
  const required = {
    StandardOutput: 'null', StandardError: 'null', LimitCORE: '0', MemorySwapMax: '0',
    NoNewPrivileges: 'yes', ProtectSystem: 'strict', ProtectHome: 'yes', Restart: 'no',
  };
  for (const [property, expected] of Object.entries(required)) {
    requireCondition(systemctl('show', unit, `--property=${property}`, '--value') === expected);
  }
  const guestConfig = boundedText('/etc/default/instance_configs.cfg');
  validateGuestAgentConfig(guestConfig);
  // Root-owned TLS source files stay on encrypted disk. systemd makes narrow,
  // read-only in-memory credentials available to the unprivileged service.
  for (const file of ['privkey.pem', 'fullchain.pem']) {
    rootOwned(realpathSync(`/etc/letsencrypt/live/square-sandbox.vaeroex.com/${file}`), 0o600);
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { verifyHost(); } catch { process.exitCode = 78; }
}
