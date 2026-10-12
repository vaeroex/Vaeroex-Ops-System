"use client";

import { useState } from "react";
import { CapacityPayment } from "@/components/storage-capacity/CapacityPayment";
import type { CapacityPaymentSession, CapacityRecoveryQuote } from "@/lib/storage-capacity/billing-contracts";
import { CAPACITY_PACK_MONTHLY_CENTS } from "@/lib/storage-capacity/policy";

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const date = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" });
async function request<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/storage/capacity/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "The existing invoice could not be verified. Reload billing before trying again.");
  return value;
}

export function CapacityRecovery({ workspaceId, workspaceName, subscriptionId }: { workspaceId: string; workspaceName: string; subscriptionId: string }) {
  const [quote, setQuote] = useState<CapacityRecoveryQuote | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [session, setSession] = useState<CapacityPaymentSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review() {
    if (pending || session) return;
    setPending(true); setError(null);
    try {
      const next = await request<CapacityRecoveryQuote>({ workspaceId, subscriptionId });
      if (next.subscriptionId !== subscriptionId || next.currency !== "usd" || !Number.isInteger(next.packs) || next.packs < 1
        || next.amountDueTodayCents !== CAPACITY_PACK_MONTHLY_CENTS * next.packs || !next.invoiceId
        || !Number.isFinite(Date.parse(next.periodStart)) || !Number.isFinite(Date.parse(next.periodEnd)) || !Number.isFinite(Date.parse(next.renewalDate))) {
        throw new Error("The invoice amount and paid period could not be verified. No payment was authorized.");
      }
      setQuote(next); setAccepted(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The invoice review is unavailable."); }
    finally { setPending(false); }
  }

  async function preparePayment() {
    if (!quote || !accepted || pending || session) return;
    setPending(true); setError(null);
    try {
      const next = await request<CapacityPaymentSession>({ workspaceId, subscriptionId, invoiceId: quote.invoiceId, acceptedTerms: true });
      if (next.currency !== "usd" || next.amountCents !== quote.amountDueTodayCents || next.renewalDate !== quote.renewalDate
        || !/^pk_(?:test|live)_[A-Za-z0-9]+$/.test(next.publishableKey) || !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(next.clientSecret)) {
        throw new Error("The exact USD invoice payment could not be verified. No card payment was submitted.");
      }
      setSession(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The secure payment form could not be prepared."); }
    finally { setPending(false); }
  }

  return <div className="mt-3">
    {!quote ? <button type="button" disabled={pending} onClick={review} className="min-h-11 rounded-md border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">{pending ? "Reviewing invoice…" : "Resolve payment"}</button> : <section aria-label="Review existing capacity invoice" className="mt-2 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h4 className="font-semibold text-ink">Pay an existing capacity invoice</h4>
      <p className="mt-1 text-sm text-muted">For {workspaceName}. This is a failed renewal for {quote.packs} existing {quote.packs === 1 ? "pack" : "packs"}; it does not buy additional capacity packs.</p>
      <dl className="mt-3 space-y-2 text-sm text-ink">
        <div><dt className="text-muted">Amount due today</dt><dd className="font-semibold">{dollars(quote.amountDueTodayCents)} USD, including {dollars(quote.taxIncludedCents)} tax</dd></div>
        <div><dt className="text-muted">Invoice capacity period</dt><dd>{date(quote.periodStart)} UTC through {date(quote.periodEnd)} UTC</dd></div>
        <div><dt className="text-muted">Next renewal</dt><dd>{quote.cancelAtPeriodEnd ? "No further renewal scheduled" : `${date(quote.renewalDate)} UTC · ${dollars(quote.amountDueTodayCents)} USD/month`}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-ink">{quote.cancellationEffect}</p>
      <label className="mt-3 flex items-start gap-3 text-sm text-ink"><input type="checkbox" checked={accepted} disabled={pending || session !== null} onChange={event => setAccepted(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-vaeroex-blue" />
        <span>I authorize {dollars(quote.amountDueTodayCents)} USD for this existing invoice, including applicable tax, and authorize Stripe to save my payment method for this subscription’s scheduled monthly renewals. This does not buy more packs or restart canceled renewals.</span>
      </label>
      {!session ? <div className="mt-3 flex flex-wrap gap-3"><button type="button" disabled={!accepted || pending} onClick={preparePayment} className="min-h-11 rounded-md bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Preparing payment…" : "Continue to invoice payment"}</button><button type="button" disabled={pending} onClick={() => { setQuote(null); setAccepted(false); }} className="min-h-11 px-2 text-sm font-semibold text-vaeroex-blue">Close review</button></div> : <CapacityPayment key={quote.invoiceId} session={session} workspaceId={workspaceId} expiresAt={quote.periodEnd} isRecovery willRenew={!quote.cancelAtPeriodEnd} />}
    </section>}
    {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
  </div>;
}
