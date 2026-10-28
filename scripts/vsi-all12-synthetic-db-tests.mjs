// Credential-free regression of the bounded synthetic SQL composition. These
// are in-memory PostgreSQL cases, not hosted Auth/PostgREST or full-schema proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { setupAll12SyntheticDb } from './vsi-all12-synthetic-db.mjs';

async function withoutNetwork(action) {
  const fetch = globalThis.fetch;
  const connect = net.Socket.prototype.connect;
  let attempts = 0;
  const deny = () => { attempts++; throw Error('synthetic_database_network_forbidden'); };
  globalThis.fetch = deny;
  net.Socket.prototype.connect = deny;
  try { await action(); assert.equal(attempts, 0, 'fixture cannot contact a network service'); }
  finally { globalThis.fetch = fetch; net.Socket.prototype.connect = connect; }
}

function denied(code, message) {
  return error => { assert.equal(error.code, code); assert.match(error.message, message); return true; };
}

test('synthetic database preserves current Sheets/session/retention guard boundaries', async t => {
  await withoutNetwork(async () => {
    const s = await setupAll12SyntheticDb({ question: 'Explicitly synthetic local qualification' });
    const { db, w, uuid, owner2, member, memberSession, session, other, admin, login, retentionRoot } = s;
    const identity = { kind: 'sheets_ticket_source', source_id: uuid(302) };
    const read = async () => (await db.query('select public.read_shared_typed_evidence_v1($1,$2) v', [w, JSON.stringify(identity)])).rows[0].v.resolved;
    try {
      assert.equal(s.metadata.fullProductionSchemaAndRls, false);
      assert.equal(s.metadata.fullWorkspaceWriterFenceInstalled, false);
      assert.equal(s.metadata.actualProviderImports, false);
      assert.equal(s.metadata.actualOAuthOrTokens, false);
      assert.equal(s.metadata.pt409BodySha256, '460322cb8730ac1ff72438027771b14b42a8533b0a152836f5ba0443205e82a3');
      await t.test('valid current Sheets projection', async () => {
        assert.equal((await read()).data.metrics.length, 1);
      });
      const sourceDenied = ['42501', /^shared_typed_sheets_denied$/];
      const cases = [
        ['erased retention root', 'update private.google_sheets_retention_roots set erased_at=clock_timestamp() where id=$1', [retentionRoot], sourceDenied],
        ['expired retention root', "update private.google_sheets_retention_roots set expires_at=clock_timestamp()-interval '1 second' where id=$1", [retentionRoot], sourceDenied],
        ['workspace privacy block', 'update private.google_sheets_privacy_epochs set blocked=true where workspace_id=$1', [w], sourceDenied],
        ['deleted distinct approving owner', 'update auth.users set deleted_at=clock_timestamp() where id=$1', [owner2], sourceDenied, true],
        ['banned distinct approving owner', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [owner2], sourceDenied, true],
        ['approval mapping mismatch', "update google_sheets_connections set field_mapping=jsonb_build_object('changed',true) where id=$1", [uuid(300)], sourceDenied],
        ['KPI value mismatch', 'update kpis set actual_value=18 where id=$1', [uuid(304)], ['42501', /^shared_typed_sheets_no_admitted_metrics$/]],
        ['disconnected source', "update google_sheets_connections set status='disconnected' where id=$1", [uuid(300)], sourceDenied],
        ['expired actor session', "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [session], ['42501', /^square_production_customer_owner_denied$/]]
      ];
      for (const [name, sql, args, expected, distinctApprover] of cases) {
        await t.test(name, async () => {
          await admin(db);
          await db.exec('begin');
          try {
            if (distinctApprover) await db.query('update google_sheets_mapping_approvals set approved_by=$1 where id=$2', [owner2, uuid(301)]);
            await db.query(sql, args);
            await login(db);
            await assert.rejects(read, denied(...expected));
          } finally {
            // A rejected SQL statement aborts this transaction. Roll back before
            // attempting RESET ROLE or any other operation.
            await db.exec('rollback');
            await login(db);
          }
          assert.equal((await read()).data.metrics.length, 1, 'rollback restores the valid control');
        });
      }
      await t.test('wrong actor cannot bind another owner ticket', async () => {
        await assert.rejects(s.bindTicketRoots(db, uuid(101), [{ table: 'kpis', id: uuid(304) }], { actor: member, sid: memberSession }), denied('42501', /^google_sheets_read_denied$/));
      });
      await t.test('missing source cannot be bound', async () => {
        await assert.rejects(s.bindTicketRoots(db, uuid(101), [{ table: 'kpis', id: uuid(9999) }]), denied('40001', /^google_sheets_read_source_changed$/));
      });
      await t.test('actual binding RPC retains exact current source roots', async () => {
        const result = await s.bindTicketRoots(db, uuid(101), [{ table: 'kpis', id: uuid(304) }]);
        assert.equal(result.ticketId, uuid(101));
        assert.deepEqual(result.connectionIds, [uuid(300)]);
        await admin(db);
        const ticket = (await db.query('select sources from private.google_sheets_read_tickets where id=$1', [uuid(101)])).rows[0];
        assert.deepEqual(ticket.sources, [{ table: 'kpis', id: uuid(304) }]);
        await login(db);
      });
      await t.test('another workspace cannot read the selected source', async () => {
        await login(db);
        await assert.rejects(db.query('select public.read_shared_typed_evidence_v1($1,$2)', [other, JSON.stringify(identity)]), denied('42501', /^square_production_customer_owner_denied$/));
      });
    } finally { await db.close(); }
  });
});

test('PT409 rejects an unissued typed identity once without source, artifact or accounting writes', async () => {
  await withoutNetwork(async () => {
    const s = await setupAll12SyntheticDb();
    const { db, w, uuid, admin, login } = s;
    const snapshot = async () => {
      await admin(db);
      const records = {};
      for (const table of ['private.shared_evidence_manifests', 'private.shared_evidence_manifest_sources',
        'private.shared_evidence_commit_claims', 'private.shared_evidence_artifact_manifests',
        'private.shared_memory_semantic_receipts', 'public.vsi_requests', 'public.vsi_exchanges', 'public.vsi_cost_events',
        'public.google_sheets_connections', 'public.google_sheets_source_rows', 'public.google_sheets_source_versions', 'public.kpis']) {
        records[table] = (await db.query(`select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) v from (select to_jsonb(t) v from ${table} t) rows`)).rows[0].v;
      }
      return records;
    };
    try {
      const resolved = (await db.query('select public.read_shared_typed_evidence_v1($1,$2) v', [w, JSON.stringify({ kind: 'sheets_ticket_source', source_id: uuid(302) })])).rows[0].v.resolved;
      await s.bindTicketRoots(db, uuid(101), resolved.data.read_sources);
      const before = await snapshot();
      await login(db);
      let attempts = 0;
      await assert.rejects(async () => {
        attempts++;
        return db.query("select public.seal_shared_evidence_manifest_v1($1,'vsi_request',$2,1,$3,$4,'{}'::uuid[]) v", [w, uuid(103), uuid(101), JSON.stringify([{ ...resolved.identity, authority_hash: 'f'.repeat(64) }])]);
      }, denied('PT409', /^shared_typed_identity_changed$/));
      assert.equal(attempts, 1, 'no retry loop is part of this local test');
      assert.deepEqual(await snapshot(), before);
      await login(db);
      const valid = (await db.query("select public.seal_shared_evidence_manifest_v1($1,'vsi_request',$2,1,$3,$4,'{}'::uuid[]) v", [w, uuid(103), uuid(101), JSON.stringify([resolved.identity])])).rows[0].v;
      assert.equal(valid.stage, 'database_bound');
      assert.equal(valid.projections[0].hash, resolved.hash);
    } finally { await db.close(); }
  });
});
