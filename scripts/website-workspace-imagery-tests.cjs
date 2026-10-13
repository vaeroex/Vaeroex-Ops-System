/* eslint-disable @typescript-eslint/no-require-imports -- Node qualification runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build, createServer} = require('./website-demo-preview.cjs');
(async () => {
  const result = await build({test:true});
  const demo = require(path.join(result.output, 'render.cjs'));
  const originalNow = Date.now;
  Date.now = () => Date.parse(demo.AS_OF);
  const calculated = demo.calculatedIntelligence();
  Date.now = originalNow;
  assert.equal(demo.kpis.length, 168);
  assert.equal(demo.files.length, 6);
  assert.equal(demo.imports.length, 6);
  assert.equal(new Set(demo.kpis.map(row=>row.workspace_id)).size, 1);
  assert.equal(new Set(demo.kpis.map(row=>row.metric_date)).size, 28);
  const homepage = calculated.healthView.executiveHomepageModel;
  assert.equal(homepage.health.score, 20);
  assert.equal(homepage.readiness.coverage, 45);
  assert.equal(calculated.lifecycleCards.current.length, 5);
  assert.ok(calculated.snapshot.findings.some(f=>JSON.stringify(f).includes('19,800')));
  const boundary = JSON.parse(fs.readFileSync(path.join(result.output,'boundary.json')));
  assert.ok(boundary.moduleFiles.some(f=>f.endsWith('/components/intelligence/IntelligenceSignalInbox.tsx')));
  assert.ok(boundary.moduleFiles.some(f=>f.endsWith('/app/app/kpis/page.tsx')));
  assert.ok(!boundary.moduleFiles.some(f=>/\/lib\/supabase\/(client|server|admin)\./.test(f)));
  const manifest = JSON.parse(fs.readFileSync('scripts/website-demo/captures.json'));
  for (const asset of manifest.assets) {
    const bytes = fs.readFileSync(path.join('public/images/workspace-demo',asset.file));
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.ok(bytes.length < 220000, `${asset.file} must remain compact`);
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
