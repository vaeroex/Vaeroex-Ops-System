/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
/* Offline semantic admission checks; no model or database calls. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { validateTypedNoteProjection } = require('../lib/ai/shared-evidence/typed-note-semantics.ts');
const { approvedContextText } = require('../lib/ai/business-notes/approved-context-text.ts');
const { chunkEvidenceText } = require('../lib/ai/evidence-index.ts');
const { BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION } = require('../lib/ai/business-notes/contracts.ts');
const { validateBusinessNoteExtraction } = require('../lib/ai/business-notes/validation.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
const noteId = '00000000-0000-4000-8000-000000000001';
const original = 'Revenue was 7000 in June.';
const extraction = {
  schemaVersion: BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION, extractionDisposition: 'extractable',
  title: 'Business note', summary: original, noteType: 'observation', sourceClassification: 'manager_observation',
  departments: ['Sales'], topics: ['Revenue'], peopleMentioned: [], customersMentioned: [], vendorsMentioned: [], projectsMentioned: [],
  explicitFacts: [{ statement: original, sourceQuote: original, confidence: 0.9 }], opinionsOrAssumptions: [], risks: [], opportunities: [], decisions: [],
  mentionedMetrics: [{ name: 'Revenue', value: 7000, unit: 'USD', sourceQuote: original, confidence: 0.9 }],
  reportingPeriod: { start: null, end: null, inferred: false, sourceQuote: null }, evidenceTreatment: 'potentially_supporting', extractionConfidence: 0.72, missingContext: []
};
const checked = validateBusinessNoteExtraction(extraction, original);
assert.equal(checked.ok, true);
const text = chunkEvidenceText(approvedContextText(checked.value, []))[0];
const projection = {
  provider: 'business_note', workspace_id: '00000000-0000-4000-8000-000000000002', entity_id: null,
  note_id: noteId, source_version: 1, source_text_hash: hash(original), original_note_text: original,
  extraction, reviewed_extraction: extraction, user_corrections: {}, user_reporting_period_start: null, user_reporting_period_end: null,
  chunk_id: '00000000-0000-4000-8000-000000000003', chunk_index: 0, content_hash: hash(`${noteId}:1:0:${text}`), treatment: 'supporting_context'
};
assert.equal(validateTypedNoteProjection(projection).text, text);
assert.equal(validateTypedNoteProjection(projection).stage, 'unadmitted');
assert.throws(() => validateTypedNoteProjection({ ...projection, reviewed_extraction: {} }), /semantics_invalid/);
assert.throws(() => validateTypedNoteProjection({ ...projection, extraction: {} }), /semantics_invalid/);
assert.throws(() => validateTypedNoteProjection({ ...projection, reviewed_extraction: { ...extraction, title: 'Changed review' } }), /reviewed_chunk_mismatch/);
assert.throws(() => validateTypedNoteProjection({ ...projection, content_hash: hash('fabricated chunk') }), /reviewed_chunk_mismatch/);
assert.throws(() => validateTypedNoteProjection({ ...projection, chunk_index: 100 }), /reviewed_chunk_mismatch/);
assert.throws(() => validateTypedNoteProjection({ ...projection, user_corrections: { userAddedContext: [{ arbitrary: 'metadata' }] } }), /semantics_invalid/);
assert.throws(() => validateTypedNoteProjection({ ...projection, original_note_text: 'Changed original' }), /source_text_mismatch/);
console.log('Shared evidence note semantics: 8 checks passed (unadmitted, no provider calls).');
