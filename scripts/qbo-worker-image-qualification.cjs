/* eslint-disable @typescript-eslint/no-require-imports -- Owned credential-free Linux image qualification. */
'use strict';
// Reproduce on an existing local Linux/amd64 Docker host:
//   node scripts/qbo-worker-image-qualification.cjs
// No registry push, cloud build, provider request, or deployment is performed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const limits = Object.freeze({ buildMs: 900_000, smokeMs: 120_000, commandMs: 30_000,
  minimumFreeBytes: 10 * 1024 ** 3, maximumDiskGrowthBytes: 8 * 1024 ** 3,
  smokeMemoryBytes: 256 * 1024 ** 2, smokeCpus: 1, smokePids: 128 });
const inputs = ['.dockerignore', 'package.json', 'pnpm-lock.yaml', 'patches', 'lib', 'tsconfig.json',
  'services/external-integrations-qbo/Dockerfile', 'services/external-integrations-qbo/src',
  'services/external-integrations-qbo/image-smoke.mjs'];
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const freeBytes = location => { const stat = fs.statfsSync(location); return stat.bavail * stat.bsize; };

function verifyHost(platform, architecture, host, context) {
  assert.equal(platform, 'linux', 'An existing Linux Docker host is required; do not substitute a host bundle build.');
  assert.equal(architecture, 'x64', 'This qualification requires Linux/amd64.');
  assert.ok(!host || /^unix:\/\//.test(host), 'Remote DOCKER_HOST is forbidden.');
  assert.equal(context.length, 1, 'Exactly one Docker context is required.');
  const endpoint = context[0]?.Endpoints?.docker?.Host;
  assert.ok(typeof endpoint === 'string' && /^unix:\/\//.test(endpoint), 'Only a local Unix Docker socket is allowed.');
  return host || endpoint;
}
function verifyImage(image, sourceCommit, imageId) {
  assert.equal(image.Id, imageId, 'Built image identity mismatch.');
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  assert.equal(image.Config?.User, '65532:65532');
  assert.equal(image.Config?.Labels?.['org.opencontainers.image.revision'], sourceCommit);
  assert.deepEqual(image.Config?.Cmd, ['--conditions=react-server', 'index.js']);
}
function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: limits.commandMs,
    maxBuffer: 8 * 1024 ** 2, ...options });
  assert.equal(result.status, 0, `${path.basename(binary)} ${args[0]} failed (${result.error?.code || result.status})`);
  return result.stdout.trim();
}

