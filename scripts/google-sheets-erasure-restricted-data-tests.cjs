/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic database qualification, no remote connections. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { qualify } = require('./google-sheets-data-tests.cjs');
const { normalizeSheetsRows } = require('../lib/integrations/google-sheets/ingestion.ts');
const migration = '20261012191836_google_sheets_restricted_erasure_retention.sql';
const mapping = { rowKeyColumn: 0, dateColumn: 1, dateFormat: 'iso', locationColumn: null,
  metrics: [{ column: 2, name: 'Synthetic erasure orders', category: 'Operations', unit: 'count', target: 100 }] };
const headers = ['Record ID', 'Date', 'Orders'];

async function setupRestricted(db) {
  const baseline = await qualify(db);
  await db.exec(`
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
    create table public.ai_agent_runs(id uuid primary key default gen_random_uuid(),workspace_id uuid,agent_type text,input_json jsonb default '{}',output_json jsonb default '{}',status text,created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz,deleted_at timestamptz);
    create table public.reports(id uuid primary key default gen_random_uuid(),workspace_id uuid,title text,body_markdown text,source_data_json jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz,deleted_at timestamptz);
    create table public.business_health_snapshots(id uuid primary key default gen_random_uuid(),workspace_id uuid,source_summary jsonb default '{}',score numeric,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.business_notes(id uuid primary key default gen_random_uuid(),workspace_id uuid,original_note_text text,created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz,deleted_at timestamptz);
    create table public.business_memory_chunks(id uuid primary key default gen_random_uuid(),workspace_id uuid,source_id uuid,source_type text,source_excerpt text,source_metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),archived_at timestamptz,deleted_at timestamptz);
    create table public.vsi_conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid,actor_user_id uuid,title text,context_summary text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.vsi_requests(id uuid primary key default gen_random_uuid(),workspace_id uuid,conversation_id uuid references public.vsi_conversations(id) on delete set null,question_hash text not null,cost_usd numeric default 0,status text);
    create table public.vsi_exchanges(id uuid primary key default gen_random_uuid(),workspace_id uuid,actor_user_id uuid,conversation_id uuid references public.vsi_conversations(id) on delete cascade,answer text,citations jsonb default '[]',saved_note_id uuid references public.business_notes(id) on delete set null,created_at timestamptz default now());
    create table public.kpi_settings(id uuid primary key default gen_random_uuid(),workspace_id uuid,kpi_name text,classification_source text);
    create table public.intelligence_card_lifecycle(id uuid primary key default gen_random_uuid(),workspace_id uuid,card_snapshot_json jsonb default '{}');
    create table public.intelligence_card_lifecycle_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,lifecycle_id uuid references public.intelligence_card_lifecycle(id),card_snapshot_json jsonb default '{}');
    create table public.fixture_report_children(id uuid primary key default gen_random_uuid(),workspace_id uuid,report_id uuid references public.reports(id) on delete set null);
    create table public.business_decisions(id uuid primary key default gen_random_uuid(),workspace_id uuid,title text,related_kpi text);
    alter table public.file_uploads add column storage_bucket text,add column storage_path text,add column analysis_prompt text,add column analysis_summary text,add column metadata_json jsonb default '{}',add column processing_status text,add column processing_error text,add column processed_at timestamptz,add column storage_purged_at timestamptz,add column storage_missing_at timestamptz,add column storage_purge_requested_at timestamptz,add column storage_purge_attempted_at timestamptz;
    create schema storage;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create table public.file_processing_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,file_upload_id uuid,job_type text,result_json jsonb default '{}');
    create function public.publish_confirmed_file_memory_v1(p_workspace_id uuid,p_file_upload_id uuid,p_analysis_run_id uuid,p_confirmed_by uuid,p_chunks jsonb,p_summary text,p_review_note text) returns jsonb language plpgsql security invoker set search_path='' as $$
    begin
  if auth.uid() is distinct from p_confirmed_by or not public.is_workspace_member(p_workspace_id) then raise exception 'publication_denied'; end if;
      insert into public.business_memory_chunks(workspace_id,source_id,source_type,source_excerpt,source_metadata) select p_workspace_id,p_file_upload_id,'file',x->>'source_excerpt',x->'source_metadata' from jsonb_array_elements(p_chunks) x;
      update public.file_uploads set metadata_json=metadata_json||jsonb_build_object('business_memory',jsonb_build_object('summary',p_summary)) where id=p_file_upload_id and workspace_id=p_workspace_id;
      insert into public.file_processing_jobs(workspace_id,file_upload_id,job_type,result_json) values(p_workspace_id,p_file_upload_id,'index',jsonb_build_object('summary',p_summary));
      return jsonb_build_object('ok',true);
    end $$;
    grant select,insert,update on public.file_uploads,public.business_memory_chunks,public.file_processing_jobs to authenticated;
    create function public.vsi_mutate_v1(p_workspace_id uuid,p_actor_user_id uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer as $$
    declare v_id uuid; begin
      if auth.role()<>'service_role' then raise exception 'vsi_server_only'; end if;
      if p_action='create' then insert into public.vsi_conversations(workspace_id,actor_user_id,title,context_summary) values(p_workspace_id,p_actor_user_id,p_input->>'title','') returning id into v_id;
      elsif p_action='rename' then update public.vsi_conversations set title=p_input->>'title' where workspace_id=p_workspace_id and id=(p_input->>'conversationId')::uuid returning id into v_id;
      else raise exception 'fixture_unsupported_vsi_operation'; end if;
      return jsonb_build_object('id',v_id);
    end $$;
    grant all on public.ai_agent_runs,public.reports,public.business_health_snapshots,public.business_notes,public.business_memory_chunks,public.vsi_conversations,public.vsi_exchanges,public.kpi_settings,public.business_decisions to service_role;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261002225025_google_sheets_support_erasure.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', migration), 'utf8'));

  async function seed() {
    const workspace = randomUUID(), connection = randomUUID(), entity = randomUUID(), owner = randomUUID(), session = randomUUID(), request = randomUUID();
    const spreadsheet = 'synthetic_erasure_' + randomUUID().replaceAll('-', '');
    await db.query('insert into public.workspaces(id) values($1)', [workspace]);
    await db.query("insert into public.customer_subscriptions(workspace_id,billing_provider,manually_activated,status) values($1,'manual',true,'active')", [workspace]);
    await db.query('insert into public.profiles(id) values($1)', [owner]);
    await db.query('insert into auth.users(id) values($1)', [owner]);
    await db.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 day')", [session, owner]);
    await db.query("insert into public.workspace_members values($1,$2,'owner','active')", [workspace, owner]);
    await db.query("insert into public.business_entities values($1,$2,'active','Synthetic erasure entity')", [entity, workspace]);
    await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers) values($1,$2,$3,$4,'connected','Synthetic erasure',$5,0,'Metrics',$6)", [connection, workspace, entity, owner, spreadsheet, JSON.stringify(headers)]);
    const as = async (role, action, adapter = db) => {
      await adapter.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false),set_config('request.jwt.claims',$3,false)", [role, owner, JSON.stringify({ sub: owner, session_id: session })]);
      await adapter.exec(`set role ${role}`);
      try { return await action(adapter); } finally { await adapter.exec('reset role'); }
    };
    const call = (name, args, role = 'service_role', adapter = db) => as(role, async client => (await client.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result, adapter);
    const approval = await call('public.approve_google_sheets_mapping_v1', [workspace, connection, owner, session, JSON.stringify(mapping), true, true]);
    const claimed = await call('public.claim_google_sheets_sync_v1', [workspace, connection, owner, session, 'manual']);
    const rows = normalizeSheetsRows({ workspaceId: workspace, businessEntityId: entity, connectionId: connection, spreadsheetId: spreadsheet,
      sheetId: 0, headerRow: 1, mapping, rows: [['fixture-row', '2026-10-01', 42]] });
    await call('public.commit_google_sheets_sync_v1', [workspace, connection, claimed.runId, JSON.stringify(rows), true]);
    const kpi = (await db.query('select kpi_id from public.google_sheets_fact_links where connection_id=$1', [connection])).rows[0].kpi_id;
    const source = (await db.query('select id from public.google_sheets_source_rows where connection_id=$1', [connection])).rows[0].id;
    const beginReader = async (adapter = db, sources = [{ table: 'kpis', id: kpi }]) => {
      const ticket = await call('public.begin_google_sheets_read_v1', [workspace, owner], 'service_role', adapter);
      await call('public.bind_google_sheets_read_v1', [ticket.ticketId, JSON.stringify(sources)], 'service_role', adapter);
      return ticket;
    };
    const writeDerivative = async (adapter, ticket, id = randomUUID()) => as('service_role', client => client.query(
      'insert into public.reports(id,workspace_id,title,body_markdown,google_sheets_read_ticket_id) values($1,$2,$3,$4,$5)',
      [id, workspace, 'Synthetic derived report', '42 synthetic orders', ticket.ticketId]), adapter);
    const ticket = await beginReader();
    const report = randomUUID();
    await writeDerivative(db, ticket, report);
    const file = randomUUID();
    await db.query("insert into public.file_uploads(id,workspace_id,storage_bucket,storage_path,metadata_json) values($1,$2,'files','original-unrelated.pdf','{\"original_filename\":\"unrelated.pdf\",\"import_rows\":8}')", [file,workspace]);
    await db.query("update public.file_uploads set analysis_prompt='Explain 42 Google orders',analysis_summary='42 synthetic orders',metadata_json=metadata_json||'{\"latest_analysis_output\":{\"value\":42},\"analysis_review_note\":\"42 orders\"}',google_sheets_read_ticket_id=$2 where id=$1", [file,ticket.ticketId]);
    const conversation = randomUUID(), chatRequest = randomUUID();
    await db.query('insert into public.vsi_conversations(id,workspace_id,actor_user_id,title,context_summary,google_sheets_read_ticket_id) values($1,$2,$3,$4,$5,$6)',[conversation,workspace,owner,'Synthetic Google-derived chat','42 orders',ticket.ticketId]);
    await db.query("insert into public.vsi_requests(id,workspace_id,conversation_id,question_hash,cost_usd,status) values($1,$2,$3,$4,0.125,'completed')",[chatRequest,workspace,conversation,'f'.repeat(64)]);
    await db.query('insert into public.vsi_exchanges(id,workspace_id,actor_user_id,conversation_id,answer,google_sheets_read_ticket_id) values($1,$2,$3,$4,$5,$6)',[chatRequest,workspace,owner,conversation,'42 orders',ticket.ticketId]);
    const unrelated = randomUUID(), otherWorkspace = randomUUID(), otherRecord = randomUUID();
    const empty = await beginReader(db, []);
    await as('service_role', client => client.query('insert into public.reports(id,workspace_id,title,google_sheets_read_ticket_id) values($1,$2,$3,$4)', [unrelated, workspace, 'Unrelated Square/QBO summary', empty.ticketId]));
    await db.query('insert into public.workspaces(id) values($1)', [otherWorkspace]);
    await db.query("insert into public.reports(id,workspace_id,title) values($1,$2,'Other tenant report')", [otherRecord, otherWorkspace]);
    await call('public.google_sheets_lifecycle_v1', ['disconnect', workspace, connection, owner, session, '{}']);
    const artifacts = [];
    const prepare = () => call('private.prepare_google_sheets_erasure_v1', [request, workspace, connection, randomUUID(), JSON.stringify(artifacts), true], 'google_sheets_erasure_support');
    const approve = async (id, scope) => {
      const review = await call('public.read_google_sheets_erasure_request_v1', [id], 'authenticated');
      const deletions = review.artifacts.filter(item => item.action === 'delete').map(({ table, id, hash }) => ({ table, id, hash }));
      return call('public.confirm_google_sheets_erasure_request_v1', [id, scope, JSON.stringify(deletions)], 'authenticated');
    };
    const assertPreserved = async (adapter = db) => {
      assert.equal((await adapter.query('select count(*)::int n from public.reports where id in ($1,$2)', [unrelated, otherRecord])).rows[0].n, 2);
      const preservedLedger = (await adapter.query('select question_hash,conversation_id,cost_usd,status from public.vsi_requests where id=$1',[chatRequest])).rows[0];
      assert.deepEqual(preservedLedger,{question_hash:'',conversation_id:null,cost_usd:'0.125',status:'completed'});
      const preservedFile = (await adapter.query('select analysis_prompt,analysis_summary,metadata_json,storage_path from public.file_uploads where id=$1',[file])).rows[0];
      assert.deepEqual(preservedFile,{analysis_prompt:null,analysis_summary:null,metadata_json:{original_filename:'unrelated.pdf',import_rows:8},storage_path:'original-unrelated.pdf'});
      assert.equal((await adapter.query('select count(*)::int n from public.business_entities where id=$1', [entity])).rows[0].n, 1);
    };
    return { workspace, connection, entity, owner, session, request, approval, source, kpi, report, unrelated, otherWorkspace, otherRecord,
      spreadsheet, rowKey: rows[0].rowKey, file, conversation, chatRequest, artifacts, as, call, prepare, approve, assertPreserved, beginReader, writeDerivative };
  }
  return { baseline, seed };
}

async function qualifyRestricted(db) {
  const fixture = await setupRestricted(db);
  const f = await fixture.seed(); let checks = 0;
  await db.exec(`alter table public.reports enable row level security; alter table public.file_uploads enable row level security; alter table public.kpis enable row level security;
    grant select on public.reports,public.file_uploads,public.kpis to authenticated;
    create policy fixture_reports_member on public.reports for select to authenticated using (public.is_workspace_member(workspace_id));
    create policy fixture_files_member on public.file_uploads for select to authenticated using (public.is_workspace_member(workspace_id));
    create policy fixture_kpis_member on public.kpis for select to authenticated using (public.is_workspace_member(workspace_id));`);
  const deny = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
  const stale = await f.beginReader();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await deny(() => f.call('private.prepare_google_sheets_erasure_v1', [f.request, f.workspace, f.connection, randomUUID(), '[]', true], role), /permission denied/);
  }
  const prepared = await f.prepare(); checks++;
  await deny(() => f.call('private.get_google_sheets_erasure_execution_v1', [f.request, prepared.scopeHash], 'google_sheets_erasure_support'), /approval_required/);
  await deny(() => f.beginReader(), /privacy_paused/);
  await deny(() => f.writeDerivative(db, stale), /privacy_paused/);
  await f.approve(f.request, prepared.scopeHash); checks++;
  const manifest = await f.call('private.get_google_sheets_erasure_execution_v1', [f.request, prepared.scopeHash], 'google_sheets_erasure_support');
  assert(manifest.targets.some(target => target.id === f.report)); assert(!manifest.targets.some(target => target.id === f.unrelated)); checks += 2;
  await deny(() => f.call('private.execute_google_sheets_erasure_v1', [f.request, prepared.scopeHash, 'bad'], 'google_sheets_erasure_support'), /journal_required/);
  const finished = await f.call('private.execute_google_sheets_erasure_v1', [f.request, prepared.scopeHash, 'a'.repeat(64)], 'google_sheets_erasure_support');
  assert.equal(finished.state, 'completed'); checks++;
  await f.assertPreserved(); checks++;
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_connections where id=$1', [f.connection])).rows[0].n, 0); checks++;
  await deny(() => f.writeDerivative(db, stale), /ticket_stale/);
  const repeated = await f.call('private.execute_google_sheets_erasure_v1', [f.request, prepared.scopeHash, 'a'.repeat(64)], 'google_sheets_erasure_support');
  assert.deepEqual(repeated, finished); checks++;
  await deny(() => db.exec('delete from public.google_sheets_source_versions'), /immutable/);
  await deny(() => f.call('private.replay_google_sheets_erasure_v1',[f.request,prepared.scopeHash,JSON.stringify(manifest),'a'.repeat(64)],'google_sheets_erasure_support'), /permission denied/);
  const replay = await f.call('private.replay_google_sheets_erasure_v1', [f.request, prepared.scopeHash, JSON.stringify(manifest), 'a'.repeat(64)], 'google_sheets_erasure_restore');
  assert.equal(replay.remaining, 0); checks++;
  assert.equal((await db.query('select blocked from private.google_sheets_privacy_epochs where workspace_id=$1', [f.workspace])).rows[0].blocked, true); checks++;
  await f.call('private.finish_google_sheets_restore_v1',[JSON.stringify([manifest]),'b'.repeat(64)],'google_sheets_erasure_restore');
  await f.beginReader(db,[]); checks++;
  await deny(() => f.writeDerivative(db,stale),/ticket_stale/);
  const expiry = await fixture.seed();
  const root = (await db.query('select r.* from private.google_sheets_retention_roots r join private.google_sheets_source_root_links l on l.root_id=r.id where l.source_row_id=$1',[expiry.source])).rows[0];
  assert.equal(root.automatic_expiry_authorized,true); checks++;
  const first = root.first_imported_at, deadline = root.expires_at;
  await db.query('select private.google_sheets_register_retention_v1($1,$2,$3,$4,$5,true)',[expiry.workspace,expiry.connection,expiry.source,JSON.stringify({rowKey:expiry.rowKey}),new Date(Date.now()+86400000).toISOString()]);
  const unchangedRoot=(await db.query('select first_imported_at,expires_at from private.google_sheets_retention_roots where id=$1',[root.id])).rows[0];
  assert.deepEqual(unchangedRoot,{first_imported_at:first,expires_at:deadline}); checks++;
  const disconnected=(await db.query('select disconnected_at from public.google_sheets_connections where id=$1',[expiry.connection])).rows[0].disconnected_at;
  assert.equal(new Date(deadline).getTime()-new Date(disconnected).getTime(),30*86400000); checks++;
  const calendarRoot=(await db.query('select private.google_sheets_register_retention_v1($1,$2,$3,$4,$5,true) id',[expiry.workspace,expiry.connection,randomUUID(),JSON.stringify({rowKey:'calendar-only'}),'2024-01-31T00:00:00Z'])).rows[0].id;
  const calendar=(await db.query('select expires_at,automatic_expiry_authorized from private.google_sheets_retention_roots where id=$1',[calendarRoot])).rows[0];
  assert.equal(new Date(calendar.expires_at).toISOString(),'2025-02-28T00:00:00.000Z'); assert.equal(calendar.automatic_expiry_authorized,false); checks+=2;
  await deny(()=>expiry.call('private.prepare_google_sheets_retention_v1',[randomUUID(),expiry.workspace,expiry.connection,randomUUID(),[calendarRoot]],'google_sheets_erasure_support'),/retention_not_authorized/);
  assert.equal((await expiry.as('authenticated',client=>client.query('select count(*)::int n from public.reports where id=$1',[expiry.report]))).rows[0].n,1);checks++;
  const priorTicket=await expiry.beginReader();
  await db.query("update private.google_sheets_retention_roots set expires_at=clock_timestamp()-interval '1 second' where id=$1",[root.id]);
  for(const [table,id] of [['reports',expiry.report],['kpis',expiry.kpi],['file_uploads',expiry.file]]) {
    assert.equal((await expiry.as('authenticated',client=>client.query(`select count(*)::int n from public.${table} where id=$1`,[id]))).rows[0].n,0);checks++;
  }
  assert.equal((await expiry.as('authenticated',client=>client.query('select count(*)::int n from public.reports where id=$1',[expiry.unrelated]))).rows[0].n,1);checks++;
  await deny(()=>expiry.beginReader(),/source_expired/);
  await deny(()=>expiry.writeDerivative(db,priorTicket),/source_expired/);
  await deny(()=>db.query('select private.google_sheets_register_retention_v1($1,$2,$3,$4,clock_timestamp(),false)',[expiry.workspace,expiry.connection,randomUUID(),JSON.stringify({rowKey:expiry.rowKey})]),/source_expired/);
  const retentionId=randomUUID();
  const due=await expiry.call('private.prepare_google_sheets_retention_v1',[retentionId,expiry.workspace,expiry.connection,randomUUID(),[root.id]],'google_sheets_erasure_support');
  const dueManifest=await expiry.call('private.get_google_sheets_erasure_execution_v1',[retentionId,due.scopeHash],'google_sheets_erasure_support');
  assert(dueManifest.targets.some(t=>t.table==='file_upload_analysis'&&t.id===expiry.file));checks++;
  const dueResult=await expiry.call('private.execute_google_sheets_erasure_v1',[retentionId,due.scopeHash,'c'.repeat(64)],'google_sheets_erasure_support');
  assert.equal(dueResult.state,'completed');checks++;
  await expiry.assertPreserved();checks++;
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_source_rows where id=$1',[expiry.source])).rows[0].n,0);checks++;
  assert.equal((await expiry.as('authenticated',client=>client.query('select count(*)::int n from public.file_uploads where id=$1',[expiry.file]))).rows[0].n,1);checks++;
  // Hash drift must fail before any of the prepared rows are mutated.
  const drift=await fixture.seed(); const driftPrepared=await drift.prepare();await drift.approve(drift.request,driftPrepared.scopeHash);
  await db.query("update public.google_sheets_source_rows set current=not current where id=$1",[drift.source]);
  await deny(()=>drift.call('private.execute_google_sheets_erasure_v1',[drift.request,driftPrepared.scopeHash,'d'.repeat(64)],'google_sheets_erasure_support'),/scope_changed/);
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_source_rows where id=$1',[drift.source])).rows[0].n,1);checks++;
  const cascade=await fixture.seed();
  const child=randomUUID();await db.query('insert into public.fixture_report_children(id,workspace_id,report_id) values($1,$2,$3)',[child,cascade.workspace,cascade.report]);
  const cascadePrepared=await cascade.prepare();await cascade.approve(cascade.request,cascadePrepared.scopeHash);
  await deny(()=>cascade.call('private.execute_google_sheets_erasure_v1',[cascade.request,cascadePrepared.scopeHash,'e'.repeat(64)],'google_sheets_erasure_support'),/unlisted_cascade/);
  assert.equal((await db.query('select report_id from public.fixture_report_children where id=$1',[child])).rows[0].report_id,cascade.report);checks++;
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_source_rows where id=$1',[cascade.source])).rows[0].n,1);checks++;
  const noConsent=await fixture.seed();
  await db.query('delete from private.google_sheets_retention_consents where approval_id=$1',[noConsent.approval]);
  await deny(()=>noConsent.call('public.claim_google_sheets_sync_v1',[noConsent.workspace,noConsent.connection,noConsent.owner,noConsent.session,'manual']),/retention_consent_required/);
  // Publication must use the fresh originating ticket even when an older file
  // analysis ticket has expired; all nested copies inherit the same source.
  const publication=await fixture.seed();
  const oldFileTicket=(await db.query('select google_sheets_read_ticket_id id from public.file_uploads where id=$1',[publication.file])).rows[0].id;
  await db.query("update private.google_sheets_read_tickets set expires_at=clock_timestamp()-interval '1 second' where id=$1",[oldFileTicket]);
  await db.query("update public.file_uploads set processing_status='complete' where id=$1",[publication.file]);checks++;
  await deny(()=>db.query("update public.file_uploads set analysis_summary='late result' where id=$1",[publication.file]),/ticket_stale/);
  const fresh=await publication.beginReader();
  await publication.call('public.publish_confirmed_file_memory_v1',[publication.workspace,publication.file,randomUUID(),publication.owner,JSON.stringify([{source_excerpt:'42 orders',source_metadata:{google_sheets_read_ticket_id:fresh.ticketId}}]),'42 orders','Reviewed'],'authenticated');
  const publicationLinks=(await db.query("select count(distinct table_name)::int n from private.google_sheets_derivation_roots where workspace_id=$1 and table_name in ('file_processing_jobs','business_memory_chunks')",[publication.workspace])).rows[0].n;
  assert.equal(publicationLinks,2);checks++;
  const rawFile=randomUUID(),manualSetting=randomUUID();
  await db.query("insert into public.file_uploads(id,workspace_id,metadata_json) values($1,$2,'{}')",[rawFile,publication.workspace]);
  await db.query("insert into public.kpi_settings(id,workspace_id,kpi_name,classification_source) values($1,$2,'Manual target','manual')",[manualSetting,publication.workspace]);
  const ordinary=await publication.beginReader(db,[{table:'file_uploads',id:rawFile},{table:'kpi_settings',id:manualSetting}]);
  assert.equal((await publication.call('public.get_google_sheets_read_context_v1',[ordinary.ticketId])).hasUnattributedDerivedSources,false);checks++;
  // Connection names/configuration are Google-derived context even before the
  // first row import. Their metadata and copied report have a real expiry.
  const metadataConnection=randomUUID(),metadataReport=randomUUID();
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name) values($1,$2,$3,$4,'connected','Metadata only fixture')",[metadataConnection,publication.workspace,publication.entity,publication.owner]);
  const metaTicket=await publication.beginReader(db,[{table:'google_sheets_connections',id:metadataConnection}]);
  const metaContext=await publication.call('public.get_google_sheets_read_context_v1',[metaTicket.ticketId]);
  assert.equal(metaContext.containsGoogleSheets,true);assert(metaContext.connectionIds.includes(metadataConnection));checks+=2;
  await publication.writeDerivative(db,metaTicket,metadataReport);
  await publication.call('public.google_sheets_lifecycle_v1',['disconnect',publication.workspace,metadataConnection,publication.owner,publication.session,'{}']);
  await db.query("update public.google_sheets_connections set disconnected_at=clock_timestamp()-interval '31 days' where id=$1",[metadataConnection]);
  assert.equal((await publication.as('authenticated',client=>client.query('select count(*)::int n from public.google_sheets_connections where id=$1',[metadataConnection]))).rows[0].n,0);checks++;
  assert.equal((await publication.as('authenticated',client=>client.query('select count(*)::int n from public.reports where id=$1',[metadataReport]))).rows[0].n,0);checks++;
  const metadataDue=await publication.call('private.due_google_sheets_disconnected_expiry_v1',[100],'google_sheets_erasure_support');
  assert(metadataDue.some(item=>item.connectionId===metadataConnection&&!item.manualReviewRequired));checks++;
  const metaRequest=randomUUID();const metaPrepared=await publication.call('private.prepare_google_sheets_disconnected_expiry_v1',[metaRequest,publication.workspace,metadataConnection,randomUUID()],'google_sheets_erasure_support');
  const metaManifest=await publication.call('private.get_google_sheets_erasure_execution_v1',[metaRequest,metaPrepared.scopeHash],'google_sheets_erasure_support');
  assert(metaManifest.targets.some(t=>t.table==='google_sheets_retention_boundary'));checks++;
  await publication.call('private.execute_google_sheets_erasure_v1',[metaRequest,metaPrepared.scopeHash,'1'.repeat(64)],'google_sheets_erasure_support');
  assert.equal((await db.query('select count(*)::int n from public.google_sheets_connections where id=$1',[metadataConnection])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[publication.owner])).rows[0].n,1);checks+=2;
  // Recovery preserves records and retains the barrier until the independently
  // witnessed withdrawal is finalized; new scope requires new owner approval.
  const withdrawn=await drift.call('private.withdraw_google_sheets_erasure_v1',[drift.request,driftPrepared.scopeHash,'2'.repeat(64),'scope_changed'],'google_sheets_erasure_support');
  assert.equal(withdrawn.state,'withdrawn');checks++;
  await deny(()=>drift.beginReader(),/privacy_paused/);
  await deny(()=>drift.call('private.prepare_google_sheets_erasure_v1',[randomUUID(),drift.workspace,drift.connection,randomUUID(),'[]',true],'google_sheets_erasure_support'),/privacy_paused/);
  const sameWithdrawal=await drift.call('private.withdraw_google_sheets_erasure_v1',[drift.request,driftPrepared.scopeHash,'3'.repeat(64),'scope_changed'],'google_sheets_erasure_support');
  assert.equal(sameWithdrawal.withdrawnAt,withdrawn.withdrawnAt);assert.equal(sameWithdrawal.withdrawalInventoryDigest,'2'.repeat(64));checks+=2;
  await drift.call('private.finish_google_sheets_withdrawal_v1',[drift.request,driftPrepared.scopeHash,'4'.repeat(64),'5'.repeat(64)],'google_sheets_erasure_support');
  await drift.beginReader(db,[]);checks++;
  await deny(()=>f.call('private.withdraw_google_sheets_erasure_v1',[f.request,prepared.scopeHash,'2'.repeat(64),'owner_withdrawn'],'google_sheets_erasure_support'),/completed_wins/);
  const freshRequest=randomUUID();const freshPrepared=await drift.call('private.prepare_google_sheets_erasure_v1',[freshRequest,drift.workspace,drift.connection,randomUUID(),'[]',true],'google_sheets_erasure_support');
  await deny(()=>drift.call('private.execute_google_sheets_erasure_v1',[freshRequest,freshPrepared.scopeHash,'6'.repeat(64)],'google_sheets_erasure_support'),/approval_required/);
  await drift.approve(freshRequest,freshPrepared.scopeHash);await drift.call('private.execute_google_sheets_erasure_v1',[freshRequest,freshPrepared.scopeHash,'6'.repeat(64)],'google_sheets_erasure_support');checks++;
  // Mere Storage metadata absence is insufficient. Exact product purge flags
  // are required before prepare, then captured in the signed manifest scope.
  const storage=await fixture.seed(),fullFile=randomUUID();
  await db.query("insert into public.file_uploads(id,workspace_id,storage_bucket,storage_path,metadata_json) values($1,$2,'workspace-files',$3,'{}')",[fullFile,storage.workspace,storage.workspace+'/copy.pdf']);
  const fullTarget=async()=> (await db.query("select private.google_sheets_target_v1($1,'file_uploads',$2) target",[storage.workspace,fullFile])).rows[0].target;
  await deny(async()=>storage.call('private.prepare_google_sheets_erasure_v1',[storage.request,storage.workspace,storage.connection,randomUUID(),JSON.stringify([{...await fullTarget(),action:'delete'}]),true],'google_sheets_erasure_support'),/storage_product_purge_required/);
  await db.query('update public.file_uploads set storage_purged_at=clock_timestamp(),storage_missing_at=clock_timestamp(),storage_purge_requested_at=clock_timestamp(),storage_purge_attempted_at=clock_timestamp() where id=$1',[fullFile]);
  const storagePrepared=await storage.call('private.prepare_google_sheets_erasure_v1',[storage.request,storage.workspace,storage.connection,randomUUID(),JSON.stringify([{...await fullTarget(),action:'delete'}]),true],'google_sheets_erasure_support');
  await storage.approve(storage.request,storagePrepared.scopeHash);
  const storageManifest=await storage.call('private.get_google_sheets_erasure_execution_v1',[storage.request,storagePrepared.scopeHash],'google_sheets_erasure_support');
  assert.equal(storageManifest.storageReceipts[0].path,storage.workspace+'/copy.pdf');assert.equal(storageManifest.storageReceipts[0].rowHash,(await fullTarget()).hash);checks+=2;
  await storage.call('private.execute_google_sheets_erasure_v1',[storage.request,storagePrepared.scopeHash,'7'.repeat(64)],'google_sheets_erasure_support');
  assert.equal((await db.query('select count(*)::int n from public.file_uploads where id=$1',[fullFile])).rows[0].n,0);checks++;
  // A genesis-only witness has no erasures to replay and cannot mutate any
  // workspace barrier. A valid empty inventory can still finish qualification.
  const barrierBefore=(await db.query('select jsonb_agg(to_jsonb(e) order by workspace_id) snapshot from private.google_sheets_privacy_epochs e')).rows[0].snapshot;
  assert.equal((await storage.call('private.finish_google_sheets_restore_v1',['[]','8'.repeat(64)],'google_sheets_erasure_restore')).remaining,0);checks++;
  assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(e) order by workspace_id) snapshot from private.google_sheets_privacy_epochs e')).rows[0].snapshot,barrierBefore);checks++;
  // 101 permanently held entries cannot prevent the bounded operator from
  // discovering later due work. Tuple cursors retain full timestamp precision.
  const backlog=await fixture.seed();
  await db.query("insert into public.google_sheets_connections(workspace_id,business_entity_id,created_by,status,display_name,disconnected_at) select $1,$2,$3,'disconnected','Synthetic paging metadata','1950-01-01T00:00:00Z'::timestamptz from generate_series(1,101)",[backlog.workspace,backlog.entity,backlog.owner]);
  await db.query("update private.google_sheets_retention_roots set automatic_expiry_authorized=false where workspace_id=$1 and expires_at<'1951-01-01'",[backlog.workspace]);
  for(const [rpc,key] of [['private.due_google_sheets_retention_v1','rootId'],['private.due_google_sheets_disconnected_expiry_v1','connectionId']]) {
    const all=await backlog.call(rpc,[500],'google_sheets_erasure_support');
    const first=await backlog.call(rpc,[100],'google_sheets_erasure_support');
    assert.equal(first.length,100);checks++;
    const cursor=first.at(-1);
    const second=await backlog.call(rpc,[100,cursor.expiresAt,cursor[key]],'google_sheets_erasure_support');
    assert.deepEqual([...first,...second],all);assert(second.some(item=>new Date(item.expiresAt).getUTCFullYear()===1950));checks+=2;
    await deny(()=>backlog.call(rpc,[100,cursor.expiresAt,null],'google_sheets_erasure_support'),/cursor_invalid/);
  }
  // A pre-connector run stays unknown when copied or relabeled. It cannot
  // acquire clean provenance merely because the copy uses a fresh empty ticket.
  const legacyWorkspace=randomUUID(),legacyRun=randomUUID();
  await db.query('insert into public.workspaces(id) values($1)',[legacyWorkspace]);
  await db.query("insert into public.ai_agent_runs(id,workspace_id,status,output_json) values($1,$2,'completed','{\"summary\":\"Legacy unclassified content\"}')",[legacyRun,legacyWorkspace]);
  await db.query("insert into public.workspace_members values($1,$2,'owner','active')",[legacyWorkspace,backlog.owner]);
  const legacyEntity=randomUUID();await db.query("insert into public.business_entities values($1,$2,'active','Legacy fixture entity')",[legacyEntity,legacyWorkspace]);
  await db.query("insert into public.google_sheets_connections(workspace_id,business_entity_id,created_by,status,display_name) values($1,$2,$3,'disconnected','Legacy exposure fixture')",[legacyWorkspace,legacyEntity,backlog.owner]);
  const legacyTicket=await backlog.call('public.begin_google_sheets_read_v1',[legacyWorkspace,backlog.owner]);
  await backlog.call('public.bind_google_sheets_read_v1',[legacyTicket.ticketId,JSON.stringify([{table:'ai_agent_runs',id:legacyRun}])]);
  await deny(()=>db.query("insert into public.reports(workspace_id,title,google_sheets_read_ticket_id) values($1,'Copied legacy output',$2)",[legacyWorkspace,legacyTicket.ticketId]),/unattributed_source/);
  const emptyLegacy=await backlog.call('public.begin_google_sheets_read_v1',[legacyWorkspace,backlog.owner]);
  await backlog.call('public.bind_google_sheets_read_v1',[emptyLegacy.ticketId,'[]']);
  await deny(()=>db.query('update public.ai_agent_runs set google_sheets_read_ticket_id=$2 where id=$1',[legacyRun,emptyLegacy.ticketId]),/unattributed_source/);
  assert.equal((await backlog.call('public.get_google_sheets_read_context_v1',[legacyTicket.ticketId])).hasUnattributedDerivedSources,true);checks++;
  // A paused backlog row exposes only its precise recovery handle.
  await db.query("update private.google_sheets_retention_roots set expires_at=clock_timestamp()-interval '1 second' where id in(select root_id from private.google_sheets_source_root_links where connection_id=$1)",[cascade.connection]);
  const activeDue=await cascade.call('private.due_google_sheets_retention_v1',[500],'google_sheets_erasure_support');
  assert.deepEqual(activeDue.find(row=>row.connectionId===cascade.connection).activeRequest,{requestId:cascade.request,scopeHash:cascadePrepared.scopeHash,state:'approved'});checks++;
  assert(activeDue.every(row=>row.activeRequest===null||Object.keys(row.activeRequest).sort().join(',')==='requestId,scopeHash,state'));checks++;
  // Exact artifact preview closes the operator workflow without granting any
  // raw table reads or target-helper access to the support identity.
  const preview=await publication.call('private.preview_google_sheets_erasure_artifact_v1',[publication.workspace,publication.connection,'reports',publication.report],'google_sheets_erasure_support');
  assert.deepEqual(Object.keys(preview).sort(),['hash','id','table']);assert.equal(preview.id,publication.report);assert.match(preview.hash,/^[a-f0-9]{64}$/);checks++;
  for(const role of ['anon','authenticated','service_role','google_sheets_erasure_restore']) await deny(()=>publication.call('private.preview_google_sheets_erasure_artifact_v1',[publication.workspace,publication.connection,'reports',publication.report],role),/permission denied/);
  await deny(()=>publication.call('private.preview_google_sheets_erasure_artifact_v1',[publication.workspace,publication.connection,'reports',publication.otherRecord],'google_sheets_erasure_support'),/target_unavailable/);
  await deny(()=>publication.call('private.preview_google_sheets_erasure_artifact_v1',[publication.workspace,publication.connection,'google_sheets_connections',publication.connection],'google_sheets_erasure_support'),/table_denied/);
  await deny(()=>publication.as('google_sheets_erasure_support',client=>client.query('select * from public.reports where id=$1',[publication.report])),/permission denied/);
  return { ...fixture, checks, scope: 'Actual new migration; synthetic source/sink tables; no production mutation' };
}
module.exports = { setupRestricted, qualifyRestricted };
if (require.main === module) (async () => {
  const { PGlite } = require(process.env.GOOGLE_SHEETS_PGLITE_PATH || '@electric-sql/pglite');
  const db = new PGlite();
  try { const result = await qualifyRestricted(db); console.log(JSON.stringify({ suite: 'google_sheets_restricted_erasure', checks: result.checks, baseline: result.baseline.checks, scope: result.scope })); }
  finally { await db.close(); }
})().catch(error => { console.error({ message: error.message, code: error.code, where: error.where, stack: error.code && !error.code.startsWith('ERR_') ? undefined : error.stack }); process.exitCode = 1; });
