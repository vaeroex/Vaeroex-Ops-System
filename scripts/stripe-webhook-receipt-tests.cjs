/* eslint-disable @typescript-eslint/no-require-imports -- Run the real webhook with controlled provider/database I/O. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalTs = require.extensions['.ts'];

let rows, writes, rpcCalls, routedEvents, providerReads, capacityHandler, currentSubscription, rpcHandler, auditEvents, observationClaims, claimHandler, observationSteps;
const admin = {
  from(table) {
    if (table === 'customer_subscriptions') {
      const query = { update() { return query; }, eq() { return query; }, in() { return query; }, is() { return query; }, select() { return query; },
        async maybeSingle() { return { data: null, error: null }; } };
      return query; // Welcome email was already handled; no email is sent by this fixture.
    }
    assert.equal(table, 'subscription_events');
    let mutation = null;
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      insert(value) { mutation = { kind: 'insert', value }; return query; },
      update(value) { mutation = { kind: 'update', value }; return query; },
      async maybeSingle() { return execute(); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
    };
    function execute() {
      let row = rows.find(candidate => Object.entries(filters).every(([key, value]) => candidate[key] === value));
      if (mutation) {
        writes.push(structuredClone(mutation));
        if (mutation.kind === 'insert') {
          row = { id: `receipt_${rows.length + 1}`, ...structuredClone(mutation.value) };
          rows.push(row);
        } else {
          if (row) Object.assign(row, structuredClone(mutation.value));
        }
      }
      return { data: row ? structuredClone(row) : null, error: null };
    }
    return query;
  },
  async rpc(name, args) {
    if (name === 'claim_stripe_subscription_observation_v1') {
      observationClaims.push(structuredClone(args));
      observationSteps.push(`claim:${args.p_stripe_subscription_id}`);
      return claimHandler(args);
    }
    rpcCalls.push({ name, args });
    assert.ok(['sync_stripe_subscription_entitlement_v1', 'sync_stripe_subscription_entitlement_v2'].includes(name));
    return rpcHandler(args);
  }
};

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: filename
}).outputText, filename);
Module._resolveFilename = function(request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
Module._load = function(request, parent, isMain) {
  if (request === 'server-only') return {};
  if (request === '@/lib/supabase/config') return { getAppUrl: () => 'https://example.test' };
  return originalLoad.call(this, request, parent, isMain);
};
const stripe = require('../lib/stripe/billing.ts');
const { minimizeStripeWebhookReceipt } = require('../lib/stripe/webhook-receipt.ts');
Module._load = function(request, parent, isMain) {
  if (request === 'next/server') return { NextResponse: { json: (value, options) => Response.json(value, options) } };
  if (request === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin };
  if (request === '@/lib/storage-capacity/billing') return {
    processCapacityStripeEvent: async (client, event) => {
      assert.equal(client, admin);
      routedEvents.push(event);
      return capacityHandler(event);
    }
  };
  if (request === '@/lib/email/welcome') return { sendVaeroexWelcomeEmail: () => { throw new Error('Unexpected welcome email'); } };
  if (request === '@/lib/security/tool-execution-gateway') return { logSecurityAuditEvent: async value => { auditEvents.push(value); } };
  if (request === '@/lib/stripe/billing') return {
    ...stripe,
    retrieveStripeSubscription: async id => {
      providerReads.push(id);
      observationSteps.push(`retrieve:${id}`);
      return structuredClone({ id, ...currentSubscription });
    },
    retrieveStripeCustomer: async id => {
      providerReads.push(id);
      return { id, email: 'owner@example.test', name: 'Synthetic Owner' };
    }
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { POST } = require('../app/api/stripe/webhook/route.ts');
Module._resolveFilename = originalResolve;
Module._load = originalLoad;
if (originalTs) require.extensions['.ts'] = originalTs;
else delete require.extensions['.ts'];

const omittedFields = ['address', 'customer_address', 'customer_shipping', 'shipping', 'billing_details',
  'billing_address', 'shipping_address', 'client_secret', 'next_action', 'hosted_invoice_url', 'invoice_pdf', 'receipt_url'];
function sensitiveFields() {
  return Object.fromEntries(omittedFields.map(key => [key, `synthetic-sensitive-${key}`]));
}
function fixture() {
  return {
    id: 'evt_synthetic_receipt', object: 'event', type: 'invoice.paid', created: 1791763200, livemode: false,
    request: { id: 'req_synthetic', idempotency_key: 'synthetic-request' },
    data: {
      object: {
        id: 'in_synthetic', object: 'invoice', subscription: 'sub_synthetic', customer: 'cus_synthetic',
        customer_email: 'owner@example.test', amount_due: 500, amount_paid: 500, currency: 'usd', status: 'paid',
        metadata: { product: 'workspace_storage_capacity', capacity_intent_id: 'intent_synthetic', workspace_id: 'workspace_synthetic', arbitrary_audit_key: 'preserved' },
        ...sensitiveFields(),
        customer_details: { email: 'owner@example.test', name: 'Synthetic Owner', address: { line1: 'synthetic address' } },
        payment_intent: { id: 'pi_synthetic', amount: 500, client_secret: 'pi_synthetic_secret_value' },
        evidence: { billing_address: 'synthetic billing address', shipping_address: 'synthetic shipping address', receipt: 'file_synthetic' },
        lines: { data: [{ id: 'il_synthetic', amount: 500, period: { start: 1791763200, end: 1794441600 },
          expanded: sensitiveFields(), nested: [null, false, 0, 'ordinary string', sensitiveFields()] }] }
      },
      previous_attributes: { status: 'open', ...sensitiveFields() }
    }
  };
}
function assertMinimized(value) {
  if (Array.isArray(value)) return value.forEach(assertMinimized);
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(omittedFields.includes(key), false, `receipt must omit ${key}`);
    assertMinimized(nested);
  }
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
function requestFor(event, validSignature = true) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://example.test/api/stripe/webhook', {
    method: 'POST', body,
    headers: { 'stripe-signature': `t=${timestamp},v1=${validSignature ? signature : '0'.repeat(64)}` }
  });
}
test.beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_synthetic_receipt_only';
  rows = []; writes = []; rpcCalls = []; routedEvents = []; providerReads = []; auditEvents = []; observationClaims = []; observationSteps = [];
  claimHandler = async () => ({ data: observationClaims.length, error: null });
  currentSubscription = { customer: 'cus_base', status: 'active', current_period_start: 1791763200, current_period_end: 1794441600,
    metadata: { purchase_intent_id: 'intent_base', vaeroex_user_id: 'actor_base' },
    items: { data: [{ price: { id: 'price_base' } }] } };
  rpcHandler = async args => ({ data: { subscription_record_id: 'base_record', workspace_id: 'base_workspace', status: args.p_status }, error: null });
  capacityHandler = async () => ({ handled: true });
});

test('receipt removes nested address containers and payment credentials without mutating the verified event', () => {
  const event = fixture();
  const original = structuredClone(event);
  freezeDeep(event);
  const receipt = minimizeStripeWebhookReceipt(event);
  assertMinimized(receipt);
  assert.deepEqual(event, original);
  assert.notEqual(receipt, event);
  assert.notEqual(receipt.data.object.metadata, event.data.object.metadata);
  assert.notEqual(receipt.data.object.lines.data, event.data.object.lines.data);
});

test('receipt preserves attribution, amounts, periods, envelope and audit fields for capacity and base events', () => {
  const event = fixture();
  for (const metadata of [event.data.object.metadata, { purchase_intent_id: 'intent_base', vaeroex_user_id: 'actor_base', arbitrary_audit_key: 'preserved' }]) {
    event.data.object.metadata = metadata;
    const receipt = minimizeStripeWebhookReceipt(event);
    for (const key of ['id', 'object', 'type', 'created', 'livemode', 'request']) assert.deepEqual(receipt[key], event[key]);
    for (const key of ['id', 'subscription', 'customer', 'customer_email', 'amount_due', 'amount_paid', 'currency', 'status', 'metadata']) {
      assert.deepEqual(receipt.data.object[key], event.data.object[key]);
    }
    assert.deepEqual(receipt.data.object.lines.data[0].period, event.data.object.lines.data[0].period);
    assert.deepEqual(receipt.data.object.lines.data[0].nested, [null, false, 0, 'ordinary string', {}]);
    assert.deepEqual(receipt.data.object.payment_intent, { id: 'pi_synthetic', amount: 500 });
    assert.deepEqual(receipt.data.object.evidence, { receipt: 'file_synthetic' });
    assert.deepEqual(receipt.data.previous_attributes, { status: 'open' });
  }
});

test('failed first receipt and retry are minimized before capacity routing, then duplicate is idempotent', async () => {
  const event = fixture();
  capacityHandler = async received => {
    assert.deepEqual(received, event, 'processing still receives the full original verified event');
    assertMinimized(rows[0].payload_json);
    assert.equal(writes.filter(write => write.value.payload_json).length, routedEvents.length);
    if (routedEvents.length === 1) throw new Error('Synthetic transient provider failure');
    return { handled: true };
  };
  assert.equal((await POST(requestFor(event))).status, 500);
  assert.equal(rows[0].processed, false);
  assert.equal(rows[0].processing_error, 'Synthetic transient provider failure');
  assert.equal((await POST(requestFor(event))).status, 200);
  const receipts = writes.filter(write => write.value.payload_json);
  assert.deepEqual(receipts.map(write => write.kind), ['insert', 'update']);
  receipts.forEach(write => {
    assertMinimized(write.value.payload_json);
    assert.equal(write.value.stripe_subscription_id, 'sub_synthetic');
  });
  assert.equal(rows[0].processed, true);
  assert.equal(rows[0].processing_error, null);
  const writeCount = writes.length;
  const duplicate = await POST(requestFor(event));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(writes.length, writeCount);
  assert.equal(routedEvents.length, 2);
  assert.equal(rpcCalls.length, 0, 'capacity events never enter base reconciliation');
  assert.equal(providerReads.length, 0, 'receipt minimization adds no provider retrieval');
});

test('unclassified base invoice keeps existing reconciliation while its shared receipt is minimized', async () => {
  const event = fixture();
  event.data.object.metadata = {};
  event.data.object.subscription = 'sub_base';
  event.data.object.customer = 'cus_base';
  capacityHandler = async received => {
    assert.deepEqual(received, event);
    assertMinimized(rows[0].payload_json);
    return { handled: false };
  };
  assert.equal((await POST(requestFor(event))).status, 200);
  assert.deepEqual(providerReads, ['sub_base', 'cus_base']);
  assert.equal(rpcCalls.length, 1);
  const args = rpcCalls[0].args;
  assert.deepEqual(args.p_raw_payload, event, 'existing base audit reconciliation remains unchanged');
  assert.equal(args.p_event_id, event.id);
  assert.equal(args.p_stripe_subscription_id, 'sub_base');
  assert.equal(args.p_stripe_customer_id, 'cus_base');
  assert.equal(args.p_checkout_intent_id, 'intent_base');
  assert.equal(args.p_user_id, 'actor_base');
  assert.equal(args.p_customer_email, 'owner@example.test');
  assert.equal(rows[0].processed, true);
  assertMinimized(rows[0].payload_json);
});

test('signature failure cannot persist or route an event', async () => {
  assert.equal((await POST(requestFor(fixture(), false))).status, 401);
  assert.equal(writes.length, 0);
  assert.equal(routedEvents.length, 0);
});


function baseInvoice(type = 'invoice.paid', modern = true) {
  const event = fixture();
  event.type = type;
  event.data.object.metadata = {};
  event.data.object.customer = 'cus_base';
  event.data.object.amount_due = 25000;
  event.data.object.amount_paid = type === 'invoice.payment_failed' ? 0 : 25000;
  if (modern) {
    delete event.data.object.subscription;
    event.data.object.parent = { type: 'subscription_details', subscription_details: { subscription: 'sub_base' } };
  } else event.data.object.subscription = 'sub_base';
  return event;
}

for (const modern of [false, true]) {
  for (const type of ['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed']) {
    test(`${modern ? 'modern' : 'legacy'} signed ${type} reconciles the exact base entitlement`, async () => {
      const event = baseInvoice(type, modern);
      currentSubscription.status = type === 'invoice.payment_failed' ? 'past_due' : 'active';
      capacityHandler = async () => ({ handled: false });
      const response = await POST(requestFor(event));
      assert.equal(response.status, 200);
      assert.equal(rpcCalls.length, 1);
      const args = rpcCalls[0].args;
      assert.equal(rpcCalls[0].name, 'sync_stripe_subscription_entitlement_v2');
      assert.equal(args.p_observation_generation, 1);
      assert.deepEqual(observationSteps, ['claim:sub_base', 'retrieve:sub_base']);
      assert.equal(args.p_stripe_subscription_id, 'sub_base');
      assert.equal(args.p_stripe_customer_id, 'cus_base');
      assert.equal(args.p_checkout_intent_id, 'intent_base');
      assert.equal(args.p_user_id, 'actor_base');
      assert.equal(args.p_status, currentSubscription.status);
      assert.equal(args.p_event_created_at, new Date(event.created * 1000).toISOString());
      assert.equal(args.p_event_id, event.id);
      assert.equal(args.p_event_type, event.type);
      assert.equal(args.p_plan_slug, 'vaeroex');
      assert.equal(rows[0].processed, true);
      assert.equal(rows[0].stripe_subscription_id, 'sub_base');
      assert.equal(auditEvents[0].workspaceId, 'base_workspace');
      assertMinimized(rows[0].payload_json);
      assert.deepEqual(providerReads, ['sub_base', 'cus_base']);
    });
  }
}

test('subscription references accept expanded modern and matching legacy IDs', () => {
  const invoice = baseInvoice().data.object;
  invoice.subscription = { id: 'sub_base' };
  invoice.parent.subscription_details.subscription = { id: 'sub_base' };
  assert.equal(stripe.stripeInvoiceSubscriptionId(invoice), 'sub_base');
  assert.equal(stripe.stripeInvoiceSubscriptionId({ id: 'in_oneoff', parent: null }), null);
});

for (const [name, mutate] of [
  ['conflicting subscription IDs', invoice => { invoice.subscription = 'sub_foreign'; }],
  ['incorrect parent type', invoice => { invoice.parent.type = 'quote_details'; }],
  ['missing parent type', invoice => { delete invoice.parent.type; }],
  ['missing modern reference with legacy fallback', invoice => { invoice.subscription = 'sub_base'; delete invoice.parent.subscription_details.subscription; }]
]) {
  test(`${name} cannot reconcile a signed invoice`, async () => {
    const event = baseInvoice(); mutate(event.data.object);
    capacityHandler = async () => ({ handled: false });
    assert.equal((await POST(requestFor(event))).status, 500);
    assert.equal(rpcCalls.length, 0);
    assert.equal(providerReads.length, 0);
    assert.equal(rows[0].processed, false);
    assert.equal(rows[0].stripe_subscription_id, null, 'conflicting references must not select a receipt attribution');
  });
}

for (const [name, mutate] of [
  ['foreign invoice customer', invoice => { invoice.customer = 'cus_foreign'; }],
  ['missing invoice customer', invoice => { delete invoice.customer; }],
  ['wrong retrieved subscription', () => { currentSubscription.id = 'sub_foreign'; }]
]) {
  test(`${name} fails before entitlement or customer lookup`, async () => {
    const event = baseInvoice(); mutate(event.data.object);
    capacityHandler = async () => ({ handled: false });
    assert.equal((await POST(requestFor(event))).status, 500);
    assert.deepEqual(providerReads, ['sub_base']);
    assert.equal(rpcCalls.length, 0);
    assert.equal(rows[0].processed, false);
    assert.match(rows[0].processing_error, /attribution disagree/);
  });
}

test('modern payment failure then recovery uses current provider state, preserves event time, and duplicate does no work', async () => {
  capacityHandler = async () => ({ handled: false });
  const failed = baseInvoice('invoice.payment_failed');
  currentSubscription.status = 'past_due';
  assert.equal((await POST(requestFor(failed))).status, 200);
  const recovered = baseInvoice('invoice.paid');
  recovered.id = 'evt_recovered'; recovered.created += 1;
  currentSubscription.status = 'active';
  assert.equal((await POST(requestFor(recovered))).status, 200);
  assert.deepEqual(rpcCalls.map(call => call.args.p_status), ['past_due', 'active']);
  assert.deepEqual(rpcCalls.map(call => call.args.p_event_created_at), [failed, recovered].map(event => new Date(event.created * 1000).toISOString()));
  const reads = providerReads.length;
  assert.equal((await (await POST(requestFor(recovered))).json()).duplicate, true);
  assert.equal(rpcCalls.length, 2);
  assert.equal(providerReads.length, reads);
  assert.equal(rows.length, 2);
});

test('older failure delivery retains original ordering and uses current active provider status', async () => {
  capacityHandler = async () => ({ handled: false });
  const paid = baseInvoice(); paid.id = 'evt_latest';
  assert.equal((await POST(requestFor(paid))).status, 200);
  const oldFailure = baseInvoice('invoice.payment_failed'); oldFailure.id = 'evt_old_failure'; oldFailure.created -= 60;
  assert.equal((await POST(requestFor(oldFailure))).status, 200);
  const args = rpcCalls[1].args;
  assert.equal(args.p_status, 'active', 'an old invoice failure must not be treated as the current subscription status');
  assert.equal(args.p_event_created_at, new Date(oldFailure.created * 1000).toISOString(), 'the native RPC retains authority to reject stale ordering');
  assert.equal(args.p_event_id, oldFailure.id);
});

test('native RPC workspace-binding rejection stays retryable and never marks an invoice processed', async () => {
  capacityHandler = async () => ({ handled: false });
  currentSubscription.metadata.vaeroex_user_id = 'actor_foreign';
  rpcHandler = async () => ({ data: null, error: { code: '42501', message: 'Stripe purchase intent attribution is invalid.' } });
  assert.equal((await POST(requestFor(baseInvoice()))).status, 500);
  assert.equal(rpcCalls[0].args.p_checkout_intent_id, 'intent_base');
  assert.equal(rpcCalls[0].args.p_user_id, 'actor_foreign');
  assert.equal(rows[0].processed, false);
  assert.equal(auditEvents[0].allowed, false);
});

test('completed base Checkout still binds the trusted intent and grants access without a second purchase', async () => {
  capacityHandler = async () => ({ handled: false });
  const event = fixture(); event.type = 'checkout.session.completed';
  event.data.object = { id: 'cs_base', mode: 'subscription', status: 'complete', payment_status: 'paid', amount_total: 25000,
    customer: 'cus_base', subscription: 'sub_base', client_reference_id: 'intent_base', customer_email: 'owner@example.test',
    metadata: { product: 'operations_intelligence', purchase_intent_id: 'intent_base', vaeroex_user_id: 'actor_base' } };
  const result = await POST(requestFor(event));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, 'active');
  assert.equal(rpcCalls[0].args.p_checkout_intent_id, 'intent_base');
  assert.equal(rpcCalls[0].args.p_user_id, 'actor_base');
  assert.equal(auditEvents[0].workspaceId, 'base_workspace');
  assert.deepEqual(providerReads, ['sub_base', 'cus_base'], 'webhook performs reads only, never creates another Checkout or charge');
  assert.equal((await (await POST(requestFor(event))).json()).duplicate, true);
  assert.equal(rpcCalls.length, 1);
});


test('same-second failure and verified recovery carry distinct database generations without fabricating event time', async () => {
  capacityHandler = async () => ({ handled: false });
  const failed = baseInvoice('invoice.payment_failed');
  currentSubscription.status = 'past_due';
  assert.equal((await POST(requestFor(failed))).status, 200);
  const recovered = baseInvoice('invoice.paid'); recovered.id = 'evt_same_second_recovery';
  currentSubscription.status = 'active';
  assert.equal((await POST(requestFor(recovered))).status, 200);
  assert.deepEqual(rpcCalls.map(call => call.args.p_observation_generation), [1, 2]);
  assert.equal(rpcCalls[0].args.p_event_created_at, rpcCalls[1].args.p_event_created_at);
  assert.deepEqual(rpcCalls.map(call => call.args.p_status), ['past_due', 'active']);
});

test('superseded provider observation remains unprocessed and retry claims a fresh generation', async () => {
  capacityHandler = async () => ({ handled: false });
  const event = baseInvoice();
  rpcHandler = async () => ({ data: null, error: { code: '40001', message: 'Stripe subscription observation was superseded; retry reconciliation.' } });
  assert.equal((await POST(requestFor(event))).status, 500);
  assert.equal(rows[0].processed, false);
  assert.match(rows[0].processing_error, /superseded/);
  assert.equal(rows[0].stripe_subscription_id, 'sub_base', 'modern subscription attribution is retained even before successful reconciliation');
  rpcHandler = async args => ({ data: { subscription_record_id: 'base_record', workspace_id: 'base_workspace', status: args.p_status }, error: null });
  assert.equal((await POST(requestFor(event))).status, 200);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].processed, true);
  assert.deepEqual(rpcCalls.map(call => call.args.p_observation_generation), [1, 2]);
});

test('failed or invalid generation claim cannot start a provider observation', async () => {
  capacityHandler = async () => ({ handled: false });
  for (const [index, result] of [
    { data: null, error: { code: '40001' } },
    { data: 0, error: null },
    { data: 1.5, error: null },
    { data: Number.MAX_SAFE_INTEGER + 1, error: null }
  ].entries()) {
    claimHandler = async () => result;
    const event = baseInvoice(); event.id = `evt_bad_generation_${index}`;
    assert.equal((await POST(requestFor(event))).status, 500);
  }
  assert.equal(providerReads.length, 0);
  assert.equal(rpcCalls.length, 0);
  assert.ok(rows.every(row => !row.processed));
});

for (const type of ['customer.subscription.created', 'customer.subscription.updated']) {
  test(`${type} fences the current provider read`, async () => {
    capacityHandler = async () => ({ handled: false });
    const event = fixture(); event.type = type; event.data.object = { id: 'sub_base', status: 'past_due' };
    assert.equal((await POST(requestFor(event))).status, 200);
    assert.deepEqual(observationSteps, ['claim:sub_base', 'retrieve:sub_base']);
    assert.equal(rpcCalls[0].name, 'sync_stripe_subscription_entitlement_v2');
    assert.equal(rpcCalls[0].args.p_status, 'active');
  });
}

test('subscription deletion retains terminal signed snapshot and conservative v1 ordering', async () => {
  capacityHandler = async () => ({ handled: false });
  const event = fixture(); event.type = 'customer.subscription.deleted';
  event.data.object = { id: 'sub_base', ...currentSubscription, status: 'canceled' };
  assert.equal((await POST(requestFor(event))).status, 200);
  assert.equal(observationClaims.length, 0);
  assert.deepEqual(providerReads, ['cus_base']);
  assert.equal(rpcCalls[0].name, 'sync_stripe_subscription_entitlement_v1');
  assert.equal(rpcCalls[0].args.p_status, 'canceled');
  assert.equal(rpcCalls[0].args.p_observation_generation, undefined);
});


test('superseded duplicate delivery cannot overwrite a receipt already completed by its concurrent winner', async () => {
  capacityHandler = async () => ({ handled: false });
  const event = baseInvoice();
  rpcHandler = async () => {
    // Another delivery committed the same event while this provider read was in flight.
    Object.assign(rows[0], { processed: true, processing_error: null, stripe_subscription_id: 'sub_base' });
    return { data: null, error: { code: '40001', message: 'Stripe subscription observation was superseded; retry reconciliation.' } };
  };
  assert.equal((await POST(requestFor(event))).status, 500);
  assert.equal(rows[0].processed, true);
  assert.equal(rows[0].processing_error, null);
  const priorClaims = observationClaims.length;
  assert.equal((await (await POST(requestFor(event))).json()).duplicate, true);
  assert.equal(observationClaims.length, priorClaims);
  assert.equal(rpcCalls.length, 1);
});
