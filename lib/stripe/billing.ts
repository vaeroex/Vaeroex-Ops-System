import "server-only";

import crypto from "node:crypto";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import type { SubscriptionStatus } from "@/lib/billing/types";
import { VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";
import { getAppUrl } from "@/lib/supabase/config";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 300;

export const STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE = `Checkout is temporarily unavailable. Contact ${VAEROEX_CONTACT_EMAILS.general}.`;
export const STRIPE_PORTAL_UNAVAILABLE_MESSAGE = `Billing management is temporarily unavailable. Contact ${VAEROEX_CONTACT_EMAILS.billing}.`;

export type StripeCheckoutSession = {
  id: string;
  mode?: string | null;
  url?: string | null;
  customer?: string | { id?: string; email?: string | null; name?: string | null } | null;
  customer_email?: string | null;
  customer_details?: {
    email?: string | null;
    name?: string | null;
  } | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string | null> | null;
};

export type StripeSubscription = {
  id: string;
  customer?: string | { id?: string; email?: string | null; name?: string | null } | null;
  status?: string | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  canceled_at?: number | null;
  metadata?: Record<string, string | null> | null;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
      } | null;
    }>;
  } | null;
};

export type StripeInvoice = {
  id: string;
  customer?: string | { id?: string; email?: string | null; name?: string | null } | null;
  customer_email?: string | null;
  subscription?: string | { id?: string } | null;
};

export type StripeCustomer = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || "";
}

export function stripePriceId() {
  return process.env.STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY || "";
}

export function isStripeCheckoutConfigured() {
  return Boolean(stripeSecretKey() && stripePriceId() && process.env.NEXT_PUBLIC_APP_URL);
}

export function isStripePortalConfigured() {
  return Boolean(stripeSecretKey() && process.env.NEXT_PUBLIC_APP_URL);
}

function requireStripeSecret() {
  const secretKey = stripeSecretKey();

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  return secretKey;
}

async function stripeRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireStripeSecret()}`,
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : "Stripe request failed.";
    throw new Error(message);
  }

  return data as T;
}

async function stripeFormRequest<T>(path: string, params: URLSearchParams) {
  return stripeRequest<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
}

export async function createOperationsIntelligenceCheckoutSession() {
  const priceId = stripePriceId();

  if (!isStripeCheckoutConfigured()) {
    throw new Error(STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE);
  }

  const appUrl = getAppUrl();
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    allow_promotion_codes: "true",
    billing_address_collection: "auto",
    "metadata[plan_slug]": VAEROEX_PLAN_SLUG,
    "metadata[product]": "operations_intelligence",
    "subscription_data[metadata][plan_slug]": VAEROEX_PLAN_SLUG,
    "subscription_data[metadata][product]": "operations_intelligence"
  });

  return stripeFormRequest<StripeCheckoutSession>("/checkout/sessions", params);
}

export async function createStripePortalSession(customerId: string) {
  if (!isStripePortalConfigured()) {
    throw new Error(STRIPE_PORTAL_UNAVAILABLE_MESSAGE);
  }

  return stripeFormRequest<{ url?: string | null }>("/billing_portal/sessions", new URLSearchParams({
    customer: customerId,
    return_url: `${getAppUrl()}/app/account/subscription`
  }));
}

export async function retrieveStripeSubscription(subscriptionId: string) {
  return stripeRequest<StripeSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`);
}

export async function retrieveStripeCustomer(customerId: string) {
  return stripeRequest<StripeCustomer>(`/customers/${encodeURIComponent(customerId)}`);
}

export function stripeObjectId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

export function stripeTimestampToIso(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

export function mapStripeStatus(status?: string | null): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "unpaid":
    case "canceled":
    case "incomplete":
      return status;
    case "incomplete_expired":
      return "expired";
    default:
      return "past_due";
  }
}

export function verifyStripeSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string) {
  if (!signatureHeader || !webhookSecret) {
    return false;
  }

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));

  if (!timestamp || !signatures.length) {
    return false;
  }

  const timestampNumber = Number(timestamp);

  if (!Number.isFinite(timestampNumber)) {
    return false;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestampNumber);

  if (age > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  return signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
}
