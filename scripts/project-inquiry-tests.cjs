/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server-action tests; no network or real submissions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
let config, inserted, audit;
function reset(overrides = {}) { config = { admin: true, allowed: true, result: { data: { id: 'test-request' }, error: null }, ...overrides }; inserted = []; audit = []; }
const cache = new Map();
function load(file) {
  if(cache.has(file)) return cache.get(file).exports;
  const loadedModule = { exports: {} }; cache.set(file,loadedModule);
  const mocks = {
    '@/lib/email/inquiry-notification': { notifyPublicInquiry: async () => { if(config.notifyThrows) throw Error('synthetic email outage'); } },
    'next/navigation': { redirect: url => { throw Object.assign(new Error('redirect'), { url }); } },
    '@/lib/security/tool-execution-gateway': { logSecurityAuditEvent: async row => { audit.push(row); } },
    '@/lib/security/rate-limit': { enforceRateLimit: async () => { if(config.rateError) throw Error('unavailable'); return { allowed: config.allowed }; }, rateLimitMessage: () => 'Too many requests.' },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => null },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => config.admin ? { from(table) { assert.equal(table,'support_requests'); return { insert(row) { if(config.insertThrows) throw Error('offline'); inserted.push(row); return { select(key) { assert.equal(key,'id'); return { maybeSingle: async () => config.result }; } }; } }; } } : null },
    '@/lib/workspaces/current': { getWorkspaceContext: async () => { throw Error('Anonymous form must not resolve a workspace'); } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop:true } }).outputText, { module:loadedModule, exports:loadedModule.exports, FormData, TextEncoder, console, require: spec => spec in mocks ? mocks[spec] : spec.startsWith('@/') ? load(path.join(process.cwd(), spec.slice(2)+'.ts')) : require(spec) }, { filename:file });
  return loadedModule.exports;
}
function form(category = 'Custom Business Systems', extra = {}) {
  const data = new FormData();
  for (const [key,value] of Object.entries({name:'Test User',email:'test@example.invalid',issue_type:category,message:'Local synthetic project inquiry',company:'Example only',existing_tools:'Inventory spreadsheet',expected_users:'11–50',project_budget:'Not sure yet',project_timeline:'Not sure yet',...extra})) data.append(key,value);
  return data;
}
(async () => {
  reset();
  const actions = load(path.resolve('app/support/actions.ts'));
  const {INQUIRY_CATEGORIES,inquiryCategory} = load(path.resolve('lib/contact/inquiries.ts'));
  assert.equal(inquiryCategory('drug-discovery'), 'Drug Discovery Intelligence walkthrough');
  assert.equal(inquiryCategory('website-development'), 'Website Development / Enhancement');
  assert.equal(inquiryCategory('__proto__'), 'General Inquiry');
  for (const category of Object.values(INQUIRY_CATEGORIES)) {
    reset(); const result = await actions.createContactRequestAction({},form(category));
    assert.ok(result.message); assert.equal(inserted.length,1); assert.equal(audit.length,1);
    assert.equal(inserted[0].issue_type,category); assert.equal(inserted[0].workspace_id,null);
    assert.equal(inserted[0].user_id,null); assert.equal(inserted[0].status,'open');
    assert.match(inserted[0].message, /Page\/module:/);
    if(category === 'Custom Business Systems') assert.match(inserted[0].message,/Approximate expected users: 11–50/);
    else assert.doesNotMatch(inserted[0].message,/Approximate expected users:/);
    if(['Custom Business Systems','Website Development / Enhancement'].includes(category)) assert.match(inserted[0].message,/Existing tools or website: Inventory spreadsheet/);
    else assert.doesNotMatch(inserted[0].message,/Existing tools or website:|Approximate budget:/);
  }
  for(const extra of [{name:' '},{email:'invalid'},{message:''},{message:'x'.repeat(6001)},{existing_tools:'x'.repeat(1001)}]) {
    reset(); const result = await actions.createContactRequestAction({},form(undefined,extra)); assert.ok(result.error); assert.ok(result.fieldErrors); assert.equal(inserted.length,0);
  }
  reset(); let data = form(); data.append('email','duplicate@example.invalid'); assert.ok((await actions.createContactRequestAction({},data)).error); assert.equal(inserted.length,0);
  reset(); data = form(); data.append('unexpected','payload'); assert.ok((await actions.createContactRequestAction({},data)).error); assert.equal(inserted.length,0);
  reset(); assert.ok((await actions.createContactRequestAction({},form('unrecognized'))).error); assert.equal(inserted.length,0);
  for (const settings of [{admin:false},{allowed:false},{rateError:true},{result:{data:null,error:{message:'db error'}}},{result:{data:null,error:null}},{insertThrows:true}]) {
    reset(settings); const result = await actions.createContactRequestAction({},form()); assert.ok(result.error); assert.equal(result.message,undefined); assert.equal(audit.length,0);
  }
  reset({notifyThrows:true}); assert.ok((await actions.createContactRequestAction({},form())).message); assert.equal(inserted.length,1);
  reset(); data = form('Support Request',{return_path:'/support'});
  await assert.rejects(actions.createSupportRequestAction(data), error => error.url.startsWith('/support?message='));
  reset(); data = form('Support Request',{return_path:'https://attacker.invalid'});
  await assert.rejects(actions.createSupportRequestAction(data), error => error.url.startsWith('/support?message='));
  assert.equal(inserted.length,1);
  console.log('Project inquiries: public category destinations, scoped context, validation, duplicate/unknown fields, configuration/rate/database failures, and legacy redirects passed. No network requests or real submissions.');
})().catch(error => { console.error(error); process.exitCode=1; });
