/* eslint-disable @typescript-eslint/no-require-imports -- Owned native database backup/restore qualification. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { signManifest, verifyRecord, publicKeyFingerprint } = require('../tools/google-sheets-erasure/journal.cjs');
const { auditInventory } = require('../tools/google-sheets-erasure/witness.cjs');
const { createOperator, restrictedDatabase } = require('../tools/google-sheets-erasure/operator.cjs');

// No URL or live-connection option exists. The only external input is an explicit
// local PostgreSQL installation. Provider/witness traffic remains synthetic.
async function main() {
  if (process.argv.length !== 2) throw Error('arguments_denied');
  const bin = process.env.GOOGLE_SHEETS_TEST_PG_BIN;
  if (!bin || !path.isAbsolute(bin)) throw Error('local_postgres_binary_directory_required');
  const owned = fs.realpathSync(fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : '/tmp', 'sheets-erasure-native-')));
  fs.chmodSync(owned, 0o700);
  const data = path.join(owned, 'data'), socket = path.join(owned, 'socket');
  fs.mkdirSync(socket, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', HOME: owned };
  const command = (name, args) => {
    const result = spawnSync(path.join(bin, name), args, { env, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw Error(`synthetic_${name}_failed:${(result.stderr || '').slice(0, 300)}`);
  };
  let started = false, restoredStarted = false, checks = 0;
  const restoredData = path.join(owned, 'restored-data'), restoredSocket = path.join(owned, 'restore-socket');
  const clients = [];
  const connect = async (database = 'postgres', user = 'erasure_fixture_admin', host = socket) => {
    const client = new Client({ host, port: 5432, database, user, connectionTimeoutMillis: 5000,
      statement_timeout: 15000, lock_timeout: 10000 });
    await client.connect(); clients.push(client); return client;
  };
  const adapter = client => ({ query: (sql, params) => client.query(sql, params?.map(value =>
    value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value)), exec: sql => client.query(sql) });
  try {
    command('initdb', ['-D', data, '-U', 'erasure_fixture_admin', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--no-locale']);
    command('pg_ctl', ['-D', data, '-l', path.join(owned, 'postgres.log'), '-o',
      `-k ${socket} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=16 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`, '-w', 'start']);
    started = true;
    const admin = await connect();
    const server = (await admin.query("select current_setting('data_directory') directory,inet_server_addr() address")).rows[0];
    assert.equal(fs.realpathSync(server.directory), data); assert.equal(server.address, null); checks += 2;
    const { setupRestricted } = require('./google-sheets-erasure-restricted-data-tests.cjs');
    const fixture = await setupRestricted(adapter(admin));
    // The shared qualifier supplies an additional untouched, revoked connection
    // for this real process-concurrency and restore exercise.
    const seed = await fixture.seed();
    const recoverySeed = await fixture.seed();
    await admin.query('create role synthetic_erasure_operator login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication');
    await admin.query('grant google_sheets_erasure_support to synthetic_erasure_operator');
    const support = await connect('postgres', 'synthetic_erasure_operator');
    const database = await restrictedDatabase(support);
    await admin.query('create role synthetic_unrelated_privilege nologin');
    await admin.query('grant synthetic_unrelated_privilege to synthetic_erasure_operator');
    await assert.rejects(restrictedDatabase(support), /restricted_login_required/); checks++;
    await admin.query('revoke synthetic_unrelated_privilege from synthetic_erasure_operator');
    await assert.rejects(support.query('delete from public.google_sheets_source_versions where source_row_id=$1', [seed.source]), /permission denied/); checks++;
    await assert.rejects(support.query("update private.google_sheets_erasure_requests set state='completed'"), /permission denied/); checks++;
    const writer = await connect();
    const staleTicket = await seed.beginReader(adapter(writer));
    const archive = path.join(owned, 'before-erasure.dump'), globals = path.join(owned, 'source-globals.sql');
    command('pg_dumpall', ['-h', socket, '-U', 'erasure_fixture_admin', '--globals-only', '--file', globals]);
    command('pg_dump', ['-h', socket, '-U', 'erasure_fixture_admin', '-d', 'postgres', '--format=custom', '--file', archive]);
    await support.query('begin');
    const prepared = await database.prepare({ requestId: seed.request, workspaceId: seed.workspace,
      connectionId: seed.connection, caseId: crypto.randomUUID(), artifacts: seed.artifacts, reviewComplete: true });
    const lateId = crypto.randomUUID();
    const lateWrite = seed.writeDerivative(adapter(writer), staleTicket, lateId).then(() => ({ ok: true }), error => ({ ok: false, error }));
    let observedWaiting = false;
    const waitUntil = Date.now() + 5000;
    while (Date.now() < waitUntil) {
      const activity = (await admin.query('select wait_event_type from pg_stat_activity where pid=$1', [writer.processID])).rows[0];
      if (activity?.wait_event_type === 'Lock') { observedWaiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(observedWaiting, 'real derivative writer waits behind the preparation lock'); checks++;
    await support.query('commit');
    const rejectedWrite = await lateWrite;
    assert.equal(rejectedWrite.ok, false); assert.match(rejectedWrite.error.message, /privacy_paused/);
    assert.equal((await admin.query('select count(*)::int n from public.reports where id=$1', [lateId])).rows[0].n, 0); checks += 3;
    const scope = prepared.scopeHash;
    await seed.approve(seed.request, scope);
    const manifest = await database.getExecution(seed.request, scope);
    assert.equal(manifest.version, 2); assert(manifest.targets.length > 0); checks += 2;
    const pair = crypto.generateKeyPairSync('ed25519'), pin = publicKeyFingerprint(pair.publicKey);
    const local = new Map(), independent = new Map();
    const journal = {
      writePending: m => {
        const bytes = signManifest(m, pair.privateKey), key = `${m.requestId}.pending.json`;
        if (local.has(key)) assert.deepEqual(local.get(key), bytes); else local.set(key, bytes);
      },
      writeCompletedReceipt: m => local.set(`${m.requestId}.completed.json`, signManifest(m, pair.privateKey)),
      writeWithdrawalReceipt: m => local.set(`${m.requestId}.withdrawn.json`, signManifest(m, pair.privateKey)),
      readSignedRecord: (id, state) => local.get(`${id}.${state}.json`)
    };
    const witness = {
      append: async bytes => {
        const result = verifyRecord(bytes, pair.publicKey, pin), name = `${result.manifest.requestId}.${result.state}.json`;
        if (independent.has(name)) assert.deepEqual(independent.get(name), bytes); else independent.set(name, Buffer.from(bytes));
        return result;
      },
      inventory: async () => auditInventory([...independent].map(([name, bytes]) => ({ name, bytes })), pair.publicKey, pin)
    };
    let lost = true;
    const flaky = { ...database, execute: async (...args) => {
      const result = await database.execute(...args);
      if (lost) { lost = false; throw Error('synthetic_lost_commit_acknowledgement'); }
      return result;
    } };
    const operator = createOperator({ database: flaky, journal, witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
    await assert.rejects(operator.execute(seed.request, scope), /lost_commit_acknowledgement/); checks++;
    assert.equal(independent.size, 1); assert.equal(local.size, 1); checks += 2;
    const first = await database.getExecution(seed.request, scope);
    assert(first.completedAt); checks++;
    const retried = await operator.execute(seed.request, scope);
    assert.equal(retried.completedAt, new Date(first.completedAt).toISOString());
    assert.deepEqual(await database.getExecution(seed.request, scope), first); checks += 2;
    await seed.assertPreserved(); checks++;
    await assert.rejects(seed.writeDerivative(adapter(writer), staleTicket), /ticket_stale/); checks++;
    // A real expired approval window cannot be cleared with a flag edit. The
    // exact request is terminalized, independently witnessed, then prepared and
    // owner-approved again under a new request identity.
    const recoveryTicket = await recoverySeed.beginReader();
    const expired = await recoverySeed.prepare();
    await admin.query("update private.google_sheets_erasure_requests set requested_at=clock_timestamp()-interval '8 days' where id=$1", [recoverySeed.request]);
    await assert.rejects(recoverySeed.approve(recoverySeed.request, expired.scopeHash), /request_expired/); checks++;
    await assert.rejects(recoverySeed.beginReader(), /privacy_paused/); checks++;
    const withdrawal = await operator.withdraw(recoverySeed.request, expired.scopeHash, 'approval_expired', (await witness.inventory()).digest);
    assert.equal(withdrawal.released, true); checks++;
    await recoverySeed.beginReader(undefined, []); checks++;
    await assert.rejects(recoverySeed.writeDerivative(adapter(admin), recoveryTicket), /ticket_stale/); checks++;
    const replacementRequest = crypto.randomUUID();
    const replacement = await database.prepare({ requestId: replacementRequest, workspaceId: recoverySeed.workspace,
      connectionId: recoverySeed.connection, caseId: crypto.randomUUID(), artifacts: recoverySeed.artifacts, reviewComplete: true });
    await assert.rejects(database.getExecution(replacementRequest, replacement.scopeHash), /approval_required/); checks++;
    await recoverySeed.approve(replacementRequest, replacement.scopeHash);
    await operator.execute(replacementRequest, replacement.scopeHash); checks++;
    await recoverySeed.assertPreserved(); checks++;
    // Restore the actual native archive, preserving SQL ACLs/owners and the
    // independently retained witness. Local request files deliberately vanish.
    local.clear();
    fs.mkdirSync(restoredSocket, { mode: 0o700 });
    command('initdb', ['-D', restoredData, '-U', 'erasure_fixture_admin', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--no-locale']);
    command('pg_ctl', ['-D', restoredData, '-l', path.join(owned, 'restored-postgres.log'), '-o',
      `-k ${restoredSocket} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=16 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`, '-w', 'start']);
    restoredStarted = true;
    // PostgreSQL17 role memberships retain GRANTED BY identities. Bootstrap the
    // same admin on the isolated cluster, preserving every ALTER/GRANT statement;
    // only that already-created bootstrap role's duplicate CREATE is omitted.
    const roleSql = fs.readFileSync(globals, 'utf8');
    assert.equal(roleSql.split('CREATE ROLE erasure_fixture_admin;').length, 2);
    const restoreGlobals = path.join(owned, 'restore-globals.sql');
    fs.writeFileSync(restoreGlobals, roleSql.replace('CREATE ROLE erasure_fixture_admin;', ''), { mode: 0o600 });
    command('psql', ['-h', restoredSocket, '-U', 'erasure_fixture_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', restoreGlobals]);
    command('pg_restore', ['-h', restoredSocket, '-U', 'erasure_fixture_admin', '-d', 'postgres', '--exit-on-error', archive]);
    const restoredAdmin = await connect('postgres', 'erasure_fixture_admin', restoredSocket);
    await restoredAdmin.query('create role synthetic_erasure_restore login inherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication');
    await restoredAdmin.query('grant google_sheets_erasure_restore to synthetic_erasure_restore');
    assert.equal((await admin.query("select count(*)::int n from pg_roles where rolname='synthetic_erasure_restore'")).rows[0].n, 0); checks++;
    await assert.rejects(database.replay(seed.request, scope, manifest, 'a'.repeat(64)), /permission denied/); checks++;
    const restoreClient = await connect('postgres', 'synthetic_erasure_restore', restoredSocket);
    const restoreDb = await restrictedDatabase(restoreClient, 'isolated-restore');
    const checkedRestoreDb = { ...restoreDb,
      replay: async (...args) => {
        const result = await restoreDb.replay(...args);
        const replayedSeed = args[0] === seed.request ? seed : recoverySeed;
        await assert.rejects(replayedSeed.beginReader(adapter(restoredAdmin), []), /privacy_paused/); checks++;
        return result;
      },
      finishRestore: async (...args) => {
        const result = await restoreDb.finishRestore(...args);
        await seed.beginReader(adapter(restoredAdmin), []); checks++;
        await assert.rejects(seed.writeDerivative(adapter(restoredAdmin), staleTicket), /ticket_stale/); checks++;
        return result;
      }
    };
    const restore = createOperator({ database: checkedRestoreDb, journal: null, witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
    const inventory = await witness.inventory();
    const endpoint = crypto.createHash('sha256').update('owned-native-restored-database').digest('hex');
    const checkpoint = await restore.restore(inventory.digest, endpoint);
    assert.equal(checkpoint.remainingTargets, 0); assert.equal(checkpoint.requestsReplayed, 2);
    assert.equal(checkpoint.withdrawalsReconciled, 1); checks++;
    assert.equal(checkpoint.activation, 'external-release-required'); checks += 3;
    const replayed = await restore.restore(inventory.digest, endpoint);
    assert.equal(replayed.inventoryDigest, checkpoint.inventoryDigest); checks++;
    await seed.assertPreserved(adapter(restoredAdmin)); checks++;
    await recoverySeed.assertPreserved(adapter(restoredAdmin)); checks++;
    // A distinct restored snapshot with a changed authorized row must roll back
    // every attempted erasure and cannot emit an activation checkpoint.
    await restoredAdmin.query('create database changed_snapshot');
    command('pg_restore', ['-h', restoredSocket, '-U', 'erasure_fixture_admin', '-d', 'changed_snapshot', '--exit-on-error', archive]);
    const changedAdmin = await connect('changed_snapshot', 'erasure_fixture_admin', restoredSocket);
    await seed.as('service_role', client => client.query("update public.reports set body_markdown='Changed synthetic value after inventory' where id=$1", [seed.report]), adapter(changedAdmin));
    const originalFile = (await changedAdmin.query('select to_jsonb(f) value from public.file_uploads f where id=$1', [seed.file])).rows[0].value;
    const versionCount = (await changedAdmin.query('select count(*)::int n from public.google_sheets_source_versions where connection_id=$1', [seed.connection])).rows[0].n;
    const changedClient = await connect('changed_snapshot', 'synthetic_erasure_restore', restoredSocket);
    const changedDb = await restrictedDatabase(changedClient, 'isolated-restore');
    const heldRestore = createOperator({ database: changedDb, journal: null, witness, publicKey: pair.publicKey, pinnedFingerprint: pin });
    await assert.rejects(heldRestore.restore(inventory.digest, crypto.createHash('sha256').update('changed-owned-snapshot').digest('hex')), /scope_changed/); checks++;
    assert.equal((await changedAdmin.query('select count(*)::int n from public.google_sheets_source_versions where connection_id=$1', [seed.connection])).rows[0].n, versionCount);
    assert.equal((await changedAdmin.query('select count(*)::int n from public.google_sheets_connections where id=$1', [seed.connection])).rows[0].n, 1); checks += 2;
    assert.deepEqual((await changedAdmin.query('select to_jsonb(f) value from public.file_uploads f where id=$1', [seed.file])).rows[0].value, originalFile); checks++;
    console.log(JSON.stringify({ suite: 'google_sheets_erasure_operator_native', checks,
      baseline: fixture.baseline.checks, realWriterWaitObserved: observedWaiting, staleWriterRejectedAfterReopen: true, nativeBackupRestore: true, expiredApprovalRecoveryReapproved: true, changedHashRollbackHeld: true, uncertainCommitReconciled: true,
      localJournalRemoved: true, independentWitnessRequests: inventory.requestCount,
      exactReplayRemaining: checkpoint.remainingTargets, restoredActivation: checkpoint.activation,
      liveDatabaseConnections: 0, liveProviderCalls: 0, cloudQualification: false }));
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    if (restoredStarted) command('pg_ctl', ['-D', restoredData, '-m', 'fast', '-w', 'stop']);
    if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    fs.rmSync(owned, { recursive: true, force: true });
  }
}
main().catch(error => { console.error({ stage: 'synthetic_erasure_operator_native', code: error.code, message: error.message }); process.exitCode = 1; });
