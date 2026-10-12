"use client";

import type { CapacityBillingAddress } from "@/lib/storage-capacity/billing-contracts";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countries = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  .split(" ").map(code => ({ code, name: regionNames.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name, "en"));

export function billingAddressError(address: CapacityBillingAddress): string | null {
  if (!address.line1.trim() || !address.city.trim() || !countries.some(country => country.code === address.country)) {
    return "Enter the billing street address, city, and country before reviewing the purchase.";
  }
  if (["US", "CA"].includes(address.country) && !address.state?.trim()) return "Enter the billing state or province before reviewing the purchase.";
  if (["US", "CA", "GB"].includes(address.country) && !address.postalCode?.trim()) return "Enter the billing ZIP or postal code before reviewing the purchase.";
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
      <label className="text-sm font-medium text-ink sm:col-span-2">Country or region
        <select name="country" autoComplete="billing country" required value={value.country} onChange={event => onChange({ ...value, country: event.target.value })} className={fieldClass}>
          <option value="">Select country or region</option>
          {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink sm:col-span-2">Street address
        <input name="line1" autoComplete="billing address-line1" required maxLength={200} value={value.line1} onChange={event => onChange({ ...value, line1: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink sm:col-span-2">Apartment, suite, or building (optional)
        <input name="line2" autoComplete="billing address-line2" maxLength={200} value={value.line2 || ""} onChange={event => onChange({ ...value, line2: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink">City
        <input name="city" autoComplete="billing address-level2" required maxLength={100} value={value.city} onChange={event => onChange({ ...value, city: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink">State, province, or region{["US", "CA"].includes(value.country) ? "" : " (optional)"}
        <input name="state" autoComplete="billing address-level1" required={["US", "CA"].includes(value.country)} maxLength={100} value={value.state || ""} onChange={event => onChange({ ...value, state: event.target.value })} className={fieldClass} />
      </label>
      <label className="text-sm font-medium text-ink">ZIP or postal code{["US", "CA", "GB"].includes(value.country) ? "" : " (optional)"}
        <input name="postalCode" autoComplete="billing postal-code" required={["US", "CA", "GB"].includes(value.country)} maxLength={20} value={value.postalCode || ""} onChange={event => onChange({ ...value, postalCode: event.target.value })} className={fieldClass} />
      </label>
    </div>
  </fieldset>;
}
