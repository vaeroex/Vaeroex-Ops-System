/* eslint-disable @typescript-eslint/no-require-imports -- Isolated synthetic Health runtime only. */
'use strict';
// Run beneath runtime.network.sb. Does not start/stop Supabase, migrate, seed or schedule work.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), cp = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const [runtimeFile, build, commit] = process.argv.slice(2);
assert(runtimeFile && ['true', 'false'].includes(build) && /^[a-f0-9]{40}$/.test(commit), 'usage_runtime_build_boolean_exact_commit');
assert.equal(fs.statSync(runtimeFile).mode & 0o077, 0, 'private_runtime_required');
const cfg = JSON.parse(fs.readFileSync(runtimeFile));
assert(cfg.syntheticOnly && cfg.paidCredentialsPresent === false);
const sha = value => createHash('sha256').update(value).digest('hex');
const preloadSource = "'use strict';\nconst fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');\nconst runtimeFile=process.env.VAEROEX_CAPACITY_RUNTIME_CONFIG;\nassert(runtimeFile&&fs.statSync(runtimeFile).mode%512===384);\nconst cfg=JSON.parse(fs.readFileSync(runtimeFile)),plan=JSON.parse(fs.readFileSync(cfg.planFile)),config=JSON.parse(fs.readFileSync(cfg.configFile));\nassert(cfg.syntheticOnly&&cfg.paidCredentialsPresent===false&&plan.kind==='isolated_health_functional_v1');\nassert(/^\\/(?:private\\/)?tmp\\/vaeroex-capacity-[a-z0-9-]+$/.test(cfg.out));\nconst scope=plan.workspaces.find(w=>w.kind==='current').id,api=new URL(config.apiUrl).origin,control=path.join(cfg.out,'health-fault-control.private.json'),events=path.join(cfg.out,'health-fault-events.jsonl'),used=new Set(),previous=globalThis.fetch;\nglobalThis.fetch=async(input,options={})=>{\n const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();\n if(url.origin===api&&url.pathname==='/rest/v1/assets'&&method==='GET'&&url.searchParams.get('workspace_id')==='eq.'+scope){\n  const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(options.headers).forEach((v,k)=>headers.set(k,v));\n  let claim;try{claim=JSON.parse(Buffer.from((headers.get('authorization')||'').split('.')[1]||'','base64url').toString());}catch{}\n  const fault=JSON.parse(fs.readFileSync(control));\n  if(claim?.role==='authenticated'&&fault.enabled===true&&fault.workspaceId===scope&&fault.id&&!used.has(fault.id)){\n   used.add(fault.id);fs.appendFileSync(events,JSON.stringify({at:new Date().toISOString(),event:'health_read_fault',faultId:fault.id,workspaceId:scope,path:url.pathname,method,role:claim.role,status:503,pid:process.pid,actualInjection:true})+'\\n',{mode:0o600});\n   return new Response(JSON.stringify({code:'health_qualification_read_failure',message:'Synthetic isolated Health data request failure.'}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});\n  }\n }\n return previous(input,options);\n};\n";

const original = cp.spawn, preload = path.join(cfg.out, 'health-fault-preload.cjs'), nextServer = path.join(root, 'scripts/workspace-capacity-next-server.cjs');
// Install before loading the existing supervisor, which captures spawn at module load.
cp.spawn = function (file, args, options) {
  if (file === process.execPath && Array.isArray(args) && args.length === 3 && args[0] === nextServer && args[1] === runtimeFile && args[2] === 'application') {
    assert.equal(options.env.VAEROEX_CAPACITY_RUNTIME_CONFIG, runtimeFile);
    options = { ...options, env: { ...options.env, NODE_OPTIONS: options.env.NODE_OPTIONS + ' --require=' + preload } };
  }
  return original.call(this, file, args, options);
};
(async () => {
  const { validate, inspectStatus } = require('./workspace-capacity-confine-stack.cjs');
  const { read, write, denyNetwork } = require('./intelligence-health-fixtures.cjs');
  const ctx = validate(cfg.configFile, runtimeFile), plan = read(cfg.planFile);
  assert.equal(plan.kind, 'isolated_health_functional_v1'); assert.equal(plan.runId, cfg.runId);
  assert.equal(plan.workspaces.filter(w => w.kind === 'current').length, 1);
  await denyNetwork(); await inspectStatus(ctx);
  if (build === 'false') {
    const inherited = read(path.join(cfg.out, 'processes.json'));
    assert.equal(inherited.sourceCommit, commit, 'inherited_build_commit_mismatch');
    assert.equal(inherited.buildId, fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim(), 'inherited_build_id_mismatch');
  }
  fs.writeFileSync(preload, preloadSource, { mode: 0o600 }); fs.chmodSync(preload, 0o600);
  for (const [file, data] of [['health-fault-control.private.json', '{}\n'], ['health-fault-events.jsonl', '']]) {
    const target = path.join(cfg.out, file); if (!fs.existsSync(target)) fs.writeFileSync(target, data, { mode: 0o600, flag: 'wx' });
  }
  write(path.join(cfg.out, 'health-fault-runtime-manifest.json'), { kind: 'isolated_health_fault_preload_v1', applicationOnly: true, sourceCommit: commit, preloadSha256: sha(preloadSource), wrapperSha256: sha(fs.readFileSync(__filename)), reusedVerifiedBuild: build === 'false', scope: 'One authenticated GET /rest/v1/assets for current synthetic workspace, once per explicit fault id; no application source or authority changes.' });
  await require('./workspace-capacity-environment.cjs').serve(runtimeFile, { build: build === 'true', artifactCommit: commit });
})().catch(error => {
  fs.writeFileSync(path.join(cfg.out, 'health-runtime-failure.private.txt'), String(error.stack), { mode: 0o600 });
  console.error(JSON.stringify({ failed: true, reason: 'health_runtime_failed' })); process.exitCode = 1;
});
