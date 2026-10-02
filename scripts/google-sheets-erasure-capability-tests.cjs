/* eslint-disable @typescript-eslint/no-require-imports -- Standalone synthetic PostgreSQL capability proof. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

// This fixture neither loads migrations nor opens a persistent/live database.
// The protected tables are deliberately minimal; hashes cover their entire rows.
const EXECUTOR = 'sheets_erasure_executor';
const SUPPORT = 'sheets_erasure_support';
const TABLES = ['google_sheets_mapping_approvals', 'google_sheets_source_versions'];
const WORKSPACE = randomUUID();
const CONNECTION = randomUUID();
const OWNER = randomUUID();
let checks = 0;
let deniedChecks = 0;
let stage = 'setup';

const schema = `
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create role sheets_erasure_support nologin noinherit;
  create role sheets_erasure_executor nologin noinherit nobypassrls;
  revoke create on schema public from public;
  create schema private;
  revoke all on schema private from public;
  grant usage on schema private to sheets_erasure_executor, sheets_erasure_support;
  grant usage on schema public to authenticated, service_role, sheets_erasure_executor;

  create table private.erasure_requests (
    id uuid primary key,
    workspace_id uuid not null,
    connection_id uuid not null,
    owner_id uuid not null,
    state text not null check (state in ('prepared', 'approved', 'completed')),
    inventory_hash text not null default '',
    approved_hash text,
    approved_by uuid,
    deleted_count integer not null default 0,
    unique (id, workspace_id, connection_id)
  );
  create table private.erasure_targets (
    request_id uuid not null,
    table_oid oid not null,
    row_id uuid not null,
    workspace_id uuid not null,
    connection_id uuid not null,
    old_row_hash text not null check (old_row_hash ~ '^[a-f0-9]{64}$'),
    primary key (request_id, table_oid, row_id),
    unique (request_id, table_oid, row_id, workspace_id, connection_id, old_row_hash),
    foreign key (request_id, workspace_id, connection_id)
      references private.erasure_requests (id, workspace_id, connection_id)
  );
  create table private.erasure_capabilities (
    request_id uuid not null,
    table_oid oid not null,
    row_id uuid not null,
    workspace_id uuid not null,
    connection_id uuid not null,
    old_row_hash text not null,
    inventory_hash text not null,
    transaction_id bigint not null,
    primary key (request_id, table_oid, row_id),
    unique (transaction_id, table_oid, row_id),
    foreign key (request_id, table_oid, row_id, workspace_id, connection_id, old_row_hash)
      references private.erasure_targets
        (request_id, table_oid, row_id, workspace_id, connection_id, old_row_hash)
  );

  create function private.inventory_hash(p_request_id uuid)
  returns text language sql stable security invoker set search_path = '' as $$
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.jsonb_build_object(
        'request_id', r.id, 'workspace_id', r.workspace_id, 'connection_id', r.connection_id,
        'targets', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)
          order by t.table_oid, t.row_id) from private.erasure_targets t where t.request_id = r.id), '[]'::jsonb)
      )::text, 'UTF8')), 'hex')
    from private.erasure_requests r where r.id = p_request_id;
  $$;
  revoke all on function private.inventory_hash(uuid) from public;
  grant execute on function private.inventory_hash(uuid) to sheets_erasure_executor;

  create function private.exact_row_immutable()
  returns trigger language plpgsql security invoker set search_path = '' as $$
  declare consumed uuid;
  begin
    if tg_op <> 'DELETE' or current_user <> 'sheets_erasure_executor' then
      raise exception 'immutable_mutation_denied' using errcode = '42501';
    end if;
    delete from private.erasure_capabilities c using private.erasure_requests r
    where c.request_id = r.id
      and c.transaction_id = pg_catalog.txid_current()
      and c.table_oid = tg_relid and c.row_id = old.id
      and c.workspace_id = old.workspace_id and c.connection_id = old.connection_id
      and c.old_row_hash = pg_catalog.encode(pg_catalog.sha256(
        pg_catalog.convert_to(pg_catalog.to_jsonb(old)::text, 'UTF8')), 'hex')
      and r.workspace_id = old.workspace_id and r.connection_id = old.connection_id
      and r.state = 'approved' and r.approved_by = r.owner_id
      and r.approved_hash = r.inventory_hash and c.inventory_hash = r.inventory_hash
      and r.inventory_hash = private.inventory_hash(r.id)
    returning c.request_id into consumed;
    if consumed is null then
      raise exception 'immutable_exact_capability_denied' using errcode = '42501';
    end if;
    return old;
  end;
  $$;
  revoke all on function private.exact_row_immutable() from public;

  grant select on private.erasure_requests, private.erasure_targets to sheets_erasure_executor;
  grant update (state, deleted_count) on private.erasure_requests to sheets_erasure_executor;
  grant select, insert, delete on private.erasure_capabilities to sheets_erasure_executor;
`;

function protectedTableSql(table) {
  assert(TABLES.includes(table));
  return `
    create table public.${table} (
      id uuid primary key, workspace_id uuid not null, connection_id uuid not null,
      content jsonb not null, created_at timestamptz not null default '2026-01-01T00:00:00Z'
    );
    alter table public.${table} enable row level security;
    alter table public.${table} force row level security;
    create trigger immutable before update or delete on public.${table}
      for each row execute function private.exact_row_immutable();
    grant select, update, delete on public.${table} to authenticated, service_role, sheets_erasure_executor;
    create policy fixture_read on public.${table} for select
      to authenticated, service_role, sheets_erasure_executor using (true);
    -- Adversarial ordinary-role grants ensure the trigger, not a missing grant, denies mutation.
    create policy fixture_ordinary_delete on public.${table} for delete to authenticated using (true);
    create policy fixture_update on public.${table} for update
      to authenticated, sheets_erasure_executor using (true) with check (true);
    create policy executor_exact_delete on public.${table} for delete to sheets_erasure_executor
      using (exists (
        select 1 from private.erasure_capabilities c join private.erasure_requests r on r.id = c.request_id
        where c.transaction_id = pg_catalog.txid_current()
          and c.table_oid = 'public.${table}'::regclass
          and c.row_id = ${table}.id and c.workspace_id = ${table}.workspace_id
          and c.connection_id = ${table}.connection_id
          and r.workspace_id = c.workspace_id and r.connection_id = c.connection_id
          and r.state = 'approved' and r.approved_by = r.owner_id
          and r.approved_hash = r.inventory_hash and c.inventory_hash = r.inventory_hash
      ));
  `;
}

const executionSql = `
  create function private.execute_erasure(p_request_id uuid, p_inventory_hash text)
  returns jsonb language plpgsql security definer set search_path = '' as $$
  declare r private.erasure_requests; t private.erasure_targets; affected integer; total integer := 0;
  begin
    -- Lock before checking state: a second executor observes the committed receipt.
    select * into r from private.erasure_requests where id = p_request_id for update;
    if not found then raise exception 'request_missing' using errcode = '42501'; end if;
    if p_inventory_hash is null or p_inventory_hash <> r.inventory_hash
      or r.approved_hash is distinct from r.inventory_hash
      or r.approved_by is distinct from r.owner_id
      or r.inventory_hash <> private.inventory_hash(r.id) then
      raise exception 'request_approval_denied' using errcode = '42501';
    end if;
    if r.state = 'completed' then
      return pg_catalog.jsonb_build_object('status', 'replayed', 'deleted', r.deleted_count);
    end if;
    if r.state <> 'approved' then raise exception 'request_not_approved' using errcode = '42501'; end if;
    if not exists (select 1 from private.erasure_targets where request_id = r.id) then
      raise exception 'request_empty' using errcode = '42501';
    end if;

    for t in select * from private.erasure_targets where request_id = r.id order by table_oid, row_id loop
      insert into private.erasure_capabilities
        (request_id, table_oid, row_id, workspace_id, connection_id, old_row_hash, inventory_hash, transaction_id)
      values (r.id, t.table_oid, t.row_id, t.workspace_id, t.connection_id, t.old_row_hash,
        r.inventory_hash, pg_catalog.txid_current());
      if t.table_oid = 'public.google_sheets_mapping_approvals'::regclass then
        delete from public.google_sheets_mapping_approvals
          where id = t.row_id and workspace_id = t.workspace_id and connection_id = t.connection_id;
      elsif t.table_oid = 'public.google_sheets_source_versions'::regclass then
        delete from public.google_sheets_source_versions
          where id = t.row_id and workspace_id = t.workspace_id and connection_id = t.connection_id;
      else
        raise exception 'target_table_denied' using errcode = '42501';
      end if;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'exact_target_not_deleted' using errcode = '42501'; end if;
      if exists (select 1 from private.erasure_capabilities where request_id = r.id) then
        raise exception 'capability_not_consumed' using errcode = '42501';
      end if;
      total := total + affected;
    end loop;
    update private.erasure_requests set state = 'completed', deleted_count = total where id = r.id;
    return pg_catalog.jsonb_build_object('status', 'completed', 'deleted', total);
  end;
  $$;
  alter function private.execute_erasure(uuid, text) owner to sheets_erasure_executor;
  revoke all on function private.execute_erasure(uuid, text) from public;
  grant execute on function private.execute_erasure(uuid, text) to sheets_erasure_support;
`;

async function main() {
  const db = new PGlite();
  const check = async (name, action) => { stage = name; await action(); checks++; };
  const deny = async (name, action, pattern = /denied|permission denied/i) => check(name, async () => {
    await assert.rejects(action, error => error.code === '42501' && pattern.test(error.message));
    deniedChecks++;
  });
  const asRole = async (role, action) => {
    assert(['authenticated', 'service_role', SUPPORT, EXECUTOR].includes(role));
    try {
      return await db.transaction(async tx => { await tx.exec(`set local role ${role}`); return action(tx); });
    } finally {
      await db.exec('reset role');
    }
  };
  const seedRow = async (table, options = {}) => {
    assert(TABLES.includes(table));
    const row = { table, id: options.id || randomUUID(), workspace: options.workspace || WORKSPACE,
      connection: options.connection || CONNECTION };
    await db.query(`insert into public.${table} (id, workspace_id, connection_id, content) values ($1, $2, $3, $4)`,
      [row.id, row.workspace, row.connection, { synthetic: true, value: options.value || 'fixture' }]);
    return row;
  };
  const prepare = async (rows, options = {}) => {
    const id = randomUUID();
    await db.query(`insert into private.erasure_requests (id, workspace_id, connection_id, owner_id, state)
      values ($1, $2, $3, $4, 'prepared')`, [id, options.workspace || WORKSPACE, options.connection || CONNECTION, OWNER]);
    for (const row of rows) {
      await db.query(`insert into private.erasure_targets (request_id, table_oid, row_id, workspace_id, connection_id, old_row_hash)
        select $1, $2::regclass::oid, source.id, $3, $4,
          coalesce($5::text, encode(sha256(convert_to(to_jsonb(source)::text, 'UTF8')), 'hex'))
        from public.${row.table} source where source.id = $6`,
      [id, `public.${row.table}`, options.workspace || WORKSPACE, options.connection || CONNECTION,
        row.hash || null, row.id]);
    }
    const { rows: [request] } = await db.query(`update private.erasure_requests r
      set inventory_hash = private.inventory_hash(r.id),
        approved_hash = case when $2 then private.inventory_hash(r.id) else null end,
        approved_by = case when $2 then owner_id else null end,
        state = case when $2 then 'approved' else 'prepared' end
      where id = $1 returning id, inventory_hash`, [id, options.approved !== false]);
    return request;
  };
  const executeOn = async (client, request) => (await client.query(
    'select private.execute_erasure($1, $2) as result', [request.id, request.inventory_hash])).rows[0].result;
  const execute = request => asRole(SUPPORT, tx => executeOn(tx, request));
  const exists = async row => (await db.query(`select count(*)::int as count from public.${row.table} where id = $1`, [row.id])).rows[0].count;
  const capabilities = async () => (await db.query('select count(*)::int as count from private.erasure_capabilities')).rows[0].count;
  const receipt = async request => (await db.query('select state, deleted_count from private.erasure_requests where id = $1', [request.id])).rows[0];
  // Only the superuser fixture harness installs probes. No callable test bypass is created.
  const withCapability = (request, action, txOffset = 0) => db.transaction(async tx => {
    await tx.query(`insert into private.erasure_capabilities
      select t.*, r.inventory_hash, txid_current() + $2 from private.erasure_targets t
      join private.erasure_requests r on r.id = t.request_id where t.request_id = $1`, [request.id, txOffset]);
    await tx.exec(`set local role ${EXECUTOR}`);
    const result = await action(tx);
    await tx.exec('reset role');
    await tx.query('delete from private.erasure_capabilities where request_id = $1', [request.id]);
    return result;
  });

  try {
    await db.exec(schema);
    for (const table of TABLES) await db.exec(protectedTableSql(table));
    await db.exec(executionSql);

    await check('executor ownership, invoker trigger, and request row lock', async () => {
      const { rows: [role] } = await db.query(`select rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
        from pg_roles where rolname = $1`, [EXECUTOR]);
      assert.deepEqual(role, { rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
      const { rows: functions } = await db.query(`select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner,
        p.prosrc, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('exact_row_immutable', 'execute_erasure')`);
      const trigger = functions.find(fn => fn.proname === 'exact_row_immutable');
      const executeFunction = functions.find(fn => fn.proname === 'execute_erasure');
      assert.equal(trigger.prosecdef, false);
      assert.equal(executeFunction.prosecdef, true);
      assert.equal(executeFunction.owner, EXECUTOR);
      assert.match(executeFunction.prosrc, /where id = p_request_id for update/);
      for (const fn of functions) {
        assert.deepEqual(fn.proconfig, ['search_path=""']);
        assert.doesNotMatch(fn.prosrc, /current_setting|set_config|pg_has_role|session_user|execute\s+format/i);
      }
    });

    const approval = await seedRow(TABLES[0]);
    const version = await seedRow(TABLES[1]);
    const request = await prepare([approval, version]);
    for (const role of ['authenticated', 'service_role', SUPPORT]) {
      await check(`${role} has no executor membership or preparation authority`, async () => {
        const { rows: [identity] } = await db.query('select current_user, session_user');
        assert.deepEqual(identity, { current_user: 'postgres', session_user: 'postgres' });
        const { rows: [privileges] } = await db.query(`select pg_has_role($1, $2, 'MEMBER') as member,
          has_table_privilege($1, 'private.erasure_targets', 'INSERT') as targets,
          has_table_privilege($1, 'private.erasure_capabilities', 'INSERT') as capabilities,
          has_table_privilege($1, 'private.erasure_requests', 'UPDATE') as approvals`, [role, EXECUTOR]);
        assert.deepEqual(privileges, { member: false, targets: false, capabilities: false, approvals: false });
      });
      await deny(`${role} cannot assume executor`, async () => {
        // Session authorization changes are confined to a disposable backend.
        const roleDb = new PGlite();
        try {
          await roleDb.exec(`create role ${role} nologin noinherit;
            create role ${EXECUTOR} nologin noinherit nobypassrls;
            set session authorization ${role}`);
          await roleDb.exec(`set role ${EXECUTOR}`);
        } finally {
          await roleDb.close();
        }
      }, /permission denied/);
      for (const privateTable of ['erasure_targets', 'erasure_capabilities', 'erasure_requests']) {
        await deny(`${role} cannot modify ${privateTable}`, () => asRole(role, tx => tx.exec(
          `delete from private.${privateTable}`)), /permission denied/);
      }
      for (const row of [approval, version]) {
        await deny(`${role} direct delete ${row.table}`, () => asRole(role, tx => tx.query(
          `delete from public.${row.table} where id = $1`, [row.id])));
      }
      if (role !== SUPPORT) await deny(`${role} cannot invoke eraser`, () => asRole(role, tx => executeOn(tx, request)));
    }

    for (const row of [approval, version]) {
      for (const role of ['authenticated', 'service_role', EXECUTOR]) {
        await deny(`${role} cannot update ${row.table}`, () => asRole(role, tx => tx.query(
          `update public.${row.table} set content = '{"changed":true}' where id = $1`, [row.id])), /immutable_mutation_denied/);
      }
      await deny(`approved capability cannot authorize UPDATE ${row.table}`, () => withCapability(request, tx => tx.query(
        `update public.${row.table} set content = content where id = $1`, [row.id])), /immutable_mutation_denied/);
    }

    await deny('caller GUCs and forged JWT role cannot authorize deletion', () => asRole('service_role', async tx => {
      await tx.query(`select set_config('request.jwt.claim.role', $1, true),
        set_config('app.erasure_executor', $1, true), set_config('app.erasure_request_id', $2, true),
        set_config('app.erasure_inventory_hash', $3, true)`, [EXECUTOR, request.id, request.inventory_hash]);
      await tx.query(`delete from public.${approval.table} where id = $1`, [approval.id]);
    }), /immutable_mutation_denied/);

    const sibling = await seedRow(TABLES[0]);
    const crossWorkspace = await seedRow(TABLES[0], { workspace: randomUUID() });
    const crossConnection = await seedRow(TABLES[0], { connection: randomUUID() });
    const sameIdOtherTable = await seedRow(TABLES[1], { id: approval.id });
    for (const [name, row] of [['wrong row same connection', sibling], ['cross workspace', crossWorkspace],
      ['wrong connection', crossConnection], ['same UUID wrong table', sameIdOtherTable]]) {
      await check(`exact RLS denies ${name}`, async () => {
        const result = await withCapability(request, tx => tx.query(`delete from public.${row.table} where id = $1 returning id`, [row.id]));
        assert.equal(result.rows.length, 0);
        assert.equal(await exists(row), 1);
        assert.equal(await capabilities(), 0);
      });
    }
    await check('capability from another transaction is inert', async () => {
      const result = await withCapability(request, tx => tx.query(`delete from public.${approval.table} where id = $1 returning id`, [approval.id]), -1);
      assert.equal(result.rows.length, 0);
    });
    await check('executor without capability cannot delete', async () => {
      const result = await asRole(EXECUTOR, tx => tx.query(`delete from public.${approval.table} where id = $1 returning id`, [approval.id]));
      assert.equal(result.rows.length, 0);
    });

    await deny('wrong request approval hash', () => execute({ ...request, inventory_hash: '0'.repeat(64) }), /request_approval_denied/);
    await deny('null request approval hash', () => execute({ ...request, inventory_hash: null }), /request_approval_denied/);
    await deny('missing request', () => execute({ id: randomUUID(), inventory_hash: request.inventory_hash }), /request_missing/);
    const unapproved = await prepare([sibling], { approved: false });
    await deny('request approval missing', () => execute(unapproved), /request_approval_denied/);
    await db.query("update private.erasure_requests set state = 'prepared' where id = $1", [request.id]);
    await deny('hash alone does not replace approved request state', () => execute(request), /request_not_approved/);
    await db.query("update private.erasure_requests set state = 'approved', approved_by = $2 where id = $1", [request.id, randomUUID()]);
    await deny('approval from a different owner', () => execute(request), /request_approval_denied/);
    await db.query('update private.erasure_requests set approved_by = owner_id where id = $1', [request.id]);

    const changedHash = await prepare([{ ...sibling, hash: 'f'.repeat(64) }]);
    await deny('full old row hash mismatch', () => execute(changedHash), /immutable_exact_capability_denied/);
    await check('hash failure leaves row and request untouched', async () => {
      assert.equal(await exists(sibling), 1);
      assert.deepEqual(await receipt(changedHash), { state: 'approved', deleted_count: 0 });
      assert.equal(await capabilities(), 0);
    });
    const mismatchedWorkspace = await prepare([crossWorkspace]);
    await deny('approved inventory cannot cross workspace', () => execute(mismatchedWorkspace), /exact_target_not_deleted/);
    const mismatchedConnection = await prepare([crossConnection]);
    await deny('approved inventory cannot cross connection', () => execute(mismatchedConnection), /exact_target_not_deleted/);

    const staleInventory = await prepare([sibling]);
    await db.query('update private.erasure_targets set old_row_hash = $2 where request_id = $1', [staleInventory.id, 'e'.repeat(64)]);
    await deny('target inventory drift invalidates signed hash', () => execute(staleInventory), /request_approval_denied/);
    await deny('another request cannot borrow an approved hash', () => execute({ ...unapproved, inventory_hash: request.inventory_hash }), /request_approval_denied/);

    const first = await seedRow(TABLES[0], { id: '10000000-0000-4000-8000-000000000001' });
    const second = await seedRow(TABLES[0], { id: '10000000-0000-4000-8000-000000000002' });
    const rollbackRequest = await prepare([first, { ...second, hash: 'd'.repeat(64) }]);
    await deny('later target failure rolls back earlier delete and capability consumption', () => execute(rollbackRequest), /immutable_exact_capability_denied/);
    await check('failed request commits no partial consumption', async () => {
      assert.equal(await exists(first), 1);
      assert.equal(await exists(second), 1);
      assert.equal(await capabilities(), 0);
      assert.deepEqual(await receipt(rollbackRequest), { state: 'approved', deleted_count: 0 });
    });
    await check('outer transaction rollback restores successful deletion and receipt', async () => {
      const abort = new Error('fixture_outer_rollback');
      await assert.rejects(() => asRole(SUPPORT, async tx => {
        assert.deepEqual(await executeOn(tx, request), { status: 'completed', deleted: 2 });
        throw abort;
      }), error => error === abort);
      assert.equal(await exists(approval), 1);
      assert.equal(await exists(version), 1);
      assert.equal(await capabilities(), 0);
      assert.deepEqual(await receipt(request), { state: 'approved', deleted_count: 0 });
    });

    await check('queued same-request calls complete once and replay once', async () => {
      // PGlite serializes a single backend; this is not a multi-session lock contention test.
      const results = await Promise.all([execute(request), execute(request)]);
      assert.deepEqual(results.map(result => result.status).sort(), ['completed', 'replayed']);
      assert(results.every(result => result.deleted === 2));
      assert.equal(await exists(approval), 0);
      assert.equal(await exists(version), 0);
      assert.equal(await exists(sibling), 1);
      assert.equal(await exists(crossWorkspace), 1);
      assert.equal(await exists(crossConnection), 1);
      assert.equal(await exists(sameIdOtherTable), 1);
      assert.equal(await capabilities(), 0);
      assert.deepEqual(await receipt(request), { state: 'completed', deleted_count: 2 });
    });
    await check('replay is content-free and has no fresh capability', async () => {
      assert.deepEqual(await execute(request), { status: 'replayed', deleted: 2 });
      assert.equal(await capabilities(), 0);
    });
    await deny('completed request replay still requires original hash', () => execute({ ...request, inventory_hash: 'a'.repeat(64) }), /request_approval_denied/);
    console.log(JSON.stringify({ suite: 'google_sheets_exact_row_erasure_capability', checks, deniedChecks,
      syntheticRowsDeleted: 2, productionDeletion: false, database: 'ephemeral PGlite',
      concurrency: 'single-backend queued calls; FOR UPDATE contract checked; no multi-session race claim' }));
  } finally {
    await db.close();
  }
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ suite: 'google_sheets_exact_row_erasure_capability', stage, checks,
    code: error.code, message: error.message }));
  process.exitCode = 1;
});
