/* eslint-disable @typescript-eslint/no-require-imports -- Isolated embedded PostgreSQL audit; no network or live data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { qualify } = require('./google-sheets-data-tests.cjs');

async function main() {
  const db = new PGlite();
  const results = [];
  try {
    const baseline = await qualify(db);
    const connection = (await db.query(`select c.* from public.google_sheets_connections c
      where exists(select 1 from public.google_sheets_source_rows s where s.connection_id=c.id)
      order by c.id limit 1`)).rows[0];
    assert(connection);
    const before = async () => (await db.query(`select jsonb_build_object(
      'approvals',(select count(*) from public.google_sheets_mapping_approvals where connection_id=$1),
      'versions',(select count(*) from public.google_sheets_source_versions where connection_id=$1),
      'sources',(select count(*) from public.google_sheets_source_rows where connection_id=$1),
      'links',(select count(*) from public.google_sheets_fact_links where connection_id=$1)) counts`, [connection.id])).rows[0].counts;
    const snapshot = await before();
    assert(snapshot.approvals > 0 && snapshot.versions > 0 && snapshot.links > 0);
    const denied = async (role, sql, params, code, label) => {
      await db.exec('begin');
      try {
        if (role) await db.exec(`set local role ${role}`);
        await assert.rejects(() => db.query(sql, params), error => error.code === code, label);
        results.push({ check: label, result: 'denied', code });
      } finally {
        await db.exec('rollback');
      }
    };
    for (const role of ['service_role', null]) {
      const label = role || 'database_owner';
      await denied(role, 'delete from public.google_sheets_source_versions where connection_id=$1', [connection.id], '42501', label + '_source_version_delete');
      await denied(role, 'delete from public.google_sheets_mapping_approvals where connection_id=$1', [connection.id], '42501', label + '_approval_delete');
    }
    await denied(null, 'delete from public.google_sheets_connections where id=$1', [connection.id], '23503', 'connection_delete_with_history');
    await denied(null, 'delete from public.kpis where id=(select kpi_id from public.google_sheets_fact_links where connection_id=$1 limit 1)', [connection.id], '23503', 'linked_kpi_delete');
    await denied(null, 'delete from public.profiles where id=$1', [connection.created_by], '23503', 'creator_profile_delete_with_history');
    assert.deepEqual(await before(), snapshot);
    results.push({ check: 'failed_deletes_preserve_import_history', result: 'pass' });

    // This is the existing retirement contract, not erasure or a proposed bypass.
    await db.exec('begin');
    try {
      await db.query("update public.google_sheets_connections set status='disconnected' where id=$1", [connection.id]);
      assert.deepEqual(await before(), snapshot);
      assert.equal((await db.query("select count(*)::int n from public.google_sheets_fact_links where connection_id=$1 and admission_state<>'retired'", [connection.id])).rows[0].n, 0);
      assert.equal((await db.query('select count(*)::int n from public.google_sheets_source_rows where connection_id=$1 and current', [connection.id])).rows[0].n, 0);
      results.push({ check: 'disconnect_retirement_preserves_source_values_and_history', result: 'pass' });
    } finally {
      await db.exec('rollback');
    }

    // Execute the actual saved-analysis deletion function against a minimal synthetic table.
    await db.exec(`create table public.reports(id uuid primary key,workspace_id uuid,
      archived_at timestamptz,deleted_at timestamptz,source_data_json jsonb,body_markdown text);
      create function public.can_manage_workspace(uuid) returns boolean language sql
      as $$ select public.is_workspace_member($1) $$;
      grant select,update on public.reports to authenticated;`);
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260817185529_intelligence_briefing_storage_contract.sql'), 'utf8');
    const start = migration.indexOf('create or replace function public.soft_delete_saved_analyses(');
    const end = migration.indexOf('\n$$;', start);
    assert(start >= 0 && end > start);
    await db.exec(migration.slice(start, end + 4));
    const reportId = randomUUID();
    const envelope = { record_kind:'saved_analysis',envelope_version:'1',analysis_type:'weekly_briefing',
      saved_analysis_key:'synthetic-retention-audit',workspace_id:connection.workspace_id,
      release_channel:'production',artifact:{syntheticGoogleDerivedMetric:123} };
    await db.query('insert into public.reports(id,workspace_id,source_data_json,body_markdown) values($1,$2,$3,$4)',
      [reportId, connection.workspace_id, envelope, 'Synthetic Google-derived analysis']);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [connection.created_by]);
    await db.exec('set role authenticated');
    try {
      assert.equal((await db.query("select public.soft_delete_saved_analyses($1,$2,'production') n", [connection.workspace_id, [reportId]])).rows[0].n, 1);
    } finally {
      await db.exec('reset role');
    }
    const report = (await db.query('select * from public.reports where id=$1', [reportId])).rows[0];
    assert(report.deleted_at);
    assert.deepEqual(report.source_data_json, envelope);
    assert.equal(report.body_markdown, 'Synthetic Google-derived analysis');
    results.push({ check: 'saved_analysis_delete_is_soft_and_retains_payload', result: 'pass' });
    console.log(JSON.stringify({ suite:'google_sheets_retention_audit',baselineChecks:baseline.checks,
      retentionChecks:results.length,results,liveDatabaseMutations:0,liveProviderCalls:0,
      fullCanonicalBootstrap:false,erasureImplemented:false }));
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error({ suite:'google_sheets_retention_audit',code:error.code || 'assertion_failed',message:error.message });
  process.exitCode = 1;
});
