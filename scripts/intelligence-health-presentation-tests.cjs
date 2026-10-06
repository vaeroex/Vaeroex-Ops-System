/* eslint-disable @typescript-eslint/no-require-imports -- Isolated presentation regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const original = Module._load;
const seen = {};
Module._load = function(request, parent, isMain) {
  if(request === 'next/link') return function FixtureLink({children, ...props}) { return React.createElement('a', props, children); };
  for(const name of ['BusinessHealthAnalysisPanel', 'BusinessHealthTrendChart', 'EligibleBusinessSignals']) {
    if(request === '@/components/intelligence/' + name) return {[name]: function PreservedControl(props) {seen[name] = props; return React.createElement('div', {'data-preserved-control': name});}};
  }
  if(request.startsWith('@/')) request = path.join(root, request.slice(2));
  return original.call(this, request, parent, isMain);
};
for(const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText, filename);
const {IntelligenceHealthSnapshot} = require('../components/intelligence/IntelligenceHealthSnapshot.tsx');
const base = {
  health: {available: true, score: 0, status: 'At Risk', trend: 'Declining', trendDelta: -50, summary: 'Synthetic evidence summary', displayTitle: 'Revenue requires attention', confidence: 'High', memorySignals: 1, eligibleSignalCategories: [{id:'kpi_series',label:'KPI series',count:1}], driverPresentation: {identity:'Revenue',details:['Actual: 0']}},
  facts: {available:true, score:0, status:'At Risk', trajectory:'Declining', comparison:'Down 50 points since the previous stored review (Oct 4, 2026).', comparisonDelta:-50, dataQualityBase:50, riskPenalty:50, opportunityAdjustment:0, confidence:'High', freshness:'stale', latestEvidenceAt:'2026-07-01T00:00:00Z', deterministicSummary:'Synthetic evidence summary', drivers:[{kind:'risk',label:'Revenue',fact:'Zero revenue in this synthetic observation',scoreImpact:-50,citationIds:[1],limitation:null}],limitations:['Synthetic limitation remains visible']},
  citations:[{citationId:1,title:'Synthetic source',sourceLabel:'Revenue ledger',sourceType:'KPI',excerpt:'Recorded amount: 0',recordedAt:'2026-07-01T00:00:00Z'}],
  history:[{snapshotDate:'2026-07-01',score:80,status:'Strong',trend:'Stable',calculationVersion:'business_health_calculation_v1'},{snapshotDate:'2026-10-04',score:50,status:'Watch',trend:'Stable',calculationVersion:'business_health_calculation_v2'}],
  asOfDate:'2026-10-06', historyError:null, analysis:{state:{status:'unavailable',artifact:null,message:'Provider disabled in fixture'},requestToken:null}
};
const render=props=>renderToStaticMarkup(React.createElement(IntelligenceHealthSnapshot, props));
const zero=render(base);
assert.match(zero,/Business Health score 0 out of 100/);
assert.match(zero,/Down 50 points since the previous stored review/);
assert.match(zero,/Supporting evidence is over 45 days old/);
assert.match(zero,/Performance baseline 50 \+ positive performance 0 − negative performance 50 = 0/);
assert.match(zero,/href="#health-evidence-1"/);
assert.match(zero,/id="health-evidence-1"/);
assert.match(zero,/Recorded amount: 0/);
assert.deepEqual(seen.BusinessHealthAnalysisPanel.currentFacts,base.facts);
assert.deepEqual(seen.BusinessHealthAnalysisPanel.currentCitations,base.citations);
assert.deepEqual(seen.BusinessHealthTrendChart.points,base.history);
assert.match(zero,/href="\/app\/reports"/);
assert.match(zero,/Missing days are not zero scores/);
const missing=render({...base,health:{...base.health,available:false,score:null},facts:{...base.facts,available:false,score:null,comparison:'No previous review available.',freshness:'unavailable',latestEvidenceAt:null},historyError:'History unavailable'});
assert.match(missing,/Business Health score unavailable/);
assert.doesNotMatch(missing,/Business Health score 0 out of 100/);
assert.match(missing,/No previous review available/);
assert.match(missing,/Freshness cannot be established/);
assert.deepEqual(seen.BusinessHealthTrendChart.points,base.history,'historical V1/V2 points remain accessible when current score is unavailable');
assert.equal(seen.BusinessHealthTrendChart.errorMessage,'History unavailable');
const current=render({...base,facts:{...base.facts,comparison:'Unchanged from the previous stored review.',freshness:'current'}});
assert.match(current,/Unchanged from the previous stored review/);
assert.doesNotMatch(current,/Supporting evidence is over 45 days old/);
console.log(JSON.stringify({passed:true,assertions:21,cases:['real-zero','missing','stale','current','unchanged','versioned-history','history-failure'],scope:'presentation; interactive workflows are qualified separately'}));
