"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CapacityBillingAddress, CapacityPaymentSession, CapacityQuote, WorkspaceCapacityBilling } from "@/lib/storage-capacity/billing-contracts";
import { CAPACITY_PACK_MONTHLY_CENTS, capacityAllowance, formatStorageBytes } from "@/lib/storage-capacity/policy";
import { BillingAddressFields, billingAddressError } from "@/components/storage-capacity/BillingAddressFields";
import { CapacityPayment } from "@/components/storage-capacity/CapacityPayment";
import { CapacityRecovery } from "@/components/storage-capacity/CapacityRecovery";

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const date = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "Not confirmed";

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result: T & { error?: string } = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The billing request could not be confirmed.");
  return result;
}

export function CapacityPurchase({ workspaceId, workspaceName, currentPacks, billing, checkoutResult }: {
  workspaceId: string; workspaceName: string; currentPacks: number; billing: WorkspaceCapacityBilling; checkoutResult?: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [packs, setPacks] = useState(1);
  const [billingAddress, setBillingAddress] = useState<CapacityBillingAddress>({ line1: "", line2: "", city: "", state: "", postalCode: "", country: "" });
  const [quote, setQuote] = useState<CapacityQuote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [paymentSession, setPaymentSession] = useState<CapacityPaymentSession | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const committedPacks = Math.max(currentPacks, billing.committedPacks ?? currentPacks);
  const maximumPurchase = Math.max(0, billing.maxPacks - committedPacks);
  const preview = capacityAllowance(Math.min(billing.maxPacks, currentPacks + packs));

  useEffect(() => {
    if (checkoutResult !== "complete") return;
    // A return URL is never proof of payment. Refresh the server's event-derived
    // entitlement, bounded so an unavailable webhook does not create polling load.
    let checks = 0;
    const timer = window.setInterval(() => {
      router.refresh();
      checks += 1;
      if (checks >= 6) window.clearInterval(timer);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [checkoutResult, router]);

  useEffect(() => { if (quote) reviewHeading.current?.focus(); }, [quote]);

  async function reviewPurchase() {
    if (pending) return;
    const addressError = billingAddressError(billingAddress);
    if (addressError) { setFeedback({ error: true, text: addressError }); return; }
    setPending("quote");
    setFeedback(null);
    try {
      const review = await post<CapacityQuote>("/api/storage/capacity/quote", { workspaceId, packs, billingAddress });
      const exactPrice = packs * CAPACITY_PACK_MONTHLY_CENTS;
      if (review.workspaceId !== workspaceId || review.packs !== packs || review.currency !== "usd"
        || review.monthlyCents !== exactPrice || review.amountDueTodayCents !== exactPrice
        || !Number.isFinite(Date.parse(review.renewalDate)) || !Number.isFinite(Date.parse(review.expiresAt))) {
        throw new Error("The exact price and renewal could not be verified. No payment has been authorized. Refresh the review before purchasing.");
      }
      setQuote(review);
      setAccepted(false);
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "The purchase review is unavailable." });
    } finally { setPending(null); }
  }

  async function beginCheckout() {
    if (pending || !quote || !accepted || paymentSession) return;
    if (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) {
      setFeedback({ error: true, text: "This purchase review expired. Refresh the review before continuing." });
      setQuote(null);
      setAccepted(false);
      return;
    }
    setPending("checkout");
    setFeedback(null);
    try {
      const result = await post<CapacityPaymentSession>("/api/storage/capacity/checkout", { workspaceId, quoteId: quote.quoteId, acceptedTerms: true });
      if (result.currency !== "usd" || result.amountCents !== quote.amountDueTodayCents || result.renewalDate !== quote.renewalDate
        || !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(result.publishableKey) || !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(result.clientSecret)) {
        throw new Error("The exact USD payment could not be verified. No card payment was submitted. Reload before continuing.");
      }
      setPaymentSession(result);
      setPending(null);
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "Checkout could not be started. Refresh before trying again." });
      setPending(null);
    }
  }

  async function cancelSubscription(subscription: WorkspaceCapacityBilling["subscriptions"][number]) {
    if (pending) return;
    const hasPaidCapacity = Boolean(subscription.paidThrough && Date.parse(subscription.paidThrough) > Date.now());
    const remaining = capacityAllowance(Math.max(0, currentPacks - (hasPaidCapacity ? subscription.packs : 0)));
    const periodEffect = hasPaidCapacity ? `The current paid capacity lasts through ${date(subscription.paidThrough)} UTC. After expiry, this workspace will have ${formatStorageBytes(remaining.bytes, { gb: true })} and ${remaining.files.toLocaleString("en-US")} file slots unless other capacity changes.` : "This subscription currently provides no paid capacity. Canceling its renewal does not reduce the current allowance.";
    if (!window.confirm(`Cancel renewal of ${subscription.packs} capacity ${subscription.packs === 1 ? "pack" : "packs"} for “${workspaceName}”? This stops its next ${dollars(subscription.monthlyCents)}/month renewal. ${periodEffect} Existing files are retained and can still be restored; only new uploads that need unavailable capacity are blocked.`)) return;
    setPending(subscription.id);
    setFeedback(null);
    try {
      const result = await post<{ endsAt: string | null }>("/api/storage/capacity/cancel", { workspaceId, subscriptionId: subscription.id, confirmed: true });
      const capacityEffect = result.endsAt && Date.parse(result.endsAt) > Date.now() ? `This purchase provides capacity through ${date(result.endsAt)} UTC.` : "This purchase has no current paid capacity.";
      setFeedback({ error: false, text: `Renewal canceled. ${capacityEffect} Existing files will be retained.` });
      router.refresh();
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : "Cancellation could not be confirmed. Refresh before trying again." });
    } finally { setPending(null); }
  }

  return <section id="buy-capacity" aria-labelledby="capacity-purchase-heading" className="rounded-lg border border-line bg-white p-4 sm:p-5">
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
      <div><h2 id="capacity-purchase-heading" className="text-base font-semibold text-ink">Workspace capacity</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">Each explicitly purchased pack adds 10 GB and 500 file slots to {workspaceName} for <strong className="font-semibold text-ink">$5 USD today and $5 USD/month, including applicable tax</strong>. Buy at any usage level.</p></div>
      <button type="button" disabled={pending !== null || paymentSession !== null} aria-expanded={expanded} aria-controls="capacity-purchase-options" onClick={() => setExpanded(value => !value)}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Buy capacity</button>
    </div>
    {checkoutResult === "complete" ? <p role="status" className="mt-4 rounded-md border border-line p-3 text-sm text-ink">Returned from payment. Capacity is granted only after confirmed payment is received. The allowance above reflects confirmed billing events; it refreshes while confirmation arrives. If payment is still pending, reload this page shortly.</p> : null}
    {checkoutResult === "cancelled" ? <p role="status" className="mt-4 text-sm text-muted">Checkout was canceled. No capacity was added by this return.</p> : null}
    {billing.mode === "test" ? <p role="status" className="mt-3 text-sm font-semibold text-amber-800">Test billing: this environment does not accept live customer payments.</p> : null}
    {feedback ? <p role={feedback.error ? "alert" : "status"} className={`mt-4 rounded-md border p-3 text-sm ${feedback.error ? "border-red-200 bg-red-50 text-red-800" : "border-line text-ink"}`}>{feedback.text}</p> : null}
    {expanded ? <div id="capacity-purchase-options" className="mt-4 space-y-4 border-t border-line pt-4">
      {!billing.purchasesEnabled ? <p role="status" className="text-sm text-amber-800">Capacity purchases are temporarily unavailable. Your included allowance and existing files remain available. Contact support if you need more capacity.</p> : null}
      {committedPacks > currentPacks ? <p className="text-sm text-muted">{committedPacks} packs are committed toward the purchase limit. Each subscription counts once while it can renew or has a paid period that has not ended or been fully refunded. Disputed periods also reserve their packs until the period ends. Canceling renewal releases a fully refunded subscription’s commitment only when no other qualifying paid period remains.</p> : null}
      {maximumPurchase === 0 ? <p className="text-sm text-ink">This workspace has reached the self-service limit for committed capacity. Review existing subscriptions below. A larger enterprise workspace requires a separately qualified plan before additional capacity can be purchased.</p> : <>
        <label className="block max-w-xs text-sm font-medium text-ink">Additional packs
          <select value={packs} disabled={pending !== null || paymentSession !== null} onChange={event => { setPacks(Number(event.target.value)); setQuote(null); setAccepted(false); }}
            className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm disabled:opacity-50">
            {Array.from({ length: maximumPurchase }, (_, index) => index + 1).map(quantity => <option value={quantity} key={quantity}>{quantity} {quantity === 1 ? "pack" : "packs"} — {dollars(quantity * CAPACITY_PACK_MONTHLY_CENTS)}/month</option>)}
          </select>
        </label>
        {!quote ? <form onSubmit={async event => { event.preventDefault(); await reviewPurchase(); }} className="space-y-4" data-capacity-review="true">
          <p className="text-sm text-muted">After confirmed payment: <strong className="text-ink">{formatStorageBytes(preview.bytes, { gb: true })} and {preview.files.toLocaleString("en-US")} file slots</strong> for this workspace. Review the amount due today, renewal, and cancellation terms before continuing.</p>
          <BillingAddressFields value={billingAddress} onChange={value => { setBillingAddress(value); setAccepted(false); }} disabled={pending !== null || !billing.purchasesEnabled} />
          <button type="submit" disabled={!billing.purchasesEnabled || pending !== null} className="min-h-11 rounded-md border border-vaeroex-blue px-4 py-2 text-sm font-semibold text-vaeroex-blue disabled:opacity-50">{pending === "quote" ? "Preparing review…" : "Review purchase"}</button>
        </form> : <div className="rounded-lg border border-vaeroex-blue/40 bg-slate-50 p-4">
          <h3 ref={reviewHeading} tabIndex={-1} className="text-base font-semibold text-ink outline-none">Review your capacity purchase</h3>
          <p className="mt-1 text-sm text-muted">Applies only to <strong className="text-ink">{workspaceName}</strong>.</p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Additional packs</dt><dd className="mt-1 font-semibold text-ink">{quote.packs}</dd></div>
            <div><dt className="text-muted">New total allowance</dt><dd className="mt-1 font-semibold text-ink">{formatStorageBytes(quote.totalBytes, { gb: true })} · {quote.totalFiles.toLocaleString("en-US")} files</dd></div>
            <div><dt className="text-muted">New purchase, recurring monthly</dt><dd className="mt-1 font-semibold text-ink">{dollars(quote.monthlyCents)}/month</dd></div>
            <div><dt className="text-muted">Total recurring capacity charges after purchase</dt><dd className="mt-1 font-semibold text-ink">{dollars(quote.existingMonthlyCents + quote.monthlyCents)}/month, plus your workspace plan</dd></div>
            <div><dt className="text-muted">Amount due today</dt><dd className="mt-1 font-semibold text-ink">{dollars(quote.amountDueTodayCents)} USD</dd></div>
            {typeof quote.taxIncludedCents === "number" ? <div><dt className="text-muted">Tax included in total</dt><dd className="mt-1 font-semibold text-ink">{dollars(quote.taxIncludedCents)} USD · no extra charge</dd></div> : null}
            <div><dt className="text-muted">First renewal</dt><dd className="mt-1 font-semibold text-ink">{new Date(quote.renewalDate).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" })} UTC</dd></div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted">The first payment and each monthly renewal are exactly $5 USD per pack. Applicable tax is included in that price; no extra tax or processing fee is added. This purchase has its own renewal date, shown above. Existing purchases keep their dates, and scheduled cancellations are excluded from the recurring total.</p>
          <p className="mt-3 text-sm text-ink">{quote.cancellationEffect}</p>
          <p className="mt-3 text-sm text-muted">{quote.checkoutTerms}</p>
          <p className="mt-3 text-sm"><Link href="/workspace-capacity-terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-vaeroex-blue underline underline-offset-2">Read Workspace Capacity Terms</Link> <span className="text-muted">({quote.termsVersion}; opens in a new tab).</span></p>
          <label className="mt-4 flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" checked={accepted} disabled={pending !== null || paymentSession !== null} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-vaeroex-blue" />
            <span>I accept the Workspace Capacity Terms ({quote.termsVersion}) and authorize {dollars(quote.amountDueTodayCents)} today and recurring {dollars(quote.monthlyCents)}/month for {workspaceName}, including applicable tax. I authorize Stripe to save my payment method for these monthly renewals. I understand the renewal date and cancellation effect and will confirm payment using Stripe’s secure card fields below. No additional packs or overages will be purchased automatically.</span>
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            {!paymentSession ? <button type="button" disabled={!accepted || pending !== null || !billing.purchasesEnabled} onClick={beginCheckout} className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending === "checkout" ? "Opening secure payment…" : "Continue to secure payment"}</button> : null}
            <button type="button" disabled={pending !== null || paymentSession !== null} onClick={() => { setQuote(null); setAccepted(false); }} className="min-h-11 px-2 text-sm font-semibold text-vaeroex-blue disabled:opacity-50">Change purchase</button>
          </div>
          {paymentSession ? <CapacityPayment key={quote.quoteId} session={paymentSession} workspaceId={workspaceId} expiresAt={quote.expiresAt} /> : null}
        </div>}
      </>}
      <p className="text-xs leading-5 text-muted">Self-service purchase limit: {billing.maxPacks} committed packs, with up to {formatStorageBytes(capacityAllowance(billing.maxPacks).bytes, { gb: true })} and {capacityAllowance(billing.maxPacks).files.toLocaleString("en-US")} file slots total when paid. Larger enterprise needs require a separately qualified plan, including processing and integration capacity. Contact support before expanding beyond this limit.</p>
    </div> : null}
    {billing.subscriptions.length > 0 ? <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-ink">Capacity subscriptions</h3>
      <ul className="mt-3 divide-y divide-line">{billing.subscriptions.map(subscription => <li key={subscription.id} className="flex flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center">
        <div className="text-sm"><p className="font-semibold text-ink">{subscription.packs} {subscription.packs === 1 ? "pack" : "packs"} · {dollars(subscription.monthlyCents)}/month</p>
          <p className="mt-1 text-muted">{subscription.paidThrough && Date.parse(subscription.paidThrough) > Date.now() ? `${subscription.cancelAtPeriodEnd ? "Ends" : "Paid through"} ${date(subscription.paidThrough)} UTC` : "No current paid capacity"}</p>
          <p className="mt-1 text-xs text-muted">Payment provider status: {subscription.status.replaceAll("_", " ")}</p>
          {subscription.status === "past_due" || subscription.status === "unpaid" ? <p className="mt-1 text-amber-800">Payment needs attention. Existing files are retained; capacity follows the confirmed paid period.</p> : null}
          {subscription.status === "past_due" || subscription.status === "unpaid" ? <CapacityRecovery workspaceId={workspaceId} workspaceName={workspaceName} subscriptionId={subscription.id} /> : null}
        </div>
        {!subscription.cancelAtPeriodEnd && !["canceled", "incomplete_expired"].includes(subscription.status) ? <button type="button" disabled={pending !== null} onClick={() => cancelSubscription(subscription)} className="min-h-11 rounded-md border border-line px-3 py-2 text-sm font-semibold text-vaeroex-blue disabled:opacity-50">{pending === subscription.id ? "Canceling…" : "Cancel renewal"}</button> : <span className="text-sm text-muted">Renewal stopped</span>}
      </li>)}</ul>
    </div> : null}
    <p className="mt-4 text-xs leading-5 text-muted">Only a workspace owner can purchase or cancel capacity. Cancellation or payment failure never deletes existing files. Capacity is added automatically after confirmed payment; no manual credit is required.</p>
  </section>;
}
