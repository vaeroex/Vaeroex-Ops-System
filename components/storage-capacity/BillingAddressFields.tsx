"use client";

import type { CapacityBillingAddress } from "@/lib/storage-capacity/billing-contracts";

export function billingAddressError(address: CapacityBillingAddress): string | null {
  if (!address.line1.trim() || !address.city.trim() || !address.country) {
    return "Enter the billing street address, city, and country before reviewing the purchase.";
  }
  if (address.country !== "US") return "Storage capacity purchases are currently available only for United States billing addresses.";
  if (!address.state?.trim()) return "Enter the billing state before reviewing the purchase.";
  if (!address.postalCode?.trim()) return "Enter the billing ZIP code before reviewing the purchase.";
  return null;
}

export function BillingAddressFields({ value, onChange, disabled }: {
  value: CapacityBillingAddress;
  onChange: (next: CapacityBillingAddress) => void;
  disabled: boolean;
}) {
  const fieldClass = "mt-1 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <fieldset disabled={disabled} className="rounded-lg border border-line p-4">
    <legend className="px-1 text-sm font-semibold text-ink">Billing address</legend>
    <p id="capacity-address-help" className="mb-3 text-sm leading-5 text-muted">Stripe uses this address to calculate tax included in the advertised price. We send it to Stripe for billing; it is not saved in Vaeroex workspace records. Enter card details only in Stripe’s secure payment fields.</p>
    <div className="grid gap-3 sm:grid-cols-2" aria-describedby="capacity-address-help">
      <p className="text-sm font-medium text-ink sm:col-span-2">Country or region <span className="mt-1 block text-sm font-normal">United States</span></p>
      <label className="text-sm font-medium text-ink sm:col-span-2">Street address
        <input name="line1" autoComplete="billing address-line1" required maxLength={200} value={value.line1} onChange={event => onChange({ ...value, line1: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink sm:col-span-2">Apartment, suite, or building (optional)
        <input name="line2" autoComplete="billing address-line2" maxLength={200} value={value.line2 || ""} onChange={event => onChange({ ...value, line2: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink">City
        <input name="city" autoComplete="billing address-level2" required maxLength={100} value={value.city} onChange={event => onChange({ ...value, city: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink">State
        <input name="state" autoComplete="billing address-level1" required maxLength={100} value={value.state || ""} onChange={event => onChange({ ...value, state: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink">ZIP code
        <input name="postalCode" autoComplete="billing postal-code" required maxLength={20} value={value.postalCode || ""} onChange={event => onChange({ ...value, postalCode: event.target.value })} className={fieldClass} />
      </label>
    </div>
  </fieldset>;
}
