// Isolated PGlite only. Uses the existing screened owner/session fixture;
// no hosted SQL, provider network, credentials, or saved production records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, admin, login, map, capture, reopen, uuid, w, other, owner, member, memberSession } from './shared-evidence-sql-fixture.mjs';

const connection = uuid(860), merchant = uuid(861);
async function seed(db, currency = 'USD') {
  await admin(db);
  await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,$5)", [connection,w,owner,merchant,currency]);
  // Import-shaped receipt: business instant precedes creation (the retrieval
  // selector), refunded and cancelled status preserved without netting amounts.
  await db.query(`insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,
    receipt_date,created_at,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled)
    values($1,$2,'synthetic-refund','synthetic-store','2026-09-30T23:00:00Z','2026-10-01T01:00:00Z',
    '2026-10-01T02:00:00Z','REFUND',-25.00,-2.00,0,true)`, [w,connection]);
  await login(db);
  return map(db,'loyverse',connection);
}

test('protected projection binds merchant currency and retains receipt semantics exactly', async () => {
  const db=await setup();try {
    const binding=await seed(db), result=await capture(db,binding);
    assert.equal(result.data.currency,'USD');
    assert.equal(result.data.records.length,1);
    const record=result.data.records[0];
    assert.deepEqual([record.receipt_type,record.total_money,record.total_tax,record.total_discount,record.cancelled],['REFUND',-25,-2,0,true]);
    assert.match(record.receipt_date,/^2026-09-30T23:00:00/);
    assert.match(record.created_at,/^2026-10-01T01:00:00/);
    assert.deepEqual(result.data.original_keys,[['loyverse',connection,'synthetic-refund']]);
    assert.equal((await reopen(db,result.reference_id)).status,'current');
    assert.equal((await reopen(db,result.reference_id)).data.currency,'USD');
    await assert.rejects(capture(db,binding,other),/square_production_customer_owner_denied/);
    await login(db,member,memberSession);await assert.rejects(capture(db,binding),/square_production_customer_owner_denied/);
  }finally{await db.close();}
});

test('missing merchant currency remains explicit unknown; labels cannot supply it', async () => {
  const db=await setup();try {
    const binding=await seed(db,null);
    await admin(db);await db.query("update loyverse_connections set business_name='USD merchant' where id=$1",[connection]);await login(db);
    assert.equal((await capture(db,binding)).data.currency,null);
  }finally{await db.close();}
});

test('currency replacement revokes old binding and reference before explicit remapping', async () => {
  const db=await setup();try {
    const binding=await seed(db), result=await capture(db,binding);
    await admin(db);await db.query("update loyverse_connections set currency_code='EUR' where id=$1",[connection]);await login(db);
    await assert.rejects(capture(db,binding),/evidence_binding_unavailable/);
    await assert.rejects(reopen(db,result.reference_id),/evidence_binding_unavailable/);
    const replacement=await map(db,'loyverse',connection);assert.notEqual(replacement,binding);
    assert.equal((await capture(db,replacement)).data.currency,'EUR');
  }finally{await db.close();}
});

test('pre-currency reference reports changed and is never rewritten; other provider hash shape unchanged', async () => {
  const db=await setup();try {
    const binding=await seed(db), result=await capture(db,binding);
    await admin(db);
    // Model an existing captured projection before the currency field was
    // available. The immutable reference must not silently gain semantics.
    const oldId=uuid(862);
    await db.query(`insert into private.legacy_evidence_references(id,binding_id,workspace_id,period_start,period_end,
      projection_version,source_hash,original_keys,captured_by,captured_session_id)
      select $1,binding_id,workspace_id,period_start,period_end,projection_version,
      private.evidence_digest_v1($2::jsonb-'currency'),original_keys,captured_by,captured_session_id
      from private.legacy_evidence_references where id=$3`,[oldId,JSON.stringify(result.data),result.reference_id]);
    const before=(await db.query('select source_hash from private.legacy_evidence_references where id=$1',[oldId])).rows[0].source_hash;
    await login(db);assert.deepEqual(await reopen(db,oldId),{status:'changed',reference_id:oldId});
    const harvest=await capture(db,await map(db));assert.equal(Object.hasOwn(harvest.data,'currency'),false);
    await admin(db);assert.equal((await db.query('select source_hash from private.legacy_evidence_references where id=$1',[oldId])).rows[0].source_hash,before);
  }finally{await db.close();}
});
