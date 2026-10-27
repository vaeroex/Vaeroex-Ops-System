/* eslint-disable @typescript-eslint/no-require-imports -- Isolated, credential-free SQL/application regression. */
const assert = require('node:assert/strict');

module.exports = async function run({ db, uuid, w, other, owner, owner2, session, secondSession, entity, conn, login, admin, map }) {
  const requestedProviders = ['google_sheets', 'quickbooks_online', 'square', 'loyverse', 'zoho-books', 'wix-orders', 'xero', 'harvest', 'clockify', 'toggl', 'zoho-inventory', 'katana'];
  const ticket = uuid(101), request = uuid(103), start = '2026-10-01', end = '2026-10-01';
  let networkAttempts = 0;
  const OriginalDate = global.Date;
  global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-10-27T12:00:00.000Z'])); } static now() { return OriginalDate.parse('2026-10-27T12:00:00.000Z'); } };
  const originalFetch = global.fetch, originalConnect = require('node:net').Socket.prototype.connect;
  const denyNetwork = () => { networkAttempts++; throw Error('all_provider_path_network_forbidden'); };
  global.fetch = denyNetwork; require('node:net').Socket.prototype.connect = denyNetwork;
  try {
    const calls = [];
    const allowedRPC = new Set(['discover_shared_evidence_v1', 'discover_shared_evidence_v2', 'preview_shared_legacy_evidence_v1', 'read_shared_typed_evidence_v1', 'capture_legacy_evidence_v1', 'shared_evidence_dependencies_v1', 'seal_shared_evidence_manifest_v1', 'validate_shared_evidence_manifest_v1', 'vsi_mutate_v3', 'reopen_shared_evidence_target_v1', 'reopen_shared_evidence_artifact_v1']);
    function client(role, actor = owner, sid = session) {
      return { auth: {
        getUser: async () => ({ data: { user: { id: actor } }, error: null }),
        getClaims: async () => ({ data: { claims: { sub: actor, session_id: sid } }, error: null })
      }, rpc: async (name, args) => {
        assert(allowedRPC.has(name), name); calls.push(name);
        const entries = Object.entries(args); entries.forEach(([key]) => assert(/^p_[a-z_]+$/.test(key)));
        await login(db, actor, sid, role);
        try {
          const values = entries.map(([key, value]) => value && typeof value === 'object'
            && (!Array.isArray(value) || ['p_sources', 'p_preferences', 'p_input'].includes(key)) ? JSON.stringify(value) : value);
          const data = (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) v`, values)).rows[0].v;
          return { data, error: null };
        } catch (error) {
          console.error('synthetic SQL path rejection', name, error.code, error.message);
          return { data: null, error: { code: error.code, message: error.message } };
        }
      } };
    }
    const reader = client('authenticated'), service = client('service_role');
    const bind = async (_reader, id, roots) => {
      assert.equal(id, ticket); await admin(db);
      const existing = (await db.query('select sources from private.google_sheets_read_tickets where id=$1', [id])).rows[0].sources;
      const unique = [...new Map([...existing, ...roots].map(root => [JSON.stringify(root), root])).values()];
      await db.query('update private.google_sheets_read_tickets set sources=$1 where id=$2', [JSON.stringify(unique), id]);
      await login(db); return { ticketId: id };
    };
    require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {},
      '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => true },
      '@/lib/ai/shared-evidence/qualitative-policy': { qualitativeSynthesisEnabled: () => true },
      './retrieval': { authorizeVsiRead: async () => ({ supabase: reader, workspaceId: w, user: { id: owner }, membership: { role: 'owner' } }), retrieveVsiEvidence: async () => { throw Error('legacy_fallback_forbidden'); } },
      './product-context': { loadVsiProductContext: async () => ({ authoritative: {}, sources: [], limitations: [] }) },
      '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: bind },
      '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({ Authorization: 'Bearer synthetic-all12-no-access' }) },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => service }
    });
    const { sharedRow, prepareSharedGeneration } = require('../lib/ai/shared-evidence/generation.ts');
    const { expandFactTimes } = require('../lib/ai/shared-evidence/fact-time.ts');
    const { renderSharedAnswer, SHARED_ANSWER_INSTRUCTIONS } = require('../lib/ai/shared-evidence/answer-contract.ts');
    const { settleGeneratedVsi } = require('../lib/vsi/storage.ts');
    const { reopenSharedCitation } = require('../lib/ai/shared-evidence/citation-reopen.ts');
    const { validateSnapshot } = require('../lib/integrations/reporting/adapters.ts');

    // These are importer-retained records, not invented adapter summaries. The
    // reporting snapshots additionally run the installed import validator. The
    // network-backed provider parsers and OAuth flows are deliberately not called.
    const legacy = [
      ['xero', uuid(730), [{ key: 'invoices', value: 1, currency: 'USD' }, { key: 'billed', value: 123.45, currency: 'USD' }, { key: 'outstanding', value: 0, currency: 'USD' }, { key: 'bills', value: 0, currency: 'USD' }, { key: 'purchases', value: 0, currency: 'USD' }]],
      ['clockify', uuid(731), [{ key: 'entries', value: 1 }, { key: 'hours', value: 0 }, { key: 'billable_hours', value: 0 }, { key: 'running', value: 0 }]],
      ['toggl', uuid(732), [{ key: 'projects', value: 2 }, { key: 'hours', value: 100 }]],
      ['zoho-inventory', uuid(733), [{ key: 'items', value: 20 }, { key: 'low_stock', value: 0 }]],
      ['katana', uuid(734), [{ key: 'stock_rows', value: 5 }, { key: 'unavailable', value: 0 }]]
    ];
    await admin(db);
    for (const [provider, connection, metrics] of legacy) {
      const snapshot = validateSnapshot(provider, { start: '2026-10-01T12:00:00.000Z', end: '2026-10-01T12:00:00.000Z', metrics });
      await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account,snapshot,last_sync_at) values($1,$2,$3,$4,'connected',$5,$6,'2026-10-01T12:01:00Z')", [connection, w, provider, owner, JSON.stringify({ id: `synthetic-${provider}`, ...(provider === 'clockify' ? { user: 'synthetic-own-user' } : {}), ...(provider === 'toggl' ? { parent: 'synthetic-organization' } : {}) }), JSON.stringify(snapshot)]);
      if (['xero', 'clockify'].includes(provider)) await db.query("insert into reporting_history_facts values($1,$2,$3,'record-1','2026-10-01',$4)", [w, provider, connection, JSON.stringify(metrics)]);
    }
    await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,'USD')", [uuid(740), w, owner, uuid(750)]);
    await db.query("insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,created_at,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled) values($1,$2,'sale-zero','store-1','2026-09-30T23:00:00Z','2026-10-01T01:00:00Z','2026-10-01T01:00:00Z','SALE',0,0,0,false)", [w, uuid(740)]);
    await db.query("insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,currency_code) values($1,$2,$3,'connected','12345','USD')", [uuid(741), w, owner]);
    await db.query("insert into zoho_books_history_facts values($1,$2,'invoice','123','2026-10-01',true,'USD',80,35)", [w, uuid(741)]);
    await db.query("insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash,site_id) values($1,$2,$3,'connected',$4,$5)", [uuid(742), w, owner, 'a'.repeat(64), uuid(752)]);
    await db.query("insert into wix_order_facts values($1,$2,$3,'2026-10-01T10:00:00Z',120,'USD','NOT_PAID')", [w, uuid(742), uuid(753)]);
    const { record, report } = require('./qbo-customer-test-support.cjs');
    const projection = record('Invoice'); projection.id = 'invoice-1'; projection.temporal.postingDate = start; projection.accounting.basis = 'accrual';
    await db.query("insert into private.integration_connections values($1,$2,$3,'quickbooks_online','production','active',1)", [uuid(720), w, entity]);
    await db.query("insert into private.provider_entity_mappings values($1,$2,$3,$4,'quickbooks_online','production','active',now(),1)", [uuid(721), w, entity, uuid(720)]);
    await db.query("insert into private.external_source_records values($1,$2,$3,$4,$5,'quickbooks_online','provider','active',$6,'Invoice','invoice-1')", [uuid(722), w, entity, uuid(720), uuid(721), uuid(723)]);
    await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection,accounting_currency,accounting_basis,posting_date,observed_at) values($1,$2,$3,$4,$5,'quickbooks_online','provider','Invoice','invoice-1','valid',$6,'USD','accrual',$7,'2026-10-02T00:00:00Z')", [uuid(723), w, entity, uuid(720), uuid(722), JSON.stringify(projection), start]);
    await db.query("insert into private.qbo_production_source_validation_work values($1,$2,$3,$4,$5,$6,null,'valid')", [w, entity, uuid(720), uuid(721), uuid(722), uuid(723)]);
    // A legitimate unsupported report shape is distinct from failed authority or
    // corrupt records. It must not prevent the other twelve mapped providers.
    const unsupported = report(); unsupported.periodStart = start; unsupported.periodEnd = end;
    unsupported.columns.push({ columnKey: 'third', title: 'Comparison', type: 'Money' });
    const reportId = `ProfitAndLoss:accrual:${start}:${end}:USD`;
    await db.query("insert into private.external_source_records values($1,$2,$3,$4,$5,'quickbooks_online','provider','active',$6,'ProfitAndLoss',$7)", [uuid(724), w, entity, uuid(720), uuid(721), uuid(725), reportId]);
    await db.query("insert into private.external_source_record_versions(id,workspace_id,business_entity_id,connection_id,source_record_id,provider_key,source_kind,provider_record_type,provider_record_id,validation_state,normalized_projection,accounting_currency,accounting_basis,period_start,period_end) values($1,$2,$3,$4,$5,'quickbooks_online','provider','ProfitAndLoss',$9,'valid',$6,'USD','accrual',$7,$8)", [uuid(725), w, entity, uuid(720), uuid(724), JSON.stringify(unsupported), start, end, reportId]);
    await db.query("insert into private.qbo_production_source_validation_work values($1,$2,$3,$4,$5,$6,null,'valid')", [w, entity, uuid(720), uuid(721), uuid(724), uuid(725)]);
    await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account) values($1,$2,'harvest',$3,'connected',$4)", [uuid(780), w, owner, JSON.stringify({ id: 'synthetic-authorized-empty' })]);
    await login(db);
    for (const [provider, connection] of [...legacy, ['loyverse', uuid(740)], ['zoho-books', uuid(741)], ['wix-orders', uuid(742)]]) await map(db, provider, connection);
    await map(db, 'harvest', uuid(780));
    // Existing fixture supplies Harvest, Square COMPLETED payment and an approved
    // Sheets row. Nine legacy bindings remain explicit owner confirmations.
    const prepared = await prepareSharedGeneration(reader, w, start, end);
    assert.deepEqual(prepared.rows.map(row => row.provider).sort(), [...requestedProviders].sort());
    assert.equal(prepared.coverage.providers.find(row => row.provider === 'harvest').empty, 1);
    assert.equal(prepared.coverage.providers.find(row => row.provider === 'quickbooks_online').unsupported, 1);
    assert(prepared.limitations.some(value => value.includes('authorized empty')));
    assert(prepared.limitations.some(value => value.includes('unsupported typed projection')));
    assert(prepared.rows.length <= 24); assert(prepared.rows.reduce((n, row) => n + JSON.stringify(row.facts).length, 0) <= 12000);
    const byProvider = new Map(prepared.rows.map(row => [row.provider, row]));
    const inventory = [
      ['google_sheets', /Orders: 17 count/, /2026-10-01/],
      ['quickbooks_online', /total: 100 USD/, /2026-10-01/],
      ['square', /12345 USD minor units/, /not posted accounting revenue/],
      ['loyverse', /SALE/, /0 USD/, /not.*accounting revenue/],
      ['zoho-books', /80 USD/, /35 USD/, /balance at import/],
      ['wix-orders', /120 USD/, /NOT_PAID/, /not.*settlement/],
      ['xero', /123.45 USD/, /outstanding: 0 USD/, /balance at import/],
      ['harvest', /hours: 8 hours/, /spent date/],
      ['clockify', /hours: 0 hours/, /UTC/],
      ['toggl', /hours: 100 hours/, /lifetime/i],
      ['zoho-inventory', /items: 20 count/, /snapshot/i],
      ['katana', /stock rows: 5 count/, /snapshot/i]
    ];
    for (const [provider, ...patterns] of inventory) {
      const row = byProvider.get(provider); assert(row, provider);
      for (const pattern of patterns) assert.match(row.facts.join('\n'), pattern, provider);
      const times = expandFactTimes(row.factTimes, row.facts.length); assert.equal(times.length, row.facts.length, provider);
      assert(row.hash.match(/^[a-f0-9]{64}$/));
    }
    assert.equal(byProvider.get('loyverse').data.currency, 'USD', 'protected reviewed connection currency reaches projection');
    assert.equal(byProvider.get('loyverse').data.records[0].receipt_date.slice(0, 10), '2026-09-30', 'backdated receipt date retained independently of creation-time selection');
    assert.equal(byProvider.get('clockify').scope.scope, 'connected_user');

    const sources = prepared.rows.map((row, i) => ({ ref: `B${i + 1}`, binding: row.hash, dependencies: [row.hash], facts: row.facts, factTimes: row.factTimes,
      ...(row.salesInvoiceFactGroups ? { salesInvoiceFactGroups: row.salesInvoiceFactGroups } : {}), reported: false, provider: row.provider, environment: 'production' }));
    const observations = sources.flatMap(source => source.facts.map((_, factIndex) => ({ ref: source.ref, binding: source.binding, factIndex })));
    assert(observations.length <= 96);
    const answer = { observations, results: [], hypotheses: [], missing_information: [], next_checks: [] };
    const context = { sources, results: [], hypothesesEnabled: true, scopes: new Map(prepared.rows.map((row, i) => [sources[i].ref, row.scope])) };
    const rendered = renderSharedAnswer(answer, context);
    assert.equal(rendered.citationIds.length, 12);
    assert.match(rendered.content, /Application date check/);
    for (const source of sources) assert(rendered.content.includes(`[${source.ref}]`));
    assert.throws(() => renderSharedAnswer({ ...answer, observations: [{ ...observations[0], binding: 'f'.repeat(64) }, ...observations.slice(1)] }, context), error => error.rule === 'fact_reference');
    assert.throws(() => renderSharedAnswer({ ...answer, results: ['f'.repeat(64)] }, context), error => error.rule === 'result_reference');
    assert.throws(() => sharedRow({ identity: prepared.rows[0].identity, hash: prepared.rows[0].hash, data: { ...prepared.rows[0].data, workspace_id: other } }, w), /shared_workspace_mismatch/);
    // Run the actual engine, not a hand-built approximation of its prompt or
    // request envelope. Only the model response transport is deterministic.
    // The full engine prompt, all issued relationships, dynamic schema, product
    // context slots and final transport escaping participate in its size guard.
    process.env.OPENAI_API_KEY = 'synthetic-unused-global';
    process.env.VAEROEX_VSI_MAX_INPUT_CHARS = '48000';
    process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS = '6000';
    const engineRequests = [], measured = [], packing = require('../lib/vsi/answer-context.ts'), actualPack = packing.packVsiAnswerContext;
    packing.packVsiAnswerContext = (...args) => { const canonical = JSON.stringify(args[0]), result = actualPack(...args); assert.equal(JSON.stringify(args[0]), canonical); measured.push(result.metrics); return result; };
    const { runVsiAnswer, VSI_SYSTEM_PROMPT } = require('../lib/vsi/engine.ts');
    global.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, 'Bearer synthetic-all12-no-access');
      const body = JSON.parse(init.body), payload = JSON.parse(body.input[1].content);
      assert.equal(body.store, false); assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.tools, undefined);
      assert(init.body.length <= 48000); assert(Buffer.byteLength(init.body, 'utf8') <= 192000);
      engineRequests.push({ chars: init.body.length, bytes: Buffer.byteLength(init.body, 'utf8'), body, payload });
      let output;
      if (body.text.format.name === 'vsi_research_plan_v1') {
        assert.deepEqual([...payload.sourceDiscovery.sourceTypes].sort(), [...requestedProviders].sort());
        output = { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] };
      } else {
        assert.equal(body.text.format.name, 'vsi_shared_answer_v2');
        assert(body.input[0].content.length > VSI_SYSTEM_PROMPT.length, 'actual full shared engine prompt is present');
        assert(body.input[0].content.endsWith(SHARED_ANSWER_INSTRUCTIONS));
        assert.equal(payload.businessSources.length, 12);
        assert.deepEqual(payload.qualitative_sources.map(source => source.provider).sort(), [...requestedProviders].sort());
        for (const source of payload.qualitative_sources) {
          assert.deepEqual(source.facts, byProvider.get(source.provider).facts);
          assert.deepEqual(source.factTimes, byProvider.get(source.provider).factTimes);
          const canonical = payload.businessSources.find(candidate => candidate.id === source.ref);
          assert.equal(canonical.sourceId, source.binding);
        }
        const metric = measured.at(-1); assert.equal(metric.requestChars, init.body.length); assert.equal(metric.requestBytes, Buffer.byteLength(init.body, 'utf8'));
        output = { observations: payload.qualitative_sources.flatMap(source => source.facts.map((_, factIndex) => ({ ref: source.ref, binding: source.binding, factIndex }))), results: [], hypotheses: [], missing_information: [], next_checks: [] };
      }
      return new Response(JSON.stringify({ model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 100, output_tokens: 100 }, output_text: JSON.stringify(output) }), { status: 200 });
    };
    let engineAnswer;
    try { engineAnswer = await runVsiAnswer({ supabase: reader, workspaceId: w, actorUserId: owner, readTicket: { ticketId: ticket }, question: 'Question', recentMessages: [], requestId: uuid(104), reservedRequest: { id: request, attempt: 1 } }); }
    finally { global.fetch = denyNetwork; packing.packVsiAnswerContext = actualPack; }
    assert.equal(engineRequests.length, 2); assert.equal(engineAnswer.usage.providerCalls, 2); assert.equal(engineAnswer.usage.retries, 0);
    assert.equal(engineAnswer.citations.length, 12); assert.match(engineAnswer.content, /Application date check/);
    const citations = engineAnswer.citations, finalRequest = engineRequests.at(-1);
    await settleGeneratedVsi({ supabase: reader, workspaceId: w, userId: owner, sessionId: session }, { id: request, conversationId: uuid(102), attempt: 1, readTicketId: ticket, question: 'Question', answer: engineAnswer.content,
      summary: 'Synthetic stored-provider review', citations, usage: engineAnswer.usage }, engineAnswer.sharedManifestId);
    const reopened = await reopenSharedCitation(reader, { workspaceId: w, kind: 'vsi_exchange', id: request });
    assert.deepEqual(reopened.map(row => row.provider).sort(), [...requestedProviders].sort());
    for (const source of finalRequest.payload.qualitative_sources) assert(reopened.some(saved => saved.hash === source.binding && saved.provider === source.provider));
    await admin(db);
    const saved = (await db.query('select answer,citations from vsi_exchanges where id=$1', [request])).rows[0];
    assert.equal(saved.answer, engineAnswer.content); assert.deepEqual(saved.citations, citations);
    const usage = (await db.query('select (select count(*) from vsi_exchanges where id=$1)::int exchanges,(select count(*) from vsi_cost_events where request_id=$1)::int costs', [request])).rows[0];
    assert.equal(usage.exchanges, 1); assert.equal(usage.costs, 1);
    await assert.rejects(reopenSharedCitation(reader, { workspaceId: other, kind: 'vsi_exchange', id: request }));
    await assert.rejects(reopenSharedCitation(client('authenticated', owner2, secondSession), { workspaceId: w, kind: 'vsi_exchange', id: request }));
    // More than the discovery and row budgets: eligible QBO and Sheets groups
    // compete with valid mapped neighbors. No source is shortened, and requested
    // providers are represented before irrelevant rows consume the budgets.
    await admin(db);
    for (let i = 0; i < 110; i++) {
      const source = uuid(2000 + i * 3), version = uuid(2001 + i * 3), kpi = uuid(2002 + i * 3);
      await db.query('insert into google_sheets_source_rows values($1,$2,$3,$4,$5,true)', [source, w, uuid(300), entity, version]);
      await db.query("insert into google_sheets_source_versions values($1,$2,$3,$4,'valid',$5,$6)", [version, w, uuid(300), source, JSON.stringify({ date: start, metrics: [{ column: 1, name: 'Synthetic count', value: String(i % 7), unit: 'count' }] }), `synthetic-${i}`]);
      await db.query("insert into kpis values($1,$2,$3,$4,'Synthetic count','{}',null,null)", [kpi, w, i % 7, start]);
      await db.query("insert into google_sheets_fact_links values($1,$2,$3,$4,$5,$6,'accepted',1)", [w, uuid(300), source, version, uuid(301), kpi]);
    }
    await login(db);
    const bounded = await prepareSharedGeneration(reader, w, start, end, 'Review QuickBooks Online and Google Sheets stored evidence.');
    assert(bounded.rows.some(row => row.provider === 'quickbooks_online'));
    assert(bounded.rows.some(row => row.provider === 'google_sheets'));
    assert(bounded.rows.length <= 24);
    assert.equal(bounded.coverage.providers.reduce((n, row) => n + row.discovered, 0), 96);
    assert(bounded.coverage.providers.some(row => row.catalog > row.discovered));
    assert(bounded.coverage.providers.some(row => row.rowBudgetOmitted > 0));
    assert(bounded.limitations.some(value => value.includes('outside the discovery cap')));
    assert(bounded.limitations.some(value => value.includes('outside the row budget')));
    for (const row of bounded.rows) assert.deepEqual(sharedRow({ identity: row.identity, hash: row.hash, data: row.data }, w).facts, row.facts);
    // An invalid connection/entity lifecycle is not an 'unsupported' skip. A
    // remaining readable neighbor cannot license continuing past this denial.
    await admin(db);
    await db.query("update business_entities set status='inactive' where id=$1", [entity]);
    await assert.rejects(prepareSharedGeneration(reader, w, start, end, 'Review QuickBooks Online and Google Sheets stored evidence.'), /shared_evidence_authority_unavailable/);
    await admin(db); await db.query("update business_entities set status='active' where id=$1", [entity]);
    const revocations = [
      ['google_sheets', "update google_sheets_connections set status='disconnected' where id=$1", uuid(300)],
      ['quickbooks_online', "update private.integration_connections set status='inactive' where id=$1", uuid(720)],
      ['square', "update square_customer_private.connections set state='disconnected' where connection_id=$1", uuid(210)],
      ['loyverse', "update loyverse_connections set status='disconnected' where id=$1", uuid(740)],
      ['zoho-books', "update zoho_books_connections set status='disconnected' where id=$1", uuid(741)],
      ['wix-orders', "update wix_order_connections set status='disconnected' where id=$1", uuid(742)],
      ...[['harvest', conn], ...legacy.map(([provider, connection]) => [provider, connection])].map(([provider, connection]) => [provider, "update reporting_connections set status='disconnected' where id=$1", connection])
    ];
    for (const [provider, sql, connection] of revocations) {
      await admin(db); await db.exec('begin');
      try {
        await db.query(sql, [connection]);
        await assert.rejects(reopenSharedCitation(reader, { workspaceId: w, kind: 'vsi_exchange', id: request }), undefined, `${provider} revocation must invalidate exact saved evidence`);
      } finally { await db.exec('rollback'); await admin(db); }
    }
    assert.equal(revocations.length, 12);
    assert.equal((await reopenSharedCitation(reader, { workspaceId: w, kind: 'vsi_exchange', id: request })).length, 12, 'negative fixtures rolled back; original evidence unchanged');
    assert.equal(networkAttempts, 0);
    return { providers: 12, renderedFactCount: observations.length, requestChars: finalRequest.chars, requestBytes: finalRequest.bytes, actualEngine: true, deterministicTransportCalls: engineRequests.length,
      actualSQLAdmission: true, actualSQLSettlement: true, exactSavedAnswerAndBindings: true, wrongWorkspaceDenied: true, wrongActorDenied: true, revokedProvidersDenied: revocations.length,
      authorizedEmptyNeighbors: 1, unsupportedNeighbors: 1, volumeAdditionalRows: 110, discoveryBudget: 96, rowBudget: 24,
      reportingImportSnapshotValidators: 5, providerRequests: 0, modelRequests: 0, networkAttempts, limitation: 'PGlite with existing screened SQL helper composition; no hosted SQL/RLS/concurrency, provider import transport, model quality or browser navigation proof.' };
  } finally { global.Date = OriginalDate; global.fetch = originalFetch; require('node:net').Socket.prototype.connect = originalConnect; }
};
