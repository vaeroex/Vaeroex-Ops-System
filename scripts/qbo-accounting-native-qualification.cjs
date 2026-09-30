/* eslint-disable @typescript-eslint/no-require-imports -- Isolated native database fixture. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
require('./qbo-customer-test-support.cjs').installLoader();
const { minimizeQboSourceRecord } = require('../lib/integrations/providers/qbo/minimizers.ts');
const { qboMinimizedRecordToExternalSourceVersion } = require('../lib/integrations/providers/qbo/source-records.ts');
const { externalSourceIdentityFingerprint } = require('../lib/integrations/persistence/identity.ts');
const { canonicalFactFingerprint, externalSourceFingerprint } = require('../lib/integrations/contracts/canonical.ts');
const { validateProductionQboSourceClaim } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');
const { applyQboProductionAccountingPage } = require('../lib/integrations/persistence/qbo-production-accounting-repository.ts');
const { calculateQboAccounting } = require('../lib/integrations/persistence/qbo-accounting-calculation-repository.ts');

async function accountingNativeQualification(connection, fixture) {
  const db = new Client({ ...connection, statement_timeout: 10000 });
  let assertions = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
  const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) value`, args)).rows[0].value;
  const parametersFor = args => Object.entries(args).map(([key, value]) => ['p_facts', 'p_nodes'].includes(key) ? JSON.stringify(value) : value);
  const transport = async (name, args) => {
    const parameters = parametersFor(args);
    try { return { data: await call(name, parameters), error: null }; }
    catch (error) { throw new Error(`${name}:${error.message}`, { cause: error }); }
  };
  const cid = 'e9f00000-0000-4000-8000-000000000101';
  try {
    await db.connect();
    await db.query(`begin; set local search_path=public,extensions; ${fixture} commit;`);
    await db.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ role: 'authenticated',
      sub: 'a9f00000-0000-4000-8000-000000000001', session_id: '79f00000-0000-4000-8000-000000000101' })]);
    await db.query('set role authenticated');
    const effectiveFrom = '2026-09-29T00:00:00Z';
    const consent = await call('set_qbo_customer_accounting_authority_v1', [cid, null, true, effectiveFrom]);
    equal(consent.idempotent, false, 'actual owner consent creates authority once');
    await db.query('reset role');
    await call('schedule_qbo_initialization_v2', [2, 'accounting_native_schedule']);
    await db.query(`update private.integration_sync_tasks set state='dispatched',dispatcher_task_name=repeat('a',64),
      dispatch_generation=1,row_version=row_version+1,updated_at=transaction_timestamp()
      where connection_id=$1 and stream_key in ('accounts','qbo_invoice');`, [cid]);
    await db.query(`update private.integration_sync_tasks set state='leased',lease_id=gen_random_uuid(),
      lease_owner_fingerprint=decode(repeat('a',64),'hex'),lease_expires_at=clock_timestamp()+interval '1 hour',
      heartbeat_at=clock_timestamp(),delivery_attribution_state='attributed',last_delivery_dispatch_generation=1,
      last_delivery_retry_count=0,last_delivery_execution_count=0,last_delivery_attempt_fingerprint=decode(repeat('b',64),'hex'),
      row_version=row_version+1,updated_at=transaction_timestamp()
      where connection_id=$1 and stream_key in ('accounts','qbo_invoice')`, [cid]);
    const tasks = (await db.query('select * from private.integration_sync_tasks where connection_id=$1', [cid])).rows;
    const previous = new Map();
    async function ingest(type, raw) {
      const task = tasks.find(t => t.stream_key === (type === 'Account' ? 'accounts' : 'qbo_invoice'));
      const before = previous.get(type + ':' + raw.Id);
      const now = (await db.query("select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') stamp")).rows[0].stamp;
      const record = minimizeQboSourceRecord({ recordType: type, raw, provider: {
        providerKey: 'quickbooks_online', sourceEnvironment: 'production', realmId: 'synthetic-production-realm-a' } });
      const version = qboMinimizedRecordToExternalSourceVersion({ context: { workspaceId: task.workspace_id,
        businessEntityId: task.business_entity_id, connectionId: task.connection_id, providerKey: 'quickbooks_online', providerEnvironment: 'production' },
        record, id: randomUUID(), immutableVersion: before ? before.immutableVersion + 1 : 1,
        priorVersionId: before?.id ?? null, previousRecord: before?.normalizedProjection ?? null,
        observedAt: now, synchronizedAt: now, ingestedAt: now, receivedAt: now });
      await db.query('set role integration_provider_source_authority');
      await call('commit_provider_external_source_record_version_v1', [{ contractVersion: 'integration_provider_source_commit_v1',
        taskId: task.id, leaseId: task.lease_id, leaseOwnerFingerprint: `sha256:${'a'.repeat(64)}`,
        mappingId: task.control_metadata.mappingId, sourceIdentityFingerprint: externalSourceIdentityFingerprint(version), version }, 'accounting_native_ingest']);
      const claims = await call('claim_qbo_production_source_validation_v1', [task.id, `sha256:${'c'.repeat(64)}`, 100]);
      equal(claims.length, 1, 'only the newly committed source is claimed');
      equal(claims[0].pendingVersion.sourceFingerprint, externalSourceFingerprint(claims[0].pendingVersion),
        'native source round trip preserves the TypeScript content fingerprint');
      equal(claims[0].sourceIdentityFingerprint, externalSourceIdentityFingerprint(claims[0].pendingVersion),
        'native source round trip preserves the TypeScript identity fingerprint');
      equal(Date.parse(claims[0].validatedAt) >= Date.parse(claims[0].pendingVersion.receivedAt), true,
        'native validation follows ingestion');
      const valid = validateProductionQboSourceClaim(claims[0]);
      equal(valid.validatedVersion.validation.state, 'valid', 'real TypeScript source validator accepts fixture');
      await call('complete_qbo_production_source_validation_v1', [version.id, claims[0].claimId,
        `sha256:${'c'.repeat(64)}`, valid.validatedVersion, 'accounting_native_validate']);
      await db.query('reset role');
      previous.set(type + ':' + raw.Id, valid.validatedVersion);
      return valid.validatedVersion;
    }
    const metadata = { CreateTime: '2026-09-29T08:00:00Z', LastUpdatedTime: '2026-09-29T08:00:00Z' };
    await ingest('Account', { Id: 'income-401', SyncToken: '1', Active: true, AccountType: 'Income',
      CurrencyRef: { value: 'USD' }, MetaData: metadata });
    const sales = (amount, token) => ({ Id: 'invoice-native', SyncToken: token, MetaData: metadata,
      TxnDate: '2026-09-29', CurrencyRef: { value: 'USD' }, TotalAmt: amount, GlobalTaxCalculation: 'NotApplicable',
      Line: [{ Id: 'line-1', Amount: amount, DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: 'item-native' }, ItemAccountRef: { value: 'income-401' }, TaxCodeRef: { value: 'NON' } } }] });
    await ingest('Invoice', sales('100.25', '1'));
    let admissionFenceTested = false;
    async function admissionFence(name, args) {
      const rejected = async (mutation, label) => {
        const altered = structuredClone(args);
        mutation(altered);
        for (const fact of altered.p_facts) fact.factFingerprint = canonicalFactFingerprint(fact);
        await assert.rejects(() => transport(name, altered), /qbo_accounting_/, label); assertions++;
      };
      await rejected(command => { command.p_facts[0].value.amount = '999.25'; }, 'forged amount with a valid hash is denied');
      await rejected(command => { command.p_facts[0].dimensions = []; }, 'forged dimensions with a valid hash are denied');
      await rejected(command => { command.p_facts[0].temporal.postingDate = '2026-09-28'; }, 'wrong posting date is denied');
      await rejected(command => { command.p_facts[0].sourceObservedAt = '2026-09-28T00:00:00Z'; }, 'wrong observation binding is denied');
      await rejected(command => { command.p_authority_id = randomUUID(); }, 'stale authority CAS is denied');
      await rejected(command => { command.p_source_record_id = randomUUID(); }, 'cross-source substitution is denied');
      await rejected(command => { command.p_account_context_fingerprint = `sha256:${'f'.repeat(64)}`; }, 'stale account classification context is denied');
      await db.query('reset role');
      equal((await db.query('select count(*)::int n from private.canonical_business_facts')).rows[0].n, 0,
        'all forged admissions leave zero canonical facts');
      equal((await db.query('select count(*)::int n from private.fact_contribution_events')).rows[0].n, 0,
        'all forged admissions leave zero financial effects');
      await db.query('set role service_role');
      await assert.rejects(() => transport(name, args), /permission denied/, 'service_role has no admission shortcut'); assertions++;
      await db.query('reset role');
      const peers = [new Client({ ...connection, statement_timeout: 10000 }), new Client({ ...connection, statement_timeout: 10000 })];
      try {
        for (const peer of peers) { await peer.connect(); await peer.query('set role integration_provider_source_authority'); }
        const parameters = parametersFor(args);
        const query = `select public.${name}(${parameters.map((_, i) => '$' + (i + 1)).join(',')}) value`;
        const results = await Promise.all(peers.map(peer => peer.query(query, parameters).then(result => result.rows[0].value)));
        equal(results.map(result => result.idempotent).sort(), [false, true], 'concurrent admission has one winner and one idempotent loser');
        equal(results[0].applicationId, results[1].applicationId, 'concurrent workers receive the same immutable application');
        equal(results[0].factVersionIds, results[1].factVersionIds, 'concurrent workers receive the same canonical fact versions');
        return results.find(result => !result.idempotent);
      } finally {
        for (const peer of peers) await peer.end();
        await db.query('set role integration_provider_source_authority');
      }
    }
    async function mapAndCommit(invoiceDisposition = 'mapped_partial') {
      await db.query('set role integration_provider_source_authority');
      const page = await call('read_qbo_accounting_page_v1', [cid, null, 25]);
      const calls = [];
      const applied = await applyQboProductionAccountingPage({ connectionId: cid, afterSourceId: null,
        maximumSources: 25, requestId: 'native_adapter_commit' }, { rpc: async (name, args) => {
          calls.push({ name, args });
          if (name === 'commit_qbo_accounting_source_v1' && args.p_facts.length && !admissionFenceTested) {
            admissionFenceTested = true;
            return { data: await admissionFence(name, args), error: null };
          }
          return transport(name, args);
        } });
      for (const application of applied.applications) {
        equal(application.idempotent, false, 'one financial source application');
        const saved = calls.find(item => item.name === 'commit_qbo_accounting_source_v1' &&
          item.args.p_source_record_id === application.sourceRecordId);
        equal((await transport(saved.name, saved.args)).data.idempotent, true, 'financial source replay is idempotent');
        const source = page.sources.find(row => row.sourceRecordId === application.sourceRecordId);
        if (source.sourceVersion.source.providerRecordType === 'Invoice') equal(application.disposition, invoiceDisposition, 'invoice lifecycle has its exact financial disposition');
      }
      equal((await call('read_qbo_accounting_page_v1', [cid, null, 25])).sources.length, 0, 'processed page is not rediscovered');
      await db.query('reset role');
      return applied;
    }
    async function summary(state, amount) {
      await db.query('set role authenticated');
      const result = await call('read_qbo_customer_accounting_summary_v1', [cid]);
      await db.query('reset role');
      equal(result.calculationState, state, 'customer summary reports truthful calculation state');
      equal(result.coverage, 'partial', 'customer summary never claims full revenue coverage');
      equal(result.fullPostedRevenue, false, 'customer summary does not claim full posted revenue');
      if (amount !== null) {
        equal(result.months.map(month => month.valueCanonical), [amount], 'customer summary derives exact admitted subtotal');
        equal(result.months[0].provenance.length > 0, true, 'customer summary has native source provenance');
      } else equal(result.months, [], 'pending or withdrawn authority exposes no stale subtotal');
    }
    await mapAndCommit();
    async function calculate(expected) {
      await db.query('set role integration_provider_source_authority');
      const client = { rpc: (name, args) => transport(name, name === 'commit_qbo_accounting_calculation_v1'
        ? { ...args, p_result: { ...args.p_result, completedAt: '2099-01-01T00:00:00Z' } } : args) };
      equal((await calculateQboAccounting(cid, client)).state, 'completed', 'native deterministic calculation completes');
      equal((await calculateQboAccounting(cid, client)).idempotent, true, 'unchanged native calculation replays without mutation');
      await db.query('reset role');
      equal((await db.query(`select bool_and(completed_at<=clock_timestamp()+interval '1 second') ok
        from private.deterministic_change_sets where state='completed'`)).rows[0].ok, true,
      'database completion clock ignores forged future worker time');
      const actual = (await db.query(`select node_key,value_canonical
        from private.deterministic_aggregate_states where business_entity_id=(select business_entity_id
          from private.integration_connections where id=$1) order by node_key`, [cid])).rows;
      equal(actual, [{ node_key: 'recognized_revenue_month_total', value_canonical: expected },
        { node_key: 'revenue', value_canonical: expected }], 'canonical contribution drives exact aggregate and KPI states');
    }
    await calculate('100.25');
    await summary('current', '100.25');
    const writer = new Client({ ...connection, statement_timeout: 1000 });
    try {
      await writer.connect();
      await db.query('begin'); await db.query('set local role authenticated');
      await call('read_qbo_customer_accounting_summary_v1', [cid]);
      await writer.query("set lock_timeout='100ms'");
      await assert.rejects(() => writer.query('begin; lock table private.fact_contribution_events in row exclusive mode'),
        error => error.code === '55P03', 'customer summary holds the contribution write fence through its snapshot'); assertions++;
      await writer.query('rollback'); await db.query('commit'); await db.query('reset role');
    } finally { await writer.end(); }
    const active = async () => (await db.query(`select trim_scale(coalesce(sum(e.value),0))::text amount,count(*)::int events
      from private.fact_contribution_events e where e.event_kind='establish' and not exists(select 1
        from private.fact_contribution_events r where r.target_contribution_event_id=e.id and r.event_kind='retract')`)).rows[0];
    equal(await active(), { amount: '100.25', events: 1 }, 'exact native nonduplicate revenue contribution');
    await ingest('Account', { Id: 'unrelated-110', SyncToken: '1', Active: true, AccountType: 'Accounts Receivable',
      CurrencyRef: { value: 'USD' }, MetaData: metadata });
    await mapAndCommit();
    equal(await active(), { amount: '100.25', events: 1 }, 'unrelated Account evidence cannot duplicate or withdraw unchanged revenue');
    equal((await db.query('select count(*)::int n from private.fact_contribution_events')).rows[0].n, 1,
      'account-context refresh creates no financial event for an unchanged fact');
    await ingest('Invoice', sales('80.25', '2'));
    await summary('pending', null);
    await mapAndCommit();
    equal(await active(), { amount: '80.25', events: 1 }, 'correction replaces rather than adds revenue');
    await calculate('80.25');
    await summary('current', '80.25');
    equal((await db.query('select count(*)::int n from private.fact_contribution_events')).rows[0].n, 3, 'one initial, one retraction, one replacement event');
    equal((await db.query('select count(*)::int n from private.canonical_business_facts')).rows[0].n, 1, 'stable canonical fact identity');
    equal((await db.query('select count(*)::int n from private.canonical_business_fact_versions')).rows[0].n, 3, 'immutable invalidation and correction versions');
    await ingest('Account', { Id: 'income-401', SyncToken: '2', Active: false, AccountType: 'Income',
      CurrencyRef: { value: 'USD' }, MetaData: metadata });
    equal(await active(), { amount: '0', events: 0 }, 'changed corroborating Account atomically invalidates prior contribution');
    await mapAndCommit();
    equal(await active(), { amount: '80.25', events: 1 }, 'inactive but validated Account still proves historical posting classification');
    await db.query('set role authenticated');
    const withdrawn = await call('set_qbo_customer_accounting_authority_v1', [cid, consent.authorityId, false, effectiveFrom]);
    equal(withdrawn.enabled, false, 'owner can withdraw financial authority');
    await db.query('reset role');
    equal(await active(), { amount: '0', events: 0 }, 'owner withdrawal atomically removes active contribution');
    await calculate('0');
    await summary('disabled', null);
    equal((await db.query(`select count(*)::int n from private.canonical_business_facts f
      join private.canonical_business_fact_versions v on v.id=f.current_version_id where v.reconciliation_state='accepted'`)).rows[0].n,
      1, 'owner withdrawal preserves truthful canonical source fact history');
    await db.query('set role authenticated');
    let restored = await call('set_qbo_customer_accounting_authority_v1', [cid, withdrawn.authorityId, true, effectiveFrom]);
    await db.query('reset role');
    await mapAndCommit();
    equal(await active(), { amount: '80.25', events: 1 }, 'explicit new consent reuses unchanged fact without double counting');
    await calculate('80.25');
    await db.query(`update private.integration_connections set status='error',state_reason_code='control_plane_error',
      status_changed_at=clock_timestamp(),row_version=row_version+1,updated_at=clock_timestamp() where id=$1`, [cid]);
    equal(await active(), { amount: '80.25', events: 1 }, 'transient connectivity loss preserves admitted accounting truth');
    await summary('disabled', null);
    await db.query(`update private.integration_connections set status='initializing',state_reason_code='initial_sync_pending',
      status_changed_at=clock_timestamp(),row_version=row_version+1,updated_at=clock_timestamp() where id=$1`, [cid]);
    await summary('current', '80.25');
    await mapAndCommit();
    equal(await active(), { amount: '80.25', events: 1 }, 'same-generation retry does not duplicate or orphan contributions');
    await ingest('Invoice', { ...sales('50.25', '3'), TxnDate: '2026-09-28' });
    await mapAndCommit('review_required');
    equal(await active(), { amount: '0', events: 0 }, 'pre-consent correction cannot remain financially admitted');
    await calculate('0');
    await ingest('Invoice', sales('80.25', '4'));
    await mapAndCommit(); await calculate('80.25');
    await ingest('Invoice', { ...sales('0', '5'), Voided: true });
    equal(await active(), { amount: '0', events: 0 }, 'void source head immediately withdraws the prior effect');
    await mapAndCommit('retraction_required');
    await calculate('0');
    await ingest('Invoice', sales('80.25', '6'));
    await mapAndCommit();
    await calculate('80.25');
    equal(await active(), { amount: '80.25', events: 1 }, 'restoration advances the canonical fact history once');
    for (const target of ['inactive', 'pending_verification', 'active']) {
      const mapping = (await db.query('select * from private.provider_entity_mappings where connection_id=$1 and mapping_version=1', [cid])).rows[0];
      await call('transition_provider_entity_mapping_v1', [{ workspaceId: mapping.workspace_id,
        businessEntityId: mapping.business_entity_id, connectionId: cid, mappingId: mapping.id,
        expectedRowVersion: Number(mapping.row_version), targetStatus: target,
        verificationFingerprint: target === 'active' ? `sha256:${'d'.repeat(64)}` : null,
        transitionedAt: new Date().toISOString() }, `native_mapping_${target}`, 'native_qualification']);
    }
    equal(await active(), { amount: '0', events: 0 }, 'mapping withdrawal retracts prior authority even after same-ID reinstatement');
    await summary('disabled', null);
    await db.query('set role integration_provider_source_authority');
    await assert.rejects(() => call('read_qbo_accounting_page_v1', [cid, null, 25]), /qbo_accounting_authority_conflict/,
      'same-ID mapping reinstatement cannot reuse earlier owner authority'); assertions++;
    await db.query('set role authenticated');
    const renewed = await call('set_qbo_customer_accounting_authority_v1', [cid, restored.authorityId, true, effectiveFrom]);
    equal(renewed.idempotent, false, 'mapping reapproval appends distinct explicit owner authority');
    restored = renewed;
    await db.query('reset role');
    await mapAndCommit();
    equal(await active(), { amount: '80.25', events: 1 }, 'new owner grant can restore one exact contribution');
    const rowVersion = (await db.query('select row_version from private.integration_connections where id=$1', [cid])).rows[0].row_version;
    await db.query('set role authenticated');
    await call('request_integration_disconnect_v1', [cid, rowVersion, 'native_accounting_disconnect']);
    await db.query('reset role');
    equal(await active(), { amount: '0', events: 0 }, 'canonical disconnect withdraws financial effects immediately');
    await summary('disabled', null);
    await db.query('set role integration_provider_source_authority');
    const work = await call('claim_qbo_accounting_work_v1', [1]);
    equal(work, [{ connectionId: cid, admissionEnabled: false }], 'disconnected authority is discovered only for deterministic withdrawal');
    await db.query('reset role');
    await calculate('0');
    await db.query('set role authenticated');
    await call('set_qbo_customer_accounting_authority_v1', [cid, restored.authorityId, false, effectiveFrom]);
    await db.query('reset role');
    await db.query('set role integration_provider_source_authority');
    equal((await calculateQboAccounting(cid, { rpc: transport })).idempotent, true, 'authority revocation after disconnect does not duplicate calculation');
    await db.query('reset role');
    return assertions;
  } finally { await db.query('rollback').catch(() => {}); await db.end(); }
}
module.exports = { accountingNativeQualification };
