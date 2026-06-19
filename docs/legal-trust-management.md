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
- Vaeroex Disclaimer
- Sensitive Data Policy

When a policy changes materially, increment the matching version in `LEGAL_DOCUMENT_VERSIONS`. Normal users who have not accepted the latest combination will see the policy acceptance gate on next app access.

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

## Admin Visibility

The admin dashboard shows:

- Current policy versions
- Latest acceptance record count
- Estimated users who have not accepted the latest versions

This is a launch-readiness signal, not a legal report.

## Counsel Review

Legal content should be reviewed by qualified counsel before commercial launch. Do not market Vaeroex as HIPAA-compliant, SOC 2-certified, GDPR-compliant, or certified for regulated data unless those claims are independently validated and supported by required agreements, controls, and documentation.
