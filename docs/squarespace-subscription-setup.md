# Squarespace Subscription Setup

Vaeroex uses Squarespace as the storefront, checkout, payment, and subscription billing layer. The Vaeroex app controls platform access after purchase.

## 1. Create One Squarespace Subscription Product

Create one monthly subscription product:

```text
Vaeroex
$500/month
Everything Included
```

Squarespace remains the source of truth for checkout pricing, discounts, promotions, taxes, and billing status. Do not configure customer-facing Starter, Growth, or Pro products for the current Vaeroex app.

## 2. Product Positioning

Use the Vaeroex product for the complete Executive Intelligence experience:

- Executive Intelligence Workspace
- CRM
- KPIs
- Reports
- SOPs
- Follow-ups
- Issues
- Checklists
- Files
- People
- Notifications
- Team Roles
- Assignments
- Report Scheduling
- Report Sharing
- KPI Alerts
- Vaeroex decision support
- Business Health Score
- Business Memory
- Profit Leak Detector
- Executive Briefings
- Role-Based Briefings
- Weekly Reviews
- Demo Workspace
- Security Features
- Help Center
- Future intelligence features

## 3. Set Checkout Success Page

Set the Squarespace checkout success or thank-you page to tell customers to create their Vaeroex account with the same email used at checkout.

Use the copy in:

```text
docs/squarespace-thank-you-page-copy.md
```

## 4. Redirect Customers To Vaeroex App Onboarding

Primary sign-up URL:

```text
https://vaeroex.com/signup
```

Customers should use the same email address they used for Squarespace checkout. This lets Vaeroex match the app account to the Squarespace subscription.

## 5. Manually Activate Early Customers

For the MVP launch:

1. Confirm the customer purchase in Squarespace.
2. Sign in to Vaeroex as an internal admin.
3. Open:

```text
/app/admin/subscriptions
```

4. Enter the customer email, Vaeroex plan, order ID if available, and notes.
5. Save the manual activation.

Manual activations create or update `customer_subscriptions` with `plan_slug = 'vaeroex'` and `manually_activated = true`.

## 6. Configure Webhook Later

When ready, configure a Squarespace order webhook to send order events to:

```text
https://vaeroex.com/api/squarespace/webhook
```

Add these environment variables:

```bash
SQUARESPACE_WEBHOOK_SECRET=
SQUARESPACE_VAEROEX_PRODUCT_ID=
SQUARESPACE_VAEROEX_SKU=
NEXT_PUBLIC_SQUARESPACE_VAEROEX_CHECKOUT_URL=
```

The app maps these current product names automatically:

- Vaeroex
- Vaeroex Executive Intelligence

For backward compatibility, old legacy product names/SKUs are still accepted by the webhook and mapped to the single internal `vaeroex` plan.

Webhook events are stored in `subscription_events`. Clear events update `customer_subscriptions`; unclear events are stored for manual review.

## 7. Test A Purchase

1. Create or use a Squarespace test order.
2. Confirm the checkout email.
3. Create a Vaeroex app account using the same email.
4. Open `/app/setup`.
5. Confirm the app allows setup only when a matching active/manual/demo subscription exists.
6. If access does not unlock, use the “I already purchased” form on `/billing-required`.

## 8. Handle Cancellations

When a Squarespace order/subscription cancellation event arrives, the webhook attempts to set the subscription status to `canceled`.

If webhook payloads are unclear, manually update the customer on:

```text
/app/admin/subscriptions
```

Canceled or expired subscriptions are blocked from full app modules unless a workspace is demo or manually unlocked.

## 9. Handle Failed Payments

When Squarespace sends failed payment or past-due events, the webhook attempts to set status to `past_due`.

Past-due customers should see the billing-required flow until their subscription returns to active or an admin manually unlocks access.
