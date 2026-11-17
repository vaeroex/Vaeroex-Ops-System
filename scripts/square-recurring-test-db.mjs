import { readFileSync } from 'node:fs';
import { createImportRecurringTestDb, ids, asService } from './import-recurring-test-db.mjs';

export { ids, asService };
export const squareIds = Object.freeze({
  session: 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa', entity: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  connection: 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa', application: 'sq0idp-recurring-fixture'
});
const sql = name => readFileSync(new URL(`../supabase/production-migrations/${name}`, import.meta.url), 'utf8');

// Production-shaped isolated fixture, not a claim that the historical 105-row
// release ledger was recreated. Install the original table/function bodies
// after their explicit historical ledger preflight; the NEW incremental
// migration's complete prerequisite/function/ACL checks execute unchanged.
export async function createSquareRecurringTestDb({ beforeSquareMigration, applyRecurring = true } = {}) {
  const db = await createImportRecurringTestDb();
  await db.exec(`create role square_production_oauth_authority;create role square_production_broker_authority;
    create role square_production_runtime_authority;create role square_production_evidence_authority;
    create role square_production_scheduler_authority;create role square_production_webhook_authority;
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
    create table public.business_entities(id uuid primary key,workspace_id uuid not null references workspaces(id),display_name text,
      status text not null default 'active',unique(workspace_id,id));`);
  const authority = sql('20260925032300_square_production_customer_connection.sql');
  await db.exec(authority.slice(authority.indexOf('create function private.square_production_customer_require_keys_v1'),
    authority.indexOf('create function private.square_production_customer_require_login_v1')));
  await db.exec(authority.slice(authority.indexOf('create function private.square_production_customer_require_owner_v1'),
    authority.indexOf('create function private.square_production_customer_require_gate_v1')));
  await db.exec(`revoke all on function private.square_production_customer_require_keys_v1(jsonb,text[]),
    private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid),private.square_production_customer_require_eligible_v1(uuid)
    from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,
      square_production_runtime_authority,square_production_evidence_authority,square_production_scheduler_authority,square_production_webhook_authority;`);
  const backend = sql('20260929004917_square_customer_service_backend.sql');
  await db.exec(backend.slice(backend.indexOf('create schema square_customer_private')));
  const history = sql('20260929041048_square_customer_payment_history.sql');
  await db.exec(history.slice(history.indexOf('alter table square_customer_private.connections')));
  await db.query('insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval \'1 day\')', [squareIds.session, ids.actor]);
  await db.query('insert into business_entities(id,workspace_id,display_name) values($1,$2,$3)', [squareIds.entity, ids.workspace, 'Fictional Square seller']);
  await db.query("insert into customer_subscriptions(workspace_id,billing_provider,status,current_period_end,stripe_customer_id,stripe_subscription_id) values($1,'stripe','active',clock_timestamp()+interval '1 month','fictional-customer','fictional-subscription')", [ids.workspace]);
  if (beforeSquareMigration) await beforeSquareMigration(db);
  if (applyRecurring) await db.exec(sql('20261117014116_square_customer_recurring_refresh.sql'));
  return db;
}

export async function connectSquare(db, { workspace = ids.workspace, connection = squareIds.connection,
  entity = squareIds.entity, merchant = 'fictional-seller', application = squareIds.application, recurring = true,
  actor = ids.actor, session = squareIds.session, ciphertext = 'A'.repeat(64), accessExpiresAt = new Date(Date.now() + 86400_000).toISOString() } = {}) {
  await asService(db);
  await db.query('update square_customer_private.configuration set enabled=true,application_id=$1', [application]);
  await db.query(`insert into square_customer_private.connections(connection_id,workspace_id,business_entity_id,application_id,state,
    credential_version,ciphertext,merchant_id,seller_label,access_expires_at,locations,location_id)
    values($1,$2,$3,$4,'connected',1,$5,$6,'Fictional seller',$8,$7,'location-1')`,
  [connection, workspace, entity, application, ciphertext, merchant, JSON.stringify([{ id: 'location-1', label: 'Main' }]), accessExpiresAt]);
  if (recurring) await db.query('select square_customer_set_recurring_v1($1,$2,$3,$4,$5,true)', [actor, session, workspace, application, connection]);
}

export async function squareRecurring(db, operation, payload, { workspace = ids.workspace, application = squareIds.application } = {}) {
  return (await db.query('select square_customer_recurring_v1($1,$2,$3,$4) value', [operation, workspace, application, JSON.stringify(payload)])).rows[0].value;
}
export async function squareManual(db, operation, payload, { workspace = ids.workspace, actor = ids.actor,
  session = squareIds.session, application = squareIds.application } = {}) {
  return (await db.query('select square_customer_backend_v1($1,$2,$3,$4,$5,$6) value', [operation, actor, session, workspace, application, JSON.stringify(payload)])).rows[0].value;
}
