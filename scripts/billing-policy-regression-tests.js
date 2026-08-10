const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const legalContent = read("lib/legal/content.ts");
const pricingPage = read("app/pricing/page.tsx");
const accountSubscriptionPage = read("app/app/account/subscription/page.tsx");
const checkoutSuccessPage = read("app/checkout/success/page.tsx");
const publicHelpPage = read("app/help/page.tsx");
const publicSupportPage = read("app/support/page.tsx");
const appSupportPage = read("app/app/support/page.tsx");
const welcomeEmail = read("lib/email/welcome.ts");
const contactEmails = read("lib/contact/emails.ts");
const stripeBilling = read("lib/stripe/billing.ts");
const stripePortalRoute = read("app/api/stripe/portal/route.ts");
const stripeWebhook = read("app/api/stripe/webhook/route.ts");
const subscriptionAccess = read("lib/billing/get-subscription-status.ts");

const customerFacingBillingCopy = [
  legalContent,
  pricingPage,
  accountSubscriptionPage,
  checkoutSuccessPage,
  publicHelpPage,
  publicSupportPage,
  appSupportPage,
  welcomeEmail
].join("\n");

assert.doesNotMatch(
  customerFacingBillingCopy,
  /14[ -]?day|fourteen[ -]?day|satisfaction refund|money[ -]?back|refund window|partial months?|automatic refund/i,
  "Customer-facing billing copy must not restore refund windows, satisfaction guarantees, or unused-time refunds"
);
assert.doesNotMatch(
  customerFacingBillingCopy,
  /cancel(?:lation)?[^.]{0,120}(?:must|required)[^.]{0,80}(?:email|contact)/i,
  "Customer-facing billing copy must not require email as the cancellation method"
);
assert.doesNotMatch(
  customerFacingBillingCopy,
  /cancel(?:lation|ed)?[^.]{0,100}(?:immediately terminates|immediately ends|ends immediately|lose access immediately)/i,
  "Customer-facing billing copy must not imply immediate loss of paid access"
);

assert.match(legalContent, /All purchases and subscription payments are final and non-refundable, except where a refund is required by applicable law\./);
assert.match(legalContent, /Cancellation does not provide a prorated refund, credit, or refund for unused time/);
assert.match(legalContent, /Manage billing in the Stripe Customer Portal/);
assert.match(legalContent, /Cancellation prevents the next renewal and takes effect at the end of the current paid billing period/);
assert.match(legalContent, /Access continues through that paid period/);
assert.match(pricingPage, /Payments are final and non-refundable except where required by applicable law/);
assert.match(accountSubscriptionPage, /Use Manage billing to schedule cancellation through the Stripe Customer Portal/);
assert.match(checkoutSuccessPage, /paid access continues through the end of the current billing period/);
assert.match(legalContent, /Your subscription price will not increase while your subscription remains continuously active/);
assert.match(legalContent, /If Vaeroex lowers the applicable subscription price, active subscribers will receive the lower price for future renewals/);
assert.match(legalContent, /If you cancel and later resubscribe, your new subscription will be subject to the pricing available at the time you resubscribe/);
assert.match(legalContent, /A price reduction does not provide a retroactive refund or credit for billing periods already paid/);
assert.match(pricingPage, /Price reductions do not provide retroactive refunds or credits for billing periods already paid/);
assert.match(accountSubscriptionPage, /Canceling ends this pricing protection/);
assert.match(checkoutSuccessPage, /the new subscription uses the pricing available at that time/);
assert.match(contactEmails, /billing:\s*"billing@vaeroex\.com"/);

assert.match(accountSubscriptionPage, /action="\/api\/stripe\/portal"/);
assert.match(accountSubscriptionPage, />\s*Manage billing\s*</);
assert.match(stripePortalRoute, /createStripePortalSession\(subscription\.stripe_customer_id\)/);
assert.match(stripeBilling, /"\/billing_portal\/sessions"/);
assert.match(stripeBilling, /process\.env\.STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY/);
assert.match(stripeBilling, /"line_items\[0\]\[price\]": priceId/);
assert.match(stripeWebhook, /current_period_end:\s*stripeTimestampToIso\(subscription\?\.current_period_end\)/);
assert.match(stripeWebhook, /stripe_cancel_at_period_end:\s*Boolean\(subscription\?\.cancel_at_period_end\)/);
assert.match(stripeWebhook, /stripe_price_id:\s*priceIdFromSubscription\(subscription\)/);
assert.doesNotMatch(stripeBilling, /export async function (?:update|migrate).*StripeSubscription/i, "Policy copy must not introduce automatic Stripe subscription-price migration");
assert.match(subscriptionAccess, /const periodValid = !subscription\.current_period_end \|\| new Date\(subscription\.current_period_end\) > new Date\(\)/);
assert.match(subscriptionAccess, /\["active", "trialing"\]\.includes\(status\) && periodValid/);

process.stdout.write("Billing policy regressions passed.\n");
