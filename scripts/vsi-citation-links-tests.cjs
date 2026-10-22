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
console.log(JSON.stringify({ passed: true, suite: 'Existing saved VSI KPI citation renders metric detail; narrow aliases and unchanged snapshots', paidProviderCalls: 0, databaseCalls: 0 }));
