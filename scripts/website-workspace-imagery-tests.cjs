/* eslint-disable @typescript-eslint/no-require-imports -- Node qualification runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build, createServer} = require('./website-demo-preview.cjs');
(async () => {
  const result = await build({test:true});
  const demo = require(path.join(result.output, 'render.cjs'));
  assert.equal(demo.squareBrowser.totalCount, 3);
  assert.equal(demo.squareBrowser.currentConnection, null);
  assert.ok(demo.squareBrowser.connections.every(row => row.state === 'disconnected'));
  assert.equal(demo.squarePaymentInputs.reduce((sum, row) => sum + Number(row.amountMinor), 0), 35100);
  assert.equal(demo.accountingAmounts.sales, demo.metrics[0].values.at(-1));
  assert.equal(demo.accountingAmounts.grossProfit / demo.accountingAmounts.sales, .7);
  assert.equal(demo.accountingAmounts.netIncome, 8695.2);
  assert.equal(demo.qboBrowser.additive, false);
  assert.equal(demo.qboBrowser.detail.value.reportType, 'ProfitAndLoss');
  const preview = demo.sheetsPreview(new URLSearchParams({connectionId:demo.sheetsConnectionId,fieldMapping:JSON.stringify(demo.sheetsMapping)}));
  assert.equal(preview.rows.length, 3);
  assert.deepEqual(preview.rows.at(-1), ['W28','2026-10-12','96']);
  assert.equal(demo.sheetsMapping.metrics[0].target, 90);
  assert.throws(() => demo.sheetsPreview(new URLSearchParams({connectionId:'other-workspace'})));
  const recording = JSON.parse(fs.readFileSync('scripts/website-demo/vsi-response.json'));
  assert.equal(require('node:crypto').createHash('sha256').update(recording.answer).digest('hex'), recording.provenance.contentSha256);
  assert.equal(demo.vsiExchange.answer, recording.answer);
  assert.deepEqual(demo.vsiExchange.citations, recording.citations);
  assert.equal(recording.citations.length, 4);
  assert.equal(recording.provenance.citationStatus, 'validated');
  const localRead = new URL(`http://127.0.0.1:3190/api/vsi/conversations?workspaceId=${demo.kpis[0].workspace_id}`);
  assert.equal(demo.vsiReadResponse(localRead).conversations.length, 1);
  assert.throws(() => demo.vsiReadResponse(localRead, 'POST'));
  assert.throws(() => demo.vsiReadResponse(new URL('http://127.0.0.1:3190/api/vsi/conversations?workspaceId=other')));
  const transcript = fs.readFileSync('public/images/workspace-demo/coastal-kitchen-vsi-conversation.txt','utf8');
  assert.ok(transcript.includes(recording.question) && transcript.includes(recording.answer));
  const financial = JSON.parse(fs.readFileSync('scripts/website-demo/chart-response.json'));
  assert.equal(require('node:crypto').createHash('sha256').update(financial.answer).digest('hex'), financial.provenance.answerSha256);
  assert.equal(demo.chartExchange.answer, financial.answer);
  assert.deepEqual(demo.chartExchange.citations, financial.citations);
  assert.equal(financial.synthetic, true);
  assert.equal(financial.provenance.citationStatus, 'validated');
  assert.equal(demo.chartReadResponse(localRead).conversations.length, 1);
  assert.throws(() => demo.chartReadResponse(localRead, 'POST'));
  assert.throws(() => demo.chartReadResponse(new URL('http://127.0.0.1:3190/api/vsi/conversations?workspaceId=other')));
  const financialTranscript = fs.readFileSync('public/images/workspace-demo/coastal-kitchen-financial-conversation.txt','utf8');
  assert.ok(financialTranscript.includes(financial.question) && financialTranscript.includes(financial.answer));
  const charts = financial.citations.flatMap(c => c.comparisons || []);
  assert.equal(charts.length, 3);
  assert.deepEqual(charts.map(c => [c.title,c.before.value,c.after.value]), [['Revenue',27200,27600],['Net income',9052.8,8695.2],['Operating expenses',9932.8,10624.8]]);
  assert.ok(charts.every(c => c.limitations.join(' ').includes('profit is not cash flow')));
  assert.equal(demo.monthlyBriefing.workspaceId, demo.kpis[0].workspace_id);
  assert.deepEqual([demo.monthlyBriefing.period.start,demo.monthlyBriefing.period.end], ['2026-09-13','2026-10-12']);
  assert.equal(demo.monthlyBriefing.evidenceCoverage.supportingRecordCount,20);
  assert.equal(demo.monthlyBriefing.evidenceCoverage.independentSourceCount,7);
  const originalNow = Date.now;
  Date.now = () => Date.parse(demo.AS_OF);
  const calculated = demo.calculatedIntelligence();
  Date.now = originalNow;
  assert.equal(demo.kpis.length, 168);
  assert.equal(demo.files.length, 64);
  assert.equal(demo.imports.length, 64);
  assert.equal(new Set(demo.kpis.map(row=>row.workspace_id)).size, 1);
  assert.equal(new Set(demo.kpis.map(row=>row.metric_date)).size, 28);
  const homepage = calculated.healthView.executiveHomepageModel;
  assert.equal(homepage.health.score, 90);
  assert.equal(homepage.readiness.coverage, 87);
  assert.equal(calculated.lifecycleCards.current.length, 7);
  assert.ok(calculated.snapshot.findings.some(f=>JSON.stringify(f).includes('$600')));
  assert.equal(calculated.snapshots.length, 3);
  assert.ok(calculated.snapshots.every(row => row.workspace_id === demo.kpis[0].workspace_id && row.source_summary.business_health_calculation_version));
  assert.ok(calculated.snapshot.contextualEvidence.length > 0);
  assert.equal(calculated.intelligence.businessHealth.components.dataQualityBase, 50);
  assert.equal(calculated.intelligence.businessHealth.components.opportunityAdjustment, 50);
  assert.equal(calculated.intelligence.businessHealth.components.riskPenalty, 10);
  const supplier = calculated.intelligence.insights.find(row=>row.title.includes('Supplier invoices'));
  assert.match(supplier.recommendedAction, /Confirm payment status/);
  assert.equal(supplier.supportingRecords.length, 2);
  assert.equal(supplier.independentSourceCount, 1);
  assert.match(supplier.limitation, /does not prove/);
  for (let i = 0; i < demo.files.length; i++) assert.equal(demo.files[i].file_size_bytes, Buffer.byteLength(demo.csvContents[i]));
  const boundary = JSON.parse(fs.readFileSync(path.join(result.output,'boundary.json')));
  assert.ok(boundary.moduleFiles.some(f=>f.endsWith('/components/intelligence/IntelligenceSignalInbox.tsx')));
  assert.ok(boundary.moduleFiles.some(f=>f.endsWith('/app/app/kpis/page.tsx')));
  assert.ok(!boundary.moduleFiles.some(f=>/\/lib\/supabase\/(client|server|admin)\./.test(f)));
  const manifest = {assets: [
    ...JSON.parse(fs.readFileSync("scripts/website-demo/captures.json")).assets,
    ...JSON.parse(fs.readFileSync("scripts/website-demo/integration-captures.json")).assets,
    ...JSON.parse(fs.readFileSync("scripts/website-demo/vsi-captures.json")).assets,
    ...JSON.parse(fs.readFileSync("scripts/website-demo/chart-captures.json")).assets
  ]};
  for (const asset of manifest.assets) {
    const bytes = fs.readFileSync(path.join('public/images/workspace-demo',asset.file));
    assert.equal(asset.dpr, 2);
    assert.ok(asset.encoding.includes("lossless"));
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.ok(bytes.length < (asset.file.startsWith('vsi-') ? 400000 : asset.file.startsWith('briefing-') ? 350000 : 220000), `${asset.file} must remain compact`);
  }
  for (const asset of JSON.parse(fs.readFileSync('scripts/website-demo/homepage-captures.json')).assets) {
    const bytes = fs.readFileSync(path.join('public/images', asset.file));
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.ok(bytes.length < 500000, `${asset.file} must remain compact`);
  }
  // No network request is made: validate the static server's response boundary directly.
  const server = createServer({...result,port:3190});
  for (const [method,host,expected] of [['POST','127.0.0.1:3190',405],['GET','other.invalid',403]]) {
    let status=200, headers={};
    server.emit('request',{headers:{host},method,url:'/app/intelligence'},{setHeader:(k,v)=>headers[k]=v,writeHead:v=>status=v,end(){}});
    assert.equal(status,expected); assert.ok(headers['Content-Security-Policy'].includes("connect-src 'none'"));
  }
  assert.equal(JSON.parse(fs.readFileSync('vercel.json')).git.deploymentEnabled.main,false);
  console.log('Website imagery: normal calculations, current components, 168 synthetic observations, asset integrity and isolated write/network boundary passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
