import type { Json } from "@/lib/supabase/types";

const OMITTED_RECEIPT_FIELDS = new Set([
  "address",
  "customer_address",
  "customer_shipping",
  "shipping",
  "billing_details",
  "billing_address",
  "shipping_address",
  "client_secret",
  "next_action",
  "hosted_invoice_url",
  "invoice_pdf",
  "receipt_url"
]);

/**
 * Keep billing attribution and audit data without retaining provider address
 * containers or payment credentials/links. The verified event itself stays
 * unchanged in memory for processing; this copy is only a durable receipt.
 */
export function minimizeStripeWebhookReceipt(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(minimizeStripeWebhookReceipt);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !OMITTED_RECEIPT_FIELDS.has(key))
        .map(([key, nested]) => [key, minimizeStripeWebhookReceipt(nested)])
    );
  }
  return null;
}
