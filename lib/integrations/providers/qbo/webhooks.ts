import {
  QBO_PROVIDER_KEY,
  QBO_WEBHOOK_CONTRACT_VERSION,
  QBO_V1_SUPPORTED_OBJECTS,
  type QboProviderMetadata,
  type QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";

type JsonRecord = Record<string, unknown>;

const webhookEntityToRecordType: Readonly<Record<string, QboSupportedObjectType>> = {
  account: "Account",
  customer: "Customer",
  vendor: "Vendor",
  item: "Item",
  invoice: "Invoice",
  payment: "Payment",
  creditmemo: "CreditMemo",
  salesreceipt: "SalesReceipt",
  refundreceipt: "RefundReceipt",
  bill: "Bill",
  billpayment: "BillPayment",
  vendorcredit: "VendorCredit",
  purchase: "Purchase",
  deposit: "Deposit",
  transfer: "Transfer",
  journalentry: "JournalEntry"
};

function fail(field: string): never {
  throw new Error(`qbo_webhook_contract_validation_failed:${field}`);
}

function object(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as JsonRecord;
}

function stringValue(record: JsonRecord, key: string) {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") fail(key);
  return value.trim();
}

function optionalData(value: unknown) {
  if (value === undefined || value === null) return {};
  return object(value, "data");
}

function changeKind(operation: string) {
  if (operation === "created") return "created" as const;
  if (operation === "updated" || operation === "merged") return "updated" as const;
  if (operation === "deleted") return "deleted" as const;
  if (operation === "voided") return "voided" as const;
  return null;
}

export function parseQboCloudEventsWebhook(input: {
  raw: unknown;
  expectedProvider?: QboProviderMetadata;
}) {
  if (!Array.isArray(input.raw)) fail("root");
  return input.raw.map((value, index) => {
    const event = object(value, `${index}`);
    const specversion = stringValue(event, "specversion");
    if (specversion !== "1.0") fail("specversion");
    const type = stringValue(event, "type");
    const match = /^qbo\.([a-z0-9]+)\.([a-z]+)\.v1$/.exec(type);
    if (!match) fail("type");
    const [, entity, operation] = match;
    const recordType = webhookEntityToRecordType[entity];
    if (!recordType || !(QBO_V1_SUPPORTED_OBJECTS as readonly string[]).includes(recordType)) {
      throw new Error(`qbo_webhook_unsupported_entity:${entity}`);
    }
    const mappedChangeKind = changeKind(operation);
    if (!mappedChangeKind) throw new Error(`qbo_webhook_unsupported_operation:${operation}`);
    const realmId = stringValue(event, "intuitaccountid");
    if (input.expectedProvider && input.expectedProvider.realmId !== realmId) {
      throw new Error("qbo_webhook_realm_mismatch");
    }
    const time = stringValue(event, "time");
    if (!Number.isFinite(new Date(time).getTime())) fail("time");
    const data = optionalData(event.data);
    return {
      contractVersion: QBO_WEBHOOK_CONTRACT_VERSION,
      providerKey: QBO_PROVIDER_KEY,
      eventId: stringValue(event, "id"),
      source: stringValue(event, "source"),
      eventType: type,
      eventTime: new Date(time).toISOString(),
      realmId,
      recordType,
      providerRecordId: stringValue(event, "intuitentityid"),
      providerOperation: operation,
      changeKind: mappedChangeKind,
      deletedProviderRecordId: typeof data.deletedid === "string" ? data.deletedid : null,
      signatureVerification: "deferred_to_runtime_secret_authority" as const,
      hintOnly: true as const
    };
  });
}
