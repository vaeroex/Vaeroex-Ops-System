import {
  QBO_ACCOUNTING_MINIMIZATION_VERSION,
  QBO_MASTER_RECORD_TYPES,
  QBO_PROVIDER_KEY,
  QBO_SOURCE_RECORD_CONTRACT_VERSION,
  QBO_TRANSACTION_RECORD_TYPES,
  QboAccountingBasisSchema,
  QboMinimizedSourceRecordSchema,
  type QboAccountingBasis,
  type QboMinimizedSourceRecord,
  type QboProviderMetadata,
  type QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";
import {
  IsoTimestampSchema,
  PersistedExchangeRateSchema,
  PersistedFactDecimalSchema
} from "@/lib/integrations/contracts/primitives";

type JsonRecord = Record<string, unknown>;

const transactionTypes = new Set<string>(QBO_TRANSACTION_RECORD_TYPES);
const masterTypes = new Set<string>(QBO_MASTER_RECORD_TYPES);

function fail(field: string): never {
  throw new Error(`qbo_contract_validation_failed:${field}`);
}

function object(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as JsonRecord;
}

function optionalObject(value: unknown, field: string): JsonRecord | null {
  if (value === undefined || value === null) return null;
  return object(value, field);
}

function requiredString(record: JsonRecord, key: string, field = key) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") fail(field);
  return value.trim();
}

function optionalString(record: JsonRecord, key: string) {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(key);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalBoolean(record: JsonRecord, key: string) {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") fail(key);
  return value;
}

function requiredTimestamp(value: unknown, field: string) {
  const parsed = IsoTimestampSchema.safeParse(value);
  if (!parsed.success) fail(field);
  // PostgreSQL stores instants, not their original offset/fraction spelling.
  // Fingerprint the same millisecond UTC representation returned by the RPCs.
  return new Date(parsed.data).toISOString();
}

function optionalTimestamp(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  return requiredTimestamp(value, field);
}

function optionalDate(record: JsonRecord, key: string) {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(key);
  return value;
}

function normalizeDecimalText(
  value: string,
  field: string,
  allowNegative: boolean,
  kind: "fact" | "exchange_rate" = "fact"
) {
  const trimmed = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) fail(field);
  if (!allowNegative && trimmed.startsWith("-")) fail(field);
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const normalizedInteger = integerPart;
  const normalizedFraction = fractionPart.replace(/0+$/, "");
  const normalized = normalizedFraction === "" ? normalizedInteger : `${normalizedInteger}.${normalizedFraction}`;
  const canonical = normalized === "0" ? "0" : `${negative ? "-" : ""}${normalized}`;
  try {
    return kind === "exchange_rate"
      ? PersistedExchangeRateSchema.parse(canonical)
      : PersistedFactDecimalSchema.parse(canonical);
  } catch {
    fail(field);
  }
}

function optionalDecimal(
  record: JsonRecord,
  key: string,
  options: { allowNegative: boolean; kind?: "fact" | "exchange_rate" }
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail(key);
    }
    const text = String(value);
    if (text.includes("e") || text.includes("E")) fail(key);
    return normalizeDecimalText(text, key, options.allowNegative, options.kind);
  }
  if (typeof value !== "string") fail(key);
  return normalizeDecimalText(value, key, options.allowNegative, options.kind);
}

function requiredCurrency(record: JsonRecord, key: string) {
  const ref = object(record[key], key);
  const value = requiredString(ref, "value", `${key}.value`).toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) fail(`${key}.value`);
  return value;
}

function optionalCurrency(record: JsonRecord, key: string) {
  const value = record[key];
  if (value === undefined || value === null) return null;
  return requiredCurrency(record, key);
}

function ref(value: unknown, field: string) {
  if (value === undefined || value === null) return null;
  const source = object(value, field);
  return {
    value: requiredString(source, "value", `${field}.value`),
    name: optionalString(source, "name")
  };
}

