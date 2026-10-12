"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import type { CapacityPaymentSession } from "@/lib/storage-capacity/billing-contracts";

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function CapacityPayment({ session, workspaceId, expiresAt, isRecovery = false, willRenew = true }: {
  session: CapacityPaymentSession; workspaceId: string; expiresAt: string; isRecovery?: boolean; willRenew?: boolean;
}) {
  const [stripe, setStripe] = useState<Promise<Stripe | null> | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let mounted = true;
    setStripe(loadStripe(session.publishableKey).catch(() => { if (mounted) setLoadError(true); return null; }));
    return () => { mounted = false; };
  }, [session.publishableKey]);

  if (loadError) return <p role="alert" className="mt-4 text-sm text-red-800">Stripe’s secure payment fields could not load. Reload this page to resume the purchase. No payment was submitted by this form.</p>;
  if (!stripe) return <p role="status" className="mt-4 text-sm text-muted">Loading Stripe’s secure payment fields…</p>;
  return <Elements stripe={stripe} options={{ clientSecret: session.clientSecret, appearance: { theme: "stripe" } }}>
    <CapacityPaymentForm amountCents={session.amountCents} workspaceId={workspaceId} expiresAt={expiresAt} isRecovery={isRecovery} willRenew={willRenew} />
  </Elements>;
}

export function CapacityPaymentForm({ amountCents, workspaceId, expiresAt, isRecovery = false, willRenew = true }: {
  amountCents: number; workspaceId: string; expiresAt: string; isRecovery?: boolean; willRenew?: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const submitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!completed) return;
    router.refresh();
    let attempts = 0;
    const timer = window.setInterval(() => {
      router.refresh();
      if (++attempts >= 6) window.clearInterval(timer);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [completed, router]);

  async function pay() {
    if (!stripe || !elements || !ready || submitted.current || pending || completed || uncertain) return;
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      setError("This payment review expired. Reload Usage & Storage before starting a new review.");
      return;
    }
    submitted.current = true;
    setPending(true);
    setError(null);
    try {
      const returnUrl = new URL("/app/settings/storage/payment-return", window.location.origin);
      returnUrl.searchParams.set("workspaceId", workspaceId);
      const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl.href }, redirect: "if_required" });
      if (result.error) {
        if (["card_error", "validation_error"].includes(result.error.type)) {
          setError(result.error.message || "Payment was not completed. Check the card details and try again.");
          submitted.current = false;
        } else {
          setUncertain(true);
          setError("Payment confirmation is unavailable. Check Usage & Storage before trying again; this form will not submit another payment.");
        }
      } else if (["succeeded", "processing"].includes(result.paymentIntent?.status || "")) {
        setCompleted(true);
      } else {
        setUncertain(true);
        setError("Payment is not yet confirmed. Reload Usage & Storage to check the current billing state before trying again.");
      }
    } catch {
      setUncertain(true);
      setError("The payment response was interrupted. Reload Usage & Storage to check its status; this form will not submit another payment.");
    } finally { setPending(false); }
  }

  return <div className="mt-5 border-t border-line pt-4">
    <h4 className="text-sm font-semibold text-ink">Secure card payment</h4>
    <p className="mt-1 text-sm text-muted">Stripe receives your card details directly. This payment is {dollars(amountCents)} USD, including applicable tax.{willRenew ? ` Future scheduled monthly renewals are ${dollars(amountCents)} USD until canceled.` : " No further renewal is scheduled; this invoice payment does not restart canceled renewals."}{isRecovery ? " This pays the existing invoice and does not buy additional packs." : ""}</p>
    {completed ? <p role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Payment was submitted to Stripe. Capacity updates only after the server receives confirmed payment; the allowance refreshes while that confirmation arrives.</p> : <form onSubmit={async event => { event.preventDefault(); await pay(); }} className="mt-4 space-y-4">
      <PaymentElement onReady={() => setReady(true)} onLoadError={() => setError("Stripe’s secure payment fields could not load. Reload this page to try again.")}
        options={{ layout: "tabs", readOnly: pending || uncertain, wallets: { applePay: "never", googlePay: "never", link: "never" } }} />
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
      <button type="submit" disabled={!stripe || !elements || !ready || pending || uncertain} className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Confirming payment…" : `Pay ${dollars(amountCents)} USD ${isRecovery ? "invoice" : "and subscribe"}`}</button>
      {uncertain ? <button type="button" onClick={() => window.location.assign("/app/settings/storage")} className="ml-3 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue underline">Reload Usage &amp; Storage</button> : null}
    </form>}
  </div>;
}
