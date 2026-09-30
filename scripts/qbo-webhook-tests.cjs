/* eslint-disable @typescript-eslint/no-require-imports -- Run actual TypeScript with synthetic webhook payloads. */
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename
  }
).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
global.fetch = async () => { throw Error("live_network_denied"); };

const { parseQboCloudEventsWebhook } = require("../lib/integrations/providers/qbo/webhooks.ts");
const { verifyAndParseQboCloudEventsWebhook, QBO_WEBHOOK_MAX_RAW_BODY_BYTES } =
  require("../lib/integrations/providers/qbo/webhook-signature.ts");

// Subscription contract for the 16 existing webhook entities, checked 2026-09-30:
// https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html
// Select Create/Update/Delete for all; Merge only for the four list entities;
// Void only for the eight entities below. Leave Emailed and all other entities off.
// Preferences supports Update at Intuit, but this adapter does not admit its webhook.
const recordTypes = [
  "Account", "Customer", "Vendor", "Item", "Invoice", "Payment", "CreditMemo", "SalesReceipt",
  "RefundReceipt", "Bill", "BillPayment", "VendorCredit", "Purchase", "Deposit", "Transfer", "JournalEntry"
];
const mergeTypes = new Set(["Account", "Customer", "Vendor", "Item"]);
const voidTypes = new Set([
  "Invoice", "Payment", "CreditMemo", "SalesReceipt", "RefundReceipt", "BillPayment", "Purchase", "Transfer"
]);
const expectedProvider = { providerKey: "quickbooks_online", realmId: "synthetic-realm", sourceEnvironment: "production" };
const verifierSecret = Buffer.from("synthetic-webhook-verifier-token", "utf8");
const event = (recordType, operation, overrides = {}) => ({
  specversion: "1.0",
  id: `synthetic-${recordType}-${operation}`,
  source: "intuit.synthetic",
  type: `qbo.${recordType.toLowerCase()}.${operation}.v1`,
  time: "2026-09-30T12:00:00.000Z",
  intuitentityid: "synthetic-record",
  intuitaccountid: expectedProvider.realmId,
  data: {},
  ...overrides
});
const parse = raw => parseQboCloudEventsWebhook({ raw, expectedProvider });
const signature = rawBody => createHmac("sha256", verifierSecret).update(rawBody).digest("base64");
const verify = (rawBody, intuitSignature = signature(rawBody)) => verifyAndParseQboCloudEventsWebhook({
  rawBody, intuitSignature, verifierSecret, expectedProvider
});

for (const recordType of recordTypes) {
  test(`${recordType}: only documented, locally supported operations are admitted`, () => {
    for (const operation of ["created", "updated", "deleted", "merged", "void", "voided", "emailed", "unknown", "create", "update", "delete", "merge"]) {
      const supported = ["created", "updated", "deleted"].includes(operation) ||
        (operation === "merged" && mergeTypes.has(recordType)) ||
        (operation === "void" && voidTypes.has(recordType));
      if (!supported) {
        assert.throws(() => parse([event(recordType, operation)]), {
          message: `qbo_webhook_unsupported_operation:${operation}`
        });
        continue;
      }
      const [parsed] = parse([event(recordType, operation)]);
      assert.equal(parsed.recordType, recordType);
      assert.equal(parsed.providerOperation, operation);
      assert.equal(parsed.changeKind, operation === "merged" ? "updated" : operation === "void" ? "voided" : operation);
      assert.equal(parsed.eventType, `qbo.${recordType.toLowerCase()}.${operation}.v1`);
      assert.equal(parsed.hintOnly, true);
      assert.equal(parsed.signatureVerification, "deferred_to_runtime_secret_authority");
    }
  });
}

test("unsupported entities stay closed even when Intuit supports their subscriptions", () => {
  for (const recordType of ["Budget", "Class", "Currency", "Department", "Employee", "Estimate", "JournalCode",
    "PaymentMethod", "Preferences", "PurchaseOrder", "TaxAgency", "Term", "TimeActivity", "CompanyInfo", "Unknown", "constructor"]) {
    assert.throws(() => parse([event(recordType, "updated")]), {
      message: `qbo_webhook_unsupported_entity:${recordType.toLowerCase()}`
    });
  }
});

