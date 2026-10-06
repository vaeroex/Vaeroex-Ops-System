/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
// Actual parser/admission functions with bounded synthetic data and an in-memory DB.
// No service credentials, network, provider generation or real storage are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const zlib = require('node:zlib');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
global.fetch = async () => { throw new Error('Network disabled for audit regression'); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest); };
const load = Module._load;
const inflations = [];
Module._load = function(request, parent, ...rest) {
  if (request === 'server-only') return {};
  if (request === 'zlib') return { ...zlib, ...Object.fromEntries(['inflateSync', 'inflateRawSync'].map(name => [name, (input, options) => {
    const observation = { method: name, compressedBytes: input.length, maxOutputLength: options?.maxOutputLength, expandedBytes: null };
    inflations.push(observation);
    assert.ok(options?.maxOutputLength > 0 && options.maxOutputLength <= 8 * 1024 * 1024, 'every inflater has a runtime bound');
    const output = zlib[name](input, options); observation.expandedBytes = output.length; return output;
  }])) };
  if (request === '@/lib/ai/providers/provider-manager') return { createAIEmbeddings: async () => ({ embeddings: [], model: 'synthetic-no-provider', tokens: 0, error: 'Synthetic text-only indexing' }) };
  return load.call(this, request, parent, ...rest);
};
const parser = require('../lib/imports/spreadsheets.ts');
const documents = require('../lib/imports/document-text.ts');
const evidence = require('../lib/ai/evidence-index.ts');
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
function zip(parts) {
  const locals = [], central = []; let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name), body = Buffer.from(part.body), method = part.stored ? 0 : 8;
    const compressed = part.stored ? body : zlib.deflateRawSync(body, { level: 9 });
    const declared = part.declared ?? body.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(declared, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(entry, name); offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const workbook = '<workbook><sheets><sheet name="Metrics" r:id="r1"/></sheets></workbook>';
const relationships = '<Relationships><Relationship Id="r1" Type="fixture/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c><c r="C1" t="inlineStr"><is><t>Amount (2)</t></is></c></row><row r="2"><c r="A2"><v>10</v></c><c r="B2"><v>20</v></c><c r="C2"><v>30</v></c></row></sheetData></worksheet>';
const xlsx = (extra = []) => zip([{ name: 'xl/workbook.xml', body: workbook }, { name: 'xl/_rels/workbook.xml.rels', body: relationships }, { name: 'xl/worksheets/sheet1.xml', body: sheet }, ...extra]);
check('CSV duplicate suffix collision retains all columns', () => {
  const row = parser.parseCsvRows('Amount,Amount,Amount (2)\n10,20,30\n')[0];
  assert.deepEqual(Object.keys(row), ['Amount', 'Amount (3)', 'Amount (2)']); assert.deepEqual(Object.values(row), ['10', '20', '30']);
});
check('header truncation, fallback, repeated suffixes and reserved keys retain values', () => {
  const labels = ['X'.repeat(81), 'X'.repeat(80), '', 'Column 3', 'Amount (2)', 'Amount (2)', '__proto__', 'constructor', 'toString'];
  const values = labels.map((_, i) => String(i)); const row = parser.parseCsvRows(labels.join(',') + '\n' + values.join(','))[0];
  assert.equal(Object.keys(row).length, labels.length); assert.deepEqual(Object.values(row), values); assert.equal(Object.hasOwn(row, '__proto__'), true);
});
check('XLSX duplicate suffix collision retains all columns', () => assert.deepEqual(Object.values(parser.parseXlsxRows(xlsx())[0]), [10, 20, 30]));
check('CSV physical start-line provenance survives blanks and quoted CRLF', () => {
  const csv = '\r\nName,Revenue\r\nAlpha,100\r\n\r\n"Beta\r\nbranch",200\r\nGamma,300\r\n';
  const rows = parser.parseSpreadsheetWorkbook({ fileName: 'fixture.csv', buffer: Buffer.from(csv) }).rows;
  assert.deepEqual(rows.map(r => r.worksheetRowNumber), [3, 5, 7]); assert.equal(rows[1].values.Name, 'Beta\r\nbranch');
  assert.deepEqual(parser.parseSpreadsheetWorkbook({ fileName: 'fixture.csv', buffer: Buffer.from('A\r1\r\r2') }).rows.map(r => r.worksheetRowNumber), [2, 4]);
});
check('ordinary DOCX and compressed PDF text still extract', () => {
  assert.equal(documents.extractDocxText(zip([{ name: 'word/document.xml', body: '<w:p>Hello synthetic business.</w:p>' }])), 'Hello synthetic business.');
  const body = zlib.deflateSync(Buffer.from('BT (Hello synthetic PDF.) Tj ET'));
  assert.equal(documents.extractPdfText(Buffer.concat([Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\n'), body, Buffer.from('\nendstream')])), 'Hello synthetic PDF.');
});
check('forged DOCX size is stopped by zlib before output allocation', () => {
  const before = inflations.length; assert.throws(() => documents.extractDocxText(zip([{ name: 'word/document.xml', body: 'A'.repeat(2 * 1024 * 1024), declared: 1 }])), /safe extraction limits/);
  assert.equal(inflations[before].maxOutputLength, 1); assert.equal(inflations[before].expandedBytes, null);
});
check('forged XLSX size is stopped by zlib before output allocation', () => {
  const before = inflations.length; assert.throws(() => parser.parseXlsxRows(zip([{ name: 'xl/workbook.xml', body: 'A'.repeat(2 * 1024 * 1024), declared: 1 }, { name: 'xl/_rels/workbook.xml.rels', body: relationships }])), /invalid or oversized/);
  assert.equal(inflations[before].maxOutputLength, 1); assert.equal(inflations[before].expandedBytes, null);
});
check('unneeded DOCX/XLSX package parts are not inflated', () => {
  let before = inflations.length;
  documents.extractDocxText(zip([{ name: 'word/document.xml', body: '<w:p>Normal.</w:p>' }, { name: 'word/media/unused.bin', body: 'A'.repeat(2 * 1024 * 1024), declared: 1 }]));
  assert.equal(inflations.length - before, 1); before = inflations.length;
  parser.parseXlsxRows(xlsx([{ name: 'xl/media/unused.bin', body: 'A'.repeat(2 * 1024 * 1024), declared: 1 }])); assert.equal(inflations.length - before, 3);
});
check('ZIP duplicate entries, inconsistent local headers, excessive ratio reject', () => {
  assert.throws(() => documents.extractDocxText(zip([{ name: 'word/document.xml', body: 'first' }, { name: 'word/document.xml', body: 'second' }])), /inconsistent/);
  const fixture = xlsx(); fixture.writeUInt32LE(1, 22); assert.throws(() => parser.parseXlsxRows(fixture), /inconsistent/);
  assert.throws(() => documents.extractDocxText(zip([{ name: 'word/document.xml', body: 'A'.repeat(2 * 1024 * 1024) }])), /safe extraction limits/);
});
check('compressed PDF expansion rejects rather than falling through to model extraction', () => {
  const payload = zlib.deflateSync(Buffer.from('A'.repeat(2 * 1024 * 1024)));
  const before = inflations.length;
  assert.throws(() => documents.extractPdfText(Buffer.concat([Buffer.from('<< /Filter /FlateDecode >>\nstream\n'), payload, Buffer.from('\nendstream')])), /safe extraction limits/);
  assert.equal(inflations.length - before, 1); assert.equal(inflations[before].expandedBytes, null);
});
if (process.argv.includes('--limits')) {
  // At most 35 MiB of intended DOCX/PDF expansion, 70 MiB declared XLSX;
  // run this mode only under the external 512 MiB RSS / 60-second watchdog.
  let seed = 0x71384625;
  const pattern = Buffer.from(Array.from({ length: 8192 }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return 65 + ((seed >>> 0) % 26); }));
  const part = Buffer.alloc(7 * 1024 * 1024); for (let i = 0; i < part.length; i += pattern.length) pattern.copy(part, i);
  check('DOCX cumulative expansion stops before the fifth 7MiB part', () => {
    const before = inflations.length;
    assert.throws(() => documents.extractDocxText(zip(Array.from({ length: 5 }, (_, i) => ({ name: `word/header${i}.xml`, body: part })))), /safe extraction limits/);
    assert.equal(inflations.length - before, 4); assert.equal(inflations.slice(before).reduce((n, r) => n + r.expandedBytes, 0), 28 * 1024 * 1024);
  });
  check('PDF cumulative expansion bounds the fifth stream to remaining 4MiB', () => {
    const payload = zlib.deflateSync(part); const stream = Buffer.concat([Buffer.from('<< /Filter /FlateDecode >>\nstream\n'), payload, Buffer.from('\nendstream\n')]); const before = inflations.length;
    assert.throws(() => documents.extractPdfText(Buffer.concat(Array(5).fill(stream))), /safe extraction limits/);
    assert.equal(inflations.length - before, 5); assert.equal(inflations.at(-1).maxOutputLength, 4 * 1024 * 1024); assert.equal(inflations.at(-1).expandedBytes, null);
  });
  check('XLSX cumulative declaration rejects before inflating', () => {
    const before = inflations.length;
    assert.throws(() => parser.parseXlsxRows(zip(Array.from({ length: 10 }, (_, i) => ({ name: `xl/part${i}.xml`, body: part })))), /expands beyond/); assert.equal(inflations.length, before);
  });
  check('DOCX entry-count cap rejects before inflation', () => assert.throws(() => documents.extractDocxText(zip(Array.from({ length: 1001 }, (_, i) => ({ name: `word/header${i}.xml`, body: '' })))), /safe extraction limits/));
}
const assess = (claim, source = 'Revenue amount October 100. This financial worksheet records the actual October revenue amount for the business.') => evidence.assessFileAnalysisEvidence({ outputJson: { findings: [claim] }, extractedSourceText: source, extractedRowCount: 1 });
check('magnitude, signed values, percentage, small numbers, currency, labels, periods, direction fail closed', () => {
  for (const [claim, source] of [
    ['Revenue amount October 999', undefined],
    ['Revenue amount October 1', undefined],
    ['Revenue amount October 100', 'Revenue amount October -100.'],
    ['Margin October 10%', 'Margin October 10.'],
    ['Margin October 0.5', 'Margin October 50%.'],
    ['Revenue October $100', 'Revenue October €100.'],
    ['Revenue October 999', 'Revenue October 100. Costs October 999.'],
    ['Financial revenue total October 999', 'Financial revenue total October 100. Financial costs total October 999.'],
    ['Revenue November 100', 'Revenue October 100.'],
    ['Revenue January 200', 'Revenue January 100. Revenue February 200.'],
    ['Revenue decreased to 100', 'Revenue increased to 100.']
  ]) assert.equal(assess(claim, source).eligible, false, claim);
});
check('one supported fact cannot admit an unrelated false claim or summary', () => {
  for (const outputJson of [{ findings: ['Revenue amount October 100', 'Revenue amount October 999'] }, { findings: ['Revenue amount October 100'], summary: 'Revenue amount October 999' }]) {
    assert.equal(evidence.assessFileAnalysisEvidence({ outputJson, extractedSourceText: 'Revenue amount October 100.', extractedRowCount: 1 }).eligible, false);
  }
});
check('supported numerical claim is eligible only for explicit review', () => { const result = assess('Revenue amount October 100'); assert.equal(result.eligible, true); assert.equal(result.requiresReview, true); });
function client(failTable, options = {}) {
  const writes = [];
  const memory = (options.memory || []).map(row => ({ ...row }));
  const sourceRun = { id: 'run-one', status: 'completed', deleted_at: null, archived_at: null, input_json: {}, output_json: {} };
  return { writes, memory, rpc: async () => ({ data: { eligible: true, mode: 'existing_native_file_analysis' }, error: null }), from(table) {
    let operation = 'select', value; const predicates = []; const query = {
      select() { return query; }, eq(k,v) { predicates.push(row => row[k] === v); return query; }, in(k,v) { predicates.push(row => v.includes(row[k])); return query; }, is(k,v) { predicates.push(row => (row[k] ?? null) === v); return query; }, lt(k,v) { predicates.push(row => row[k] < v); return query; }, maybeSingle() { return query; },
      insert(v) { operation = 'insert'; value = v; return query; }, update(v) { operation = 'update'; value = v; return query; }, upsert(v) { operation = 'upsert'; value = v; return query; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (table === failTable) return { data: null, error: { message: 'Synthetic private database detail' } };
        if (table === 'business_memory_chunks' && operation === 'upsert' && options.failUpsert) return { data: null, error: { message: 'Synthetic replacement write failure' } };
        if (operation !== 'select') writes.push({ table, operation, value });
        if (table === 'business_memory_chunks') {
          if (operation === 'select') return { data: memory.filter(row => predicates.every(p => p(row))).map(row => ({ id: row.id })), error: null };
          if (operation === 'update') { for (const row of memory.filter(row => predicates.every(p => p(row)))) Object.assign(row, value); return { data: [], error: null }; }
          if (operation === 'upsert') { const result = value.map(row => { let target = memory.find(item => item.content_hash === row.content_hash && item.chunk_index === row.chunk_index); if (!target) { target = { id: 'memory-' + memory.length }; memory.push(target); } Object.assign(target, row); return { id: target.id }; }); return { data: result, error: null }; }
        }
        return { data: table === 'ai_agent_runs' ? sourceRun : table === 'file_processing_jobs' ? { id: 'job-one' } : [], error: null };
      }).then(resolve, reject); }
    }; return query;
  } };
}
(async () => {
  for (const [table, row] of [
    ['file_uploads', { source_type: 'file', source_file_id: 'file-one' }],
    ['ai_agent_runs', { source_type: 'file_analysis', source_metadata: { run_id: 'run-one' } }],
    ['business_notes', { source_type: 'business_note', source_id: 'note-one' }]
  ]) {
    await assert.rejects(evidence.filterEligibleMemoryRowsByLifecycle({ supabase: client(table), workspaceId: 'workspace-one', rows: [{ source_metadata: {}, ...row }] }), error => /source availability/.test(error.message) && !error.message.includes('private'));
    checks.push(`${table} lifecycle failure propagates a sanitized unavailable result`);
  }
  assert.deepEqual(await evidence.filterEligibleMemoryRowsByLifecycle({ supabase: client(), workspaceId: 'workspace-one', rows: [] }), []); checks.push('genuinely empty lifecycle evidence remains empty');
  const file = { id: 'file-one', display_name: 'Synthetic source', original_name: 'synthetic.txt', file_extension: 'txt', deleted_at: null, archived_at: null };
  const metadata = { analysis_output: { findings: ['Revenue amount October 100'] }, extracted_row_count: 1 };
  const input = { workspaceId: 'workspace-one', userId: 'user-one', file, runId: 'run-one', extractedText: 'Revenue amount October 100. This financial worksheet records the actual October revenue amount for the business.', metadata };
  for (const confirmation of [undefined, { userId: 'other-user', runId: 'run-one' }, { userId: 'user-one', runId: 'other-run' }]) {
    const db = client(); const result = await evidence.indexFileAnalysisEvidence({ ...input, supabase: db, confirmation }); assert.equal(result.indexedChunks, 0); assert.equal(db.writes.length, 0);
  } checks.push('missing or mismatched confirmation cannot write generated Business Memory');
  let db = client(); let result = await evidence.indexFileAnalysisEvidence({ ...input, supabase: db, confirmation: { userId: 'user-one', runId: 'run-one' } }); assert.ok(result.indexedChunks > 0); assert.equal(db.writes.filter(w => w.table === 'business_memory_chunks' && w.operation === 'upsert').length, 1); checks.push('explicitly confirmed supported analysis reaches actual indexer write boundary');
  db = client(); result = await evidence.indexFileAnalysisEvidence({ ...input, supabase: db, metadata: { ...metadata, analysis_output: { findings: ['Revenue amount October 999'] } }, confirmation: { userId: 'user-one', runId: 'run-one' } }); assert.equal(result.indexedChunks, 0); assert.equal(db.writes.length, 0); checks.push('explicit confirmation cannot admit contradictory numerical output');
  const previous = { id: 'previous-approved', workspace_id: input.workspaceId, source_type: 'file_analysis', source_file_id: file.id, content_hash: 'old-distinct-content', chunk_index: 0, indexed_at: '2020-01-01T00:00:00Z', archived_at: null, deleted_at: null };
  db = client(null, { memory: [previous], failUpsert: true }); result = await evidence.indexFileAnalysisEvidence({ ...input, supabase: db, confirmation: { userId: 'user-one', runId: 'run-one' } }); assert.equal(result.indexedChunks, 0); assert.deepEqual(db.memory, [previous]); checks.push('failed replacement write preserves previously approved memory');
  db = client(null, { memory: [previous] }); result = await evidence.indexFileAnalysisEvidence({ ...input, supabase: db, confirmation: { userId: 'user-one', runId: 'run-one' } }); assert.ok(result.indexedChunks > 0); assert.ok(db.memory[0].archived_at); assert.equal(db.memory[1].archived_at, null); assert.equal(db.memory[1].deleted_at, null); const memoryWrites = db.writes.filter(w => w.table === 'business_memory_chunks'); assert.deepEqual(memoryWrites.map(w => w.operation), ['upsert', 'update']); checks.push('previous IDs retire only after complete replacement acknowledgement');
  result = await evidence.indexFileAnalysisEvidence({ ...input, supabase: db, confirmation: { userId: 'user-one', runId: 'run-one' } }); assert.ok(result.indexedChunks > 0); assert.equal(db.memory.filter(row => !row.archived_at && !row.deleted_at).length, 1); checks.push('identical confirmed retry keeps its idempotent chunk active');
  console.log(JSON.stringify({ kind: 'audit_import_evidence_regression', status: 'passed', checks: checks.length, names: checks, inflations, resourceUsage: process.resourceUsage(), limitation: 'Actual parser and indexer functions; synthetic query responses and in-memory write recording, no real database/provider/UI.' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
