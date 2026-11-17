import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createReportingRecurringTestDb, asService, ids } from './reporting-recurring-test-db.mjs';

export { ids, asService };
export const importTables = Object.freeze({ loyverse: 'loyverse_connections', 'zoho-books': 'zoho_books_connections', 'wix-orders': 'wix_order_connections' });
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

export async function createImportRecurringTestDb({ beforeImportMigration } = {}) {
  const db = await createReportingRecurringTestDb();
  for (const migration of ['20261017013603_loyverse_read_only_connection.sql', '20261017023221_zoho_books_read_only_connection.sql',
    '20261017051502_wix_orders_read_only_connection.sql', '20261017184954_loyverse_merchant_reconnect_guard.sql',
    '20261019070949_zoho_books_import_history.sql', '20261019070953_loyverse_import_history.sql',
    '20261019071008_wix_orders_import_history.sql']) await db.exec(sql(migration));
  if (beforeImportMigration) await beforeImportMigration(db);
  await db.exec(sql('20261117012702_import_recurring_refresh.sql'));
  return db;
}

export async function connectImport(db, { provider = 'loyverse', workspace = ids.workspace, actor = ids.actor,
  connection = ids.connection, recurring = true, ciphertext = 'A'.repeat(64) } = {}) {
  await asService(db);
  const table = importTables[provider];
  if (!table) throw Error('invalid_fixture_provider');
  if (provider === 'loyverse') {
    await db.query(`insert into ${table}(id,workspace_id,created_by,status,merchant_id,business_name,currency_code)
      values($1,$2,$3,'connected',$4,'Fictional receipt store','USD')`, [connection, workspace, actor, randomUUID()]);
    await db.query("insert into loyverse_credentials(connection_id,workspace_id,token_ciphertext,access_expires_at,scope) values($1,$2,$3,clock_timestamp()+interval '1 hour','MERCHANT_READ RECEIPTS_READ')", [connection, workspace, ciphertext]);
  } else if (provider === 'zoho-books') {
    await db.query(`insert into ${table}(id,workspace_id,created_by,status,organization_id,organization_name,currency_code)
      values($1,$2,$3,'connected','123456','Fictional accounting organization','USD')`, [connection, workspace, actor]);
    await db.query("insert into zoho_books_credentials(connection_id,workspace_id,token_ciphertext,access_expires_at,scope) values($1,$2,$3,clock_timestamp()+interval '1 hour','ZohoBooks.settings.READ,ZohoBooks.invoices.READ,ZohoBooks.expenses.READ')", [connection, workspace, ciphertext]);
  } else {
    await db.query(`insert into ${table}(id,workspace_id,created_by,status,instance_hash,site_id) values($1,$2,$3,'connected',$4,$5)`,
      [connection, workspace, actor, createHash('sha256').update(connection).digest('hex'), randomUUID()]);
    await db.query('insert into wix_order_credentials(connection_id,workspace_id,instance_ciphertext) values($1,$2,$3)', [connection, workspace, ciphertext]);
  }
  if (recurring) await db.query('select set_import_recurring($1,$2,$3,$4,true)', [workspace, provider, connection, actor]);
}

export async function dueImportNow(db, { provider = 'loyverse', connection = ids.connection } = {}) {
  const table = importTables[provider]; if (!table) throw Error('invalid_fixture_provider');
  await db.query(`update ${table} set recurring_next_refresh_at=clock_timestamp()-interval '1 second',refresh_not_before=clock_timestamp()-interval '1 second' where id=$1`, [connection]);
}

export async function claimImport(db, { workspace = ids.workspace, provider = 'loyverse', connection = ids.connection,
  lease = ids.lease, trigger = 'scheduled', actor = trigger === 'manual' ? ids.actor : null } = {}) {
  return (await db.query('select claim_import_refresh($1,$2,$3,$4,$5,$6) ok', [workspace, provider, connection, lease, trigger, actor])).rows[0].ok;
}

export async function importPeriod(db, { provider = 'loyverse', connection = ids.connection } = {}) {
  const table = importTables[provider]; if (!table) throw Error('invalid_fixture_provider');
  return (await db.query(`select ((recurring_last_attempt_at at time zone 'UTC')::date-7)::text as start,
    ((recurring_last_attempt_at at time zone 'UTC')::date-1)::text as end,
    ((recurring_last_attempt_at at time zone 'UTC')::date)::text||'T00:00:00Z' as cutoff from ${table} where id=$1`, [connection])).rows[0];
}