test("legacy format, malformed types and mismatched realms remain rejected", () => {
  assert.throws(() => parse({ eventNotifications: [] }), /contract_validation_failed:root/);
  for (const type of ["qbo.invoice.Void.v1", "qbo.invoice.void.v2", "qbo.invoice.void.v1.extra", "other.invoice.void.v1"]) {
    assert.throws(() => parse([event("Invoice", "void", { type })]), /contract_validation_failed:type/);
  }
  assert.throws(() => parse([event("Invoice", "void", { intuitaccountid: "other-realm" })]), /qbo_webhook_realm_mismatch/);
});

test("merge retains the survivor and deleted ID without promoting webhook data", () => {
  const [parsed] = parse([event("Customer", "merged", { data: { deletedid: "synthetic-deleted", TotalAmt: 999 } })]);
  assert.equal(parsed.providerRecordId, "synthetic-record");
  assert.equal(parsed.deletedProviderRecordId, "synthetic-deleted");
  assert.equal(parsed.changeKind, "updated");
  assert.equal(parsed.hintOnly, true);
  assert.equal(parsed.TotalAmt, undefined);
});

test("signed void events retain provider operation and verified hint-only status", () => {
  const rawBody = Buffer.from(JSON.stringify([...voidTypes].map(recordType => event(recordType, "void"))));
  const verified = verify(rawBody);
  assert.equal(verified.events.length, 8);
  assert.match(verified.deliveryHash, /^sha256:[a-f0-9]{64}$/);
  for (const parsed of verified.events) {
    assert.equal(parsed.providerOperation, "void");
    assert.equal(parsed.changeKind, "voided");
    assert.equal(parsed.signatureVerification, "verified_hmac_sha256");
    assert.equal(parsed.hintOnly, true);
  }
});

test("unsupported signed events reject the whole batch before returning intake hints", () => {
  for (const invalid of [event("Invoice", "emailed"), event("Invoice", "merged"), event("Bill", "void"),
    event("Invoice", "voided"), event("Preferences", "updated")]) {
    const rawBody = Buffer.from(JSON.stringify([event("Invoice", "void"), invalid]));
    assert.throws(() => verify(rawBody), /qbo_webhook_unsupported_(operation|entity):/);
  }
});

test("HMAC authenticates the exact raw bytes before JSON or operation validation", () => {
  const rawBody = Buffer.from(JSON.stringify([event("Invoice", "void")]));
  const validSignature = signature(rawBody);
  for (const body of [Buffer.from("{not-json"), Buffer.concat([rawBody, Buffer.from(" ")]),
    Buffer.from(JSON.stringify([event("Invoice", "emailed")]))]) {
    assert.throws(() => verify(body, validSignature), /qbo_webhook_signature_denied/);
  }
  assert.throws(() => verify(Buffer.from("{not-json")), /qbo_webhook_raw_body_invalid/);
  assert.throws(() => verify(Buffer.from([0xff])), /qbo_webhook_raw_body_invalid/);
});

test("missing, malformed and wrong-key signatures fail closed", () => {
  const rawBody = Buffer.from(JSON.stringify([event("Invoice", "void")]));
  const wrongKeySignature = createHmac("sha256", "different-synthetic-verifier").update(rawBody).digest("base64");
  for (const invalid of ["", "not-base64", signature(rawBody).slice(0, -1), wrongKeySignature]) {
    assert.throws(() => verify(rawBody, invalid), /qbo_webhook_signature_denied/);
  }
  assert.throws(() => verifyAndParseQboCloudEventsWebhook({ rawBody, verifierSecret }), /qbo_webhook_signature_denied/);
});

test("empty and oversized raw bodies remain bounded before intake", () => {
  assert.throws(() => verify(Buffer.alloc(0), ""), /qbo_webhook_raw_body_size_invalid/);
  assert.throws(() => verify(Buffer.alloc(QBO_WEBHOOK_MAX_RAW_BODY_BYTES + 1), ""), /qbo_webhook_raw_body_size_invalid/);
});
