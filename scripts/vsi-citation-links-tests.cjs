/* eslint-disable @typescript-eslint/no-require-imports -- Render synthetic saved citations without network or database. */
const assert = require('node:assert/strict');
const { loadSource, React } = require('./integrations-ui-test-support');
const { renderToStaticMarkup } = require('react-dom/server');
const { vsiCitationNavigationUrl } = loadSource('lib/vsi/citation-links.ts');
const { Exchange } = loadSource('components/vsi/Exchange.tsx', {
  '@/app/app/reports/save-vsi-analysis': { saveVsiAnalysis: async () => { throw new Error('No writes allowed'); } },
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
});
const oldUrl = '/app/kpis?q=Revenue%20%26%20sales';
const newUrl = '/app/kpis?metric=Revenue%20%26%20sales&section=detail#kpi-detail';
const citation = { id: 'B1', title: 'Revenue & sales', url: oldUrl, sourceType: 'kpi', sourceId: 'synthetic-record', evidenceDate: '2026-10-01', retrievedAt: '2026-10-22T00:00:00Z' };
assert.equal(vsiCitationNavigationUrl(citation), newUrl);
for (const url of [newUrl, '/app/kpis?q=Revenue&section=records', '/app/kpis?q=%ZZ', '/app/kpis?q=', '//other.test/app/kpis?q=Revenue', 'javascript:alert(1)', 'https://example.test/app/kpis?q=Revenue']) {
  assert.equal(vsiCitationNavigationUrl({ ...citation, url }), url);
}
assert.equal(vsiCitationNavigationUrl({ ...citation, sourceType: 'web' }), oldUrl);
const markup = renderToStaticMarkup(React.createElement(Exchange, {
  exchange: { id: 'synthetic', userMessage: 'Question', answer: 'Recorded result [B1].', createdAt: citation.retrievedAt, citations: [citation] },
  canEditNotes: false, saving: false, disabled: false, workspaceName: 'Synthetic', onRemember() { throw new Error('No writes allowed'); }
}));
assert(markup.includes('href="/app/kpis?metric=Revenue%20%26%20sales&amp;section=detail#kpi-detail"'));
assert.equal(citation.url, oldUrl, 'stored citation/snapshot stays unchanged');
const { SavedAnalysisRenderer } = loadSource('components/reports/SavedAnalysisRenderer.tsx', {
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
});
const savedCitation = { citationId: 1, title: citation.title, sourceLabel: 'Synthetic KPI', sourceType: 'kpi',
  excerpt: 'Synthetic recorded result.', recordedAt: citation.evidenceDate, href: oldUrl };
const envelope = { analysis_type: 'vsi', title: 'Synthetic saved answer', confidence: 'Low', freshness: 'current',
  generated_at: citation.retrievedAt, saved_at: citation.retrievedAt, citations: [savedCitation], evidence_lineage: [savedCitation],
  display: { summary_label: 'Summary', summary: 'Recorded result.', sections: [], evidence_status: 'Current' }, artifact: null };
const savedSnapshot = JSON.stringify(envelope);
const renderSaved = value => renderToStaticMarkup(React.createElement(SavedAnalysisRenderer, { envelope: value }));
assert(renderSaved(envelope).includes('href="/app/kpis?metric=Revenue%20%26%20sales&amp;section=detail#kpi-detail"'),
  'a historical separately saved VSI report opens the cited metric detail');
assert.equal(JSON.stringify(envelope), savedSnapshot, 'rendering must not rewrite saved citations or lineage');
for (const href of [newUrl, '/app/kpis?q=Revenue&section=records', '/app/kpis?q=%ZZ', '/app/sources/synthetic']) {
  const unchanged = { ...envelope, citations: [{ ...savedCitation, href }] };
  assert(renderSaved(unchanged).includes(`href="${href.replaceAll('&', '&amp;')}"`));
}
assert(renderSaved({ ...envelope, citations: [{ ...savedCitation, sourceType: 'Metric evidence' }] }).includes(`href="${oldUrl}"`),
  'non-KPI source types do not acquire legacy VSI link aliases');
assert(!renderSaved({ ...envelope, citations: [{ ...savedCitation, href: undefined }] }).includes('>Open source</a>'));
console.log(JSON.stringify({ passed: true, suite: 'Chat and saved-report KPI citation rendering; narrow aliases and unchanged snapshots', paidProviderCalls: 0, databaseCalls: 0 }));
