/* eslint-disable @typescript-eslint/no-require-imports -- Shared native/CI test safety boundary. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertNoRemoteConfiguration, assertNoLinkedProject, validateLocalDatabaseUrl } = require('./run-square-durable-page-qualification.js');
const root = path.resolve(__dirname, '..');
function command(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, 'Owned local database discovery command failed');
  return result.stdout;
}
function discoverVsiDatabaseTarget(args = process.argv.slice(2)) {
  assert(args.length === 0 || args.length === 1 && args[0] === '--supabase-local', 'Only --supabase-local is accepted');
  if (args[0] === '--supabase-local') {
    assertNoRemoteConfiguration(); assertNoLinkedProject();
    assert(!process.env.VSI_TEST_CONFIG && !process.env.VSI_REFRESH_LOCAL_RPC, 'CI accepts no alternate database config or schema-refresh flag');
    const contexts = JSON.parse(command('docker', ['context', 'inspect']));
    assert(contexts.length === 1 && String(contexts[0]?.Endpoints?.docker?.Host).startsWith('unix://'), 'Local Docker socket required');
    assert(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'), 'Remote Docker forbidden');
    const project = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8'))?.[1];
    assert(project, 'Local Supabase project identity missing');
    const containers = JSON.parse(command('docker', ['inspect', `supabase_db_${project}`]));
    const container = containers[0];
    assert(containers.length === 1 && container.Name === `/supabase_db_${project}` && container.State?.Running && String(container.Config?.Image).includes('supabase/postgres'), 'Local Supabase database container identity mismatch');
    const status = command(process.env.SUPABASE_CLI_PATH || 'supabase', ['status', '--output', 'env']);
    const url = /^DB_URL="([^"\r\n]+)"$/m.exec(status)?.[1];
    assert(url, 'Local database status missing');
    const connection = validateLocalDatabaseUrl(url);
    assert((container.NetworkSettings?.Ports?.['5432/tcp'] || []).some(item => Number(item.HostPort) === connection.port), 'Local database port does not match verified container');
    return { kind: 'supabase-local', connection, async verify(client) {
      const state = (await client.query("select current_database() db,inet_server_port() port,current_setting('server_version_num')::integer version")).rows[0];
      assert(state.db === 'postgres' && state.port === 5432 && state.version >= 170000, 'Local server identity mismatch');
      assert((await client.query("select 1 from supabase_migrations.schema_migrations where version='20261008190000'")).rowCount === 1, 'CI must apply the actual VSI migration before this test');
    } };
  }
  assert(process.env.VSI_TEST_CONFIG, 'Set VSI_TEST_CONFIG to an owned disposable native stack config');
  const config = JSON.parse(fs.readFileSync(process.env.VSI_TEST_CONFIG, 'utf8'));
  assert.equal(config.mode, 'disposable-native-local', 'Refusing an unowned native database');
  const connection = validateLocalDatabaseUrl(config.dbUrl);
  const ownedHome = fs.realpathSync(config.ownedSupabaseHome);
  assert(ownedHome.startsWith(fs.realpathSync('/tmp') + path.sep), 'Disposable native stack must live under temporary storage');
  return { kind: 'native', connection, async verify(client) {
    const state = (await client.query("select current_database() db,current_setting('data_directory') directory,inet_server_addr() ip")).rows[0];
    assert(state.db === 'postgres' && ['127.0.0.1', '::1', null].includes(state.ip), 'Local native server identity mismatch');
    assert(fs.realpathSync(state.directory).startsWith(ownedHome + path.sep), 'Database does not belong to the verified disposable native stack');
  } };
}
module.exports = { discoverVsiDatabaseTarget };
