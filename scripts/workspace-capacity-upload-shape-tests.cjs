/* eslint-disable @typescript-eslint/no-require-imports -- Offline workload-contract tests; no application or provider. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = import('../docs/security/audit-evidence/stage-3/http/core.mjs');

for (const profile of ['agreed_large_rows_v1', 'supported_rows_v1']) {
  test(`${profile} preserves the complete twenty-file distribution with exact bytes and unique rows`, async () => {
    const { uploadCsv, uploadTargetBytes, uploadRecordCount } = await core;
    const counts = new Map();
    for (let sequence = 0; sequence < 20; sequence++) {
      const expectedBytes = sequence < 16 ? 40960 : sequence < 19 ? 419430 : 2202009;
      const agreedRows = sequence < 16 ? 1000 : sequence < 19 ? 10000 : 50000;
      const expectedRows = profile === 'supported_rows_v1' ? 1000 : agreedRows;
      const csv = uploadCsv(sequence, profile), lines = csv.split('\n');
      assert.equal(uploadTargetBytes(sequence), expectedBytes);
      assert.equal(uploadRecordCount(sequence), agreedRows, 'the original target row counts must remain explicit');
      assert.equal(Buffer.byteLength(csv), expectedBytes); assert.equal(lines.pop(), '', 'CSV must end at a complete record');
      assert.equal(lines.shift(), 'date,Revenue,Marker'); assert.equal(lines.length, expectedRows);
      const markers = new Set();
      for (const [index, line] of lines.entries()) {
        const columns = line.split(','); assert.equal(columns.length, 3); assert.equal(columns[0], '2026-09-01'); assert.equal(columns[1], '100');
        assert.match(columns[2], new RegExp(`^r${String(index).padStart(6, '0')}x*$`)); markers.add(columns[2]);
      }
      assert.equal(markers.size, expectedRows, 'no duplicate or omitted row markers');
      counts.set(expectedBytes, (counts.get(expectedBytes) || 0) + 1);
      assert.equal(uploadCsv(sequence + 20, profile), csv, 'distribution must repeat after twenty files');
      if (profile === 'agreed_large_rows_v1') assert.equal(uploadCsv(sequence), csv, 'default remains the original agreed profile');
    }
    assert.deepEqual([...counts], [[40960, 16], [419430, 3], [2202009, 1]]);
  });
}

test('unknown upload profiles fail closed', async () => {
  const { uploadCsv } = await core;
  for (const profile of ['', 'supported', null, 'agreed_large_rows_v2']) assert.throws(() => uploadCsv(0, profile), /upload_profile_invalid/);
});

test('actual workload multipart adapter correlates distinct files without inflating CSV rows', async () => {
  const { uploadCsv } = await core;
  const source = fs.readFileSync(path.join(__dirname, '../docs/security/audit-evidence/stage-3/http/run.mjs'), 'utf8');
  const line = source.split('\n').find(s => s.includes('const body=new FormData();for(const entry of a.entries)'));
  assert(line, 'review the actual multipart construction if its boundary moves');
  const actualBody = new Function('a', 'id', 'actor', 'env', 'uploadCsv', 'uploadSequence', 'assert', line + ';return body;');
  const actor = { workspaceId: '00000000-0000-4000-8000-000000000010' };
  const adapter = { entries: [{ name: 'file', fileFixture: true }, { name: 'display_name', value: 'SYNTHETIC {{logicalId}}' }] };
  for (const profile of ['agreed_large_rows_v1', 'supported_rows_v1']) {
    const files = [];
    for (const id of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']) {
      const body = actualBody(adapter, id, actor, { uploadProfile: profile }, uploadCsv, 19, assert);
      const file = body.get('file'); assert.equal(file.name, `SYNTHETIC-${id}.csv`); assert.equal(file.type, 'text/csv');
      assert.equal(body.get('display_name'), 'SYNTHETIC ' + id); assert.equal(await file.text(), uploadCsv(19, profile));
      assert(!(await file.text()).includes(id), 'correlation must not change the data-shape contract'); files.push(file);
    }
    assert.notEqual(files[0].name, files[1].name); assert.equal(files[0].size, files[1].size);
  }
});
