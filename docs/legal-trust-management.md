# Vaeroex Legal And Trust Management Notes

This is an internal launch-readiness note. It is not a customer-facing legal document.

## Current Legal Versions

Legal versions are defined in:

```text
lib/legal/content.ts
```

Current version keys:

- Terms of Service
- Privacy Policy
- Subscription and Billing Terms
- Refund Policy
- Acceptable Use Policy
- Vaeroex Disclaimer
- Sensitive Data Policy
- Data Retention Notice
- Human Review Notice

When a policy changes materially, increment the matching version in `LEGAL_DOCUMENT_VERSIONS`. Normal users who have not accepted the latest combination will see the policy acceptance gate on next app access.

Pre-checkout acceptance has a separate versioned acceptance set in:

```text
lib/legal/pre-checkout-acceptance.ts
```

When a required pre-checkout policy or the accepted policy set changes, increment `PRE_CHECKOUT_ACCEPTANCE_SET_VERSION` so stale acceptance records fail closed before Stripe Checkout.

## Acceptance Logging

Acceptance records are stored in:

```text
public.legal_acceptances
```

The table records:

- user ID
- workspace ID when available
- policy versions
- accepted timestamp
- user email
- user agent when available
- IP address when available

The privacy policy discloses usage data, user agent, and IP processing where available for security, audit, abuse prevention, or platform operation.

Pre-checkout acceptance records are stored in:

```text
public.checkout_legal_acceptances
```

That immutable ledger records the authenticated user, optional workspace context, policy identifiers, versions, content hashes, full acceptance snapshot, source/action, timestamp, user agent, and IP address where available.

## Admin Visibility

The admin dashboard shows:

- Current policy versions
- Latest acceptance record count
- Estimated users who have not accepted the latest versions

This is a launch-readiness signal, not a legal report.

## Certification And Compliance Claims

Do not market Vaeroex itself as HIPAA-compliant, SOC 2-certified, ISO 27001-certified, GDPR-certified, or certified for regulated data unless those claims are independently validated and supported by required agreements, controls, and documentation. Any SOC 2, ISO 27001, or similar certification reference should clearly identify the applicable infrastructure provider unless Vaeroex expressly holds that certification.
