// Runs inside the owned local harness transaction; never a hosted target.
module.exports=async function({c,eq,workspace,actor,session,connection,entity,claims,view}) {
 const mapped='Vaeroex Square Sandbox',denial='Vaeroex Square Evidence Denial Test';
 const other=require('node:crypto').randomUUID();
 await c.query('update public.workspaces set name=$2,subscription_required=false where id=$1',[workspace,mapped]);
 await c.query('insert into public.workspaces(id,name,created_by,subscription_required) values($1,$2,$3,true)',[other,denial,actor]);
 await c.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active') on conflict do nothing",[other,actor]);
 await c.query('revoke select on public.workspace_members,public.workspaces,public.customer_subscriptions,public.subscription_plans from authenticated');
 for(const table of ['workspace_members','workspaces','customer_subscriptions','subscription_plans'])eq((await c.query("select has_table_privilege('authenticated',$1,'SELECT') ok",['public.'+table])).rows[0].ok,false,'hosted no-direct-SELECT baseline');
 const rlsBefore=(await c.query("select oid,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='private'::regnamespace order by oid")).rows;
 async function read(name=mapped,patch={}) {
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({...claims,...patch})]);
  await c.query('set local role authenticated');
  try{return (await c.query('select public.read_square_workspace_card_v1($1) value',[name])).rows[0].value;}
  finally{await c.query('reset role');}
 }
 async function change(sql,params,expected,label) {
  await c.query('savepoint card_change');await c.query(sql,params);
  eq(!!await read(),expected,label);await c.query('rollback to card_change');
 }
 const card=await read();eq(card.counts,view.counts,'RPC succeeds without any direct table SELECT');
 eq((await read()).counts,card.counts,'replay preserves card');
 for(const forbidden of [workspace,other,actor,session,connection,entity,mapped,denial,'workspace_id','credential','cursor'])eq(JSON.stringify(card).includes(forbidden),false,'only minimized evidence leaves DB');
 for(const name of [denial,'Other tenant',null,'', 'x'.repeat(201)])eq(await read(name),null,'uniform missing/unmapped result');
 for(const patch of [{sub:other},{session_id:other},{role:'service_role'},{iss:'https://production.invalid/auth/v1'},{is_anonymous:true}])eq(await read(mapped,patch),null,'invalid session authority returns no data');
 for(const [sql,params,label] of [
  ["update public.workspace_members set status='disabled' where workspace_id=$1",[workspace],'membership revoked'],
  ["update public.workspace_members set role='viewer' where workspace_id=$1",[workspace],'role downgraded'],
  ["delete from auth.sessions where id=$1",[session],'session removed'],
  ["update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[session],'session expired'],
  ["update public.workspaces set name=$2 where id=$1",[other,mapped],'ambiguous own labels'],
  ["update private.square_account_connections set revocation_pending=true where connection_id=$1",[connection],'revocation pending'],
  ["update private.square_connections set current_generation=5 where connection_id=$1",[connection],'generation changed'],
  ["update public.business_entities set status='inactive' where id=$1",[entity],'entity disabled'],
  ["update public.workspaces set subscription_required=true,subscription_status='expired',manually_unlocked=false where id=$1",[workspace],'subscription required']
 ])await change(sql,params,false,label);
 await change("update public.workspaces set subscription_required=true,subscription_status='demo' where id=$1",[workspace],true,'demo parity');
 await change("update public.workspaces set subscription_required=true,subscription_status='trialing',trial_ends_at=clock_timestamp()+interval '1 hour' where id=$1",[workspace],true,'trial parity');
 await change("update public.workspaces set subscription_required=true,subscription_status='trialing',trial_ends_at=clock_timestamp()-interval '1 hour' where id=$1",[workspace],false,'expired trial denied');
 await c.query('savepoint billing_cases');
 await c.query("update public.workspaces set subscription_required=true,manually_unlocked=true,subscription_status='expired' where id=$1",[workspace]);
 await c.query("insert into public.customer_subscriptions(workspace_id,customer_email,billing_provider,manually_activated,status) values($1,'synthetic@example.invalid','manual',true,'active')",[workspace]);
 eq(!!await read(),true,'approved manual activation parity');
 await c.query("insert into public.customer_subscriptions(workspace_id,customer_email,billing_provider,status,current_period_end,stripe_customer_id,stripe_subscription_id,created_at) values($1,'synthetic@example.invalid','stripe','active',clock_timestamp()+interval '1 hour','synthetic-customer','synthetic-subscription',clock_timestamp())",[workspace]);
 eq(!!await read(),true,'valid Stripe parity');
 await change("update public.customer_subscriptions set current_period_end=clock_timestamp()-interval '1 second' where billing_provider='stripe'",[],false,'expired Stripe overrides manual');
 await change("update public.customer_subscriptions set manually_activated=true where billing_provider='stripe'",[],false,'manually activated Stripe denied');
 await change("update public.customer_subscriptions set stripe_customer_id=null where billing_provider='stripe'",[],false,'missing Stripe identity denied');
 await c.query("update public.workspaces set subscription_required=false where id=$1",[workspace]);
 await change("update public.customer_subscriptions set status='canceled' where billing_provider='stripe'",[],false,'canceled Stripe overrides exemption');
 await c.query("insert into public.customer_subscriptions(workspace_id,customer_email,billing_provider,status,created_at) values($1,'synthetic@example.invalid','stripe','canceled',clock_timestamp()+interval '1 second')",[workspace]);
 eq(await read(),null,'newest linked Stripe wins');
 await c.query('rollback to billing_cases');
 await c.query('savepoint unrelated_billing');
 await c.query("update public.workspaces set subscription_required=true,subscription_status='expired' where id=$1",[workspace]);
 await c.query("insert into public.customer_subscriptions(workspace_id,user_id,customer_email,billing_provider,status,current_period_end,stripe_customer_id,stripe_subscription_id) values($1,$2,'synthetic@example.invalid','stripe','active',clock_timestamp()+interval '1 hour','other-customer','other-subscription')",[other,actor]);
 eq(await read(),null,'same-user unrelated subscription never grants access');
 await c.query('rollback to unrelated_billing');
 eq((await c.query("select oid,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='private'::regnamespace order by oid")).rows,rlsBefore,'FORCE RLS unchanged');
 eq((await c.query("select has_schema_privilege('authenticated','private','USAGE') ok")).rows[0].ok,false,'no private schema access');
 for(const role of ['anon','service_role'])eq((await c.query("select has_function_privilege($1,'public.read_square_workspace_card_v1(text)','EXECUTE') ok",[role])).rows[0].ok,false,'no non-user RPC grant');
};
