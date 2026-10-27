import { test } from 'node:test';
import assert from 'node:assert/strict';
import { read, uuid, w, other, owner, member, session, memberSession, login, admin, typedSetup, sheetsFixture } from './shared-evidence-sql-fixture.mjs';

test('v2 discovery prioritizes requested providers before96, counts omissions and preserves owner authority',async()=>{
 const {db}=await typedSetup();try {
  await admin(db);await sheetsFixture(db);await db.exec(read('docs/security-drafts/08-sheets-projection.sql'));await db.exec(read('docs/security-drafts/11-generation-discovery.sql'));
  for(let i=0;i<130;i++) await db.query("insert into square_customer_private.payments values($1,$2,$3,'location','COMPLETED',$4,$4,0,'USD')",[w,uuid(210),`payment:${i+2}`,`2026-10-${String(1+i%7).padStart(2,'0')}`]);
  // Other-workspace payments must not alter either returned candidates or counts.
  await db.query("insert into square_customer_private.payments values($1,$2,'foreign','location','COMPLETED','2026-10-07','2026-10-07',0,'USD')",[other,uuid(211)]);
  await login(db);
  const discover=(preferences,workspace=w)=>db.query("select discover_shared_evidence_v2($1,'2026-10-01','2026-10-07',$2) v",[workspace,preferences]).then(result=>result.rows[0].v);
  const catalog=await discover(['google_sheets','harvest']);
  assert.equal(catalog.candidates.length,96);assert.equal(catalog.totalCandidates,133);assert.equal(catalog.truncated,true);
  assert.deepEqual(catalog.candidates.slice(0,2).map(row=>row.provider),['google_sheets','harvest']);
  assert.deepEqual(catalog.providerCounts,[{provider:'google_sheets',total:1,returned:1},{provider:'harvest',total:1,returned:1},{provider:'square',total:131,returned:94}]);
  assert.equal(JSON.stringify(catalog).includes('foreign'),false);assert.equal(JSON.stringify(catalog).includes('amount_minor'),false);
  const firstPayment=catalog.candidates.find(row=>row.provider==='square').identity.payment_id;
  assert.equal((Number(firstPayment.slice(8))-2)%7,6,'most recent UTC payment date ranks first without converting its money');
  const squareRequested=await discover(['square']);assert.equal(squareRequested.candidates.every(row=>row.provider==='square'),true);
  assert.deepEqual(squareRequested.providerCounts.filter(row=>row.provider!=='square').map(row=>row.returned),[0,0]);
  const noPreference=await discover([]);assert.deepEqual(noPreference.candidates.slice(0,3).map(row=>row.provider),['google_sheets','harvest','square']);
  const legacy=(await db.query("select discover_shared_evidence_v1($1,'2026-10-01','2026-10-07') v",[w])).rows[0].v;
  assert.deepEqual(legacy.candidates,noPreference.candidates);assert.deepEqual(Object.keys(legacy).sort(),['candidates','stage','truncated']);
  for(const preferences of [null,['xero','xero'],['unknown'],[null],Array(13).fill('xero')]) await assert.rejects(discover(preferences),/shared_discovery_preference_invalid/);
  await assert.rejects(discover(['square'],other),/owner_denied/);
  await login(db,member,memberSession);await assert.rejects(discover(['square']),/owner_denied/);
  for(const role of ['anon','service_role']) {await login(db,owner,session,role);await assert.rejects(discover(['square']),/permission denied/);}
  await admin(db);const grants=(await db.query("select has_function_privilege('authenticated','public.discover_shared_evidence_v2(uuid,date,date,text[])','EXECUTE') a,has_function_privilege('anon','public.discover_shared_evidence_v2(uuid,date,date,text[])','EXECUTE') n,has_function_privilege('service_role','public.discover_shared_evidence_v2(uuid,date,date,text[])','EXECUTE') s")).rows[0];
  assert.deepEqual(grants,{a:true,n:false,s:false});
 } finally { await db.close(); }
});