async function main() {
  // Fail before any Docker mutation on unsupported hosts or remote contexts.
  const context = JSON.parse(command('docker', ['context', 'inspect']));
  const endpoint = verifyHost(process.platform, process.arch, process.env.DOCKER_HOST, context);
  const sourceCommit = command('git', ['rev-parse', 'HEAD']);
  const sourceTree = command('git', ['rev-parse', 'HEAD^{tree}']);
  assert.match(sourceCommit, /^[a-f0-9]{40}$/); assert.match(sourceTree, /^[a-f0-9]{40}$/);
  command('git', ['diff', '--quiet', 'HEAD', '--', ...inputs]);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-image-qualification-'));
  const nonce = crypto.randomBytes(10).toString('hex');
  const tag = `vaeroex-qbo-qualification:${nonce}`;
  const containerName = `vaeroex-qbo-smoke-${nonce}`;
  const contextRoot = path.join(scratch, 'context'); fs.mkdirSync(contextRoot);
  const dockerConfig = path.join(scratch, 'docker-config'); fs.mkdirSync(dockerConfig, { mode: 0o700 });
  // Deliberately do not inherit registry credentials, provider/cloud secrets,
  // proxy configuration, NODE_OPTIONS or SSH-agent access into Docker commands.
  const dockerEnv = { PATH: process.env.PATH, DOCKER_CONFIG: dockerConfig, DOCKER_HOST: endpoint };
  const docker = args => {
    commands.push({ executable: 'docker', args, timeoutMs: limits.commandMs });
    return command('docker', args, { env: dockerEnv });
  };
  let imageId, stage = 'preflight', failure, result, ownedContainer = false, buildCancellationUnconfirmed = false;
  const started = Date.now();
  const commands = [];
  const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  const initialFree = freeBytes(scratch);
  const checkDisk = () => {
    const remaining = freeBytes(scratch);
    assert.ok(remaining >= limits.minimumFreeBytes, 'Available disk fell below the 10 GiB stop condition.');
    assert.ok(initialFree - remaining <= limits.maximumDiskGrowthBytes, 'Disk growth exceeded the 8 GiB stop condition.');
  };
  const runBounded = async (args, timeoutMs, logName) => {
    commands.push({ executable: 'docker', args, timeoutMs });
    const log = fs.openSync(path.join(scratch, logName), 'wx', 0o600);
    const child = spawn('docker', args, { cwd: root, env: dockerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let captured = '', rejection;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      fs.writeSync(log, bytes); process.stdout.write(bytes);
      if (captured.length < 2 * 1024 ** 2) captured += bytes.toString('utf8');
    });
    const stop = reason => {
      rejection = reason;
      if (args[0] === 'build') buildCancellationUnconfirmed = true;
      child.kill('SIGTERM');
    };
    const timer = setTimeout(() => stop(new Error(`Image ${logName} exceeded its bounded timeout.`)), timeoutMs);
    const diskTimer = setInterval(() => { try { checkDisk(); } catch (error) { stop(error); } }, 1000);
    let killTimer;
    const ensureKill = setInterval(() => { if (rejection && !killTimer) killTimer = setTimeout(() => child.kill('SIGKILL'), 5000); }, 100);
    try {
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      if (rejection) throw rejection;
      assert.equal(code, 0, `${logName} failed (${code}); exact output retained in CI logs.`);
      return captured;
    } finally { clearTimeout(timer); clearTimeout(killTimer); clearInterval(diskTimer); clearInterval(ensureKill); fs.closeSync(log); }
  };
  try {
    checkDisk();
    const info = JSON.parse(docker(['info', '--format', '{{json .}}']));
    assert.equal(info.OSType, 'linux');
    assert.ok(['x86_64', 'amd64'].includes(info.Architecture), 'Docker server must be amd64.');
    result = { qualification: 'qbo_linux_image', sourceCommit, sourceTree,
      workflowSha: process.env.GITHUB_SHA || null, runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null, limits,
      host: { platform: process.platform, architecture: process.arch, cpus: os.cpus().length,
        memoryBytes: os.totalmem(), initialFreeBytes: initialFree },
      docker: { serverVersion: info.ServerVersion, cpus: info.NCPU, memoryBytes: info.MemTotal,
        driver: info.Driver, architecture: info.Architecture }, commands,
      network: { build: 'public pinned images and dependency downloads only; no inherited credentials', smoke: 'none' },
      imagePushed: false, providerCalls: 0, databaseConnections: 0 };
    if (process.env.GITHUB_EVENT_PATH) {
      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      result.pullRequestHead = event.pull_request?.head?.sha || null;
    }
    stage = 'tracked_source_archive';
    const archive = path.join(scratch, 'source.tar');
    command('git', ['archive', '--format=tar', '--output', archive, sourceCommit, '--', ...inputs]);
    assert.ok(fs.statSync(archive).size <= 128 * 1024 ** 2, 'Tracked Docker context exceeds 128 MiB.');
    command('tar', ['-xf', archive, '-C', contextRoot]);
    const dockerfile = path.join(contextRoot, 'services/external-integrations-qbo/Dockerfile');
    const smoke = path.join(contextRoot, 'services/external-integrations-qbo/image-smoke.mjs');
    const bases = [...fs.readFileSync(dockerfile, 'utf8').matchAll(/^FROM (\S+) AS /gm)].map(match => match[1]);
    assert.equal(bases.length, 2); for (const base of bases) assert.match(base, /@sha256:[a-f0-9]{64}$/);
    result.inputs = { dockerfileSha256: sha256(dockerfile), smokeSha256: sha256(smoke),
      packageSha256: sha256(path.join(contextRoot, 'package.json')),
      lockfileSha256: sha256(path.join(contextRoot, 'pnpm-lock.yaml')),
      patchSha256: sha256(path.join(contextRoot, 'patches/next@15.5.24.patch')), archiveSha256: sha256(archive), bases };
    stage = 'linux_image_build';
    const iid = path.join(scratch, 'image-id');
    await runBounded(['build', '--platform=linux/amd64', '--pull', '--progress=plain', '--iidfile', iid,
      '--build-arg', `QBO_SOURCE_COMMIT=${sourceCommit}`, '--tag', tag, '--file', dockerfile, contextRoot], limits.buildMs, 'build.log');
    imageId = fs.readFileSync(iid, 'utf8').trim(); assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
    const image = JSON.parse(docker(['image', 'inspect', imageId]))[0]; verifyImage(image, sourceCommit, imageId);
    result.image = { id: imageId, repoDigests: image.RepoDigests, sizeBytes: image.Size,
      architecture: image.Architecture, os: image.Os, user: image.Config.User, sourceCommit: image.Config.Labels['org.opencontainers.image.revision'],
      rootFsLayers: image.RootFS.Layers };
    stage = 'network_none_smoke';
    // Create before start so resource/isolation settings can be inspected.
    docker(['create', '--name', containerName, '--label', `com.vaeroex.qbo-image-qualification=${nonce}`,
      '--pull=never', '--platform=linux/amd64', '--network=none', '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges:true', '--cpus=1', '--memory=256m', '--memory-swap=256m', '--pids-limit=128',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
      '--mount', `type=bind,source=${smoke},target=/qbo-image-smoke.mjs,readonly`, imageId,
      '/qbo-image-smoke.mjs', sourceCommit]);
    ownedContainer = true;
    const container = JSON.parse(docker(['inspect', containerName]))[0];
    assert.equal(container.Image, imageId); assert.equal(container.Config.Labels['com.vaeroex.qbo-image-qualification'], nonce);
    assert.equal(container.HostConfig.NetworkMode, 'none'); assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.equal(container.HostConfig.Memory, limits.smokeMemoryBytes); assert.equal(container.HostConfig.NanoCpus, 1_000_000_000);
    assert.equal(container.HostConfig.PidsLimit, limits.smokePids);
    const output = await runBounded(['start', '--attach', containerName], limits.smokeMs, 'smoke.log');
    const finished = JSON.parse(docker(['inspect', containerName]))[0];
    assert.equal(finished.State.ExitCode, 0); assert.equal(finished.State.OOMKilled, false);
    const records = output.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const proof = records.find(record => record.imageSmoke === 'passed');
    assert.ok(proof, 'The unchanged runtime smoke must report its explicit pass.');
    assert.equal(proof.modes, 6); assert.equal(proof.network, 'none'); assert.equal(proof.providerCalls, 0); assert.equal(proof.databaseConnections, 0);
    result.smoke = proof; result.containerState = { exitCode: finished.State.ExitCode, oomKilled: finished.State.OOMKilled };
    checkDisk(); stage = 'complete';
  } catch (error) { failure = error; }
  finally {
    const cleanup = [];
    if (ownedContainer) {
      try {
        const owned = JSON.parse(docker(['inspect', containerName]))[0];
        assert.equal(owned.Config.Labels['com.vaeroex.qbo-image-qualification'], nonce);
        docker(['rm', '--force', containerName]); cleanup.push('owned smoke container removed');
      } catch (error) { failure ||= error; cleanup.push('owned container cleanup failed'); }
    }
    // Remove only the random qualification tag. Do not prune shared caches/base images.
    try {
      const probe = spawnSync('docker', ['image', 'inspect', tag], { env: dockerEnv, encoding: 'utf8', timeout: limits.commandMs });
      if (probe.status === 0) { docker(['image', 'rm', tag]); cleanup.push('owned image tag removed'); }
    } catch (error) { failure ||= error; cleanup.push('owned image cleanup failed'); }
    const report = { ...(result || { qualification: 'qbo_linux_image', sourceCommit, sourceTree, limits }),
      status: failure ? 'failed' : 'passed', stage, elapsedMs: Date.now() - started,
      diskGrowthBytes: initialFree - freeBytes(scratch), cleanup,
      buildCancellationUnconfirmed,
      ...(buildCancellationUnconfirmed ? { cancellationLimit: 'Docker client cancellation is best effort; the disposable CI runner teardown is the final build-resource bound. Do not rerun on a shared local daemon until its cancelled build is confirmed stopped.' } : {}),
      ...(failure ? { failure: failure.message } : {}) };
    emit(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\nQBO Linux image qualification: **${report.status}**\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (failure) throw failure;
}

module.exports = { verifyHost, verifyImage, limits };
if (require.main === module) main().catch(error => { console.error(`QBO image qualification failed: ${error.message}`); process.exitCode = 1; });
