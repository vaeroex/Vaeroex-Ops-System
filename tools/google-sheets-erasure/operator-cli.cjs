#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Restricted support CLI; no app credentials. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('pg');
const { openJournal, inspectJournalRecovery, rebuildJournal } = require('./journal.cjs');
const { createGcsWitness } = require('./witness.cjs');
const { createOperator, restrictedDatabase } = require('./operator.cjs');
const run = promisify(execFile);
const fail = code => { throw Error(`sheets_operator_${code}`); };
function privateJson(filename) {
  if (!filename || !path.isAbsolute(filename)) fail('private_file_required');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() ||
      (stat.mode & 0o7777) !== 0o600 || stat.size > 8 * 1024 * 1024) fail('private_file_required');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const actual = fs.fstatSync(fd);
    if (actual.ino !== stat.ino || actual.dev !== stat.dev) fail('file_changed');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function readStorageCheckpoint(filename) {
  const input = privateJson(filename);
  if (!Array.isArray(input.evidence) || input.evidence.length < 2 || input.evidence.length > 20) fail('storage_checkpoint_required');
  const evidence = input.evidence.map(item => {
    if (!item || Object.keys(item).sort().join(',') !== 'kind,path,sha256' || !path.isAbsolute(item.path)) fail('storage_checkpoint_required');
    const before = fs.lstatSync(item.path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== process.getuid() ||
        (before.mode & 0o7777) !== 0o600 || before.size < 1 || before.size > 8 * 1024 * 1024) fail('private_file_required');
    const fd = fs.openSync(item.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const actual = fs.fstatSync(fd);
      if (actual.ino !== before.ino || actual.dev !== before.dev) fail('file_changed');
      const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || sha256 !== item.sha256) fail('storage_evidence_changed');
      return { kind: item.kind, sha256, size: bytes.length };
    } finally { fs.closeSync(fd); }
  });
  return { ...input, evidence };
}
function endpointHash(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname ||
      url.search || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('database_endpoint');
  return crypto.createHash('sha256').update(JSON.stringify({ host: url.hostname.toLowerCase(), port: url.port || '5432', database: decodeURIComponent(url.pathname.slice(1)) })).digest('hex');
}
async function main(argv) {
  const [filename, command, ...args] = argv;
  if (!['inventory', 'status', 'artifact-preview', 'prepare', 'retention-due', 'prepare-retention', 'daily-expiry', 'journal-inspect', 'journal-recover', 'execute', 'withdraw', 'restore'].includes(command)) fail('usage_config_inventory_prepare_execute_restore');
  const config = privateJson(filename);
  if (config.version !== 1 || !['support', 'isolated-restore'].includes(config.purpose) ||
      !/^[a-f0-9]{64}$/.test(config.databaseEndpointHash) || !/^[a-f0-9]{64}$/.test(config.primaryEndpointHash)) fail('configuration');
  if (!path.isAbsolute(config.gcloudPath) || path.basename(config.gcloudPath) !== 'gcloud') fail('gcloud_path');
  const executable = fs.statSync(config.gcloudPath);
  if (!executable.isFile() || ![0, process.getuid()].includes(executable.uid) || (executable.mode & 0o022) !== 0) fail('gcloud_permissions');
  const witness = createGcsWitness({ ...config.witness, primaryEndpointHash: config.primaryEndpointHash, publicKey: config.publicKey, pinnedFingerprint: config.pinnedFingerprint }, {
    token: async () => {
      try {
        const result = await run(config.gcloudPath, ['auth', 'print-access-token', '--quiet', `--impersonate-service-account=${config.witness.serviceAccount}`, '--lifetime=900'],
          { timeout: 15000, maxBuffer: 16384, encoding: 'utf8' });
        return result.stdout.trim();
      } catch { fail('cloud_authentication'); }
    }
  });
  if (command === 'inventory') {
    if (args.length) fail('arguments');
    const inventory = await witness.inventory();
    return { inventoryDigest: inventory.digest, requestCount: inventory.requestCount,
      records: inventory.records.map(r => ({ requestId: r.manifest.requestId, state: r.state, digest: r.digest, scopeHash: r.manifest.scopeHash })) };
  }
  const connectionString = process.env.GOOGLE_SHEETS_ERASURE_DATABASE_URL;
  if (!connectionString || endpointHash(connectionString) !== config.databaseEndpointHash) fail('database_identity');
  if (command === 'restore') {
    if (config.purpose !== 'isolated-restore' || config.databaseEndpointHash === config.primaryEndpointHash || ![1, 2].includes(args.length)) fail('isolated_restore_required');
  } else if (config.purpose !== 'support' || config.databaseEndpointHash !== config.primaryEndpointHash) fail('support_target_required');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: true },
    application_name: 'vaeroex-google-sheets-erasure-support', connectionTimeoutMillis: 10000,
    statement_timeout: 120000, lock_timeout: 15000, query_timeout: 125000 });
  try {
    await client.connect();
    const database = await restrictedDatabase(client, config.purpose);
    if (command === 'artifact-preview') {
      if (args.length !== 4) fail('arguments');
      return await database.previewArtifact(args[0], args[1], args[2], args[3]);
    }
    if (command === 'status') {
      if (args.length !== 1) fail('arguments');
      return await database.inspectRecovery(args[0]);
    }
    if (command === 'retention-due') {
      if (args.length) fail('arguments');
      return await database.dueRetention();
    }
    if (command === 'prepare-retention') {
      if (args.length !== 1) fail('arguments');
      return await database.prepareRetention(privateJson(args[0]));
    }
    if (command === 'prepare') {
      if (args.length !== 1) fail('arguments');
      // Preparation fences and inventories; the workspace owner still approves
      // the exact stored scope in the authenticated application before execution.
      return await database.prepare(privateJson(args[0]));
    }
    if (command === 'journal-inspect' || command === 'journal-recover') {
      await database.assertExclusiveSession();
      const options = { directory: config.journalDirectory, publicKey: config.publicKey, pinnedFingerprint: config.pinnedFingerprint };
      const inventory = await witness.inventory();
      const snapshot = inspectJournalRecovery(options);
      if (command === 'journal-inspect') {
        if (args.length) fail('arguments');
        return { ...snapshot, inventoryDigest: inventory.digest, state: 'inspection-only-source-unchanged' };
      }
      if (args.length !== 1) fail('arguments');
      const plan = privateJson(args[0]);
      if (Object.keys(plan).sort().join(',') !== 'destination,inventoryDigest,snapshotDigest' || plan.inventoryDigest !== inventory.digest ||
          plan.snapshotDigest !== snapshot.snapshotDigest) fail('recovery_plan_changed');
      const result = rebuildJournal(options, { destination: plan.destination, snapshotDigest: plan.snapshotDigest,
        witnessRecords: inventory.records.map(r => ({ name: `${r.manifest.requestId}.${r.state}.json`, bytes: r.bytes })) });
      await database.assertExclusiveSession();
      if ((await witness.inventory()).digest !== inventory.digest) fail('inventory_changed');
      return { ...result, inventoryDigest: inventory.digest, destination: plan.destination };
    }
    const journal = command === 'restore' ? null : openJournal({ directory: config.journalDirectory,
      publicKey: config.publicKey, pinnedFingerprint: config.pinnedFingerprint });
    const operator = createOperator({ database, journal, witness, publicKey: config.publicKey, pinnedFingerprint: config.pinnedFingerprint });
    if (command === 'daily-expiry') {
      if (args.length > 1) fail('arguments');
      return await operator.dailyExpiry(10, args[0] ? privateJson(args[0]) : undefined);
    }
    if (command === 'withdraw') {
      if (args.length !== 4) fail('arguments');
      return await operator.withdraw(args[0], args[1], args[2], args[3]);
    }
    if (command === 'execute') {
      if (args.length !== 2) fail('arguments');
      return await operator.execute(args[0], args[1]);
    }
    return await operator.restore(args[0], config.databaseEndpointHash, args[1] ? readStorageCheckpoint(args[1]) : undefined);
  } finally { await client.end(); }
}
if (require.main === module) main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(error => {
  // Provider/PG error messages may include connection strings or row content.
  const code = /^(sheets_(operator|witness|journal|erasure)_[a-z0-9_]+|google_sheets_(privacy_paused|read_ticket_stale))$/.test(error?.message ?? '') ? error.message : 'sheets_operator_failed_review_required';
  process.stderr.write(JSON.stringify({ ok: false, code }) + '\n'); process.exitCode = 1;
});
module.exports = { main, privateJson, readStorageCheckpoint, endpointHash };