function metadata(raw: JsonRecord) {
  const meta = object(raw.MetaData, "MetaData");
  const providerCreatedAt = optionalTimestamp(meta.CreateTime, "MetaData.CreateTime");
  const providerUpdatedAt = optionalTimestamp(meta.LastUpdatedTime, "MetaData.LastUpdatedTime");
  if (providerCreatedAt === null && providerUpdatedAt === null) fail("MetaData");
  const syncToken = optionalString(raw, "SyncToken");
  return { providerCreatedAt, providerUpdatedAt, syncToken };
}

function provider(provider: QboProviderMetadata) {
  return {
    providerKey: QBO_PROVIDER_KEY,
    realmId: provider.realmId,
    sourceEnvironment: provider.sourceEnvironment
  } as const;
}

function parseBasis(value: unknown): QboAccountingBasis {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  if (normalized === "accrual") return "accrual";
  if (normalized === "cash") return "cash";
  return "unknown";
}

function relationshipEntries(raw: JsonRecord, keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, ref(raw[key], key)]));
}

function lineAmount(rawLine: JsonRecord, currency: string | null) {
  const amount = optionalDecimal(rawLine, "Amount", { allowNegative: true });
  if (amount === null) return null;
  if (currency === null) fail("Line.Amount.CurrencyRef");
  return { amount, currency };
}

function hasField(record: JsonRecord | null, keys: readonly string[]) {
  return record !== null && keys.some((key) => record[key] !== undefined && record[key] !== null);
}

function optionalMoney(record: JsonRecord, key: string, currency: string | null) {
  const amount = optionalDecimal(record, key, { allowNegative: true });
  if (amount === null) return null;
  if (currency === null) fail(`${key}.CurrencyRef`);
  return { amount, currency };
}

function hasDiscountDetail(record: JsonRecord | null) {
  return hasField(record, ["DiscountAmt", "DiscountRate", "DiscountPercent", "PercentBased",
    "DiscountAccountRef", "DiscountLineDetail"]);
}

function transactionAccountingEvidence(raw: JsonRecord, currency: string | null) {
  const tax = optionalObject(raw.TxnTaxDetail, "TxnTaxDetail");
  if (tax?.TaxLine !== undefined && tax.TaxLine !== null && !Array.isArray(tax.TaxLine)) fail("TxnTaxDetail.TaxLine");
  return {
    sparse: optionalBoolean(raw, "sparse") ?? false,
    globalTaxCalculation: optionalString(raw, "GlobalTaxCalculation"),
    totalTax: tax ? optionalMoney(tax, "TotalTax", currency) : null,
    hasTaxDetail: tax !== null,
    hasTaxLines: Array.isArray(tax?.TaxLine) && tax.TaxLine.length > 0,
    hasDiscountDetail: hasDiscountDetail(raw)
  };
}

function lineDetail(rawLine: JsonRecord, detailType: string | null, currency: string | null) {
  if (Object.keys(rawLine).some((key) => key.endsWith("LineDetail") && rawLine[key] !== null &&
    rawLine[key] !== undefined && key !== detailType)) fail("Line.DetailType");
  const detail = detailType ? optionalObject(rawLine[detailType], detailType) : null;
  const journalDetail = optionalObject(rawLine.JournalEntryLineDetail, "JournalEntryLineDetail");
  const journalEntity = optionalObject(journalDetail?.Entity, "JournalEntryLineDetail.Entity");
  const itemAccount = ref(detail?.ItemAccountRef, "Line.ItemAccountRef");
  const account = ref(detail?.AccountRef ?? journalDetail?.AccountRef, "Line.AccountRef");
  if (itemAccount && account && itemAccount.value !== account.value) fail("Line.AccountRef");
  const postingType = journalDetail?.PostingType === "Debit"
    ? "debit"
    : journalDetail?.PostingType === "Credit"
      ? "credit"
      : "unknown";
  return {
    lineId: optionalString(rawLine, "Id"),
    detailType,
    amount: lineAmount(rawLine, currency),
    postingType: journalDetail ? postingType : null,
    itemRef: ref(detail?.ItemRef, `${detailType}.ItemRef`),
    // Intuit's transaction-line account overrides the item's default account.
    accountRef: itemAccount ?? account,
    entityRef: ref(detail?.CustomerRef ?? detail?.VendorRef ?? journalEntity?.EntityRef, "Line.EntityRef"),
    accountingEvidence: {
      accountReferenceKind: itemAccount ? "item_account_ref" as const : account ? "account_ref" as const : null,
      taxCodeRef: ref(detail?.TaxCodeRef, "Line.TaxCodeRef"),
      taxInclusiveAmount: detail ? optionalMoney(detail, "TaxInclusiveAmt", currency) : null,
      hasTaxDetail: hasField(rawLine, ["TaxLineDetail", "TxnTaxDetail"]) ||
        hasField(detail, ["TaxAmount", "TaxApplicableOn", "TaxRateRef", "TaxInclusiveAmt"]),
      hasDiscountDetail: detailType === "DiscountLineDetail" || hasDiscountDetail(rawLine) || hasDiscountDetail(detail),
      hasGroupDetail: detailType === "GroupLineDetail" || hasField(rawLine, ["GroupLineDetail"]) || hasField(detail, ["Line"])
    }
  };
}

