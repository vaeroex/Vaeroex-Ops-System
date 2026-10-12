/* eslint-disable @typescript-eslint/no-require-imports -- Real disposable PostgreSQL billing qualification. */
const {randomUUID}=require('node:crypto');

module.exports=async function capacityBillingDatabaseChecks(c,{owner,other,actor,ok,denied,qualifyMaximum}) {
  const workspace=randomUUID(),second=randomUUID();
  await actor(c,null,'postgres');
  await c.query("insert into workspaces(id,name) values($1,'Capacity qualification'),($2,'Independent capacity')",[workspace,second]);
  await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$3,'owner'),($2,$3,'owner')",[workspace,second,owner]);
  const quote=(packs,w=workspace,who=owner)=>c.query("select workspace_capacity_quote_v1($1,$2,$3,'price_capacity',false,'storage-capacity-v1') v",[w,who,packs]).then(r=>r.rows[0].v);
  const confirm=i=>c.query('select workspace_capacity_confirm_v1($1,$2,$3) v',[workspace,owner,i.id]);
  const record=i=>c.query('select workspace_capacity_record_checkout_v1($1,$2,$3,$4,$5,now()+interval \'30 minutes\')',[workspace,owner,i.id,'cs_'+i.id,'cus_capacity']);
  const paid=(id,packs)=>({id,packs,period_start:new Date(Date.now()-86400000).toISOString(),period_end:new Date(Date.now()+29*86400000).toISOString(),paid_cents:packs*500,refunded_cents:0,disputed:false});
  const sync=(i,invoices,event=randomUUID(),checked=new Date().toISOString(),extra={})=>c.query(`select workspace_capacity_sync_v1($1,'invoice.paid',$2,$3,$4,'cus_capacity','price_capacity',false,$5,$6,$7,$8,$9,$10) v`,
    [event,i.id,'cs_'+i.id,extra.subscription||'sub_'+i.id,i.packs,extra.status||'active',extra.cancel||false,extra.ended||null,checked,JSON.stringify(invoices)]).then(r=>r.rows[0].v);
  const packs=()=>c.query('select private.workspace_storage_paid_packs_v1($1) n',[workspace]).then(r=>r.rows[0].n);
  await actor(c,owner);await denied('authenticated customer cannot forge paid capacity',()=>quote(1),'42501');
  await actor(c,owner,'service_role');
  await denied('owner identity is required even behind service RPC',()=>quote(1,workspace,other),'42501');
  await denied('zero-pack purchase rejected',()=>quote(0),'22023');
  await denied('above qualified purchase bound rejected',()=>quote(11),'22023');
  let intent=await quote(1);await confirm(intent);await record(intent);
  const invoice=paid('in_first',1);const event=randomUUID();await sync(intent,[invoice],event);
  ok('confirmed paid invoice automatically grants one pack',await packs(),1);
  ok('duplicate paid webhook is idempotent',(await sync(intent,[invoice],event)).duplicate,true);
  ok('duplicate invoice cannot double capacity',await packs(),1);
  ok('same owner second workspace has independent zero paid packs',(await c.query('select private.workspace_storage_paid_packs_v1($1) n',[second])).rows[0].n,0);
  await actor(c,owner);let usage=(await c.query('select workspace_storage_usage_v1($1) v',[workspace])).rows[0].v;
  ok('paid allowance participates in actual atomic admission',[usage.allowance_bytes,usage.allowance_files],[25000000000,1000]);
  await actor(c,owner,'service_role');
  await denied('another workspace cannot inspect purchase intent',()=>c.query('select workspace_capacity_intent_v1($1,$2,$3)',[second,owner,intent.id]),'42501');
  await denied('another user cannot inspect purchase intent',()=>c.query('select workspace_capacity_intent_v1($1,$2,$3)',[workspace,other,intent.id]),'42501');
  await denied('invoice attribution cannot change subscription',()=>sync(intent,[invoice],randomUUID(),new Date().toISOString(),{subscription:'sub_wrong'}),'23505');
  const max=await quote(9);await confirm(max);await record(max);const maxInvoice=paid('in_nine',9);await sync(max,[maxInvoice]);
  ok('multiple explicit purchases grant exactly ten packs',await packs(),10);
  await denied('active subscriptions cannot exceed ten packs',()=>quote(1),'54000');
  await actor(c,owner);usage=(await c.query('select workspace_storage_usage_v1($1) v',[workspace])).rows[0].v;
  ok('ten-pack ceiling is 115 GB and 5500 files',[usage.allowance_bytes,usage.allowance_files],[115000000000,5500]);
  if(qualifyMaximum)await qualifyMaximum(c,workspace);
  await actor(c,owner,'service_role');
  // Out-of-order worker snapshots cannot undo a newer cancellation.
  const newer=new Date(Date.now()+1000).toISOString(),older=new Date(Date.now()-1000).toISOString();
  await sync(intent,[invoice],randomUUID(),newer,{cancel:true});await sync(intent,[invoice],randomUUID(),older);
  ok('out-of-order event cannot undo cancellation flag',(await c.query('select workspace_capacity_state_v1($1,$2) v',[workspace,owner])).rows[0].v.subscriptions.find(s=>s.id==='sub_'+intent.id).cancelAtPeriodEnd,true);
  ok('cancel at period end retains paid capacity',await packs(),10);
  await sync(intent,[{...invoice,refunded_cents:250}]);ok('partial refund retains purchased period',await packs(),10);
  await sync(intent,[{...invoice,refunded_cents:500}]);ok('full refund removes only that invoice capacity',await packs(),9);
  ok('refunded renewable subscriptions still occupy the qualified purchase ceiling',(await c.query('select workspace_capacity_state_v1($1,$2) v',[workspace,owner])).rows[0].v.committedPacks,10);
  await sync(intent,[invoice]);ok('stale paid event cannot revive refunded capacity',await packs(),9);
  await sync(max,[{...maxInvoice,disputed:true}],randomUUID(),newer);ok('payment dispute revokes contested capacity',await packs(),0);
  await sync(max,[maxInvoice],randomUUID(),older);ok('stale paid event cannot revive disputed capacity',await packs(),0);
  await sync(max,[maxInvoice],randomUUID(),new Date(Date.now()+2000).toISOString());ok('verified won dispute restores current paid capacity',await packs(),9);
  // Independent new workspace qualifies missed-payment expiry without relying on an event arrival.
  const late=await quote(1,second);await c.query('select workspace_capacity_confirm_v1($1,$2,$3)',[second,owner,late.id]);
  await c.query('select workspace_capacity_record_checkout_v1($1,$2,$3,$4,$5,now()+interval \'30 minutes\')',[second,owner,late.id,'cs_'+late.id,'cus_capacity']);
  const expired={...paid('in_expired',1),period_start:new Date(Date.now()-40*86400000).toISOString(),period_end:new Date(Date.now()-86400000).toISOString()};
  await sync(late,[expired],randomUUID(),new Date().toISOString(),{status:'past_due'});
  ok('failed or missing renewal does not extend paid-through date',(await c.query('select private.workspace_storage_paid_packs_v1($1) n',[second])).rows[0].n,0);
  await actor(c,null,'postgres');
  const grants=(await c.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'workspace_capacity_%' and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))")).rows;
  ok('all capacity mutation and billing lookup RPCs are service-only',grants,[]);
  ok('billing tables remain private and RLS protected',(await c.query("select count(*)::integer n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relname in ('workspace_capacity_intents','workspace_capacity_subscriptions','workspace_capacity_invoices','workspace_capacity_events') and relrowsecurity")).rows[0].n,4);
};
