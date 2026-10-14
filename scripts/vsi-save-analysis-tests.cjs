/* eslint-disable @typescript-eslint/no-require-imports -- Server-action boundary tests with an in-memory store. */
const assert = require('node:assert/strict');
const { loadSource } = require('./integrations-ui-test-support');
const { z } = require('zod');
const { financialComparisons } = loadSource('lib/charts/financial.ts');
const { parseSavedAnalysisEnvelope } = loadSource('lib/reports/saved-analysis.ts');
const reports = require('./website-demo/financial-evidence.json').sources.filter(s=>s.sourceType==='financial_report').map(s=>JSON.parse(s.text));
const charts = financialComparisons(reports), id='10000000-0000-4000-8000-000000000001';
const exchange = {id,workspace_id:'workspace-a',actor_user_id:'actor-a',user_message:'Compare the reports',answer:'Recorded answer [B1]',created_at:'2026-10-13T00:00:00Z',citations:[{id:'B1',title:'Reported P&L',sourceType:'financial_calculation',sourceId:'report-a',url:'/app/sources/report-a',retrievedAt:'2026-10-13T00:00:00Z',evidenceDate:'2026-10-12',comparisons:charts}]};
async function main() {
  let saved=null,inserts=0,denied=false,bindingDenied=false,available=true,readTicket=true,source=structuredClone(exchange);
  const access={workspaceId:'workspace-a',user:{id:'actor-a'},membership:{role:'owner'},supabase:{from(table){assert.equal(table,'reports');let inserting=false,scoped=false,matched=false;return {select(){return this;},eq(column,value){assert.equal(column,'workspace_id');assert.equal(value,'workspace-a');scoped=true;return this;},is(){return this;},contains(column,value){assert.equal(column,'source_data_json');matched=value.saved_analysis_key===saved?.source_data_json.saved_analysis_key;return this;},insert(value){inserting=true;inserts++;assert.equal(value.workspace_id,'workspace-a');assert.equal(value.created_by,'actor-a');saved={id:'saved-report',source_data_json:JSON.parse(JSON.stringify(value.source_data_json))};return this;},async maybeSingle(){if(!inserting)assert(scoped);return{data:inserting?saved:matched?saved:null,error:null};}}}}};
  const mocks={
    'next/cache':{revalidatePath:()=>{}},
    '@/lib/security/require-workspace-access':{requireWorkspaceAccess:async()=>access},
    '@/lib/security/tool-execution-gateway':{requireToolExecution:async(context,request)=>{assert.equal(context.workspaceId,'workspace-a');assert.equal(request.confirmationReceived,true);assert.equal(request.initiatedBy,'user');if(denied)throw Error('denied');}},
    '@/lib/integrations/google-sheets/read-authority':{beginGoogleSheetsRead:async()=>readTicket?{ticketId:'ticket'}:null,bindGoogleSheetsRead:async(client,ticket,sources)=>{assert.equal(ticket,'ticket');assert.deepEqual(sources,[{table:'vsi_exchanges',id}]);if(bindingDenied)throw Error('changed');},googleSheetsReadTicketFields:ticket=>({google_sheets_read_ticket_id:ticket})},
    '@/lib/vsi/storage':{vsiUuid:z.string().uuid(),loadVsiExchange:async(a,requested)=>{assert.equal(a.workspaceId,'workspace-a');assert.equal(a.userId,'actor-a');assert.equal(requested,id);return available?source:null;},exchangeView:row=>({citations:row.citations})},
    '@/lib/reports/release-channel':{currentSavedAnalysisReleaseChannel:()=> 'preview'}
  };
  const {saveVsiAnalysis}=loadSource('app/app/reports/save-vsi-analysis.ts',mocks);
  assert(!(await saveVsiAnalysis('invalid')).id);
  available=false;assert(!(await saveVsiAnalysis(id)).id);available=true;
  denied=true;assert(!(await saveVsiAnalysis(id)).id);denied=false;
  bindingDenied=true;assert(!(await saveVsiAnalysis(id)).id);bindingDenied=false;
  readTicket=false;assert(!(await saveVsiAnalysis(id)).id);readTicket=true;
  source={...exchange,citations:[]};assert(!(await saveVsiAnalysis(id)).id);source=structuredClone(exchange);
  assert.equal(inserts,0);
  assert.equal((await saveVsiAnalysis(id)).id,'saved-report');assert.equal(inserts,1);
  assert.deepEqual(parseSavedAnalysisEnvelope(saved.source_data_json).comparisons,charts);
  assert.equal((await saveVsiAnalysis(id)).message,'Already saved.');assert.equal(inserts,1);
  source.citations[0].comparisons[0].after.value=123;
  assert.deepEqual(parseSavedAnalysisEnvelope(saved.source_data_json).comparisons,charts);
  console.log('VSI save action: source binding, denied roles, missing source/ticket, explicit confirmation, snapshot persistence and duplicate save PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
