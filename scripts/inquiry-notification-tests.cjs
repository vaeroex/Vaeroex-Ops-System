/* eslint-disable @typescript-eslint/no-require-imports -- Isolated notification tests with no network. */
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let row, calls, mode;
const env={RESEND_API_KEY:'synthetic',RESEND_FROM_EMAIL:'Vaeroex <hq@vaeroex.com>',INQUIRY_ADMIN_ORIGIN:'https://preview.example.invalid'};
const admin={};
// Supabase's claim chain is update.eq.eq.select.maybeSingle.
admin.from=()=>({update:values=>({eq:()=>({eq:()=>({select:()=>({maybeSingle:async()=>{if(row.notification_status!=='pending')return{data:null,error:null};Object.assign(row,values);return{data:{id:row.id},error:null};}})}),then:resolve=>{Object.assign(row,values);resolve({error:null});}})})});
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/email/inquiry-notification.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,process:{env},console,URL,AbortSignal,require:s=>s==='server-only'?{}:s==='@/lib/supabase/config'?{getAppUrl:()=>env.NEXT_PUBLIC_APP_URL||'http://localhost:3000'}:{VAEROEX_CONTACT_EMAILS:{general:'hq@vaeroex.com',support:'support@vaeroex.com',billing:'billing@vaeroex.com'}},fetch:async(url,opts)=>{calls.push(JSON.parse(opts.body));assert.equal(row.notification_status,'attempting');if(mode==='timeout')throw Error('timeout');return{ok:mode!=='reject',status:503,json:async()=>({id:'synthetic-provider-id'})};}});
const input={id:'synthetic-request',email:'synthetic@example.invalid',name:'<img src=x onerror=alert(1)>',category:'Custom software inquiry',message:'<script>bad</script>'.repeat(100)};
async function configurationCases(){
  const saved={...env};
  for(const scenario of [
    {name:'existing Production defaults',vars:{RESEND_API_KEY:'synthetic',NEXT_PUBLIC_APP_URL:'https://www.vaeroex.com'},origin:'https://www.vaeroex.com'},
    {name:'Preview deploy origin wins over Production app URL',vars:{RESEND_API_KEY:'synthetic',VERCEL_ENV:'preview',VERCEL_URL:'branch-preview.vercel.app',NEXT_PUBLIC_APP_URL:'https://www.vaeroex.com'},origin:'https://branch-preview.vercel.app'},
    {name:'Preview without known deployment fails closed',vars:{RESEND_API_KEY:'synthetic',VERCEL_ENV:'preview',NEXT_PUBLIC_APP_URL:'https://www.vaeroex.com'}},
    {name:'unverified sender rejected',vars:{RESEND_API_KEY:'synthetic',RESEND_FROM_EMAIL:'User <user@example.invalid>',INQUIRY_ADMIN_ORIGIN:'https://preview.example.invalid'}},
    {name:'explicit Preview origin remains supported',vars:{RESEND_API_KEY:'synthetic',VERCEL_ENV:'preview',INQUIRY_ADMIN_ORIGIN:'https://preview.example.invalid'},origin:'https://preview.example.invalid'}
  ]){
    for(const key of Object.keys(env))delete env[key];Object.assign(env,scenario.vars);
    row={id:input.id,notification_status:'pending'};calls=[];mode='accepted';
    await mod.exports.notifyPublicInquiry(admin,input);
    assert.equal(calls.length,scenario.origin?1:0,scenario.name);
    assert.equal(row.notification_status,scenario.origin?'accepted':'failed',scenario.name);
    if(scenario.origin){assert.equal(calls[0].from,'Vaeroex <hq@vaeroex.com>');assert.ok(calls[0].text.includes(scenario.origin+'/app/admin/support-requests'));}
    await mod.exports.notifyPublicInquiry(admin,input);assert.equal(calls.length,scenario.origin?1:0,scenario.name+' replay');
  }
  for(const key of Object.keys(env))delete env[key];Object.assign(env,saved);
}
(async()=>{await configurationCases();for(const scenario of ['accepted','reject','timeout','missing']){row={id:input.id,notification_status:'pending'};calls=[];mode=scenario;env.RESEND_API_KEY=scenario==='missing'?'':'synthetic';await Promise.all([mod.exports.notifyPublicInquiry(admin,input),mod.exports.notifyPublicInquiry(admin,input)]);assert.equal(calls.length,scenario==='missing'?0:1);assert.equal(row.notification_status,{accepted:'accepted',reject:'failed',timeout:'unknown',missing:'failed'}[scenario]);if(calls.length){const sent=calls[0];assert.deepEqual(sent.to,['hq@vaeroex.com']);assert.equal(sent.reply_to,input.email);assert.notEqual(sent.from,input.email);assert.ok(sent.html.includes('&lt;script&gt;'));assert.ok(!sent.html.includes('<script>'));assert.ok(sent.text.includes('/app/admin/support-requests?q='));}await mod.exports.notifyPublicInquiry(admin,input);assert.equal(calls.length,scenario==='missing'?0:1);}console.log('Notification isolated mocks: claim concurrency/replay, escaped text, fixed recipient, Reply-To, provider acceptance/rejection, unknown timeout and missing configuration passed. No real emails sent.');})().catch(e=>{console.error(e);process.exitCode=1;});
