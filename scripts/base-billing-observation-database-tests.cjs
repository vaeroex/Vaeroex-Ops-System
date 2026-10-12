/* eslint-disable @typescript-eslint/no-require-imports -- Actual billing SQL on an owned, Unix-only disposable PostgreSQL. */
// No database URL or provider credentials accepted. This tests the real RPCs,
// grants and concurrency with synthetic records; signed HTTP route tests are separate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {Client}=require(path.join(root,'node_modules/pg'));
const bin=process.env.BILLING_TEST_PG_BIN;
assert(bin&&path.isAbsolute(bin)&&fs.existsSync(path.join(bin,'initdb')),'Explicit local PostgreSQL bin required');
const read=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
const owned=fs.mkdtempSync('/tmp/vaeroex-base-native-');fs.chmodSync(owned,0o700);
const socket=path.join(owned,'socket');fs.mkdirSync(socket,{mode:0o700});
let db,started=false;const clients=[],results=[];
const config={host:socket,port:5432,user:'postgres',database:'postgres',ssl:false,statement_timeout:15000};
async function connect(){const c=new Client(config);c.on('error',()=>{});await c.connect();clients.push(c);return c;}
const claim=(sub='sub_native',c=db)=>c.query('select public.claim_stripe_subscription_observation_v1($1) g',[sub]).then(r=>r.rows[0].g);
const cmd=(name,args)=>{const r=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:90000});assert.equal(r.status,0,r.stderr);};
const table=(name,sql)=>{const m=sql.match(new RegExp('create table (?:if not exists )?public\\.'+name+' \\([\\s\\S]*?\\n\\);'));assert(m,name);return m[0];};
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',U='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444',J='55555555-5555-4555-8555-555555555555';
async function sync(id,at,status,{intent=I,customer='cus_native',sub='sub_native',lastPaid=null,generation,legacy=false,c=db,user=U}={}){
 const args=[id,at,status==='active'?'invoice.paid':'invoice.payment_failed',intent,user,sub,customer,'synthetic@example.invalid','Synthetic owner',status,'vaeroex','price_250_synthetic','2026-10-01T00:00:00Z','2026-11-01T00:00:00Z',false,status==='canceled'?at:null,lastPaid,JSON.stringify({id,created:Math.floor(Date.parse(at)/1000)})];
 if(!legacy)args.push(generation===undefined?await claim(sub,c):generation);
 return (await c.query(`select public.sync_stripe_subscription_entitlement_v${legacy?1:2}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
}
const state=()=>db.query("select status from public.customer_subscriptions where stripe_subscription_id='sub_native'").then(r=>r.rows[0].status);
async function denied(label,fn,code){let actual;try{await fn();actual='allowed';}catch(e){actual=e.code;}check(label,actual,code);}

const check=(label,actual,expected)=>{assert.deepEqual(actual,expected,label);results.push({label,actual});};
(async()=>{
 for(const k of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','SUPABASE_TEST_DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN'])assert(!Object.hasOwn(process.env,k),'Remote credentials forbidden');
 cmd('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 cmd('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 db=await connect();
 const observed=(await db.query("select current_setting('data_directory') d,current_setting('listen_addresses') a,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(observed.d),fs.realpathSync(path.join(owned,'data')));assert.equal(observed.a,'');assert.equal(observed.ip,null);
 const base=read('202606170003_phase_6_squarespace_subscriptions.sql'),migration=read('20260820053955_customer_1_billing_entitlement_remediation.sql');
 await db.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.profiles(id uuid primary key,email text,created_at timestamptz default now());
 create table public.workspaces(id uuid primary key,subscription_status text,plan_slug text);
 create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text default 'active');
 create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;`);
 await db.query(table('subscription_plans',base));await db.query(table('customer_subscriptions',base));await db.query(table('subscription_events',base));
 await db.query(read('202606220001_stripe_billing_migration.sql'));
 await db.query(migration.slice(migration.indexOf('create table public.stripe_checkout_intents'),migration.indexOf('create or replace function public.claim_stripe_checkout_intent_v1')));
 const fn=migration.match(/create or replace function public\.sync_stripe_subscription_entitlement_v1\([\s\S]*?\n\$\$;/)[0];await db.query(fn);
 await db.query(`revoke all on all functions in schema public from public,anon,authenticated;
 grant usage on schema public to service_role;
 grant select,insert,update on all tables in schema public to service_role;
 grant execute on all functions in schema public to service_role;`);
 // Mirror permissive hosted default ACLs: the migration must remove them.
 await db.query('alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant all on functions to anon,authenticated,service_role');
 await db.query(read('20261012201726_stripe_subscription_observation_fence.sql'));
 await db.query("insert into profiles(id,email)values($1,'synthetic@example.invalid');",[U]);await db.query("insert into subscription_plans(name,slug,monthly_price_cents)values('Vaeroex','vaeroex',25000)");
 await db.query("insert into workspaces(id,subscription_status,plan_slug)values($1,'manual_review','vaeroex'),($2,'manual_review','vaeroex')",[A,B]);
 await db.query("insert into workspace_members(workspace_id,user_id,role)values($1,$3,'owner'),($2,$3,'owner')",[A,B,U]);
 await db.query("insert into stripe_checkout_intents(id,user_id,workspace_id,plan_slug,stripe_customer_id,status)values($1,$3,$4,'vaeroex','cus_native','completed'),($2,$3,$5,'vaeroex','cus_native','completed')",[I,J,U,A,B]);
 await db.query('set role service_role');
 await denied('claim rejects missing subscription identity',()=>claim(''),'22023');
 await denied('claim rejects non-subscription identity',()=>claim('cus_wrong'),'22023');
 check('Initial paid event applies',(await sync('evt_paid','2026-10-12T12:00:00Z','active')).status,'active');
 check('Duplicate paid event does not apply',(await sync('evt_paid','2026-10-12T12:00:00Z','active')).reason,'duplicate_event');
 check('Older failure does not revoke',(await sync('evt_old_fail','2026-10-12T11:59:59Z','past_due')).reason,'stale_event');
 check('New failure applies',(await sync('evt_failed','2026-10-12T12:00:01Z','past_due')).status,'past_due');
 check('Older paid event does not restore',(await sync('evt_old_paid','2026-10-12T12:00:00Z','active')).reason,'stale_event');
 check('Later recovery applies',(await sync('evt_recovered','2026-10-12T12:00:02Z','active')).status,'active');
 check('Same-second failure applies',(await sync('evt_same_fail','2026-10-12T12:00:03Z','past_due')).status,'past_due');
 check('Latest observed same-second recovery applies',(await sync('evt_same_recovery','2026-10-12T12:00:03Z','active',{lastPaid:'2026-10-12T12:00:03Z'})).status,'active');
 check('Same-second genuinely newer failure applies',(await sync('evt_same_new_failure','2026-10-12T12:00:03Z','past_due')).status,'past_due');
 check('Legacy caller stays conservative on same-second recovery',(await sync('evt_legacy_recovery','2026-10-12T12:00:03Z','active',{legacy:true})).reason,'stale_event');
 let earlier=await claim(),latest=await claim();
 await denied('Latest issued claim fences earlier read before either commits',()=>sync('evt_early_read','2026-10-12T12:00:04Z','active',{generation:earlier}),'40001');
 check('Superseded read cannot change entitlement',await state(),'past_due');
 await sync('evt_current_recovery','2026-10-12T12:00:04Z','active',{generation:latest});
 await denied('Delayed failed snapshot cannot revoke recovered access',()=>sync('evt_delayed_fail','2026-10-12T12:00:04Z','past_due',{generation:earlier}),'40001');
 check('Fenced failure leaves recovered access active',await state(),'active');
 earlier=await claim();latest=await claim();
 await sync('evt_current_failure','2026-10-12T12:00:05Z','past_due',{generation:latest});
 await denied('Delayed active snapshot cannot restore failed access',()=>sync('evt_delayed_active','2026-10-12T12:00:05Z','active',{generation:earlier}),'40001');
 check('Fenced recovery leaves failed access denied',await state(),'past_due');
 check('Retry with fresh observation recovers normally',(await sync('evt_delayed_active','2026-10-12T12:00:05Z','active')).status,'active');
 check('One subscription row survives retries',(await db.query("select count(*)::int n from customer_subscriptions where stripe_subscription_id='sub_native'")).rows[0].n,1);
 await denied('Wrong workspace intent fails',()=>sync('evt_move','2026-10-12T12:00:06Z','active',{intent:J}),'42501');
 await denied('Wrong Stripe customer fails',()=>sync('evt_wrong_customer','2026-10-12T12:00:06Z','active',{customer:'cus_wrong'}),'42501');
 await denied('Wrong actor attribution fails',()=>sync('evt_wrong_actor','2026-10-12T12:00:06Z','active',{user:B}),'42501');
 await denied('New entitlement without trusted intent fails',()=>sync('evt_no_intent','2026-10-12T12:00:06Z','active',{intent:null,sub:'sub_no_intent'}),'42501');
 check('Other workspace cache remains untouched',(await db.query('select subscription_status from workspaces where id=$1',[B])).rows[0].subscription_status,'manual_review');
 check('Existing trusted subscription can reconcile without repeated metadata',(await sync('evt_existing','2026-10-12T12:00:06Z','active',{intent:null,user:null})).workspace_id,A);
 await denied('Existing subscription cannot change Stripe customer without metadata',()=>sync('evt_existing_wrong','2026-10-12T12:00:07Z','active',{intent:null,user:null,customer:'cus_wrong'}),'23514');
 const connections=await Promise.all(Array.from({length:8},async()=>{const c=await connect();await c.query('set role service_role');return c;}));
 const generations=await Promise.all(connections.map(c=>claim('sub_native',c)));
 const ordered=generations.map(Number).sort((a,b)=>a-b);
 check('Eight concurrent claims issue unique contiguous generations',ordered,Array.from({length:8},(_,i)=>ordered[0]+i));
 const max=String(ordered[7]);
 await Promise.all(connections.map((c,i)=>String(generations[i])===max
  ?sync('evt_concurrent_latest','2026-10-12T12:00:07Z','active',{generation:generations[i],c}).then(r=>check('Only latest concurrent observation applies',r.applied,true))
  :denied('Concurrent older observation is retryable '+i,()=>sync('evt_concurrent_old_'+i,'2026-10-12T12:00:07Z','past_due',{generation:generations[i],c}),'40001')));
 check('Concurrent older failures cannot revoke current access',await state(),'active');
 // The mutation and workspace cache update share one transaction.
 await db.query('reset role');await db.query("alter table workspaces add constraint synthetic_cache_failure check (subscription_status <> 'unpaid')");await db.query('set role service_role');
 await denied('Workspace cache failure rolls back the entire reconciliation',()=>sync('evt_atomic_failure','2026-10-12T12:00:08Z','unpaid'),'23514');
 check('Atomic failure preserves authoritative subscription',await state(),'active');
 check('Atomic failure preserves previous event cursor',(await db.query("select stripe_last_event_id from customer_subscriptions where stripe_subscription_id='sub_native'")).rows[0].stripe_last_event_id,'evt_concurrent_latest');
 const inFlight=await claim();
 await sync('evt_cancel','2026-10-12T12:00:09Z','canceled',{legacy:true});
 check('Signed historical deletion fences an in-flight current read',(await sync('evt_inflight_active','2026-10-12T12:00:09Z','active',{generation:inFlight})).reason,'terminal_subscription');
 check('Later observed active cannot resurrect canceled same subscription',(await sync('evt_post_cancel_active','2026-10-12T12:00:10Z','active')).reason,'terminal_subscription');
 check('Legacy same-second active also cannot resurrect canceled',(await sync('evt_legacy_after_cancel','2026-10-12T12:00:09Z','active',{legacy:true})).reason,'stale_event');
 check('Separate workspace receives its own subscription',(await sync('evt_second_paid','2026-10-12T12:00:10Z','active',{intent:J,sub:'sub_second'})).workspace_id,B);
 check('First workspace remains canceled',(await db.query('select subscription_status from workspaces where id=$1',[A])).rows[0].subscription_status,'canceled');
 await sync('evt_second_expired','2026-10-12T12:00:11Z','expired',{intent:J,sub:'sub_second',legacy:true});
 check('Incomplete-expired terminal subscription cannot be restored',(await sync('evt_second_restore','2026-10-12T12:00:12Z','active',{intent:J,sub:'sub_second'})).reason,'terminal_subscription');
 check('Base plan remains exactly $250',(await db.query("select monthly_price_cents from subscription_plans where slug='vaeroex'")).rows[0].monthly_price_cents,25000);
 await denied('Service cannot delete observation history',()=>db.query('delete from stripe_subscription_observations'),'42501');
 await db.query('reset role');
 const observedFns=(await db.query("select p.proname, p.prosecdef, p.proconfig, has_function_privilege('service_role',p.oid,'EXECUTE') service,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_stripe_subscription_observation_v1','sync_stripe_subscription_entitlement_v2') order by p.proname")).rows;
 check('Both new RPCs remain invoker, empty-search-path and service-only',observedFns.map(r=>[r.prosecdef,r.proconfig,r.service,r.anon,r.authenticated]),[[false,['search_path=\"\"'],true,false,false],[false,['search_path=\"\"'],true,false,false]]);
 check('Observation ledger has RLS',(await db.query("select relrowsecurity from pg_class where oid='public.stripe_subscription_observations'::regclass")).rows[0].relrowsecurity,true);
 for(const role of ['anon','authenticated']){
  await db.query('set role '+role);
  await denied(role+' cannot read observation ledger',()=>db.query('select * from public.stripe_subscription_observations'),'42501');
  await denied(role+' cannot claim a provider observation',()=>claim(),'42501');
  await denied(role+' cannot sync provider entitlement',()=>sync('evt_denied','2026-10-12T12:00:12Z','active',{generation:'1'}),'42501');
  await db.query('reset role');
 }
 console.log(JSON.stringify({scope:'owned Unix-socket-only disposable native Postgres; actual RPC; synthetic only',results},null,2));
})().catch(e=>{console.error(JSON.stringify({error:e.message,code:e.code,stack:e.code?undefined:e.stack}));process.exitCode=1;}).finally(async()=>{for(const c of clients)await c.end().catch(()=>{});if(started)cmd('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
