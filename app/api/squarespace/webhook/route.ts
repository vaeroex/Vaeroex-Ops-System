import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { mapSquarespaceProductToPlan } from "@/lib/billing/squarespace-plan-map";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";

export const runtime = "nodejs";

type PayloadRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PayloadRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findString(value: unknown, keys: string[]): string | null {
  if (!isRecord(value) && !Array.isArray(value)) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys);
      if (found) {
        return found;
      }
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key.toLowerCase()) && typeof child === "string" && child.trim()) {
      return child.trim();
    }
  }

  for (const child of Object.values(value)) {
    const found = findString(child, keys);
    if (found) {
      return found;
    }
  }

  return null;
}

function collectProductValues(value: unknown): string[] {
  const results = new Set<string>();

  function walk(current: unknown) {
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    if (!isRecord(current)) {
      return;
    }

    for (const [key, child] of Object.entries(current)) {
      if (["productname", "product_name", "sku", "productid", "product_id", "variant", "title"].includes(key.toLowerCase()) && typeof child === "string") {
        results.add(child);
      }
      walk(child);
    }
  }

  walk(value);
  return [...results];
}

function statusFromPayload(payload: PayloadRecord, planSlug: string | null, email: string | null) {
  const statusText = [
    findString(payload, ["status", "subscriptionstatus", "fulfillmentstatus", "financialstatus"]),
    findString(payload, ["eventtype", "type"])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (statusText.includes("cancel")) {
    return "canceled";
  }

  if (statusText.includes("past_due") || statusText.includes("failed")) {
    return "past_due";
  }

  if (statusText.includes("expired")) {
    return "expired";
  }

  return planSlug && email ? "active" : "manual_review";
}

function hmacMatches(rawBody: string, signature: string, secret: string) {
  const hex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const base64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return signature === secret || signature === hex || signature === base64 || signature.endsWith(hex) || signature.endsWith(base64);
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const secret = process.env.SQUARESPACE_WEBHOOK_SECRET;
  const signature =
    request.headers.get("x-squarespace-signature") ||
    request.headers.get("x-squarespace-webhook-signature") ||
    request.headers.get("x-webhook-signature") ||
    "";

  if (secret && !hmacMatches(rawBody, signature, secret)) {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: PayloadRecord = {};
  let parseError: string | null = null;

  try {
    payload = JSON.parse(rawBody) as PayloadRecord;
  } catch (error) {
    parseError = error instanceof Error ? error.message : "Payload could not be parsed.";
  }

  const eventType = findString(payload, ["eventtype", "type"]) || "squarespace.order";
  const customerEmail = findString(payload, ["email", "customeremail", "customer_email"]);
  const orderId = findString(payload, ["orderid", "order_id", "id", "number"]);
  const customerId = findString(payload, ["customerid", "customer_id", "profileid"]);
  const customerName = findString(payload, ["name", "customername", "billingname"]);
  const productValues = collectProductValues(payload);
  const planSlug = mapSquarespaceProductToPlan(...productValues);
  const status = statusFromPayload(payload, planSlug, customerEmail);
  const processingErrors: string[] = [];

  if (parseError) {
    processingErrors.push(parseError);
  }

  if (!customerEmail) {
    processingErrors.push("Customer email was not found in the Squarespace payload.");
  }

  if (!planSlug) {
    processingErrors.push("Squarespace product could not be mapped to a Vaeroex plan.");
  }

  const { data: eventRow } = await admin
    .from("subscription_events")
    .insert({
      source: "squarespace",
      event_type: eventType,
      customer_email: customerEmail,
      squarespace_order_id: orderId,
      payload_json: (payload || {}) as Json,
      processed: false,
      processing_error: processingErrors.length ? processingErrors.join(" ") : null
    })
    .select("id")
    .maybeSingle();

  try {
    if (!parseError && customerEmail) {
      const { data: existing } = await admin
        .from("customer_subscriptions")
        .select("id,workspace_id")
        .or(
          [
            orderId ? `squarespace_order_id.eq.${orderId}` : "",
            `customer_email.ilike.${customerEmail}`
          ]
            .filter(Boolean)
            .join(",")
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const payloadToSave = {
        customer_email: customerEmail,
        customer_name: customerName,
        source: "squarespace",
        plan_slug: planSlug,
        status,
        squarespace_order_id: orderId,
        squarespace_customer_id: customerId,
        last_payment_at: status === "active" ? new Date().toISOString() : null,
        raw_payload_json: payload as Json,
        manually_activated: false
      };

      if (existing) {
        await admin.from("customer_subscriptions").update(payloadToSave).eq("id", existing.id);
      } else {
        await admin.from("customer_subscriptions").insert(payloadToSave);
      }

      if (existing?.workspace_id) {
        await admin
          .from("workspaces")
          .update({
            subscription_status: status,
            plan_slug: planSlug,
            manually_unlocked: false
          })
          .eq("id", existing.workspace_id);
      }
    }

    if (eventRow) {
      await admin
        .from("subscription_events")
        .update({
          processed: !processingErrors.length,
          processing_error: processingErrors.length ? processingErrors.join(" ") : null
        })
        .eq("id", eventRow.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subscription event processing failed.";

    if (eventRow) {
      await admin
        .from("subscription_events")
        .update({
          processed: false,
          processing_error: message
        })
        .eq("id", eventRow.id);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 202 });
  }

  return NextResponse.json({
    ok: true,
    processed: !processingErrors.length,
    event_id: eventRow?.id ?? null,
    plan_slug: planSlug,
    status
  });
}
