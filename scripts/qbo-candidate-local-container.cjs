/* eslint-disable @typescript-eslint/no-require-imports -- Owned local CI database infrastructure. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('pg');
const { assertNoRemoteConfiguration, assertNoLinkedProject } = require('./run-square-durable-page-qualification.js');
const root = path.resolve(__dirname, '..');
const quote = value => '"' + value.replaceAll('"', '""') + '"';

function docker(args, { env = process.env } = {}) {
  const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `local Docker ${args[0]} failed (${result.error?.code || result.status})`);
  return result.stdout.trim();
}

function verifyLocalContext(context, host = process.env.DOCKER_HOST) {
  assert.equal(context.length, 1, 'exactly one local Docker context is required');
  assert.ok(String(context[0]?.Endpoints?.docker?.Host).startsWith('unix://'), 'remote Docker contexts are forbidden');
  assert.ok(!host || host.startsWith('unix://'), 'remote DOCKER_HOST is forbidden');
}

function verifyOwnedContainer(container, { id, name, image, nonce }) {
  assert.equal(container.Id, id, 'owned container identity');
  assert.equal(container.Name, `/${name}`, 'owned container name');
  assert.equal(container.Image, image, 'exact existing Supabase image identity');
  assert.equal(container.Config?.Labels?.['com.vaeroex.qbo-test'], nonce, 'owned container nonce');
  const bindings = container.NetworkSettings?.Ports?.['5432/tcp'];
  assert.ok(bindings?.length === 1 && bindings[0].HostIp === '127.0.0.1', 'database published only on local loopback');
  assert.match(bindings[0].HostPort, /^\d{1,5}$/);
  const port = Number(bindings[0].HostPort);
  assert.ok(port > 0 && port <= 65535);
  return port;
}

async function runContainerQualification(callback) {
  assertNoRemoteConfiguration();
  assertNoLinkedProject();
  verifyLocalContext(JSON.parse(docker(['context', 'inspect'])));
  const project = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'))?.[1];
  assert.ok(project, 'repository local Supabase project identity');
  const source = JSON.parse(docker(['inspect', `supabase_db_${project}`]));
  assert.equal(source.length, 1);
  assert.equal(source[0].Name, `/supabase_db_${project}`);
  assert.equal(source[0].State?.Running, true, 'the workflow local Supabase database must already be running');
  assert.ok(String(source[0].Config?.Image).includes('supabase/postgres'), 'reuse only the local Supabase PostgreSQL image');
  const image = source[0].Image;
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const bin = docker(['exec', source[0].Id, 'pg_config', '--bindir']);
  assert.match(bin, /^\/[A-Za-z0-9/_-]+$/, 'installed PostgreSQL binary directory');
  const nonce = crypto.randomBytes(12).toString('hex');
  const name = `qbo-candidate-${nonce}`;
  const cluster = `qbo_candidate_${nonce}`;
  const password = crypto.randomBytes(24).toString('hex');
  const clients = [];
  let id, administrator;
  try {
    // New cluster, same already-installed image: no package installation, linked
    // database reuse, host mounts, inherited data directory, or image pull.
    const script = `set -eu
umask 077
export PATH="${bin}:$PATH"
printf '%s\\n' "$QBO_CANDIDATE_PASSWORD" > /tmp/qbo-candidate-password
initdb -D /tmp/qbo-candidate-data --username=postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/qbo-candidate-password --encoding=UTF8 --no-locale > /tmp/qbo-candidate-init.log
rm /tmp/qbo-candidate-password
exec postgres -D /tmp/qbo-candidate-data -c listen_addresses='*' -c unix_socket_directories=/tmp -c cluster_name=${cluster} -c shared_buffers=64MB -c max_connections=30 -c log_statement=none -c log_min_error_statement=panic`;
    id = docker(['run', '--detach', '--pull=never', '--name', name, '--label', `com.vaeroex.qbo-test=${nonce}`,
      '--user', 'postgres', '--publish', '127.0.0.1::5432', '--env', 'QBO_CANDIDATE_PASSWORD',
      '--entrypoint', '/bin/sh', image, '-c', script], { env: { ...process.env, QBO_CANDIDATE_PASSWORD: password } });
    assert.match(id, /^[a-f0-9]{64}$/);
    const proof = { id, name, image, nonce };
    const inspect = () => {
      const containers = JSON.parse(docker(['inspect', id]));
      assert.equal(containers.length, 1);
      return verifyOwnedContainer(containers[0], proof);
    };
    const port = inspect();
    const connection = { host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password, ssl: false,
      connectionTimeoutMillis: 1000, statement_timeout: 60000 };
    for (let attempt = 0; attempt < 60; attempt++) {
      if (attempt % 5 === 0) {
        const running = JSON.parse(docker(['inspect', id]))[0];
        assert.equal(running?.State?.Running, true, 'owned PostgreSQL container exited during startup');
      }
      const client = new Client(connection);
      client.on('error', () => {});
      try { await client.connect(); administrator = client; break; }
      catch { await client.end().catch(() => {}); await delay(500); }
    }
    assert.ok(administrator, 'owned disposable PostgreSQL startup timed out');
    const observed = (await administrator.query(`select current_setting('server_version_num')::integer as version,
      current_setting('data_directory') as data,current_setting('cluster_name') as cluster,
      current_database() as db,inet_server_port() as port`)).rows[0];
    assert.ok(observed.version >= 170000 && observed.version < 180000, 'local Supabase image must contain PostgreSQL 17');
    assert.equal(observed.data, '/tmp/qbo-candidate-data');
    assert.equal(observed.cluster, cluster);
    assert.equal(observed.db, 'postgres');
    assert.equal(observed.port, 5432);
    inspect();
    return await callback({ targetKind: 'owned-supabase-image', async createDatabase(suffix) {
      assert.match(suffix, /^[a-z][a-z0-9_]{0,19}$/);
      inspect();
      const database = `qbo_candidate_${nonce}_${suffix}`;
      await administrator.query(`create database ${quote(database)} template template0 encoding 'UTF8'`);
      const config = { ...connection, database };
      const client = new Client(config);
      client.on('error', () => {});
      clients.push(client);
      await client.connect();
      assert.equal((await client.query('select current_database() as db')).rows[0].db, database);
      await client.query('set search_path=public,extensions');
      await client.query(fs.readFileSync(path.join(root, 'supabase/tests/fixtures/square-durable-platform.sql'), 'utf8'));
      return { name: database, client, connection: config,
        dblinkConnection: `host=/tmp port=5432 dbname=${database} user=postgres` };
    } });
  } finally {
    for (const client of clients) await client.end().catch(() => {});
    if (administrator) await administrator.end().catch(() => {});
    if (id) {
      const owned = JSON.parse(docker(['inspect', id]));
      assert.equal(owned.length, 1);
      assert.equal(owned[0].Id, id);
      assert.equal(owned[0].Name, `/${name}`);
      assert.equal(owned[0].Config?.Labels?.['com.vaeroex.qbo-test'], nonce);
      assert.equal(owned[0].Image, image);
      docker(['rm', '--force', id]);
    }
  }
}

module.exports = { runContainerQualification, verifyLocalContext, verifyOwnedContainer };
