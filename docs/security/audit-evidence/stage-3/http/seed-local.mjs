// Local disposable provisioning only. Does not apply migrations, provision provider accounts, or delete anything.
import {writeFileSync,existsSync}from'node:fs';import{resolve}from'node:path';import{randomBytes,randomUUID}from'node:crypto';import{createRequire}from'node:module';
import{assert,json,privateJson,validateEnvironment,validatePlan,guardedFetch,localUrl}from'./core.mjs';
const[planFile,envFile,keyFile,packageRoot,outFile]=process.argv.slice(2);assert(outFile&&!existsSync(outFile)&&!existsSync(outFile+'.progress.json'),'usage_seed_plan_environment_privatekeys_isolatedPackageRoot_privateOutput');
const plan=json(planFile),env=json(envFile),keys=privateJson(keyFile);validatePlan(plan);validateEnvironment(env,plan);
assert(keys.runId===plan.runId&&keys.serviceKey&&keys.anonKey&&keys.cronSecret,'local_credentials_required');
const require=createRequire(resolve(packageRoot,'package.json'));const{createClient}=require('@supabase/supabase-js');const{createServerClient}=require('@supabase/ssr');
const safeFetch=async(input,options={})=>{const u=localUrl(typeof input==='string'?input:input.url??input.href);assert(u.origin===env.authOrigin,'sdk_egress_denied');return fetch(u,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});};
const admin=createClient(env.authOrigin,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:safeFetch}});
const sessions={runId:plan.runId,anonKey:keys.anonKey,cronSecret:keys.cronSecret,actors:{}};
const progress={runId:plan.runId,kind:'isolated_seed',createdUsers:[],createdWorkspaces:[],completed:false};
writeFileSync(outFile,'{}\n',{mode:0o600,flag:'wx'});writeFileSync(outFile+'.progress.json','{}\n',{mode:0o600,flag:'wx'});const save=()=>{writeFileSync(outFile,JSON.stringify(sessions,null,2)+'\n',{mode:0o600});writeFileSync(outFile+'.progress.json',JSON.stringify(progress,null,2)+'\n',{mode:0o600});};
const result=(r,code)=>{assert(!r.error,code);return r.data;};
try{
 const existing=result(await admin.from('workspaces').select('id').in('id',plan.workspaces.map(w=>w.id)),'schema_or_workspace_read_failed');assert(existing.length===0,'seed_refuses_existing_workspaces');
 const plans=result(await admin.from('subscription_plans').select('slug').eq('slug','vaeroex'),'seed_subscription_schema_missing');assert(plans.length===1,'seed_requires_canonical_vaeroex_plan');
 for(const actor of plan.actors){
  const password=randomBytes(32).toString('base64url');const created=result(await admin.auth.admin.createUser({id:actor.id,email:actor.email,password,email_confirm:true,user_metadata:{full_name:`SYNTHETIC ${actor.id}`},app_metadata:{audit_run_id:plan.runId,synthetic:true}}),'local_auth_seed_failed');assert(created.user?.id===actor.id,'auth_id_mismatch');progress.createdUsers.push(actor.id);
  if(actor.active){const cookieJar=new Map();const client=createServerClient(env.authOrigin,keys.anonKey,{global:{fetch:safeFetch},auth:{autoRefreshToken:false},cookies:{getAll:()=>[...cookieJar].map(([name,value])=>({name,value})),setAll:entries=>entries.forEach(c=>cookieJar.set(c.name,c.value))}});const login=result(await client.auth.signInWithPassword({email:actor.email,password}),'local_session_seed_failed');assert(login.session?.access_token,'session_missing');cookieJar.set('vaeroex_workspace_id',actor.workspaceId);sessions.actors[actor.id]={cookie:[...cookieJar].map(([k,v])=>`${k}=${v}`).join('; '),accessToken:login.session.access_token,expiresAt:new Date(login.session.expires_at*1000).toISOString()};}
  save();
 }
 for(const workspace of plan.workspaces){const members=plan.actors.filter(a=>a.workspaceId===workspace.id),owner=members.find(a=>a.role==='owner');
  result(await admin.from('workspaces').insert({id:workspace.id,name:workspace.label,created_by:owner.id,primary_contact_email:owner.email,industry:'Synthetic audit',subscription_required:true,subscription_status:'active',manually_unlocked:true,plan_slug:'vaeroex',reporting_timezone:'UTC'}),'workspace_seed_failed');progress.createdWorkspaces.push(workspace.id);save();
  result(await admin.from('workspace_members').insert(members.map(a=>({workspace_id:workspace.id,user_id:a.id,role:a.role,status:'active'}))),'membership_seed_failed');
  result(await admin.from('customer_subscriptions').insert({user_id:owner.id,workspace_id:workspace.id,customer_email:owner.email,customer_name:workspace.label,source:'manual',billing_provider:'manual',status:'active',plan_slug:'vaeroex',manually_activated:true,notes:`SYNTHETIC AUDIT ${plan.runId}` }),'entitlement_seed_failed');
  result(await admin.from('issues').insert(Array.from({length:20},(_,i)=>({id:randomUUID(),workspace_id:workspace.id,title:`SYNTHETIC ${plan.runId} baseline issue ${i}`,description:'Synthetic baseline; no customer data',severity:i%3?'Medium':'High',status:i%4?'Open':'Closed',created_by:owner.id}))),'issue_fixture_seed_failed');
  result(await admin.from('sops').insert(Array.from({length:3},(_,i)=>({id:randomUUID(),workspace_id:workspace.id,title:`SYNTHETIC ${plan.runId} procedure ${i}`,body_markdown:'Synthetic repeatable procedure. No real operations content.',status:'Draft',version:1,created_by:owner.id}))),'sop_fixture_seed_failed');save();
 }
 progress.completed=true;save();console.log(JSON.stringify({kind:'isolated_seed_result',registeredUsers:progress.createdUsers.length,workspaces:progress.createdWorkspaces.length,providerFixtures:'BLOCKED: adapter required',legalAcceptance:'BLOCKED: isolated consent setup/capture required',workloadExecuted:false}));
}catch(error){save();console.error(JSON.stringify({kind:'isolated_seed_blocked',reason:/^[a-z_]+$/.test(error.message)?error.message:'seed_failed_details_withheld',partialCreatedUsers:progress.createdUsers.length,partialCreatedWorkspaces:progress.createdWorkspaces.length,noAutomaticDeletion:true}));process.exitCode=2;}