function minimizedLines(raw: JsonRecord, currency: string | null) {
  const lines = raw.Line;
  if (lines === undefined || lines === null) return [];
  if (!Array.isArray(lines)) fail("Line");
  return lines.map((value, index) => {
    const rawLine = object(value, `Line.${index}`);
    const detailType = optionalString(rawLine, "DetailType");
    return lineDetail(rawLine, detailType, currency);
  });
}

function documentedVoidedTransaction(recordType: QboSupportedObjectType, raw: JsonRecord) {
  if (recordType !== "Invoice" && recordType !== "Payment") return false;
  // Intuit's void operation prefixes PrivateNote and zeros amounts/quantities.
  // Inspect only that bounded marker; the note never enters the projection.
  // https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/invoice#void-an-invoice
  // https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/payment#void-a-payment
  if (typeof raw.PrivateNote !== "string" || raw.PrivateNote.length > 4000 ||
      !/^Voided(?:$|[\s:])/.test(raw.PrivateNote)) return false;
  const zero = (record: JsonRecord, key: string) => optionalDecimal(record, key, { allowNegative: true }) === "0";
  if (!zero(raw, "TotalAmt") || !Array.isArray(raw.Line)) return false;
  for (const key of ["HomeTotalAmt", "HomeBalance", "Deposit"]) {
    if (raw[key] !== undefined && raw[key] !== null && !zero(raw, key)) return false;
  }
  if (recordType === "Payment") return zero(raw, "UnappliedAmt") && raw.Line.length === 0;
  if (!zero(raw, "Balance")) return false;
  const tax = optionalObject(raw.TxnTaxDetail, "TxnTaxDetail");
  if (tax?.TotalTax !== undefined && !zero(tax, "TotalTax")) return false;
  let inspected = 0;
  const zeroedLines = (lines: unknown[], depth: number): boolean => depth <= 4 && lines.every((value, index) => {
    if (++inspected > 2000) return false;
    const line = object(value, `Line.${index}`);
    if (line.Amount !== undefined && !zero(line, "Amount")) return false;
    const detail = optionalObject(line.SalesItemLineDetail, "SalesItemLineDetail");
    if (detail && !["Qty", "UnitPrice"].every(key => detail[key] === undefined || zero(detail, key))) return false;
    const group = optionalObject(line.GroupLineDetail, "GroupLineDetail");
    if (!group) return true;
    if (group.Quantity !== undefined && !zero(group, "Quantity")) return false;
    return Array.isArray(group.Line) && zeroedLines(group.Line, depth + 1);
  });
  if (tax?.TaxLine !== undefined && (!Array.isArray(tax.TaxLine) || !zeroedLines(tax.TaxLine, 0))) return false;
  return zeroedLines(raw.Line, 0);
}

