/* eslint-disable @typescript-eslint/no-require-imports -- Server-rendered presentation test, no browser/network. */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { Exchange } = require('../components/vsi/Exchange.tsx');
const exchange = { id: 'synthetic', createdAt: '2026-10-31T00:00:00Z', userMessage: 'Synthetic question',
  answer: 'A retained fact [B1].', citations: [{ id: 'B1', title: 'Synthetic original', url: '/app/sources', sourceType: 'kpi',
    sourceId: 'fixture', evidenceDate: null, retrievedAt: '2026-10-31T00:00:00Z' }] };
const before = JSON.stringify(exchange);
const view = hideSourceCitations => renderToStaticMarkup(React.createElement(Exchange, { exchange, hideSourceCitations,
  canEditNotes: false, saving: false, disabled: false, workspaceName: 'Synthetic workspace', timeZone: 'UTC', onRemember() {} }));
assert(view(false).includes('Sources (1)'));
assert(view(false).includes('[B1]'));
assert(!view(true).includes('Sources (1)'));
assert(!view(true).includes('[B1]'));
assert(view(true).includes('A retained fact.'));
assert.equal(JSON.stringify(exchange), before, 'presentation must preserve stored source provenance');
console.log('Qualification citation display passed: hidden cards/markers, retained answer and immutable provenance.');
