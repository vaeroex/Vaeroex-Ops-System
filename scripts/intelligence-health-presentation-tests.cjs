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

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const [label, color] of [['negative', '#fca5a5'], ['positive', '#38bdf8'], ['minor', '#fde68a']]) {
  assert.ok(contrast(color, '#0b1f4d') >= 4.5, `${label} contribution text must meet 4.5:1 contrast on the Health snapshot navy background`);
}

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
assert.match(zero,/data-health-score-impact="negative"/);
assert.match(zero,/text-red-300/);
assert.match(zero,/Negative contribution: -50 points/);
assert.match(zero,/Supporting evidence for this factor/);
assert.match(zero,/Revenue ledger · Jul 1, 2026/);
assert.match(zero,/Supporting evidence citation 1/);
assert.doesNotMatch(zero,/Evidence \[1\]/);
assert.match(zero,/data-health-evidence-link="1"/);
assert.match(zero,/href="#health-evidence-1"[^>]*focus-visible:ring-2 focus-visible:ring-cyan-300/);
assert.match(zero,/href="#health-evidence-1"[^>]*min-h-11/);
assert.match(zero,/mt-1 flex flex-wrap gap-2/);
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
const contributionTones=render({...base,facts:{...base.facts,drivers:[
  {...base.facts.drivers[0],scoreImpact:-6},
  {kind:'opportunity',label:'Retention',fact:'Retention remains above its explicit target.',scoreImpact:6,citationIds:[2],limitation:null},
  {kind:'risk',label:'Minor variance',fact:'The difference remains small.',scoreImpact:-5,citationIds:[3],limitation:null}
]},citations:[
  ...base.citations,
  {citationId:2,title:'Retention workbook',sourceLabel:'Customer retention ledger',sourceType:'KPI',excerpt:'Recorded retention: 94%',recordedAt:'2026-07-02T00:00:00Z'},
  {citationId:3,title:'',sourceLabel:'',sourceType:'KPI',excerpt:'Recorded difference: 5',recordedAt:null}
]});
assert.match(contributionTones,/data-health-score-impact="negative"[^>]*text-red-300/);
assert.match(contributionTones,/data-health-score-impact="positive"[^>]*text-vaeroex-accent/);
assert.match(contributionTones,/data-health-score-impact="minor"[^>]*text-amber-200/);
assert.match(contributionTones,/Positive contribution: \+6 points/);
assert.match(contributionTones,/Minor contribution: -5 points/);
assert.match(contributionTones,/Customer retention ledger · Jul 2, 2026/);
assert.match(contributionTones,/View supporting evidence/);
assert.match(contributionTones,/href="#health-evidence-3"/);
console.log(JSON.stringify({passed:true,assertions:44,cases:['real-zero','missing','stale','current','unchanged','versioned-history','history-failure','contribution-tones','dark-theme-contrast','evidence-labels','evidence-fallback','keyboard-focus','touch-target','responsive-wrapping'],scope:'presentation; interactive workflows are qualified separately'}));
