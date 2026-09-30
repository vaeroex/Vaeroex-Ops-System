/* eslint-disable @typescript-eslint/no-require-imports -- Offline runner contract checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { checkTap, expandFixture, suiteRequests } = require('./run-qbo-production-candidate-database-tests.cjs');
const { verifyLocalContext, verifyOwnedContainer } = require('./qbo-candidate-local-container.cjs');
let assertions = 0;
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

// Exercise the real helper's orchestration with fake process/database boundaries.
// No Docker daemon, PostgreSQL process, credentials, or network are used here.
async function containerLifecycleTests() {
  for (const failure of [null, 'launch', 'version', 'callback', 'cleanup-identity']) {
    const calls = [], clients = [], guards = [];
    const childEnvironment = { PATH: '/synthetic/bin', QBO_CANDIDATE_PASSWORD: 'inherited-synthetic-value' };
    const ownId = 'b'.repeat(64), sourceId = 'a'.repeat(64), image = `sha256:${'c'.repeat(64)}`;
    let launch, closing = false;
    const output = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value) });
    const fakeSpawn = (command, args, options) => {
      assert.equal(command, 'docker');
      calls.push({ args: Array.from(args), options });
      if (args[0] === 'context') return output(context);
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
        Name: `/${launch.args[launch.args.indexOf('--name') + 1]}`, Image: image, State: { Running: true },
        Config: { Labels: { 'com.vaeroex.qbo-test': launch.args[launch.args.indexOf('--label') + 1].split('=')[1] } },
        NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] } },
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
      async connect() {}
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
    assert.equal(Boolean(error), failure !== null); assertions++;
    assert.equal(callbackReached, !['launch', 'version'].includes(failure)); assertions++;
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
    assert.ok(launch.args.includes('--pull=never') && launch.args.includes(image)); assertions++;
    assert.equal(launch.args[launch.args.indexOf('--publish') + 1], '127.0.0.1::5432'); assertions++;
    assert.equal(launch.args[launch.args.indexOf('--user') + 1], 'postgres'); assertions++;
    assert.ok(!launch.args.some(arg => ['--volume', '-v', '--mount'].includes(arg)), 'no host mounts'); assertions++;
    assert.equal(calls.filter(call => call.args[0] === 'rm').length,
      ['launch', 'cleanup-identity'].includes(failure) ? 0 : 1, 'cleanup requires proven ownership even after failure'); assertions++;
    assert.ok(clients.every(client => client.ended), 'all opened clients are closed'); assertions++;
  }
}
containerLifecycleTests().then(() => {
  console.log(`QBO candidate runner: ${assertions} assertions passed; no database or network used.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
