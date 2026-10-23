// Synthetic stored-write probes, not the installed provider ingestion RPCs.
import assert from 'node:assert/strict';
import {typedSetup,sheetsFixture,read,uuid,w,owner,entity,admin,login,map,capture,reopen,typedRead} from './shared-evidence-sql-fixture.mjs';
export async function prepareWriterCases(options={}) {
 const {db}=await typedSetup(options);await admin(db);
 const cases=[];
 const addLegacy=async(provider,connection,sql,args=[])=>{
  await login(db);const reference=await capture(db,await map(db,provider,connection));
  cases.push({provider,sql,args,read:async client=>reopen(client,reference.reference_id),current:v=>v.status==='current'});await admin(db);
 };
 await addLegacy('harvest',uuid(11),"update reporting_history_facts set metrics='[{\"key\":\"hours\",\"value\":9}]' where provider='harvest'");
 for(const [index,provider] of ['xero','clockify','toggl','zoho-inventory','katana'].entries()) {
  const connection=uuid(50+index),key=provider==='xero'?'invoices':provider==='katana'?'stock_rows':provider==='zoho-inventory'?'items':'hours';
  const metrics=[{key,value:1,...(provider==='xero'?{currency:'USD'}:{})}];
  await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account,snapshot,last_sync_at) values($1,$2,$3,$4,'connected','{\"id\":\"synthetic\"}',$5,'2026-10-02')",[connection,w,provider,owner,JSON.stringify({start:'2026-10-01',end:'2026-10-02',metrics})]);
  if(['xero','clockify'].includes(provider)) {
   await db.query("insert into reporting_history_facts values($1,$2,$3,'one','2026-10-01',$4)",[w,provider,connection,JSON.stringify(metrics)]);
   await addLegacy(provider,connection,'update reporting_history_facts set metrics=$1 where connection_id=$2',[JSON.stringify([{...metrics[0],value:2}]),connection]);
  } else await addLegacy(provider,connection,"update reporting_connections set snapshot=jsonb_set(snapshot,'{metrics,0,value}','2') where id=$1",[connection]);
 }
 await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,'USD')",[uuid(60),w,owner,uuid(70)]);
 await db.query("insert into loyverse_receipt_facts values($1,$2,'one','store','2026-10-01','2026-10-01','SALE',100,0,0,false,'2026-10-01')",[w,uuid(60)]);
 await addLegacy('loyverse',uuid(60),'update loyverse_receipt_facts set total_money=101');
 await db.query("insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,currency_code) values($1,$2,$3,'connected','12345','USD')",[uuid(61),w,owner]);
 await db.query("insert into zoho_books_history_facts values($1,$2,'invoice','1','2026-10-01',true,'USD',100,10)",[w,uuid(61)]);
 await addLegacy('zoho-books',uuid(61),'update zoho_books_history_facts set total=101');
 await db.query("insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash,site_id) values($1,$2,$3,'connected',$4,$5)",[uuid(62),w,owner,'a'.repeat(64),uuid(71)]);
 await db.query("insert into wix_order_facts values($1,$2,$3,'2026-10-01',120,'USD','PAID')",[w,uuid(62),uuid(72)]);
 await addLegacy('wix-orders',uuid(62),'update wix_order_facts set total_amount=121');
 const addTyped=async(provider,identity,sql,args=[])=>{
  await login(db);const original=await typedRead(db,identity);
  cases.push({provider,sql,args,read:client=>typedRead(client,identity),current:value=>value.hash===original.hash});await admin(db);
 };
 await addTyped('square',{kind:'square_payment',connection_id:uuid(210),payment_id:'payment:1'},'update square_customer_private.payments set amount_minor=12346');
 const projection={contractVersion:'qbo_source_record_minimized_v1',provider:{providerKey:'quickbooks_online',sourceEnvironment:'production'},recordType:'Invoice',id:'invoice1',minimizationVersion:'qbo_minimizer_v1',status:'active',temporal:{postingDate:'2026-10-01'},accounting:{basis:'accrual',sourceCurrency:'USD'},amounts:{total:{amount:'100',currency:'USD'}}};
 await db.exec(`insert into private.integration_connections values('${uuid(220)}','${w}','${entity}','quickbooks_online','production','active',1);
 insert into private.provider_entity_mappings values('${uuid(221)}','${w}','${entity}','${uuid(220)}','quickbooks_online','production','active',now(),1);
 insert into private.external_source_records values('${uuid(222)}','${w}','${entity}','${uuid(220)}','${uuid(221)}','quickbooks_online','provider','active','${uuid(223)}','Invoice','invoice1');`);
 await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection,posting_date,accounting_basis,accounting_currency) values($1,$2,$3,$4,$5,'quickbooks_online','provider','Invoice','invoice1','valid',$6,'2026-10-01','accrual','USD')",[uuid(223),w,entity,uuid(220),uuid(222),JSON.stringify(projection)]);
 await db.query("insert into private.qbo_production_source_validation_work values($1,$2,$3,$4,$5,$6,null,'valid')",[w,entity,uuid(220),uuid(221),uuid(222),uuid(223)]);
 await addTyped('quickbooks_online',{kind:'qbo_version',source_id:uuid(222)},"update private.qbo_production_source_validation_work set state='quarantined'");
 await sheetsFixture(db);await db.exec(read('docs/security-drafts/08-sheets-projection.sql'));
 await addTyped('google_sheets',{kind:'sheets_ticket_source',source_id:uuid(302)},'update kpis set actual_value=18');
 assert.equal(cases.length,12);assert.equal(new Set(cases.map(c=>c.provider)).size,12);
 return {db,cases};
}
export async function isCurrent(probe,client) {
 try{return probe.current(await probe.read(client));}catch(error){if(['42501','40001'].includes(error.code))return false;throw error;}
}
