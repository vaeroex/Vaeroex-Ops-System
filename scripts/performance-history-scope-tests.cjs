/* eslint-disable @typescript-eslint/no-require-imports -- Local-only regression runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {renderToStaticMarkup} = require('react-dom/server');
const {build} = require('./website-demo-preview.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root,'app/app/kpis/page.tsx'),'utf8');
const semanticsSource = fs.readFileSync(path.join(root,'lib/kpis/semantics.ts'),'utf8');
const compiled = ts.transpileModule(semanticsSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const semanticsModule = {exports:{}};
Function('exports','module',compiled)(semanticsModule.exports,semanticsModule);
const semantics = semanticsModule.exports;
function helper(text) {
  const ast=ts.createSourceFile('page.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='targetHitRate');
  const js=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return Function('evaluateKpiPerformance','isKpiTargetMet','resolveKpiTargetReference','numberFormatter',`${js}; return targetHitRate;`)(semantics.evaluateKpiPerformance,semantics.isKpiTargetMet,semantics.resolveKpiTargetReference,new Intl.NumberFormat('en-US',{maximumFractionDigits:2}));
}
const summary=helper(source);
let original=source;
for(const {before,after} of require('./fixtures/kpi-history-scope-exception.json').changes) original=original.replace(after,before);
const originalRate=helper(original);
const configured=(direction,extra={})=>({...semantics.deterministicKpiSemantics('Custom metric'),desiredDirection:direction,idealValue:null,idealRangeMin:null,idealRangeMax:null,...extra});
const records=(values,target)=>values.map(actual_value=>({actual_value,target}));
for(const [direction,values,target,extra,expected] of [
  ['maximize',[90,100,110],100,{},'66.67%'],
  ['minimize',[11,10,0],10,{},'66.67%'],
  ['exact_target',[90,100,110],100,{},'33.33%'],
  ['maintain',[90,100,110],100,{},'33.33%'],
  ['target_range',[69,70,85,86],null,{idealRangeMin:70,idealRangeMax:85},'50%'],
  ['maximize',[0,1],0,{},'100%'],
  ['minimize',[0,1],0,{},'50%'],
  ['maximize',[9,10],null,{idealValue:10},'50%'],
  ['unknown',[100],100,{},'Direction needed'],
  ['maximize',[100],null,{},'No targets'],
  ['maximize',[],100,{},'No targets'],
]) {
  const rows=records(values,target), semantic=configured(direction,extra);
  assert.equal(summary(rows,semantic).value,expected);
  assert.equal(summary(rows,semantic).value,originalRate(rows,semantic),'only the summary description/shape changes');
}
assert.deepEqual(summary([...records([90,100,110,null],100),{actual_value:100,target:null}],configured('maximize')),{value:'66.67%',detail:'2 of 3 recorded values met target. 2 records without a value or target excluded.'});
assert.equal(summary(records([0],0),configured('minimize')).detail,'1 of 1 recorded value met target.');
assert.equal(summary(records([null],100),configured('maximize')).value,'No targets');
const decode=s=>s.replace(/&amp;/g,'&').replace(/&#x27;/g,"'");
const chart=html=>html.match(/<svg\b[^>]*aria-label="Weekly net sales trend chart"[^>]*>[\s\S]*?<\/svg>/)?.[0];
const links=html=>[...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>({url:decode(m[1]),label:m[2].replace(/<[^>]+>/g,'').trim()}));
(async()=>{
  const result=await build({test:true});
  const demo=require(path.join(result.output,'render.cjs'));
  const context={section:'detail',metric:'Weekly net sales',timeline:'Custom Range',start:'2026-09-01',end:'2026-10-12',metricSearch:'sales',category:'Financial',status:'on-track',show:'12'};
  const render=async params=>renderToStaticMarkup(await demo.renderScreen('/app/kpis','populated','owner',new URLSearchParams(params)));
  const latest=await render(context);
  assert.match(latest,/Historical target hit rate/);assert.match(latest,/60\.71%/);assert.match(latest,/17 of 28 recorded values met target\./);
  assert.match(latest,/Latest<!-- --> 12<!-- --> recorded values|Latest 12 recorded values/);
  assert.equal((chart(latest).match(/<circle /g)||[]).length,12);
  const allLink=links(latest).find(l=>l.label==='All history');assert.ok(allLink);
  const allUrl=new URL(allLink.url,'http://fixture.invalid');assert.equal(allUrl.hash,'#kpi-trend');
  for(const [key,value] of Object.entries(context)) assert.equal(allUrl.searchParams.get(key),value);
  const all=await render(allUrl.searchParams);
  assert.match(all,/All history ·(?:<!-- -->)? 28(?:<!-- -->)? recorded values/);
  assert.equal((chart(all).match(/<circle /g)||[]).length,28);
  assert.match(all,/60\.71%/);assert.match(all,/17 of 28 recorded values met target\./);
  assert.ok(chart(all).includes('Apr 6')&&chart(all).includes('Oct 12'),'all-history chart retains the original first and last dates');
  const latestUrl=new URL(links(all).find(l=>l.label==='Latest 12').url,'http://fixture.invalid');
  const restored=await render(latestUrl.searchParams);assert.equal(chart(restored),chart(latest));
  assert.equal(chart(await render({...context,chart:'invalid'})),chart(latest));
  const values=demo.metrics[0].values;
  assert.equal(values.length,28);assert.equal(values.filter(v=>v>=24000).length,17);assert.equal(values.slice(-12).filter(v=>v>=24000).length,12);
  console.log('Performance history: 17/28 unchanged, latest 12 versus all 28, target semantics, missing/zero values and navigation context passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
