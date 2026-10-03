/* eslint-disable @typescript-eslint/no-require-imports -- Focused offline CommonJS tests. */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  TABLES, normalizeManifest, publicKeyFingerprint, signManifest, verifyRecord,
  generateJournalKey, openJournal
} = require('../tools/google-sheets-erasure/journal.cjs');

const KEY_FILE = 'ed25519-private.pem';
const COMPLETED_AT = '2026-10-02T22:00:00.000Z';
const pair = crypto.generateKeyPairSync('ed25519');
const pin = publicKeyFingerprint(pair.publicKey);
const clone = value => JSON.parse(JSON.stringify(value));
const encode = value => Buffer.from(JSON.stringify(value) + '\n');

function manifest(overrides = {}) {
  const connectionId = crypto.randomUUID();
  return {
    version: 1, requestId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), connectionId,
    scopeHash: 'a'.repeat(64),
    targets: [{ table: 'kpis', id: crypto.randomUUID() }, { table: 'google_sheets_connections', id: connectionId }],
    counts: { kpis: 1, google_sheets_connections: 1 }, completedAt: null, ...overrides
  };
}

// Only this test adapter maps a virtual private directory to temporary storage.
// Real POSIX permissions, symlinks, fsync and rename are exercised with synthetic
// keys/data. The production module has no temporary-directory bypass switch.
function fixture(run) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-journal-test-')));
  fs.chmodSync(root, 0o700);
  const directory = '/journal-test/private';
  const toReal = filename => {
    assert(path.isAbsolute(filename));
    return path.join(root, path.relative('/', filename));
  };
  fs.mkdirSync(toReal(directory), { mode: 0o700, recursive: true });
  const handles = new Map();
  const events = [];
  const state = { directory, toReal, events, hook: null };
  function event(op, name, extra = {}) {
    const item = { op, name, ...extra };
    events.push(item);
    if (state.hook) state.hook(item);
  }
  const io = {
    constants: fs.constants,
    lstatSync: filename => fs.lstatSync(toReal(filename)),
    realpathSync: filename => {
      const actual = fs.realpathSync(toReal(filename));
      assert(actual === root || actual.startsWith(root + path.sep));
      return path.join('/', path.relative(root, actual));
    },
    readdirSync: filename => { event('readdir', filename); return fs.readdirSync(toReal(filename)); },
    mkdirSync: (filename, options) => { event('mkdir', filename); return fs.mkdirSync(toReal(filename), options); },
    rmdirSync: filename => { event('rmdir', filename); return fs.rmdirSync(toReal(filename)); },
    openSync: (filename, flags, mode) => {
      event('open', filename, { flags, mode });
      const fd = fs.openSync(toReal(filename), flags, mode);
      handles.set(fd, filename);
      return fd;
    },
    closeSync: fd => { fs.closeSync(fd); handles.delete(fd); },
    fstatSync: fd => fs.fstatSync(fd),
    readFileSync: fd => { event('read', handles.get(fd)); return fs.readFileSync(fd); },
    writeFileSync: (fd, bytes) => { event('write', handles.get(fd)); return fs.writeFileSync(fd, bytes); },
    fsyncSync: fd => {
      event(fs.fstatSync(fd).isDirectory() ? 'fsync-directory' : 'fsync-file', handles.get(fd));
      return fs.fsyncSync(fd);
    },
    renameSync: (from, to) => { event('rename', from, { to }); return fs.renameSync(toReal(from), toReal(to)); }
  };
  state.adapter = { fs: io, uid: () => process.getuid(), cwd: () => '/repository', tmpdir: () => '/scratch' };
  state.options = null;
  state.initialize = () => {
    const trust = generateJournalKey({ directory }, state.adapter);
    state.options = { directory, ...trust };
    state.journal = openJournal(state.options, state.adapter);
    return state.journal;
  };
  state.filename = (m, phase = 'pending') => toReal(`${directory}/${m.requestId}.${phase}.json`);
  try { return run(state); } finally {
    const leaked = handles.size;
    for (const fd of handles.keys()) fs.closeSync(fd);
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(leaked, 0, 'all journal file descriptors must close');
  }
}