function transactionStatus(recordType: QboSupportedObjectType, raw: JsonRecord) {
  if (raw.Deleted === true) return "deleted";
  if (raw.Voided === true) return "voided";
  if (raw.status === "Voided") return "voided";
  const status = optionalString(raw, "TxnStatus");
  if (status?.toLowerCase() === "voided") return "voided";
  if (documentedVoidedTransaction(recordType, raw)) return "voided";
  const active = optionalBoolean(raw, "Active");
  if (active === false) return "inactive";
  return "active";
}

function displayName(recordType: QboSupportedObjectType, raw: JsonRecord) {
  if (recordType === "CompanyInfo") {
    return optionalString(raw, "CompanyName") ?? optionalString(raw, "LegalName");
  }
  return optionalString(raw, "DisplayName") ?? optionalString(raw, "Name") ?? null;
}

function baseAmounts(raw: JsonRecord, currency: string | null) {
  if (currency === null) return {};
  const total = optionalDecimal(raw, "TotalAmt", { allowNegative: true });
  const balance = optionalDecimal(raw, "Balance", { allowNegative: true });
  const homeTotal = optionalDecimal(raw, "HomeTotalAmt", { allowNegative: true });
  const amounts: Record<string, { amount: string; currency: string }> = {};
  if (total) amounts.total = { amount: total, currency };
  if (balance) amounts.balance = { amount: balance, currency };
  if (homeTotal) amounts.home_total = { amount: homeTotal, currency };
  return amounts;
}

function masterRecordAccounting(recordType: QboSupportedObjectType, raw: JsonRecord) {
  if (recordType === "Preferences") {
    const reportPrefs = optionalObject(raw.ReportPrefs, "ReportPrefs");
    const accountingPrefs = optionalObject(raw.AccountingInfoPrefs, "AccountingInfoPrefs");
    const currencyPrefs = optionalObject(raw.CurrencyPrefs, "CurrencyPrefs");
    return {
      basis: QboAccountingBasisSchema.parse(parseBasis(reportPrefs?.ReportBasis ?? accountingPrefs?.AccountingMethod)),
      sourceCurrency: optionalCurrency({ CurrencyRef: currencyPrefs?.HomeCurrency }, "CurrencyRef"),
      homeCurrency: optionalCurrency({ CurrencyRef: currencyPrefs?.HomeCurrency }, "CurrencyRef"),
      exchangeRate: null
    };
  }
  const currency = optionalCurrency(raw, "CurrencyRef");
  return {
    basis: "unknown" as const,
    sourceCurrency: currency,
    homeCurrency: currency,
    exchangeRate: null
  };
}

function transactionAccounting(raw: JsonRecord) {
  const currency = requiredCurrency(raw, "CurrencyRef");
  return {
    basis: "unknown" as const,
    sourceCurrency: currency,
    homeCurrency: optionalCurrency(raw, "HomeCurrencyRef"),
    exchangeRate: optionalDecimal(raw, "ExchangeRate", {
      allowNegative: false,
      kind: "exchange_rate"
    })
  };
}

