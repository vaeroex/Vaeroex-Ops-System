const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = process.argv[2] || process.cwd();
const sourcePath = root + '/app/app/operations/actions.ts';
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^import[\s\S]*?;\n/gm, '');
const compiled = stripTypeScriptTypes(source).replace(/^export /gm, '');
const results = [];
async function exercise(label, functionName, fields, updateResponse, count=1) {
 const writes = [];
 const db = {
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user', email: 'audit@example.invalid' } } }) },
  from: (table) => ({
   insert: async (payload) => { writes.push({table, operation:'insert', payload}); return {error:null}; },
   update: (payload) => {
    writes.push({table, operation:'update', payload});
    const builder = {eq: () => builder, then: (resolve,reject) => Promise.resolve(updateResponse).then(resolve,reject)};
    return builder;
   }
  })
 };
 const ctx = { FormData, URLSearchParams, Date,
  createSupabaseServerClient: async () => db,
  getWorkspaceContext: async () => ({activeWorkspace:{id:'synthetic-workspace'},membership:{workspace_id:'synthetic-workspace',status:'active',role:functionName === 'createAssetCheckAction' ? 'staff' : 'owner'}}),
  requireActiveSubscription: async () => {}, revalidatePath: () => {},
  redirect: (location) => {throw {redirect:location};}
 };
 vm.createContext(ctx);
 vm.runInContext(compiled+`\n globalThis.action = ${functionName};`,ctx,{filename:sourcePath});
 const redirects = [];
 for(let i=0;i<count;i++) {
  const form = new FormData(); for(const [k,v] of Object.entries(fields)) form.set(k,v);
  try {await ctx.action(form);}
  catch(e) {if(e.redirect) redirects.push(e.redirect); else throw e;}
 }
 return {label,functionName,writes,redirects};
}
(async()=>{
 results.push(await exercise('asset update error after check insert','createAssetCheckAction',{asset_id:'synthetic-asset',status:'Out of service',notes:'synthetic outage test'},{error:{message:'synthetic update denied'}}));
 results.push(await exercise('asset update silently matches zero rows','createAssetCheckAction',{asset_id:'synthetic-asset',status:'Out of service'},{error:null,data:null,count:0}));
 results.push(await exercise('submission ignores configured custom field','createFormSubmissionAction',{form_id:'synthetic-form',summary:'Synthetic inspection',priority:'Medium','serial-number':'ASSET-1','inspection-date':'2026-10-04'},{error:null}));
 results.push(await exercise('replayed create has no application deduplication','createIssueAction',{title:'Synthetic repeated click',description:'synthetic'},{error:null},2));
 console.log(JSON.stringify({scope:'Isolated action fault injection only; mocked database/auth; no network or real persistence',root,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
