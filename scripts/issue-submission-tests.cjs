/* eslint-disable @typescript-eslint/no-require-imports -- Actual action and isolated PostgreSQL receipt contracts. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(source,mocks={},globals={}){const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const compiled={exports:{}};vm.runInNewContext(`(function(require,module,exports){${code}\n})`,globals)(name=>mocks[name]??{},compiled,compiled.exports);return compiled.exports;}
function form(payload,key){const f=new FormData();f.set('issue_request_id',key);for(const [k,v]of Object.entries(payload))if(v!==null)f.set(({assigned_person_id:'person_id',assigned_role:'role',assigned_department:'department'})[k]||k,v);return f;}
async function qualify(db,nativeClients=[]){
 let checks=0;const workspace=randomUUID(),foreign=randomUUID(),actor=randomUUID(),otherActor=randomUUID(),person=randomUUID(),foreignPerson=randomUUID();
 await db.exec(`create schema auth;create schema private;create role anon;create role authenticated;create role service_role;
 create table public.workspaces(id uuid primary key,entitled boolean not null default true);
 create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text);
 create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
 create table public.people(id uuid primary key,workspace_id uuid,archived_at timestamptz,deleted_at timestamptz);
 create table public.issues(id uuid primary key default gen_random_uuid(),workspace_id uuid,title text,description text,issue_type text,severity text,status text,root_cause text,recommended_fix text,assigned_person_id uuid,assigned_role text,assigned_department text,due_date date,created_by uuid,archived_at timestamptz,deleted_at timestamptz);
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 create function private.workspace_entitlement_active_v1(uuid)returns boolean language sql stable security definer set search_path='' as $$select entitled from public.workspaces where id=$1$$;
 create function public.can_edit_operations(uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.workspace_members where workspace_id=$1 and user_id=auth.uid()and status='active'and role in('owner','admin','manager'))$$;
 grant usage on schema public,auth to authenticated;grant insert,select on public.issues to authenticated;
 alter table public.issues enable row level security;
 create policy issues_managers_write on public.issues for insert to authenticated with check(public.can_edit_operations(workspace_id)and private.workspace_entitlement_active_v1(workspace_id));
 grant usage on schema private to authenticated;grant execute on function private.workspace_entitlement_active_v1(uuid)to authenticated;`);
 const oldForm=fs.readFileSync(path.join(root,'supabase/migrations/20261005061024_internal_form_submission_idempotency.sql'),'utf8');
 const utfStart=oldForm.indexOf('create function private.internal_form_utf16_length_v1('),utfEnd=oldForm.indexOf('$$;',utfStart)+3;
 await db.exec(oldForm.slice(utfStart,utfEnd));
 await db.query('insert into public.workspaces(id)values($1),($2)',[workspace,foreign]);await db.query('insert into auth.users(id)values($1),($2)',[actor,otherActor]);
 await db.query("insert into public.workspace_members values($1,$2,'owner','active'),($1,$3,'manager','active')",[workspace,actor,otherActor]);
 await db.query('insert into public.people(id,workspace_id)values($1,$2),($3,$4)',[person,workspace,foreignPerson,foreign]);
 const payload={title:'Synthetic duplicate issue',description:'Synthetic operational issue',issue_type:'Process',severity:'Medium',status:'Open',root_cause:'Fixture',recommended_fix:'Review',assigned_person_id:person,assigned_role:'Operations',assigned_department:'Fulfilment',due_date:'2026-10-06'};
 const request=async(client,name,args,uid=actor,role='authenticated')=>{await client.exec(`set role ${role};select set_config('request.jwt.claim.role','${role}',false)`);await client.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);try{return(await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}finally{await client.exec('reset role');}};
 let membershipRole='owner',membershipStatus='active';
 const supabase={auth:{getUser:async()=>({data:{user:{id:actor,email:'synthetic@example.test'}}})},from(table){assert.equal(table,'issues');return{async insert(row){const keys=Object.keys(row);try{await db.exec("set role authenticated;select set_config('request.jwt.claim.role','authenticated',false)");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.query(`insert into public.issues(${keys.join(',')})values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));return{error:null};}catch(error){return{error};}finally{await db.exec('reset role');}}};},async rpc(name,args){assert.equal(name,'submit_issue_v1');try{return{data:await request(db,name,[args.p_workspace_id,args.p_request_id,JSON.stringify(args.p_payload)]),error:null};}catch(error){return{data:null,error};}}};
 const redirect=value=>{throw Error('REDIRECT '+decodeURIComponent(value.replaceAll('+',' ')));};
 const fixture=fs.readFileSync(path.join(root,'scripts/test-stubs/issue-pre-receipt-action.txt'),'utf8');
 const prior=load(fixture,{}, {FormData,Error,requireWorkspace:async()=>({supabase,user:{id:actor},workspaceId:workspace}),text:(f,k)=>typeof f.get(k)==='string'?f.get(k).trim():'',requireValue:()=>{},validateLength:()=>{},revalidatePath:()=>{},redirectWithError:(_p,m)=>{throw Error(m);},redirectWithMessage:(_p,m)=>redirect(m)}).createIssueAction;
 const key=randomUUID();for(let i=0;i<2;i++)await assert.rejects(prior(form(payload,key)),/REDIRECT Issue logged/);
 const before=(await db.query('select count(*)::int n from public.issues where title=$1',[payload.title])).rows[0].n;assert.equal(before,2);checks++;
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261005183352_issue_submission_receipts.sql'),'utf8'));
 const mocks={'next/navigation':{redirect},'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{createSupabaseServerClient:async()=>supabase},'@/lib/workspaces/current':{getWorkspaceContext:async()=>({activeWorkspace:{id:workspace},membership:{workspace_id:workspace,status:membershipStatus,role:membershipRole}})},'@/lib/billing/require-active-subscription':{requireActiveSubscription:async()=>{}}};
 const action=load(fs.readFileSync(path.join(root,'app/app/operations/actions.ts'),'utf8'),mocks,{FormData,URLSearchParams,Error}).createIssueAction;
 const fresh={...payload,title:'Synthetic receipt issue'},freshKey=randomUUID();
 await assert.rejects(action(form(fresh,freshKey)),/REDIRECT.*Issue logged/);await assert.rejects(action(form(fresh,freshKey)),/REDIRECT.*Issue already logged/);checks+=2;
 assert.equal((await db.query('select count(*)::int n from public.issues where title=$1',[fresh.title])).rows[0].n,1);checks++;
 await assert.rejects(action(form({...fresh,description:'Changed request'},freshKey)),/already used for different issue details/);checks++;
 const saved=(await db.query('select * from public.issues where title=$1',[fresh.title])).rows[0];assert.equal(saved.assigned_person_id,person);assert.equal(saved.created_by,actor);checks+=2;
 await db.query("update public.issues set title='Reviewed issue',archived_at=now()where id=$1",[saved.id]);await assert.rejects(action(form(fresh,freshKey)),/Issue already logged/);
 assert.equal((await db.query('select title from public.issues where id=$1',[saved.id])).rows[0].title,'Reviewed issue');checks++;
 const submit=(p=fresh,k=randomUUID(),w=workspace,uid=actor,role='authenticated')=>request(db,'submit_issue_v1',[w,k,JSON.stringify(p)],uid,role);
 for(const role of ['staff','viewer']){await db.query('update public.workspace_members set role=$1 where workspace_id=$2 and user_id=$3',[role,workspace,actor]);membershipRole=role;await assert.rejects(submit(fresh,freshKey),/access_denied/);await assert.rejects(action(form(fresh,randomUUID())),/permission to log/);checks+=2;}
 await db.query("update public.workspace_members set role='owner',status='suspended'where workspace_id=$1 and user_id=$2",[workspace,actor]);await assert.rejects(submit(),/access_denied/);checks++;
 await db.query("update public.workspace_members set status='active'where workspace_id=$1 and user_id=$2",[workspace,actor]);membershipRole='owner';
 await db.query('update public.workspaces set entitled=false where id=$1',[workspace]);await assert.rejects(submit(fresh,freshKey),/access_denied/);checks++;await db.query('update public.workspaces set entitled=true where id=$1',[workspace]);
 await db.query("update auth.users set banned_until=now()+interval '1 day'where id=$1",[actor]);await assert.rejects(submit(),/access_denied/);checks++;await db.query('update auth.users set banned_until=null where id=$1',[actor]);
 await assert.rejects(submit(fresh,randomUUID(),foreign),/access_denied/);await assert.rejects(submit({...fresh,assigned_person_id:foreignPerson}),/assignee_unavailable/);checks+=2;
 for(const role of ['anon','service_role']){await assert.rejects(submit(fresh,randomUUID(),workspace,actor,role),/permission denied|access_denied/);checks++;}
 for(const p of [{...fresh,title:''},{...fresh,severity:'Forged'},{...fresh,due_date:'infinity'},{...fresh,created_by:otherActor}]){await assert.rejects(submit(p),/payload_invalid/);checks++;}
 const malformed=form(fresh,randomUUID());malformed.append('issue_request_id',randomUUID());await assert.rejects(action(malformed),/Refresh this form/);checks++;
 // Failed issue insertion rolls back its receipt in the same transaction.
 await db.exec("create function private.fail_synthetic_issue()returns trigger language plpgsql as $$begin if new.title='Synthetic atomic failure'then raise exception 'synthetic_insert_failure';end if;return new;end;$$;create trigger synthetic_issue_failure before insert on public.issues for each row execute function private.fail_synthetic_issue();");
 const failedKey=randomUUID();await assert.rejects(submit({...fresh,title:'Synthetic atomic failure'},failedKey),/synthetic_insert_failure/);
 assert.equal((await db.query('select count(*)::int n from private.issue_submission_receipts where request_id=$1',[failedKey])).rows[0].n,0);checks+=2;
 // Eight native sessions contend for one receipt; PGlite uses sequential replay.
 const raceKey=randomUUID(),racePayload={...fresh,title:'Synthetic concurrent receipt'};
 const results=nativeClients.length?await Promise.all(nativeClients.map(client=>request(client,'submit_issue_v1',[workspace,raceKey,JSON.stringify(racePayload)]))):await Promise.all([submit(racePayload,raceKey),submit(racePayload,raceKey)]);
 assert.equal(new Set(results.map(x=>x.issueId)).size,1);assert.equal(results.filter(x=>!x.replayed).length,1);checks+=2;
 const sameKeyOtherActor=await submit({...fresh,title:'Independent actor receipt'},raceKey,workspace,otherActor);assert.notEqual(sameKeyOtherActor.issueId,results[0].issueId);checks++;
 await db.query('delete from public.issues where id=$1',[results[0].issueId]);await assert.rejects(submit(racePayload,raceKey),/issue_unavailable/);checks++;
 assert.equal((await db.query('select count(*)::int n from private.issue_submission_receipts where request_id=$1 and actor_id=$2',[raceKey,actor])).rows[0].n,1);checks++;
 assert.equal((await db.query('select count(*)::int n from public.issues where title=$1',[payload.title])).rows[0].n,2);checks++;
 return {suite:'issue_submission_receipts',checks,beforeRepeatedActionRecords:before,afterRepeatedActionRecords:1,concurrentSessions:nativeClients.length||0,concurrentLogicalRequests:1,uniqueRaceIssueIds:1,deniedRoles:['staff','viewer','anon','service_role'],historicalDuplicateRowsPreserved:2,preCorrectionActionSha256:createHash('sha256').update(fixture).digest('hex'),liveProviderCalls:0,limits:'Synthetic reduced schema; native companion proves concurrent receipt locks, browser/Auth qualification is separate.'};
}
module.exports={qualify};
if(require.main===module)(async()=>{const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();try{console.log(JSON.stringify(await qualify(db),null,2));}finally{await db.close();}})().catch(error=>{console.error({failure:true,code:error.code,message:error.message,stack:error.code?undefined:error.stack});process.exitCode=1;});