function buildProjection(
  recordType: QboSupportedObjectType,
  raw: JsonRecord,
  providerMetadata: QboProviderMetadata
): QboMinimizedSourceRecord {
  if (!masterTypes.has(recordType) && !transactionTypes.has(recordType)) {
    fail("recordType");
  }

  const id = requiredString(raw, "Id");
  const recordMetadata = metadata(raw);
  const isTransaction = transactionTypes.has(recordType);
  const accounting = isTransaction
    ? transactionAccounting(raw)
    : masterRecordAccounting(recordType, raw);
  const sourceCurrency = accounting.sourceCurrency;
  const accountingEvidenceEnabled = providerMetadata.sourceEnvironment === "production";
  const status = isTransaction ? transactionStatus(recordType, raw) : optionalBoolean(raw, "Active") === false ? "inactive" : "active";

  const commonRelationships = relationshipEntries(raw, [
    "CustomerRef",
    "VendorRef",
    "DepartmentRef",
    "ClassRef",
    "AccountRef",
    "DepositToAccountRef",
    "APAccountRef",
    "ARAccountRef",
    "FromAccountRef",
    "ToAccountRef",
    "ItemRef",
    "IncomeAccountRef",
    "ExpenseAccountRef",
    "AssetAccountRef"
  ]);
  if (recordType === "Account") {
    const accountType = optionalString(raw, "AccountType");
    if (accountType !== null) {
      commonRelationships.AccountType = { value: accountType, name: null };
    }
  }

  const minimized = {
    contractVersion: QBO_SOURCE_RECORD_CONTRACT_VERSION,
    provider: provider(providerMetadata),
    recordType,
    id,
    displayName: displayName(recordType, raw),
    active: optionalBoolean(raw, "Active"),
    status,
    metadata: recordMetadata,
    temporal: {
      postingDate: optionalDate(raw, "TxnDate"),
      providerCreatedAt: recordMetadata.providerCreatedAt,
      providerUpdatedAt: recordMetadata.providerUpdatedAt
    },
    accounting,
    relationships: commonRelationships,
    amounts: baseAmounts(raw, sourceCurrency),
    lines: minimizedLines(raw, sourceCurrency).map(({ accountingEvidence, ...line }) =>
      accountingEvidenceEnabled ? { ...line, accountingEvidence } : line),
    providerVersionReference: recordMetadata.syncToken ?? recordMetadata.providerUpdatedAt,
    minimizationVersion: accountingEvidenceEnabled ? QBO_ACCOUNTING_MINIMIZATION_VERSION : "qbo_minimizer_v1",
    ...(accountingEvidenceEnabled ? { accountingEvidence: transactionAccountingEvidence(raw, sourceCurrency) } : {})
  };

  return QboMinimizedSourceRecordSchema.parse(minimized);
}

export function minimizeQboSourceRecord(input: {
  recordType: QboSupportedObjectType;
  raw: unknown;
  provider: QboProviderMetadata;
}) {
  const providerMetadata = provider(input.provider);
  const raw = object(input.raw, input.recordType);
  if (raw.status === "Deleted") fail("Deleted.requires_cdc_tombstone");
  return buildProjection(input.recordType, raw, providerMetadata);
}

export function minimizeQboSourceRecords(input: {
  recordType: QboSupportedObjectType;
  rawRecords: readonly unknown[];
  provider: QboProviderMetadata;
}) {
  return input.rawRecords.map((raw) =>
    minimizeQboSourceRecord({
      recordType: input.recordType,
      raw,
      provider: input.provider
    })
  );
}

export function classifyQboSourceChange(input: {
  previous: QboMinimizedSourceRecord | null;
  current: QboMinimizedSourceRecord | null;
}) {
  const { previous, current } = input;
  if (!previous && !current) return "unchanged" as const;
  if (!previous && current) {
    if (current.status === "deleted") return "deleted" as const;
    if (current.status === "voided") return "voided" as const;
    return "created" as const;
  }
  if (previous && !current) return "unchanged" as const;
  if (!previous || !current) return "unchanged" as const;
  if (current.status === "deleted") return "deleted" as const;
  if (current.status === "voided") return "voided" as const;
  if (previous.providerVersionReference !== current.providerVersionReference) {
    const priorEconomic = JSON.stringify({
      postingDate: previous.temporal.postingDate,
      accounting: previous.accounting,
      amounts: previous.amounts,
      lines: previous.lines
    });
    const currentEconomic = JSON.stringify({
      postingDate: current.temporal.postingDate,
      accounting: current.accounting,
      amounts: current.amounts,
      lines: current.lines
    });
    return priorEconomic === currentEconomic ? "updated" as const : "corrected" as const;
  }
  return "unchanged" as const;
}

export function classifyQboRecordFamily(recordType: QboSupportedObjectType) {
  if (recordType === "CreditMemo" || recordType === "RefundReceipt" || recordType === "VendorCredit") {
    return "refund_or_credit" as const;
  }
  if (transactionTypes.has(recordType)) return "financial_transaction" as const;
  return "configuration_or_master" as const;
}
