# Squarespace Subscription Setup

Vaeroex Ops System uses Squarespace as the storefront, checkout, payment, and subscription billing layer. The Vaeroex app controls software access after purchase.

## 1. Create Squarespace Subscription Products

Create three Squarespace subscription products. Use monthly subscription pricing first. Annual variants can be added later using the same product names or SKUs mapped in the app.

## 2. Suggested Product Names

Product 1:
Vaeroex Ops System - Starter

Product 2:
Vaeroex Ops System - Growth

Product 3:
Vaeroex Ops System - Pro

## 3. Suggested Pricing Packages

Starter Operations System:
Best for solo owners or small teams that need basic forms, checklists, SOPs, and reports.

Growth Operations System:
Best for growing businesses that need team accountability, workflows, asset tracking, and more Vaeroex reports.

Pro Operations System:
Best for businesses with multiple locations, more users, more workflows, and heavier reporting needs.

## 4. Set Checkout Success Page

Set the Squarespace checkout success or thank-you page to tell customers to create their Vaeroex account with the same email used at checkout.

Use the copy in:

```text
docs/squarespace-thank-you-page-copy.md
```

## 5. Redirect Customers To Vaeroex App Onboarding

Primary sign-up URL:

```text
https://app.vaeroex.com/signup
```

Customers should use the same email address they used for Squarespace checkout. This lets Vaeroex match the app account to the Squarespace subscription.

## 6. Manually Activate Early Customers

For the MVP launch:

1. Confirm the customer purchase in Squarespace.
2. Sign in to Vaeroex as a workspace owner/admin.
3. Open:

```text
/app/admin/subscriptions
```

4. Enter the customer email, plan, order ID if available, and notes.
5. Save the manual activation.

Manual activations create or update `customer_subscriptions` with `manually_activated = true`.

## 7. Configure Webhook Later

When ready, configure a Squarespace order webhook to send order events to:

```text
https://app.vaeroex.com/api/squarespace/webhook
```

Add these environment variables:

```bash
SQUARESPACE_WEBHOOK_SECRET=
SQUARESPACE_STARTER_PRODUCT_ID=
SQUARESPACE_STARTER_SKU=
SQUARESPACE_GROWTH_PRODUCT_ID=
SQUARESPACE_GROWTH_SKU=
SQUARESPACE_PRO_PRODUCT_ID=
SQUARESPACE_PRO_SKU=
```

The app also maps these product names automatically:

- Vaeroex Ops System - Starter
- Vaeroex Ops System - Growth
- Vaeroex Ops System - Pro

Webhook events are stored in `subscription_events`. Clear events update `customer_subscriptions`; unclear events are stored for manual review.

## 8. Test A Purchase

1. Create or use a Squarespace test order.
2. Confirm the checkout email.
3. Create a Vaeroex app account using the same email.
4. Open `/app/setup`.
5. Confirm the app allows setup only when a matching active/manual/demo subscription exists.
6. If access does not unlock, use the “I already purchased” form on `/billing-required`.

## 9. Handle Cancellations

When a Squarespace order/subscription cancellation event arrives, the webhook attempts to set the subscription status to `canceled`.

If webhook payloads are unclear, manually update the customer on:

```text
/app/admin/subscriptions
```

Canceled or expired subscriptions are blocked from full app modules unless a workspace is demo or manually unlocked.

## 10. Handle Failed Payments

When Squarespace sends failed payment or past-due events, the webhook attempts to set status to `past_due`.

Past-due customers should see the billing-required flow until their subscription returns to active or an admin manually unlocks access.
