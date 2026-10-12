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

let rows, writes, rpcCalls, routedEvents, providerReads, capacityHandler;
const admin = {
  from(table) {
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
          assert.ok(row, 'updates must address an existing receipt');
          Object.assign(row, structuredClone(mutation.value));
        }
      }
      return { data: row ? structuredClone(row) : null, error: null };
    }
    return query;
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    assert.equal(name, 'sync_stripe_subscription_entitlement_v1');
    return { data: { subscription_record_id: 'base_record', workspace_id: 'base_workspace', status: 'active' }, error: null };
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
  if (request === '@/lib/security/tool-execution-gateway') return { logSecurityAuditEvent: async () => undefined };
  if (request === '@/lib/stripe/billing') return {
    ...stripe,
    retrieveStripeSubscription: async id => {
      providerReads.push(id);
      return { id, customer: 'cus_base', status: 'active', current_period_start: 1791763200, current_period_end: 1794441600,
        metadata: { purchase_intent_id: 'intent_base', vaeroex_user_id: 'actor_base' },
        items: { data: [{ price: { id: 'price_base' } }] } };
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
  rows = []; writes = []; rpcCalls = []; routedEvents = []; providerReads = [];
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
