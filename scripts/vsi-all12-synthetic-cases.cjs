/* Pure, invented fixture data. No provider calls, credentials, SQL or live mode. */
const syntheticLabel = 'SYNTHETIC ONLY — Cedar Workshop, a fictional business; no customer or provider records';
const entity = {
  label: 'SYNTHETIC Cedar Workshop',
  timezone: 'UTC',
  currency: 'USD',
  correspondence: 'All fixture sources intentionally describe this fictional entity. Their records are not linked to one another.',
  completeness: 'Only the explicitly supplied records are covered; no complete business ledger, workforce, inventory or order population is asserted.',
};
const window = { start: '2026-10-01', end: '2026-10-02', observedAt: '2026-10-02T12:01:00.000Z' };

// These fields are shaped like retained importer outputs, not access tokens or
// fabricated OAuth grants. The disposable SQL fixture creates its own synthetic
// actor/session/authority state; none of this data may be inserted in production.
const fixtures = {
  quickbooks_online: {
    providerEnvironment: 'production', // Required contract value inside the isolated database only.
    sourceLabel: 'SYNTHETIC QBO invoice observation',
    observed_at: window.observedAt,
    projection: {
      contractVersion: 'qbo_source_record_minimized_v1',
      provider: { providerKey: 'quickbooks_online', realmId: 'synthetic-realm-not-an-account', sourceEnvironment: 'production' },
      recordType: 'Invoice', id: 'synthetic-qbo-invoice-1', displayName: null, active: true, status: 'active',
      metadata: { providerCreatedAt: '2026-10-01T09:00:00.000Z', providerUpdatedAt: '2026-10-02T09:00:00.000Z', syncToken: 'synthetic-version-not-a-credential' },
      temporal: { postingDate: '2026-10-01', providerCreatedAt: '2026-10-01T09:00:00.000Z', providerUpdatedAt: '2026-10-02T09:00:00.000Z' },
      accounting: { basis: 'accrual', sourceCurrency: 'USD', homeCurrency: 'USD', exchangeRate: '1' },
      relationships: {},
      amounts: { total: { amount: '1800', currency: 'USD' }, balance: { amount: '600', currency: 'USD' } },
      lines: [], providerVersionReference: 'synthetic-version-1', minimizationVersion: 'qbo_minimizer_v1',
    },
  },
  xero: {
    sourceLabel: 'SYNTHETIC Xero invoice and bill observations',
    scope: 'connected_account',
    records: [
      { record_id: 'synthetic-xero-invoice-1', day: '2026-10-01', metrics: [
        { key: 'invoices', value: 1, currency: 'USD' }, { key: 'billed', value: 1200, currency: 'USD' },
        { key: 'outstanding', value: 300, currency: 'USD' }, { key: 'bills', value: 0, currency: 'USD' },
        { key: 'purchases', value: 0, currency: 'USD' },
      ] },
      { record_id: 'synthetic-xero-bill-zero', day: '2026-10-01', metrics: [
        { key: 'invoices', value: 0, currency: 'USD' }, { key: 'billed', value: 0, currency: 'USD' },
        { key: 'outstanding', value: 0, currency: 'USD' }, { key: 'bills', value: 1, currency: 'USD' },
        { key: 'purchases', value: 0, currency: 'USD' },
      ] },
    ],
  },
  'zoho-books': {
    sourceLabel: 'SYNTHETIC Zoho Books USD invoice', currency_code: 'USD',
    // Invented numeric ID satisfies the retained provider identifier contract;
    // it does not name or authorize access to a real Zoho record.
    records: [{ kind: 'invoice', source_id: '990000001', day: '2026-10-01', counted: true, currency: 'USD', total: 800, outstanding: 0 }],
  },
  'wix-orders': {
    sourceLabel: 'SYNTHETIC Wix approved orders',
    // Fixed invented UUIDs satisfy the stored order_id type. The runner must
    // preserve these exact IDs in both retained rows and expected-fact records.
    records: [
      { order_id: '00000000-0000-4000-8000-000000000801', created_at: '2026-10-01T10:00:00.000Z', total_amount: 500, currency_code: 'USD', payment_status: 'NOT_PAID' },
      { order_id: '00000000-0000-4000-8000-000000000802', created_at: '2026-10-02T10:00:00.000Z', total_amount: 0, currency_code: 'USD', payment_status: 'PAID' },
    ],
  },
  square: {
    sourceLabel: 'SYNTHETIC Square payment observations',
    records: [
      { payment_id: 'synthetic-square-payment-1', status: 'COMPLETED', created_at: '2026-10-01T11:00:00.000Z', updated_at: '2026-10-01T11:01:00.000Z', amount_minor: 12345, currency: 'USD' },
      { payment_id: 'synthetic-square-pending-1', status: 'PENDING', created_at: '2026-10-01T11:02:00.000Z', updated_at: '2026-10-01T11:02:00.000Z', amount_minor: 5000, currency: 'USD' },
    ],
  },
  loyverse: {
    sourceLabel: 'SYNTHETIC Loyverse receipt observations', currency_code: 'USD',
    records: [
      { receipt_number: 'synthetic-sale-1', store_id: 'synthetic-store', receipt_date: '2026-09-30T23:00:00.000Z', created_at: '2026-10-01T01:00:00.000Z', updated_at: '2026-10-01T01:00:00.000Z', receipt_type: 'SALE', total_money: 120, total_tax: 10, total_discount: 5, cancelled: false },
      { receipt_number: 'synthetic-refund-1', store_id: 'synthetic-store', receipt_date: '2026-10-01T12:00:00.000Z', created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:00:00.000Z', receipt_type: 'REFUND', total_money: 25, total_tax: 2, total_discount: 0, cancelled: false },
      { receipt_number: 'synthetic-sale-zero', store_id: 'synthetic-store', receipt_date: '2026-10-01T13:00:00.000Z', created_at: '2026-10-01T13:00:00.000Z', updated_at: '2026-10-01T13:00:00.000Z', receipt_type: 'SALE', total_money: 0, total_tax: 0, total_discount: 0, cancelled: false },
      { receipt_number: 'synthetic-cancelled-sale', store_id: 'synthetic-store', receipt_date: '2026-10-01T14:00:00.000Z', created_at: '2026-10-01T14:00:00.000Z', updated_at: '2026-10-01T14:01:00.000Z', receipt_type: 'SALE', total_money: 500, total_tax: 40, total_discount: 0, cancelled: true },
    ],
  },
  google_sheets: {
    sourceLabel: 'SYNTHETIC manually recorded operations, not provider-derived finance',
    rows: [
      { record_id: 'synthetic-operations-oct01', normalized_projection: { date: '2026-10-01', metrics: [
        { column: 1, name: 'Synthetic orders awaiting payment confirmation', value: '3', unit: 'count' },
        { column: 2, name: 'Synthetic unfulfilled orders', value: '4', unit: 'count' },
      ] } },
      { record_id: 'synthetic-operations-oct02', normalized_projection: { date: '2026-10-02', metrics: [
        { column: 1, name: 'Synthetic orders awaiting payment confirmation', value: '0', unit: 'count' },
        { column: 2, name: 'Synthetic orders awaiting stock review', value: '2', unit: 'count' },
      ] } },
    ],
  },
  harvest: {
    sourceLabel: 'SYNTHETIC Harvest permission-visible entries', scope: 'permission_visible_entries',
    records: [
      { record_id: 'synthetic-harvest-completed', day: '2026-10-01', metrics: [
        { key: 'entries', value: 1 }, { key: 'hours', value: 8 }, { key: 'billable_hours', value: 6 }, { key: 'running', value: 0 },
      ] },
      { record_id: 'synthetic-harvest-running', day: '2026-10-02', metrics: [
        { key: 'entries', value: 0 }, { key: 'hours', value: 0 }, { key: 'billable_hours', value: 0 }, { key: 'running', value: 1 },
      ] },
    ],
  },
  clockify: {
    sourceLabel: 'SYNTHETIC Clockify connected-user entries', scope: 'connected_user',
    records: [
      { record_id: 'synthetic-clockify-completed', day: '2026-10-01', metrics: [
        { key: 'entries', value: 1 }, { key: 'hours', value: 2 }, { key: 'billable_hours', value: 0 }, { key: 'running', value: 0 },
      ] },
      { record_id: 'synthetic-clockify-zero', day: '2026-10-02', metrics: [
        { key: 'entries', value: 1 }, { key: 'hours', value: 0 }, { key: 'billable_hours', value: 0 }, { key: 'running', value: 0 },
      ] },
    ],
  },
  toggl: {
    sourceLabel: 'SYNTHETIC Toggl visible active project lifetime snapshot', scope: 'visible_active_projects_lifetime',
    snapshot: { start: '2026-10-02T12:00:00.000Z', end: '2026-10-02T12:00:00.000Z', metrics: [{ key: 'projects', value: 2 }, { key: 'hours', value: 100 }] },
    last_sync_at: window.observedAt,
  },
  'zoho-inventory': {
    sourceLabel: 'SYNTHETIC Zoho Inventory aggregate snapshot', scope: 'current_inventory_counts',
    snapshot: { start: '2026-10-02T12:00:00.000Z', end: '2026-10-02T12:00:00.000Z', metrics: [{ key: 'items', value: 20 }, { key: 'low_stock', value: 2 }] },
    last_sync_at: window.observedAt,
  },
  katana: {
    sourceLabel: 'SYNTHETIC Katana aggregate variant/location record snapshot', scope: 'current_stock_counts',
    snapshot: { start: '2026-10-02T12:00:00.000Z', end: '2026-10-02T12:00:00.000Z', metrics: [{ key: 'stock_rows', value: 5 }, { key: 'unavailable', value: 0 }] },
    last_sync_at: window.observedAt,
  },
};

const commonUsefulness = [
  'Identify the explicitly synthetic scope and support every selected fact with its issued source reference.',
  'Use the requested providers together to identify a concrete next check or a precise reason a requested conclusion is unavailable; separate provider summaries or generic review-alongside language are insufficient.',
  'Retain each observation date, units and coverage limits. A supplied date label or common entity does not establish a matched event, common reporting period or complete population.',
  'Keep hypotheses and recommended checks explicitly unverified; no draft label is accepted as proof of correctness.',
];
const commonProhibitions = [
  'Do not invent cross-system transaction, customer, order, invoice, item, employee or project identifiers.',
  'Do not infer causation, profit, cash loss, productivity, a trend or a ratio from these partial records.',
  'Do not add source totals or invent numerical calculations that were not issued by the application.',
  'Do not treat an unrequested provider or another case’s unavailable records as admitted evidence.',
];
const cases = [
  {
    id: 'accounting-and-orders',
    question: 'Using only the stored explicitly synthetic QuickBooks Online, Xero, Zoho Books and Wix Orders evidence for October 1–2, 2026, write a short executive brief about the financial stages and a specific next check. Distinguish document amounts, balances, order status, dates and incomplete coverage. Cite every requested source you use, state missing correspondence, and do not assume that the records describe the same transaction. Do not search the web.',
    providers: ['quickbooks_online', 'xero', 'zoho-books', 'wix-orders'],
    expectedFactPatterns: {
      quickbooks_online: ['total: 1800 USD', 'balance: 600 USD', 'posting date 2026-10-01'],
      xero: ['billed: 1200 USD', 'outstanding: 300 USD', 'invoices: 1 count'],
      'zoho-books': ['stored invoice: 800 USD', 'outstanding: 0 USD', 'document date 2026-10-01'],
      'wix-orders': ['amount: 500 USD', 'NOT_PAID', '2026-10-01T10:00:00'],
    },
    mockNextCheck: 'Check order-to-invoice references and payment or settlement records before relating the unpaid order status to the distinct invoice balances; establish whether the accounting systems overlap before combining any totals.',
    expectedFacts: [
      { provider: 'quickbooks_online', record: 'synthetic-qbo-invoice-1', field: 'amounts.total', value: '1800', unit: 'USD', date: '2026-10-01', timeBasis: 'posting_date' },
      { provider: 'quickbooks_online', record: 'synthetic-qbo-invoice-1', field: 'amounts.balance', value: '600', unit: 'USD', timeBasis: 'balance_at_import', exactAsOf: null },
      { provider: 'xero', record: 'synthetic-xero-invoice-1', field: 'billed', value: '1200', unit: 'USD', date: '2026-10-01', timeBasis: 'invoice_or_bill_date' },
      { provider: 'xero', record: 'synthetic-xero-invoice-1', field: 'outstanding', value: '300', unit: 'USD', timeBasis: 'balance_at_import', exactAsOf: null },
      { provider: 'zoho-books', record: '990000001', field: 'total', value: '800', unit: 'USD', date: '2026-10-01', timeBasis: 'invoice_or_expense_date' },
      { provider: 'zoho-books', record: '990000001', field: 'outstanding', value: '0', unit: 'USD', timeBasis: 'balance_at_import', exactAsOf: null },
      { provider: 'wix-orders', record: '00000000-0000-4000-8000-000000000801', field: 'total_amount', value: '500', unit: 'USD', date: '2026-10-01', timeBasis: 'order_instant', paymentStatus: 'NOT_PAID' },
    ],
    requiredUsefulness: [...commonUsefulness,
      'Recommend checking order-to-invoice references and payment/settlement records before interpreting the NOT_PAID order alongside the distinct outstanding invoice observations.',
      'Explain why the three accounting systems could duplicate or differ in scope and therefore cannot be summed into total revenue or receivables.',
      'Keep the zero-valued Xero purchase bill distinct from the sales invoice. Keep the zero outstanding Zoho invoice as a valid balance observation without claiming when or how it was settled.',
    ],
    prohibitedInferences: [...commonProhibitions,
      'The Wix order is one of the QBO, Xero or Zoho invoices, or its amount is a portion of their balances.',
      'Posting/document dates establish historical balances on those dates or a common verified business day across all records.',
      'NOT_PAID or PAID order status proves cash settlement or accounting revenue.',
    ],
    negativeCases: ['purchase_bill_is_not_sales_invoice', 'different_entity_blocks_correspondence', 'mismatched_document_dates_are_not_aligned', 'fabricated_result_id_rejected', 'unknown_fact_binding_rejected'],
  },
  {
    id: 'payments-and-operations',
    question: 'Using only the stored explicitly synthetic Square, Loyverse and Google Sheets evidence selected for October 1–2, 2026, give a short operations brief and a specific evidence-based follow-up. Assess whether the records establish payment confirmation or settlement for the orders awaiting confirmation, and what further evidence that decision needs. Preserve payment units, receipt status and event dates, distinguish the operational counts, and state what would be required before matching these records or combining amounts. Cite the selected originals. Do not search the web.',
    providers: ['square', 'loyverse', 'google_sheets'],
    expectedFactPatterns: {
      square: ['12345 USD minor units', 'completed payment', '2026-10-01T11:00:00'],
      loyverse: ['SALE receipt dated 2026-09-30T23:00:00', 'Stored total 120 USD', 'tax 10 USD', 'discount 5 USD', 'REFUND', 'cancelled, excluded'],
      google_sheets: ['awaiting payment confirmation: 3 count', 'supplied row date 2026-10-01', 'awaiting payment confirmation: 0 count'],
    },
    mockNextCheck: 'Check tender or receipt references and settlement status for orders awaiting payment confirmation before treating payment activity as confirmation for those orders; reconcile receipt event dates separately from import selection dates.',
    expectedFacts: [
      { provider: 'square', record: 'synthetic-square-payment-1', field: 'amount_minor', value: '12345', unit: 'USD minor units', date: '2026-10-01', timeBasis: 'payment_instant', status: 'COMPLETED' },
      { provider: 'loyverse', record: 'synthetic-sale-1', field: 'total_money', value: '120', unit: 'USD', date: '2026-09-30', timeBasis: 'receipt_instant', createdAt: '2026-10-01T01:00:00.000Z', type: 'SALE', cancelled: false, tax: '10', discount: '5' },
      { provider: 'loyverse', record: 'synthetic-refund-1', field: 'total_money', value: '25', unit: 'USD', date: '2026-10-01', timeBasis: 'receipt_instant', type: 'REFUND', cancelled: false, storedSign: 'positive' },
      { provider: 'loyverse', record: 'synthetic-sale-zero', field: 'total_money', value: '0', unit: 'USD', date: '2026-10-01', timeBasis: 'receipt_instant', type: 'SALE', cancelled: false },
      { provider: 'google_sheets', record: 'synthetic-operations-oct01', field: 'Synthetic orders awaiting payment confirmation', value: '3', unit: 'count', date: '2026-10-01', timeBasis: 'sheet_row_date' },
      { provider: 'google_sheets', record: 'synthetic-operations-oct02', field: 'Synthetic orders awaiting payment confirmation', value: '0', unit: 'count', date: '2026-10-02', timeBasis: 'sheet_row_date' },
    ],
    requiredUsefulness: [...commonUsefulness,
      'Recommend checking tender/receipt references and settlement status for the operations records awaiting payment confirmation; the recorded payment/receipt activity alone cannot clear those orders.',
      'Explain that the Loyverse SALE is selected by its October 1 creation time but has a September 30 receipt event date; do not relabel it October 1 activity.',
      'Keep the positive stored refund amount, zero sale and cancelled sale distinct. Do not net refund/sale amounts or treat tax and discount as extra adjustments to the retained total.',
    ],
    prohibitedInferences: [...commonProhibitions,
      'Square’s PENDING record is a completed payment.',
      '12345 USD minor units means 12345 USD, or a currency exponent conversion was supplied by this fixture.',
      'The three orders awaiting confirmation correspond to the payment or receipts, or the following zero count proves resolution or a trend.',
      'The cancelled receipt contributes to active sales/refund comparisons; refund signs may be changed or tax/discount added again.',
    ],
    negativeCases: ['pending_square_not_admitted_as_completed', 'loyverse_currency_missing', 'unknown_receipt_type_rejected', 'cancelled_receipt_not_active_sale', 'backdated_receipt_not_creation_day', 'sparse_operations_withhold_cause'],
  },
  {
    id: 'time-coverage',
    question: 'Using only the stored explicitly synthetic Harvest, Clockify and Toggl 2.0 evidence selected for October 1–2, 2026, explain whether a combined completed-hours comparison is supported and identify a specific next check before making that comparison. Preserve completed/running status, workforce coverage, dates and lifetime versus period scope. Cite all requested originals and do not assume matching people, entries or projects. Do not search the web.',
    providers: ['harvest', 'clockify', 'toggl'],
    expectedFactPatterns: {
      harvest: ['hours: 8 hours', 'billable hours: 6 hours', 'entry spent date 2026-10-01', 'running: 1 count'],
      clockify: ['hours: 2 hours', 'hours: 0 hours', 'entry start date (UTC)', 'connected user'],
      toggl: ['hours: 100 hours', 'Lifetime visible-active-project total', 'projects: 2 count'],
    },
    mockNextCheck: 'Establish matching people, projects and reporting periods across the time systems, exclude running entries, and check entry identifiers for overlap before comparing completed time; request period-specific Toggl evidence rather than treating its lifetime total as current-period work.',
    expectedFacts: [
      { provider: 'harvest', record: 'synthetic-harvest-completed', field: 'hours', value: '8', unit: 'hours', date: '2026-10-01', timeBasis: 'spent_date', scope: 'permission_visible_entries', billableHours: '6' },
      { provider: 'harvest', record: 'synthetic-harvest-running', field: 'running', value: '1', unit: 'count', date: '2026-10-02', completedHours: '0' },
      { provider: 'clockify', record: 'synthetic-clockify-completed', field: 'hours', value: '2', unit: 'hours', date: '2026-10-01', timeBasis: 'entry_start_utc_date', scope: 'connected_user', billableHours: '0' },
      { provider: 'clockify', record: 'synthetic-clockify-zero', field: 'hours', value: '0', unit: 'hours', date: '2026-10-02', timeBasis: 'entry_start_utc_date' },
      { provider: 'toggl', field: 'hours', value: '100', unit: 'hours', timeBasis: 'lifetime_project_snapshot', capturedAt: '2026-10-02T12:00:00.000Z', beginning: null, projects: '2' },
    ],
    requiredUsefulness: [...commonUsefulness,
      'Recommend first establishing the same people/project scope and reporting period, excluding running entries, and deduplicating entry identifiers before a combined hours comparison.',
      'Explain that Harvest permission-visible entries and Clockify’s connected-user entries may overlap or cover different people, while Toggl’s 100 hours are lifetime visible-active-project hours.',
      'If retained entries are absent in the offline empty-history variant, explain the coverage gap with citations instead of inventing hours or forcing a positive comparison.',
    ],
    prohibitedInferences: [...commonProhibitions,
      'Add 8, 2 and 100 into a workforce or October 1–2 total.',
      'Treat the running entry as completed work, the zero-duration entry as missing, or billable hours as billed revenue/payroll.',
      'Infer untracked work, staff productivity or employee performance from cross-tool differences.',
    ],
    negativeCases: ['empty_history_is_explicit', 'running_time_not_completed', 'lifetime_snapshot_not_period_hours', 'connected_user_not_all_staff', 'revoked_source_rejected'],
  },
  {
    id: 'inventory-context',
    question: 'Using only the stored explicitly synthetic Zoho Inventory, Katana and Google Sheets evidence selected for October 1–2, 2026, give a short inventory/operations brief and a concrete next check. Assess whether these counts establish stock availability for the orders awaiting stock review, and what further evidence that decision needs. Preserve snapshot scope and dates, identify missing item/location/order correspondence, and explain what the observations do and do not establish about operational follow-up. Cite the selected originals. Do not search the web.',
    providers: ['zoho-inventory', 'katana', 'google_sheets'],
    expectedFactPatterns: {
      'zoho-inventory': ['items: 20 count', 'low stock: 2 count', 'snapshot 2026-10-02T12:00:00'],
      katana: ['stock rows: 5 count', 'unavailable: 0 count', 'snapshot 2026-10-02T12:00:00'],
      google_sheets: ['unfulfilled orders: 4 count', 'awaiting stock review: 2 count', 'supplied row date 2026-10-02'],
    },
    mockNextCheck: 'Check item or variant identifiers, locations and quantity requirements for orders awaiting stock review against the low-stock records; preserve the different snapshot and operations dates and do not infer order-level availability from aggregate counts.',
    expectedFacts: [
      { provider: 'zoho-inventory', field: 'items', value: '20', unit: 'count', timeBasis: 'snapshot_capture', capturedAt: '2026-10-02T12:00:00.000Z', lowStockItems: '2' },
      { provider: 'katana', field: 'stock_rows', value: '5', unit: 'count', timeBasis: 'snapshot_capture', capturedAt: '2026-10-02T12:00:00.000Z', unavailableRows: '0' },
      { provider: 'google_sheets', record: 'synthetic-operations-oct01', field: 'Synthetic unfulfilled orders', value: '4', unit: 'count', date: '2026-10-01', timeBasis: 'sheet_row_date' },
      { provider: 'google_sheets', record: 'synthetic-operations-oct02', field: 'Synthetic orders awaiting stock review', value: '2', unit: 'count', date: '2026-10-02', timeBasis: 'sheet_row_date' },
    ],
    requiredUsefulness: [...commonUsefulness,
      'Recommend checking item/variant, location and quantity requirements for the two orders awaiting stock review against the low-stock item records; the aggregate counts do not identify which orders or items correspond.',
      'Explain that Zoho low-stock items and Katana unavailable variant/location rows use different units of enumeration; zero unavailable rows does not negate two low-stock items or clear any order.',
      'Separate October 1 unfulfilled-order observations from the October 2 inventory snapshots rather than claiming simultaneous measurement or a change over time.',
    ],
    prohibitedInferences: [...commonProhibitions,
      'The two low-stock items are exactly the two orders awaiting stock review, or the snapshots explain the four unfulfilled orders.',
      'Five Katana stock rows equal five SKUs or physical units, or zero unavailable rows means all stock is sufficient.',
      'The snapshots establish inventory movement, manufacturing profitability or a shortage trend.',
    ],
    negativeCases: ['snapshot_date_not_operational_row_date', 'same_count_is_not_item_order_linkage', 'zero_unavailable_not_missing', 'wrong_workspace_rejected', 'fabricated_sku_link_rejected'],
  },
];

const negativeCasePolicy = {
  mechanical: 'Wrong workspace, revoked authority, unknown fact bindings, fabricated result IDs, invalid typed source fields and status exclusions must be exercised through the real guards. A mock answer must not replace those checks.',
  manual: 'Unsupported causation, invented correspondence, misleading aggregation, period alignment and generic usefulness are manual answer-review failures. The current unverified-draft contract does not mechanically establish the truth of arbitrary prose; a schema pass is not a semantic pass.',
  fixtureUse: 'Negative case names are review/test requirements, not claims that those scenarios have run. Only the isolated runner receipt may report executed coverage.',
};

module.exports = { syntheticLabel, entity, window, fixtures, cases, negativeCasePolicy };
