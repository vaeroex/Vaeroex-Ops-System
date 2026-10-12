const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = process.env.VAEROEX_AUDIT_ROOT || process.cwd();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename });
  module._compile(output.outputText, filename);
};
global.fetch = () => { throw new Error('Audit prohibits network access'); };
const spreadsheet = require(path.join(root, 'lib/imports/spreadsheets.ts'));
const producer = require(path.join(root, 'lib/kpis/snapshot-producer.ts'));
const layer = require(path.join(root, 'lib/intelligence/layer.ts'));
const sheets = require(path.join(root, 'lib/integrations/google-sheets/contracts.ts'));
const collision = spreadsheet.parseCsvRows('Amount,Amount,Amount (2)\n10,20,30\n');
assert.deepEqual(collision, [{Amount:'10', 'Amount (2)':'30'}]);
assert(!Object.values(collision[0]).includes('20'));
const rowLocations = spreadsheet.parseSpreadsheetWorkbook({fileName:'synthetic.csv', buffer:Buffer.from('Revenue,Date\n100,2026-09-01\n\n200,2026-10-01\n')});
assert.equal(rowLocations.rows[1].worksheetRowNumber, 3);
assert.equal(rowLocations.rows[1].values.Revenue, '200');
const ws = 'synthetic-workspace';
const rows = [100,100,100].map((value,index) => ({id:`row-${index}`,workspace_id:ws,name:'Revenue',metric_date:'2026-10-01',actual_value:value,target:null,created_at:`2026-10-0${index+1}T00:00:00Z`,source_file_id:`file-${index}`,import_row_id:`import-${index}`}));
const history = producer.buildCanonicalKpiProducerOutputV1({workspaceId:ws,rows,settings:[],asOf:'2026-10-04T00:00:00Z'})[0];
assert.equal(history.observations.selectedRange.totalObservationCount,3);
assert.equal(history.observations.current.observedAt,history.observations.previous.observedAt);
assert.notEqual(history.recommendation.confidence,'Unavailable');
const conflicts = producer.buildCanonicalKpiProducerOutputV1({workspaceId:ws,rows:rows.map((row,index)=>({...row, actual_value:index===2?150:100})),settings:[],asOf:'2026-10-04T00:00:00Z'})[0];
assert.equal(conflicts.evaluation.latestPerformanceEffect,'favorable');
// Execute the entire actual assessment module with unreachable integration imports mocked.
// The assessment's eligibility helper remains the real implementation.
const evidenceFile = path.join(root,'lib/ai/evidence-index.ts');
const evidenceModule = new Module(evidenceFile,module);
evidenceModule.filename=evidenceFile;
evidenceModule.paths=module.paths;
evidenceModule.require=request=>request==='@/lib/intelligence/evidence-eligibility'
  ? require(path.join(root,'lib/intelligence/evidence-eligibility.ts'))
  : request==='crypto'?require('node:crypto'):{};
evidenceModule._compile(ts.transpileModule(fs.readFileSync(evidenceFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,evidenceFile);
const unsupportedNumber=evidenceModule.exports.assessFileAnalysisEvidence({
  outputJson:{findings:['Revenue amount October 999']},
  extractedSourceText:'Revenue amount October 100. This financial worksheet records the actual October revenue amount for the business.',
  sourceGrounding:'local_extraction'
});
assert.equal(unsupportedNumber.eligible,true);
assert.equal(unsupportedNumber.factCount,1);
assert.equal(unsupportedNumber.requiresReview,false);
const allFiles=Array.from({length:201},(_,index)=>({id:`file-${index}`,display_name:`Synthetic source ${index}`,original_name:`synthetic-${index}.csv`,file_extension:'csv',import_type:'kpi',imported_rows:1,processing_status:'ready',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:00Z',processed_at:'2026-10-01T00:00:00Z',archived_at:null,deleted_at:null,metadata_json:{}}));
const sourceLinkedKpi={...rows[0],source_file_id:'file-200',actual_value:50,target:100};
const completeLayer=layer.buildIntelligenceLayer({asOf:'2026-10-04T00:00:00Z',kpis:[sourceLinkedKpi],files:allFiles});
const cappedLayer=layer.buildIntelligenceLayer({asOf:'2026-10-04T00:00:00Z',kpis:[sourceLinkedKpi],files:allFiles.slice(0,200)});
assert.equal(completeLayer.memorySummary.kpiHistoryRecords,1);
assert.equal(cappedLayer.memorySummary.kpiHistoryRecords,0);
const sheetsFormats = ['1234.50','$1,234.50','1,234.50','12.5%'].map(value=>{
  try {return {value,result:sheets.parseNumericCell(value)};} catch {return {value,result:'rejected'};}
});
const lifecycleEvidence = {id:'memory-1',workspace_id:ws,source_type:'file',source_id:'file-200',source_file_id:'file-200',source_metadata:{evidence_classification:'business_evidence'},deleted_at:null,archived_at:null};
function lifecycleClient(fail) {
  return {from(table) {
    assert.equal(table,'file_uploads');
    return {select(){return this;},eq(column,value){assert.equal(column,'workspace_id');assert.equal(value,ws);return this;},in(){return Promise.resolve(fail?{data:null,error:{message:'synthetic database failure'}}:{data:[allFiles[200]],error:null});}};
  }};
}
(async()=>{
const eligibleOnSuccess=await evidenceModule.exports.filterEligibleMemoryRowsByLifecycle({supabase:lifecycleClient(false),workspaceId:ws,rows:[lifecycleEvidence]});
const eligibleOnFailure=await evidenceModule.exports.filterEligibleMemoryRowsByLifecycle({supabase:lifecycleClient(true),workspaceId:ws,rows:[lifecycleEvidence]});
assert.equal(eligibleOnSuccess.length,1);
assert.deepEqual(eligibleOnFailure,[]);
console.log(JSON.stringify({
  testedRoot: root,
  csvHeaderCollision: {input:['10','20','30'],output:collision},
  csvRowLineage:{actualPhysicalLine:4,reportedRow:rowLocations.rows[1].worksheetRowNumber},
  duplicateImports:{uniqueMeasurementDates:1,observations:history.observations.selectedRange.totalObservationCount, recommendation:history.recommendation},
  conflictingSameDate:{latestPerformanceEffect:conflicts.evaluation.latestPerformanceEffect,latest:conflicts.evaluation.latestValue,previous:conflicts.evaluation.previousValue},
  unsupportedNumberAccepted:unsupportedNumber,
  overviewParentCap:{completeHistoryCount:completeLayer.memorySummary.kpiHistoryRecords,cappedHistoryCount:cappedLayer.memorySummary.kpiHistoryRecords,completeHealth:completeLayer.businessHealth,cappedHealth:cappedLayer.businessHealth},
  lifecycleDatabaseFailure:{eligibleOnSuccess:eligibleOnSuccess.length,eligibleOnFailure:eligibleOnFailure.length,threwOnFailure:false,errorSurface:'indistinguishable from no eligible memory'},
  sheetsFormattedValues:sheetsFormats
},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
