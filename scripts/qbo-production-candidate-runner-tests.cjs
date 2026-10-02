/* eslint-disable @typescript-eslint/no-require-imports -- Offline runner contract checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { checkTap, expandFixture, suiteRequests, candidateDblinkSetting, candidates, pendingSuite, eligibilitySuite } = require('./run-qbo-production-candidate-database-tests.cjs');
const { verifyLocalContext, verifyOwnedContainer, verifyBridgeGateway } = require('./qbo-candidate-local-container.cjs');
let assertions = 0;
assert.equal(candidates.at(-2), '20261002012700_qbo_customer_pending_attempt_control.sql'); assertions++;
assert.equal(candidates.at(-1), '20261002025212_qbo_customer_pending_cancellation_eligibility.sql'); assertions++;
assert.equal(new Set(candidates).size, candidates.length, 'each candidate is applied once per migration shape'); assertions++;
assert.deepEqual(pendingSuite, { file: 'scripts/qbo-pending-connection-database-tests.cjs', pending: true, expectedScenarios: 14 }); assertions++;
assert.ok(fs.existsSync(path.join(__dirname, '..', pendingSuite.file)), 'registered native suite exists'); assertions++;
assert.deepEqual(eligibilitySuite, { file: 'scripts/qbo-pending-cancellation-eligibility-database-tests.cjs', eligibility: true, expectedScenarios: 19 }); assertions++;
assert.ok(fs.existsSync(path.join(__dirname, '..', eligibilitySuite.file)), 'registered eligibility suite exists'); assertions++;
const candidateRunner = fs.readFileSync(path.join(__dirname, 'run-qbo-production-candidate-database-tests.cjs'), 'utf8');
assert.match(candidateRunner, /accounting: true \}, pendingSuite, eligibilitySuite\]/, 'pending and eligibility tests run with the required candidate suites'); assertions++;
assert.match(candidateRunner, /outcome\.assertions = await require\('\.\/qbo-pending-connection-database-tests\.cjs'\)\.qualify\(\{ client: runner, connection: config \}\)/,
  'pending tests use the owned per-suite database clone'); assertions++;
assert.match(candidateRunner, /outcome\.assertions = await require\('\.\/qbo-pending-cancellation-eligibility-database-tests\.cjs'\)\.qualify\(\{ client: runner, connection: config \}\)/,
  'eligibility tests use the owned per-suite database clone'); assertions++;
assert.match(candidateRunner, /assert\.equal\(outcome\.assertions, suite\.expectedScenarios/, 'incomplete native coverage fails the candidate run'); assertions++;
assert.match(candidateRunner, /result\.suites\.length === suites\.length \+ 4/, 'candidate success requires all four native suites'); assertions++;
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/ci.yml'), 'utf8');
assert.match(workflow.slice(workflow.indexOf('  security-database:')), /Qualify QBO completion on canonical and exact Production migration shapes[\s\S]*run: pnpm test:qbo-production-database --supabase-local/,
  'hosted security-database CI runs the candidate chain and pending scenarios'); assertions++;
assert.equal(checkTap(['1..2', 'ok 1 - first', 'ok 2 - second']), 2); assertions++;
assert.equal(checkTap(['ok 1 - first', '# diagnostic', '1..1']), 1); assertions++;
for (const lines of [
  [], ['1..0'], ['ok 1 - no plan'], ['1..2', 'ok 1 - incomplete'],
  ['1..1', 'ok 2 - missing first'], ['1..2', 'ok 1 - first', 'ok 1 - repeated'],
  ['1..1', 'not ok 1 - failure'], ['1..1', 'ok 1 - skipped # SKIP unavailable'],
  ['1..1', 'ok 1 - pending # TODO implement'], ['1..1 # SKIP all', 'ok 1 - fake'],
  ['1..1', 'ok 1 - first', 'Bail out! failed'], ['1..1', 'ok 1 - first', '# Looks like you failed a test'],
  ['1..1', '1..1', 'ok 1 - duplicate plan'],
]) {
  assert.throws(() => checkTap(lines)); assertions++;
}
assert.equal(expandFixture('select 1;', undefined), 'select 1;'); assertions++;
assert.equal(expandFixture('\\ir fixtures/qbo-production-native.sql\nselect 2;', 'select 1;'), 'select 1;\nselect 2;'); assertions++;
for (const [sql, fixture] of [
  ['\\ir /etc/passwd', 'select 1;'], ['\\i fixtures/qbo-production-native.sql', 'select 1;'],
  ['\\ir fixtures/qbo-production-native.sql', undefined],
  ['\\ir fixtures/qbo-production-native.sql\n\\ir fixtures/qbo-production-native.sql', 'select 1;'],
  ['\\ir fixtures/qbo-production-native.sql', '\\ir nested.sql'], ['\\connect external', 'select 1;'],
]) { assert.throws(() => expandFixture(sql, fixture)); assertions++; }
const context = [{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }];
verifyLocalContext(context, undefined); assertions++;
assert.throws(() => verifyLocalContext(context, 'tcp://remote:2376')); assertions++;
assert.throws(() => verifyLocalContext([{ Endpoints: { docker: { Host: 'ssh://remote' } } }])); assertions++;
assert.throws(() => verifyLocalContext([])); assertions++;
const bridge = { Name: 'bridge', Driver: 'bridge', Scope: 'local', IPAM: { Config: [{ Gateway: '172.17.0.1' }] } };
assert.equal(verifyBridgeGateway([bridge]), '172.17.0.1'); assertions++;
for (const mutate of [
  item => { item.Name = 'another-network'; }, item => { item.Driver = 'host'; },
  item => { item.Scope = 'swarm'; }, item => { item.IPAM.Config = []; },
  item => { item.IPAM.Config[0].Gateway = '172.17.0.1/16'; },
  item => { item.IPAM.Config[0].Gateway = '172.17.0.1; echo untrusted'; },
  item => { item.IPAM.Config[0].Gateway = '::1'; },
  item => { item.IPAM.Config.push({ Gateway: '172.18.0.1' }); },
]) {
  const changed = structuredClone(bridge); mutate(changed);
  assert.throws(() => verifyBridgeGateway([changed])); assertions++;
}
assert.throws(() => verifyBridgeGateway([])); assertions++;
assert.throws(() => verifyBridgeGateway([bridge, bridge])); assertions++;
const proof = { id: 'container-id', name: 'unique-name', image: 'sha256:exact-image', nonce: 'unique-nonce' };
const container = { Id: proof.id, Name: `/${proof.name}`, Image: proof.image,
  Config: { Labels: { 'com.vaeroex.qbo-test': proof.nonce } },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54322' }] } } };
assert.equal(verifyOwnedContainer(container, proof), 54322); assertions++;
for (const mutate of [
  item => { item.Id = 'another-container'; }, item => { item.Name = '/another-name'; },
  item => { item.Image = 'sha256:another-image'; }, item => { item.Config.Labels['com.vaeroex.qbo-test'] = 'another-owner'; },
  item => { item.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; },
  item => { item.NetworkSettings.Ports['5432/tcp'][0].HostPort = '65536'; },
  item => { item.NetworkSettings.Ports['5432/tcp'].push({ HostIp: '::', HostPort: '54322' }); },
]) {
  const changed = structuredClone(container); mutate(changed);
  assert.throws(() => verifyOwnedContainer(changed, proof)); assertions++;
}
const oauthFile = 'supabase/tests/qbo_customer_oauth_completion.test.sql';
const sql = "begin; select '$$ unchanged';\ncommit;\nbegin;\nset local search_path=public,extensions;\nselect 1;rollback;";
const requests = suiteRequests(sql, oauthFile);
assert.equal(requests.length, 2); assertions++;
assert.equal(requests.join(''), sql, 'request boundaries preserve every SQL byte'); assertions++;
assert.ok(requests[0].endsWith('commit;') && requests[1].startsWith('\nbegin;')); assertions++;
assert.throws(() => suiteRequests('select 1;', oauthFile)); assertions++;
assert.throws(() => suiteRequests(sql + sql, oauthFile)); assertions++;
assert.deepEqual(suiteRequests(sql, 'another-suite.sql'), [sql]); assertions++;

const clone = `qbo_candidate_case_${'a'.repeat(20)}`;
const outerConnection = { host: '127.0.0.1', port: 54321, user: 'postgres', ssl: false, password: 'synthetic-not-in-dblink' };
assert.equal(Buffer.from(candidateDblinkSetting('owned-supabase-image', outerConnection, clone), 'base64').toString(),
  `host=/tmp port=5432 dbname=${clone} user=postgres`, 'owned container dblink uses its inner socket, not outer TCP/port/password'); assertions++;
for (const host of ['/tmp/square-qualification-Abc123/socket', '/private/tmp/square-qualification-Abc123/socket']) {
  assert.equal(Buffer.from(candidateDblinkSetting('native-postgres', { ...outerConnection, host, port: 5432 }, clone), 'base64').toString(),
    `host=${host} port=5432 dbname=${clone} user=postgres`, 'native runtime retains its exact private socket'); assertions++;
}
for (const [kind, overrides, database] of [
  ['supabase-local', {}, clone], ['unowned', {}, clone],
  ['owned-supabase-image', { host: 'database.example' }, clone],
  ['owned-supabase-image', { host: '/tmp' }, clone],
  ['owned-supabase-image', { port: 0 }, clone], ['owned-supabase-image', { port: 65536 }, clone],
  ['owned-supabase-image', { port: '54321' }, clone], ['owned-supabase-image', { user: 'another_role' }, clone],
  ['owned-supabase-image', { ssl: true }, clone], ['owned-supabase-image', {}, 'postgres'],
  ['owned-supabase-image', {}, clone + ' host=remote'],
  ['native-postgres', {}, clone], ['native-postgres', { host: '/tmp', port: 5432 }, clone],
  ['native-postgres', { host: '/tmp/shared/socket', port: 5432 }, clone],
  ['native-postgres', { host: '/tmp/square-qualification-Abc123/socket', port: 5433 }, clone],
]) {
  assert.throws(() => candidateDblinkSetting(kind, { ...outerConnection, ...overrides }, database)); assertions++;
}

// Exercise the real helper's orchestration with fake process/database boundaries.
// No Docker daemon, PostgreSQL process, credentials, or network are used here.
async function containerLifecycleTests() {
  for (const failure of [null, 'launch', 'version', 'callback', 'cleanup-identity',
    'hba', 'password', 'refused', 'unknown', 'transient', 'exited', 'gateway']) {
    const calls = [], clients = [], guards = [], delays = [];
    const childEnvironment = { PATH: '/synthetic/bin', QBO_CANDIDATE_PASSWORD: 'inherited-synthetic-value' };
    const ownId = 'b'.repeat(64), sourceId = 'a'.repeat(64), image = `sha256:${'c'.repeat(64)}`;
    let launch, closing = false;
    const output = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
    const fakeSpawn = (command, args, options) => {
      assert.equal(command, 'docker');
      calls.push({ args: Array.from(args), options });
      if (args[0] === 'context') return output(context);
      if (args[0] === 'network') {
        assert.deepEqual(Array.from(args), ['network', 'inspect', 'bridge']);
        return output([bridge]);
      }
      if (args[0] === 'inspect' && args[1] === 'supabase_db_candidate-test') return output([{ Id: sourceId,
        Name: '/supabase_db_candidate-test', State: { Running: true }, Image: image, Config: { Image: 'supabase/postgres:17' } }]);
      if (args[0] === 'exec') {
        assert.deepEqual(Array.from(args), ['exec', sourceId, 'pg_config', '--bindir']);
        return output('/usr/lib/postgresql/17/bin');
      }
      if (args[0] === 'run') {
        launch = { args: Array.from(args), options };
        return failure === 'launch' ? { status: 1, stderr: options.env.QBO_CANDIDATE_PASSWORD } : output(ownId);
      }
      if (args[0] === 'inspect' && args[1] === ownId) return output([{
        Id: closing && failure === 'cleanup-identity' ? sourceId : ownId,
        Name: `/${launch.args[launch.args.indexOf('--name') + 1]}`, Image: image, State: { Running: failure !== 'exited' },
        Config: { Labels: { 'com.vaeroex.qbo-test': launch.args[launch.args.indexOf('--label') + 1].split('=')[1] } },
        NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] },
          Networks: { bridge: { Gateway: failure === 'gateway' ? '172.18.0.1' : '172.17.0.1' } } },
      }]);
      if (args[0] === 'rm') {
        assert.deepEqual(Array.from(args), ['rm', '--force', ownId]);
        return output(ownId);
      }
      throw new Error(`Unexpected fake Docker command: ${args[0]}`);
    };
    class FakeClient {
      constructor(config) { this.config = config; clients.push(this); }
      on() {}
      async connect() {
        const codes = { hba: '28000', password: '28P01', refused: 'ECONNREFUSED',
          unknown: launch.options.env.QBO_CANDIDATE_PASSWORD };
        const code = failure === 'transient' && clients.length <= 2 ? ['ECONNREFUSED', '57P03'][clients.length - 1] : codes[failure];
        if (code) throw Object.assign(new Error(launch.options.env.QBO_CANDIDATE_PASSWORD), { code });
      }
      async end() { this.ended = true; closing = true; }
      async query(sql) {
        if (sql.includes("current_setting('server_version_num')")) return { rows: [{
          version: failure === 'version' ? 160000 : 170006, data: '/tmp/qbo-candidate-data',
          cluster: /cluster_name=(\w+)/.exec(launch.args.at(-1))[1], db: 'postgres', port: 5432,
        }] };
        if (sql === 'select current_database() as db') return { rows: [{ db: this.config.database }] };
        return { rows: [] };
      }
    }
    const testModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'qbo-candidate-local-container.cjs'), 'utf8'), {
      module: testModule, __dirname, process: { env: childEnvironment },
      require(name) {
        if (name === 'node:child_process') return { spawnSync: fakeSpawn };
        if (name === 'node:timers/promises') return { async setTimeout(ms) { delays.push(ms); } };
        if (name === 'pg') return { Client: FakeClient };
        if (name === './run-square-durable-page-qualification.js') return {
          assertNoRemoteConfiguration() { guards.push('remote'); }, assertNoLinkedProject() { guards.push('linked'); },
        };
        if (name === 'node:fs') return { readFileSync(file) {
          if (file.endsWith('/supabase/config.toml')) return 'project_id = "candidate-test"';
          assert.ok(file.endsWith('/supabase/tests/fixtures/square-durable-platform.sql'));
          return 'select 1;';
        } };
        return require(name);
      },
    });
    let callbackReached = false, error;
    try {
      await testModule.exports.runContainerQualification(async runtime => {
        callbackReached = true;
        assert.equal(runtime.targetKind, 'owned-supabase-image'); assertions++;
        const database = await runtime.createDatabase('qualification');
        assert.equal(database.connection.host, '127.0.0.1'); assertions++;
        assert.equal(database.connection.port, 54321); assertions++;
        assert.equal(database.dblinkConnection, `host=/tmp port=5432 dbname=${database.name} user=postgres`); assertions++;
        if (failure === 'callback') throw new Error('synthetic qualification failure');
      });
    } catch (caught) { error = caught; }
    assert.equal(Boolean(error), ![null, 'transient'].includes(failure)); assertions++;
    assert.equal(callbackReached, [null, 'transient', 'callback', 'cleanup-identity'].includes(failure)); assertions++;
    assert.deepEqual(guards, ['remote', 'linked']); assertions++;
    const password = launch.options.env.QBO_CANDIDATE_PASSWORD;
    assert.match(password, /^[a-f0-9]{48}$/); assertions++;
    assert.ok(calls.every(call => call.args.every(arg => !arg.includes(password))), 'no password in any Docker argv'); assertions++;
    assert.equal(launch.args[launch.args.indexOf('--env') + 1], 'QBO_CANDIDATE_PASSWORD'); assertions++;
    assert.equal(launch.options.env.PATH, childEnvironment.PATH); assertions++;
    assert.equal(childEnvironment.QBO_CANDIDATE_PASSWORD, 'inherited-synthetic-value', 'parent environment is unchanged'); assertions++;
    assert.ok(calls.filter(call => call.args[0] !== 'run')
      .every(call => call.options.env.QBO_CANDIDATE_PASSWORD !== password), 'generated password scoped to launch child only'); assertions++;
    assert.ok(!String(error).includes(password), 'launch failure cannot expose a password from stderr'); assertions++;
    if (['hba', 'password', 'refused', 'unknown'].includes(failure)) {
      const expectedCode = { hba: '28000', password: '28P01', refused: 'ECONNREFUSED', unknown: 'unknown' }[failure];
      assert.equal(error.message, `owned disposable PostgreSQL startup timed out (last connection code: ${expectedCode})`); assertions++;
      assert.equal(clients.length, 60, 'retain the existing startup attempt bound'); assertions++;
      assert.deepEqual(delays, Array(60).fill(500), 'retain the existing startup retry delay'); assertions++;
    } else if (failure === 'transient') {
      assert.deepEqual(delays, [500, 500], 'connection refusal and PostgreSQL startup are retried'); assertions++;
    } else if (failure === 'exited') {
      assert.match(error.message, /^owned PostgreSQL container exited during startup/); assertions++;
      assert.equal(clients.length, 0, 'an exited owned container cannot reach database qualification'); assertions++;
    } else if (failure === 'gateway') {
      assert.match(error.message, /^owned container uses the inspected Docker bridge gateway/); assertions++;
      assert.equal(clients.length, 0, 'a mismatched bridge cannot reach database qualification'); assertions++;
    }
    assert.ok(launch.args.includes('--pull=never') && launch.args.includes(image)); assertions++;
    assert.equal(launch.args[launch.args.indexOf('--publish') + 1], '127.0.0.1::5432'); assertions++;
    assert.equal(launch.args[launch.args.indexOf('--user') + 1], 'postgres'); assertions++;
    assert.equal(launch.args[launch.args.indexOf('--network') + 1], 'bridge'); assertions++;
    assert.ok(!launch.args.some(arg => ['--volume', '-v', '--mount'].includes(arg)), 'no host mounts'); assertions++;
    assert.equal(calls.filter(call => call.args[0] === 'rm').length,
      ['launch', 'cleanup-identity'].includes(failure) ? 0 : 1, 'cleanup requires proven ownership even after failure'); assertions++;
    assert.ok(clients.every(client => client.ended), 'all opened clients are closed'); assertions++;
    if (failure === null) startupShellTests(launch.args.at(-1));
  }
}

function startupShellTests(script) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-candidate-shell-test-'));
  try {
    const passwordLine = script.split('\n').find(line => line.startsWith('printf ') && line.endsWith(' > /tmp/qbo-candidate-password'));
    assert.ok(passwordLine, 'exercise the actual rendered password-file command'); assertions++;
    const passwordFile = path.join(directory, 'password');
    const result = spawnSync('/bin/sh', ['-c', 'umask 077\n' + passwordLine.replace('/tmp/qbo-candidate-password', '"$QBO_TEST_PASSWORD_FILE"')], {
      env: { QBO_CANDIDATE_PASSWORD: 'synthetic-fixture', QBO_TEST_PASSWORD_FILE: passwordFile }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0); assertions++;
    assert.deepEqual(fs.readFileSync(passwordFile), Buffer.from('synthetic-fixture\n'), 'pwfile contains exactly the password and one newline, no literal backslash suffix'); assertions++;
    assert.equal(fs.statSync(passwordFile).mode & 0o777, 0o600); assertions++;
    assert.equal(result.stdout + result.stderr, '', 'password-file setup prints nothing'); assertions++;
    const hbaLine = script.split('\n').find(line => line.endsWith(' >> /tmp/qbo-candidate-data/pg_hba.conf'));
    assert.ok(hbaLine, 'custom entrypoint must add access for Docker bridge-forwarded clients'); assertions++;
    const hbaFile = path.join(directory, 'pg_hba.conf');
    fs.writeFileSync(hbaFile, 'local all all trust\n', { mode: 0o600 });
    const hba = spawnSync('/bin/sh', ['-c', hbaLine.replace('/tmp/qbo-candidate-data/pg_hba.conf', '"$QBO_TEST_HBA_FILE"')], {
      env: { QBO_TEST_HBA_FILE: hbaFile }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(hba.status, 0); assertions++;
    assert.equal(fs.readFileSync(hbaFile, 'utf8'), 'local all all trust\nhost all postgres 172.17.0.1/32 scram-sha-256\n',
      'preserve local rules and append only gateway /32 postgres-role SCRAM, never host trust or a broad CIDR'); assertions++;
    assert.ok(script.indexOf(hbaLine) > script.indexOf('initdb ') && script.indexOf(hbaLine) < script.indexOf('exec postgres '),
      'configure bridge access after initdb and before PostgreSQL starts'); assertions++;
    assert.ok(script.indexOf('rm /tmp/qbo-candidate-password') < script.indexOf('exec postgres '), 'remove password file before startup'); assertions++;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
containerLifecycleTests().then(() => {
  console.log(`QBO candidate runner: ${assertions} assertions passed; no database or network used.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
