const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { validateSharedMemoryProjection } = require('../lib/ai/shared-evidence/memory-eligibility.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture = () => ({ provider: 'file', workspace_id: id(1), file_id: id(2), chunk_id: id(3), excerpt: 'Reviewed business fact',
  authority: { eligible: true, mode: 'existing_native_file_analysis' }, eligibility: {
    chunk: { id: id(3), workspace_id: id(1), source_id: id(2), source_file_id: id(2), source_type: 'file_analysis',
      source_metadata: { evidence_classification: 'business_evidence', run_id: id(4) }, archived_at: null, deleted_at: null },
    files: [{ id: id(2), metadata_json: {}, archived_at: null, deleted_at: null }],
    runs: [{ id: id(4), status: 'completed', input_json: {}, output_json: { evidence_classification: 'business_evidence' }, archived_at: null, deleted_at: null }],
    notes: [], worksheetHeads: []
  }});
assert.equal(validateSharedMemoryProjection(fixture(),id(1)).text, 'Reviewed business fact');
for (const mutate of [
  p => p.eligibility.chunk.source_metadata.evidence_lifecycle='inactive',
  p => p.eligibility.chunk.source_metadata.evidence={business_evidence_eligible:false},
  p => p.eligibility.files[0].metadata_json={metadata:{invalidated_at:'2026-10-23'}},
  p => p.eligibility.files[0].metadata_json={business_evidence_eligible:false},
  p => p.eligibility.runs[0].output_json.business_evidence_eligible=false,
  p => p.eligibility.runs[0].output_json.evidence_lifecycle='inactive',
  p => p.eligibility.runs[0].input_json={metadata:{extraction_outcome:'failed'}},
  p => p.eligibility.runs=[],
  p => p.eligibility.chunk.source_metadata.indexing_method='worksheet_import',
  p => p.eligibility.chunk.workspace_id=id(9)
]) { const p=fixture();mutate(p);assert.throws(()=>validateSharedMemoryProjection(p,id(1))); }
const worksheet=fixture();worksheet.eligibility.chunk.source_metadata.indexing_method='worksheet_import';
worksheet.eligibility.chunk.source_metadata.import_attempt_id=id(5);worksheet.eligibility.worksheetHeads=[[id(2),id(5)]];
assert.equal(validateSharedMemoryProjection(worksheet,id(1)).stage,'unadmitted');
worksheet.eligibility.worksheetHeads=[[id(2),id(6)]];assert.throws(()=>validateSharedMemoryProjection(worksheet,id(1)),/ineligible/);
console.log('Canonical shared memory eligibility: 13 checks passed; zero external calls.');