test('canonical signing is deterministic, minimal, non-mutating and independently verifiable', () => {
  const input = manifest();
  const original = clone(input);
  const bytes = signManifest(input, pair.privateKey);
  const reordered = { ...input, targets: [...input.targets].reverse(), counts: { google_sheets_connections: 1, kpis: 1 } };
  assert.deepEqual(signManifest(reordered, pair.privateKey), bytes);
  assert.deepEqual(input, original);
  const result = verifyRecord(bytes, pair.publicKey, pin);
  assert.equal(result.state, 'pending');
  assert.equal(result.digest, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(Object.keys(result.manifest).sort(),
    ['version', 'requestId', 'workspaceId', 'connectionId', 'scopeHash', 'targets', 'counts', 'completedAt'].sort());
  const envelope = JSON.parse(bytes);
  assert(crypto.verify(null, Buffer.from('vaeroex-google-sheets-erasure-journal:v1\n' + JSON.stringify(envelope.manifest)),
    pair.publicKey, Buffer.from(envelope.signature, 'base64')));
  assert.equal(publicKeyFingerprint(pair.publicKey),
    crypto.createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'));
});

test('the exact Google-base and dependent-table allowlist accepts identifiers only', () => {
  const expected = [
    'google_sheets_connections', 'google_sheets_oauth_states', 'google_sheets_credentials',
    'google_sheets_mapping_approvals', 'google_sheets_sync_runs', 'google_sheets_source_rows',
    'google_sheets_source_versions', 'google_sheets_fact_links', 'kpis', 'ai_agent_runs', 'reports',
    'kpi_alert_events', 'business_memory_chunks', 'record_shares', 'notifications',
    'operational_assignments', 'business_decisions', 'vaeroex_recommendation_outcomes',
    'scheduled_report_runs', 'kpi_settings', 'kpi_alert_rules', 'audit_logs', 'security_audit_events', 'ai_usage'
  ];
  assert.deepEqual([...TABLES].sort(), expected.sort());
  const input = manifest();
  input.targets = TABLES.map(table => ({ table, id: ['google_sheets_connections', 'google_sheets_credentials'].includes(table)
    ? input.connectionId : crypto.randomUUID() }));
  input.counts = Object.fromEntries(TABLES.map(table => [table, 1]));
  assert.equal(verifyRecord(signManifest(input, pair.privateKey), pair.publicKey, pin).manifest.targets.length, 24);
  for (const table of ['square_connections', 'workspaces', 'profiles', 'google_sheets_erasure_requests', 'public.kpis', '__proto__']) {
    const bad = manifest({ targets: [{ table, id: crypto.randomUUID() }], counts: { [table]: 1 } });
    assert.throws(() => signManifest(bad, pair.privateKey), /sheets_journal_table/);
  }
});

test('extra payload fields fail at every level, even when correctly signed', () => {
  for (const field of ['values', 'tokens', 'names', 'emails', 'ciphertext', 'realm', 'publicKey']) {
    for (const level of ['manifest', 'target', 'counts', 'envelope']) {
      const input = manifest();
      if (level === 'manifest') input[field] = 'synthetic-forbidden-content';
      if (level === 'target') input.targets[0][field] = 'synthetic-forbidden-content';
      if (level === 'counts') input.counts[field] = 0;
      const signature = crypto.sign(null, Buffer.from('vaeroex-google-sheets-erasure-journal:v1\n' + JSON.stringify(input)),
        pair.privateKey).toString('base64');
      const envelope = { manifest: input, signature };
      if (level === 'envelope') envelope[field] = 'synthetic-forbidden-content';
      assert.throws(() => verifyRecord(encode(envelope), pair.publicKey, pin), /sheets_journal_(schema|table)/);
      if (level !== 'envelope') assert.throws(() => signManifest(input, pair.privateKey), /sheets_journal_/);
    }
  }
});

test('schema rejects invalid IDs, clocks, counts, duplicates, accessors and oversized arrays', () => {
  const mutations = [
    m => { m.version = 2; }, m => { m.requestId = '../request'; }, m => { m.workspaceId = 'synthetic@example.invalid'; },
    m => { m.connectionId = crypto.randomUUID(); }, m => { m.scopeHash = 'not-a-digest'; },
    m => { m.completedAt = ''; }, m => { m.completedAt = '2026-02-30T00:00:00.000Z'; },
    m => { m.completedAt = '2026-10-02T22:00:00Z'; }, m => { m.completedAt = undefined; },
    m => { m.targets[0].id = 'ciphertext'; }, m => { m.targets.push(m.targets[0]); },
    m => { m.targets.length = 3; }, m => { m.targets.extra = 'payload'; },
    m => { m.targets = new Array(50_001); }, m => { m.counts.kpis = 2; },
    m => { delete m.counts.kpis; }, m => { m.counts.reports = -0; },
    m => { m.counts.kpis = '1'; }, m => { m.counts.kpis = NaN; },
    m => { Object.defineProperty(m, 'tokens', { value: 'hidden' }); },
    m => { m[Symbol('extra')] = 'hidden'; },
    m => { Object.defineProperty(m, 'requestId', { enumerable: true, get() { throw Error('getter must not run'); } }); }
  ];
  for (const mutate of mutations) {
    const input = manifest(); mutate(input);
    assert.throws(() => signManifest(input, pair.privateKey), /sheets_journal_/);
  }
  const withZero = manifest(); withZero.counts.reports = 0;
  assert.equal(normalizeManifest(withZero).counts.reports, 0);
});

test('tampering, malformed signatures, duplicate JSON keys and alternate encodings fail', () => {
  const bytes = signManifest(manifest(), pair.privateKey);
  const modified = JSON.parse(bytes); modified.manifest.scopeHash = 'b'.repeat(64);
  assert.throws(() => verifyRecord(encode(modified), pair.publicKey, pin), /signature/);
  modified.signature = Buffer.alloc(64).toString('base64');
  assert.throws(() => verifyRecord(encode(modified), pair.publicKey, pin), /signature/);
  modified.signature = 'not-base64';
  assert.throws(() => verifyRecord(encode(modified), pair.publicKey, pin), /signature/);
  assert.throws(() => verifyRecord(bytes.subarray(0, bytes.length / 2), pair.publicKey, pin), /json/);
  assert.throws(() => verifyRecord(bytes.toString().replace('"version":1', '"version":1,"version":1'), pair.publicKey, pin), /noncanonical/);
  assert.throws(() => verifyRecord(JSON.stringify(JSON.parse(bytes), null, 2), pair.publicKey, pin), /noncanonical/);
});

test('restore requires an external Ed25519 public key AND matching fingerprint', () => {
  const bytes = signManifest(manifest(), pair.privateKey);
  const other = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => verifyRecord(bytes, other.publicKey, pin), /pin_mismatch/);
  assert.throws(() => verifyRecord(bytes, other.publicKey, publicKeyFingerprint(other.publicKey)), /signature/);
  assert.throws(() => verifyRecord(bytes, pair.publicKey), /pin_required/);
  assert.throws(() => verifyRecord(bytes, pair.publicKey, 'A'.repeat(64)), /pin_required/);
  assert.throws(() => verifyRecord(bytes, pair.privateKey, pin), /sheets_journal_key/);
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(() => signManifest(manifest(), ec.privateKey), /sheets_journal_key/);
  assert.throws(() => publicKeyFingerprint(ec.publicKey), /sheets_journal_key/);
});

test('production adapter refuses temporary, repository and implicit directory choices before writing', () => {
  for (const directory of ['/tmp', '/tmp/private-journal', '/private/tmp/private-journal', '/var/tmp/journal',
    os.tmpdir(), process.cwd(), path.join(process.cwd(), 'private-journal'), path.resolve(__dirname, '..')]) {
    assert.throws(() => generateJournalKey({ directory }), /directory_location/);
  }
  for (const directory of [undefined, '', 'relative', '/vault/../vault/private']) {
    assert.throws(() => generateJournalKey({ directory }), /directory_required/);
  }
  assert.throws(() => generateJournalKey({ directory: '/tmp/journal', allowTemporary: true }), /schema/);
});

test('key generation uses private modes and never overwrites an existing key', () => fixture(f => {
  f.initialize();
  const keyPath = f.toReal(`${f.directory}/${KEY_FILE}`);
  const before = fs.readFileSync(keyPath);
  const stat = fs.statSync(keyPath);
  assert.equal(stat.mode & 0o7777, 0o600);
  assert.equal(fs.statSync(f.toReal(f.directory)).mode & 0o7777, 0o700);
  assert.throws(() => generateJournalKey({ directory: f.directory }, f.adapter), /key_exists/);
  assert.deepEqual(fs.readFileSync(keyPath), before);
  assert.equal(fs.statSync(keyPath).ino, stat.ino);
  assert.deepEqual(f.journal.listRecords(), []);
}));

test('private directories, ancestors and files reject group/world access or unsafe ownership', () => {
  for (const mode of [0o750, 0o707, 0o1777]) fixture(f => {
    fs.chmodSync(f.toReal(f.directory), mode);
    assert.throws(() => f.initialize(), /permissions/);
    assert.deepEqual(fs.readdirSync(f.toReal(f.directory)), []);
  });
  fixture(f => {
    fs.chmodSync(f.toReal('/journal-test'), 0o770);
    assert.throws(() => f.initialize(), /parent_permissions/);
  });
  fixture(f => {
    f.adapter.uid = () => process.getuid() + 1;
    assert.throws(() => f.initialize(), /permissions/);
  });
  for (const mode of [0o640, 0o604]) fixture(f => {
    f.initialize(); fs.chmodSync(f.toReal(`${f.directory}/${KEY_FILE}`), mode);
    assert.throws(() => f.journal.writePending(manifest()), /permissions/);
    assert.throws(() => f.journal.listRecords(), /permissions/);
  });
});

test('directories inside another repository are rejected, including worktree .git files', () => {
  for (const kind of ['directory', 'file']) fixture(f => {
    const dotGit = f.toReal('/journal-test/.git');
    if (kind === 'directory') fs.mkdirSync(dotGit); else fs.writeFileSync(dotGit, 'synthetic-gitdir');
    assert.throws(() => f.initialize(), /repository/);
  });
});

test('symlink directories, ancestors, files and hard-linked files are rejected', () => {
  fixture(f => {
    fs.symlinkSync(f.toReal(f.directory), f.toReal('/journal-test/alias'));
    assert.throws(() => generateJournalKey({ directory: '/journal-test/alias' }, f.adapter), /symlink/);
    assert.throws(() => generateJournalKey({ directory: '/journal-test/alias/subdir' }, f.adapter), /ENOENT|symlink/);
    fs.mkdirSync(f.toReal(`${f.directory}/subdir`), { mode: 0o700 });
    assert.throws(() => generateJournalKey({ directory: '/journal-test/alias/subdir' }, f.adapter), /symlink/);
  });
  for (const kind of ['symlink', 'hardlink']) fixture(f => {
    f.initialize(); const input = manifest(); f.journal.writePending(input);
    const file = f.filename(input), other = f.toReal('/journal-test/copy');
    fs.renameSync(file, other);
    if (kind === 'symlink') fs.symlinkSync(other, file); else fs.linkSync(other, file);
    assert.throws(() => f.journal.listRecords(), /permissions/);
    assert.throws(() => f.journal.writePending(input), /permissions/);
  });
});

test('pending is durable before SQL; exact replay leaves bytes/inode unchanged; receipt is separate', () => fixture(f => {
  f.initialize(); const input = manifest(); f.events.length = 0;
  const pending = f.journal.writePending(input);
  assert.equal(pending.state, 'pending'); assert.equal(pending.replayed, false);
  const rename = f.events.findIndex(event => event.op === 'rename');
  assert(rename > 0);
  assert(f.events.slice(0, rename).some(event => event.op === 'fsync-file' && event.name.includes('.stage-')));
  assert(f.events.slice(rename + 1).some(event => event.op === 'fsync-directory' && event.name === f.directory));
  assert.equal(f.events.at(-1).op, 'fsync-directory');
  const bytes = fs.readFileSync(f.filename(input)), stat = fs.statSync(f.filename(input));
  const replay = f.journal.writePending({ ...input, targets: [...input.targets].reverse() });
  assert.deepEqual(replay, { ...pending, replayed: true });
  assert.deepEqual(fs.readFileSync(f.filename(input)), bytes);
  assert.equal(fs.statSync(f.filename(input)).ino, stat.ino);
  assert.deepEqual(f.journal.listRecords().map(record => record.state), ['pending']);
  const completion = { ...input, completedAt: COMPLETED_AT };
  const receipt = f.journal.writeCompletedReceipt(completion);
  assert.equal(receipt.state, 'completed'); assert.equal(receipt.replayed, false);
  assert.deepEqual(f.journal.writeCompletedReceipt(completion), { ...receipt, replayed: true });
  assert.deepEqual(f.journal.listRecords().map(record => record.state).sort(), ['completed', 'pending']);
  assert.deepEqual(fs.readFileSync(f.filename(input)), bytes);
  assert.throws(() => f.journal.writeCompletedReceipt({ ...completion, completedAt: '2026-10-03T22:00:00.000Z' }), /conflict/);
}));

test('completion requires the exact signed intent and cannot relabel pending or partial work', () => fixture(f => {
  f.initialize(); const input = manifest(); const completed = { ...input, completedAt: COMPLETED_AT };
  assert.throws(() => f.journal.writeCompletedReceipt(completed), /receipt_without_matching_intent/);
  assert.throws(() => f.journal.writeCompletedReceipt(input), /state/);
  assert.throws(() => f.journal.writePending(completed), /state/);
  f.journal.writePending(input);
  for (const change of [
    { requestId: crypto.randomUUID() }, { workspaceId: crypto.randomUUID() }, { scopeHash: 'b'.repeat(64) },
    { targets: [input.targets[1]], counts: { google_sheets_connections: 1 } }
  ]) assert.throws(() => f.journal.writeCompletedReceipt({ ...completed, ...change }), /receipt_without_matching_intent/);
  assert.throws(() => f.journal.writePending({ ...input, scopeHash: 'b'.repeat(64) }), /conflict/);
  assert.equal(f.journal.listRecords().length, 1);
  fs.renameSync(f.filename(input), f.filename(input, 'completed'));
  assert.throws(() => f.journal.listRecords(), /record_name/);
}));

test('restore lists every request/workspace intent and receipt using only external public trust', () => fixture(f => {
  f.initialize(); const inputs = [manifest(), manifest(), manifest()];
  for (const input of inputs) f.journal.writePending(input);
  for (const input of inputs.slice(0, 2)) f.journal.writeCompletedReceipt({ ...input, completedAt: COMPLETED_AT });
  fs.unlinkSync(f.toReal(`${f.directory}/${KEY_FILE}`));
  const restore = openJournal(f.options, f.adapter);
  const records = restore.listRecords();
  assert.equal(records.length, 5);
  assert.equal(records.filter(record => record.state === 'pending').length, 3);
  assert.equal(records.filter(record => record.state === 'completed').length, 2);
  assert.deepEqual(new Set(records.map(record => record.manifest.workspaceId)), new Set(inputs.map(input => input.workspaceId)));
  assert(records.some(record => record.manifest.requestId === inputs[2].requestId && record.state === 'pending'));
  assert.throws(() => generateJournalKey({ directory: f.directory }, f.adapter), /not_empty/);
  fs.unlinkSync(f.filename(inputs[0]));
  assert.throws(() => restore.listRecords(), /receipt_without_matching_intent/);
}));

test('corruption in any record blocks the whole restore and cannot be silently overwritten', () => {
  for (const corrupt of [
    bytes => bytes.subarray(0, 25),
    bytes => { const envelope = JSON.parse(bytes); envelope.manifest.scopeHash = 'c'.repeat(64); return encode(envelope); }
  ]) fixture(f => {
    f.initialize(); const first = manifest(), second = manifest();
    f.journal.writePending(first); f.journal.writePending(second);
    const bad = corrupt(fs.readFileSync(f.filename(first))); fs.writeFileSync(f.filename(first), bad);
    assert.throws(() => f.journal.listRecords(), /sheets_journal_(json|signature)/);
    assert.throws(() => f.journal.writePending(first), /sheets_journal_(json|signature)/);
    assert.throws(() => f.journal.writeCompletedReceipt({ ...second, completedAt: COMPLETED_AT }), /sheets_journal_(json|signature)/);
    assert.deepEqual(fs.readFileSync(f.filename(first)), bad);
  });
});

test('wrong signing key, wrong restore pin, unexpected files and locks fail closed', () => {
  fixture(f => {
    f.initialize();
    fs.writeFileSync(f.toReal(`${f.directory}/${KEY_FILE}`), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    assert.throws(() => f.journal.writePending(manifest()), /pin_mismatch/);
    assert.throws(() => openJournal({ ...f.options, pinnedFingerprint: pin }, f.adapter), /pin_mismatch/);
  });
  for (const filename of ['unexpected.json', '.stage-interrupted', '.journal-lock']) fixture(f => {
    f.initialize();
    const actual = f.toReal(`${f.directory}/${filename}`);
    if (filename === '.journal-lock') fs.mkdirSync(actual, { mode: 0o700 });
    else fs.writeFileSync(actual, 'synthetic-incomplete', { mode: 0o600 });
    assert.throws(() => f.journal.listRecords(), /unexpected_file|recovery_required/);
    assert.throws(() => f.journal.writePending(manifest()), /unexpected_file|recovery_required/);
  });
});

for (const phase of ['pending', 'completed']) {
  for (const interruption of ['write', 'file-fsync', 'rename', 'parent-fsync']) {
    test(`interrupted ${phase} at ${interruption} cannot report completion or dispatch subsequent SQL`, () => fixture(f => {
      f.initialize(); const input = manifest();
      if (phase === 'completed') f.journal.writePending(input);
      let renamed = false, fired = false, followingSql = 0;
      f.hook = event => {
        if (event.op === 'rename') renamed = true;
        const hit = (interruption === 'write' && event.op === 'write') ||
          (interruption === 'file-fsync' && event.op === 'fsync-file' && event.name.includes('.stage-')) ||
          (interruption === 'rename' && event.op === 'rename') ||
          (interruption === 'parent-fsync' && renamed && event.op === 'fsync-directory');
        if (hit && !fired) { fired = true; throw new Error('synthetic-power-loss'); }
      };
      assert.throws(() => {
        if (phase === 'pending') f.journal.writePending(input);
        else f.journal.writeCompletedReceipt({ ...input, completedAt: COMPLETED_AT });
        followingSql++;
      }, /synthetic-power-loss/);
      assert(fired); assert.equal(followingSql, 0); f.hook = null;
      assert.throws(() => f.journal.listRecords(), /recovery_required/);
      assert.throws(() => f.journal.writePending(input), /recovery_required/);
      if (phase === 'completed') {
        const pending = verifyRecord(fs.readFileSync(f.filename(input)), f.options.publicKey, f.options.pinnedFingerprint);
        assert.equal(pending.state, 'pending'); assert.equal(pending.manifest.completedAt, null);
      }
    }));
  }
}

test('permissions and directory identity are checked again after opening a journal', () => {
  fixture(f => {
    f.initialize(); fs.chmodSync(f.toReal(f.directory), 0o750);
    assert.throws(() => f.journal.listRecords(), /permissions/);
    assert.throws(() => f.journal.writePending(manifest()), /permissions/);
  });
  fixture(f => {
    f.initialize(); fs.renameSync(f.toReal(f.directory), f.toReal('/journal-test/old'));
    fs.mkdirSync(f.toReal(f.directory), { mode: 0o700 });
    assert.throws(() => f.journal.listRecords(), /directory_changed/);
  });
});
