import type { Route } from "next";

export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-06-19",
  privacy: "2026-06-19",
  aiDisclaimer: "2026-06-19",
  sensitiveData: "2026-06-19"
} as const;

export const LEGAL_ACCEPTANCE_VERSION_LABEL =
  `${LEGAL_DOCUMENT_VERSIONS.terms}:${LEGAL_DOCUMENT_VERSIONS.privacy}:${LEGAL_DOCUMENT_VERSIONS.aiDisclaimer}:${LEGAL_DOCUMENT_VERSIONS.sensitiveData}`;

export type LegalDocumentId =
  | "terms"
  | "privacy"
  | "acceptable-use"
  | "refund-policy"
  | "ai-disclaimer"
  | "sensitive-data-policy"
  | "subscription-billing-terms"
  | "data-retention"
  | "human-review";

export type LegalDocument = {
  id: LegalDocumentId;
  title: string;
  summary: string;
  href: Route;
  updated: string;
  sections: Array<{ title: string; body: string[] }>;
};

export const legalLinks: Array<{ href: Route; label: string }> = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/trust", label: "Trust Center" },
  { href: "/acceptable-use", label: "Acceptable Use" },
  { href: "/refund-policy", label: "Refund Policy" },
  { href: "/support", label: "Contact" }
];

// Attorney review recommended before commercial launch.
export const legalDocuments: Record<LegalDocumentId, LegalDocument> = {
  terms: {
    id: "terms",
    title: "Terms of Service",
    summary: "Plain-English terms for using Vaeroex as an Operations Intelligence Platform.",
    href: "/terms",
    updated: LEGAL_DOCUMENT_VERSIONS.terms,
    sections: [
      {
        title: "Acceptance of Terms",
        body: [
          "By creating an account, accessing a workspace, or using Vaeroex, you agree to these Terms of Service and the policies linked from this page.",
          "If you use Vaeroex on behalf of a company, you represent that you have authority to accept these terms for that company."
        ]
      },
      {
        title: "Description of Service",
        body: [
          "Vaeroex is an Operations Intelligence Platform designed to help businesses improve visibility, accountability, and execution.",
          "The platform may include dashboards, KPI records, CRM records, files, SOPs, checklists, issues, reports, notifications, and Vaeroex-generated recommendations."
        ]
      },
      {
        title: "Account Registration",
        body: [
          "You are responsible for providing accurate account information and keeping login credentials secure.",
          "You are responsible for activity that occurs through your account or workspace access."
        ]
      },
      {
        title: "Workspace Responsibility",
        body: [
          "Customers control the records, files, people, roles, and workspace activity they enter into Vaeroex.",
          "Workspace owners and admins are responsible for inviting the right users, assigning appropriate roles, and reviewing workspace activity."
        ]
      },
      {
        title: "Subscription and Billing",
        body: [
          "Vaeroex subscriptions are currently sold and billed through Squarespace or another payment provider.",
          "Customers should use the same email for purchase and account creation so subscription access can be matched correctly."
        ]
      },
      {
        title: "Cancellation",
        body: [
          "Customers may cancel according to the billing provider workflow.",
          "Access may continue until the end of the paid billing period unless otherwise required by law or approved by Vaeroex."
        ]
      },
      {
        title: "Refunds",
        body: [
          "Refunds are handled according to the Refund Policy and applicable law.",
          "Promotions, discounts, and billing adjustments are handled outside the app by the payment provider or Vaeroex support."
        ]
      },
      {
        title: "Customer Data Ownership",
        body: [
          "Customers retain ownership of the business records and files they enter into their workspace.",
          "Vaeroex needs permission to process customer data to provide the platform, generate reports, support features, and operate the service."
        ]
      },
      {
        title: "License to Use the Platform",
        body: [
          "Subject to these terms and active access, Vaeroex grants customers a limited, non-exclusive, non-transferable right to use the platform for internal business purposes.",
          "Customers may not resell, sublicense, or misuse the platform."
        ]
      },
      {
        title: "Acceptable Use",
        body: [
          "Customers must follow the Acceptable Use Policy.",
          "Vaeroex may suspend or terminate access for misuse, abuse, illegal activity, security attacks, or attempts to access another customer workspace."
        ]
      },
      {
        title: "Vaeroex Recommendations and Human Review",
        body: [
          "Vaeroex recommendations are advisory and operational-support outputs.",
          "Users are responsible for reviewing, approving, and implementing recommendations before relying on them or saving records."
        ]
      },
      {
        title: "No Professional Advice",
        body: [
          "Vaeroex does not provide legal, medical, financial, tax, insurance, employment, compliance, safety, or professional management advice.",
          "Customers should consult qualified professionals for regulated or high-stakes decisions."
        ]
      },
      {
        title: "No Guarantee of Results",
        body: [
          "Vaeroex is designed to help customers organize information and make better-informed decisions.",
          "Vaeroex does not guarantee business outcomes, revenue growth, compliance status, operational improvement, or error-free recommendations."
        ]
      },
      {
        title: "Customer Responsibilities",
        body: [
          "Customers remain responsible for decisions, implementation, workforce management, data quality, and compliance obligations.",
          "Customers should review outputs, configure roles carefully, and avoid entering prohibited or unsupported data."
        ]
      },
      {
        title: "Prohibited Data",
        body: [
          "Customers should not upload or enter patient data, PHI/ePHI, Social Security numbers, payment card numbers, government IDs, or other regulated sensitive data unless appropriate legal, security, and compliance controls exist and Vaeroex explicitly supports that use.",
          "Vaeroex is designed for operational business records, not regulated sensitive records."
        ]
      },
      {
        title: "Data Security",
        body: [
          "Vaeroex is built with workspace-scoped access and role-aware controls.",
          "No online service can guarantee absolute security. Customers should use strong account practices and assign access carefully."
        ]
      },
      {
        title: "Service Availability",
        body: [
          "Vaeroex may change, pause, or improve features over time.",
          "Service availability may be affected by maintenance, third-party providers, internet conditions, or events outside Vaeroex control."
        ]
      },
      {
        title: "Beta and Evolving Features",
        body: [
          "Some features may be released as beta, preview, or evolving features.",
          "Customers should review outputs and workflows carefully before using them for important decisions."
        ]
      },
      {
        title: "Limitation of Liability",
        body: [
          "Liability terms should be finalized with qualified counsel before commercial launch.",
          "The platform is provided subject to the limits permitted by applicable law."
        ]
      },
      {
        title: "Indemnification",
        body: [
          "Indemnification terms should be finalized with qualified counsel before commercial launch.",
          "Customers remain responsible for their use of the platform, their data, and their decisions."
        ]
      },
      {
        title: "Termination",
        body: [
          "Vaeroex may suspend or terminate access if a customer violates these terms, fails to pay, misuses the platform, or creates security or legal risk.",
          "Customers may stop using the platform and cancel according to the applicable billing workflow."
        ]
      },
      {
        title: "Changes to Terms",
        body: [
          "Vaeroex may update these terms as the platform evolves.",
          "Material updates may require users to accept updated terms on a future login."
        ]
      },
      {
        title: "Contact",
        body: ["Questions about these terms can be sent through the Vaeroex support page."]
      }
    ]
  },
  privacy: {
    id: "privacy",
    title: "Privacy Policy",
    summary: "How Vaeroex may collect, use, process, and share information to operate the platform.",
    href: "/privacy",
    updated: LEGAL_DOCUMENT_VERSIONS.privacy,
    sections: [
      { title: "Information We Collect", body: ["Vaeroex may collect account information, workspace data, uploaded files, usage data, support messages, and technical information needed to operate the platform."] },
      { title: "Account Information", body: ["Account information may include name, email address, authentication identifiers, and profile details entered by the user."] },
      { title: "Workspace Data", body: ["Workspace data may include business records, KPIs, CRM records, reports, SOPs, checklists, issues, follow-ups, assignments, notifications, and workspace settings."] },
      { title: "Uploaded Files", body: ["Uploaded files may be stored and processed so Vaeroex can provide file libraries, imports, analysis, reports, and historical business memory."] },
      { title: "Usage Data", body: ["Vaeroex may collect usage data such as feature activity, report generation, Vaeroex runs, timestamps, user agent, and operational logs. IP address may be processed where available for security, audit, abuse prevention, or platform operation."] },
      { title: "Payment Data", body: ["Payment and subscription checkout are handled by Squarespace or another payment provider. Vaeroex generally receives subscription status, customer email, order identifiers, and related billing metadata rather than full payment card details."] },
      { title: "How We Use Information", body: ["Vaeroex uses information to provide the platform, maintain workspace access, generate reports, support users, improve reliability, investigate issues, protect the service, and communicate about account or support matters."] },
      { title: "Vaeroex Processing Notice", body: ["When users ask Vaeroex for recommendations, summaries, file analysis, or reports, relevant workspace context may be sent to configured AI service providers to generate the requested output. Users should not submit sensitive or regulated data unless proper controls exist."] },
      { title: "How We Share Information", body: ["Vaeroex may share information with service providers used to host, operate, process, secure, support, or improve the platform. Vaeroex may also disclose information when required by law or to protect the platform and customers."] },
      { title: "Service Providers and Subprocessors", body: ["A subprocessors list should be finalized before broad commercial launch. Examples may include hosting, database, authentication, payment, email, analytics, support, and AI infrastructure providers."] },
      { title: "Data Security", body: ["Vaeroex is designed with workspace-scoped access and role-aware controls. No service can guarantee absolute security, and customers remain responsible for account access, workspace roles, and the data they choose to enter."] },
      { title: "Data Retention", body: ["Vaeroex may retain account, workspace, support, billing, usage, and audit records as needed to operate the service, comply with legal obligations, resolve disputes, and enforce agreements."] },
      { title: "Customer Controls", body: ["Workspace owners and admins can manage workspace records, roles, and some settings inside the app. Additional data requests can be submitted through support."] },
      { title: "Cookies and Analytics", body: ["Vaeroex may use cookies or similar technologies for authentication, security, preferences, and platform operation. Analytics details should be finalized before commercial launch."] },
      { title: "Children's Privacy", body: ["Vaeroex is intended for business use and is not directed to children."] },
      { title: "Changes to Privacy Policy", body: ["Vaeroex may update this policy as the platform evolves. Material updates may require users to review and accept updated terms."] },
      { title: "Contact", body: ["Privacy questions can be sent through Vaeroex support."] }
    ]
  },
  "acceptable-use": {
    id: "acceptable-use",
    title: "Acceptable Use Policy",
    summary: "Rules for safe, lawful, and responsible use of Vaeroex.",
    href: "/acceptable-use",
    updated: "2026-06-19",
    sections: [
      { title: "Lawful Use", body: ["Do not use Vaeroex for illegal activity or to violate the rights of others."] },
      { title: "Platform Abuse", body: ["Do not abuse, overload, disrupt, scrape, reverse engineer, attack, or attempt to bypass security controls."] },
      { title: "Customer Data Boundaries", body: ["Do not attempt to access another customer workspace, records, files, or account data."] },
      { title: "Malware and Harmful Content", body: ["Do not upload malware, malicious files, exploit code, or content intended to harm the service or other users."] },
      { title: "Sensitive and Regulated Data", body: ["Do not upload regulated sensitive data without proper authorization, compliance controls, and explicit support for that use case."] },
      { title: "High-Stakes Decisions", body: ["Do not use Vaeroex as the sole basis for medical diagnosis, legal decisions, financial decisions, employment decisions, safety decisions, or regulated decisions without appropriate professional review."] },
      { title: "Harassment and Harm", body: ["Do not use Vaeroex to create harassment, discrimination, spam, unsolicited outbound messaging, or harmful content."] },
      { title: "Consequences", body: ["Violation of this policy may result in suspension or termination of access."] }
    ]
  },
  "refund-policy": {
    id: "refund-policy",
    title: "Refund Policy",
    summary: "Customer-friendly refund and cancellation language for Vaeroex subscriptions.",
    href: "/refund-policy",
    updated: "2026-06-19",
    sections: [
      { title: "Billing Provider", body: ["Vaeroex is currently billed through Squarespace or another payment provider. Checkout, renewals, payment collection, taxes, and payment records are handled outside the app."] },
      { title: "Automatic Renewal", body: ["Subscriptions renew automatically unless canceled according to the billing provider workflow."] },
      { title: "Cancel Anytime", body: ["Customers may cancel anytime. Access generally continues until the end of the paid billing period unless otherwise required by law or approved by Vaeroex."] },
      { title: "Satisfaction Refund", body: ["First-time subscriptions may be eligible for a 14-day satisfaction refund. After 14 days, monthly subscription fees are generally non-refundable except where required by law or approved by Vaeroex."] },
      { title: "Partial Months", body: ["No refunds are provided for partial months unless required by law or approved by Vaeroex."] },
      { title: "Promotions", body: ["Promotional pricing, discounts, and coupons are handled externally through Squarespace or the payment provider. The Vaeroex app should not be used as the source of truth for discounts."] },
      { title: "Pricing Changes", body: ["Subscription pricing may change in the future. Customers will receive advance notice before pricing changes take effect."] }
    ]
  },
  "ai-disclaimer": {
    id: "ai-disclaimer",
    title: "Vaeroex Disclaimer",
    summary: "How to use Vaeroex-generated recommendations, summaries, reports, and analysis safely.",
    href: "/ai-disclaimer",
    updated: LEGAL_DOCUMENT_VERSIONS.aiDisclaimer,
    sections: [
      { title: "Operational Support", body: ["Vaeroex uses AI to assist with operational analysis, recommendations, summaries, file reviews, and reports."] },
      { title: "Possible Errors", body: ["Outputs may be incomplete, inaccurate, outdated, or unsuitable for a specific business situation."] },
      { title: "Human Review Required", body: ["Users must review and approve Vaeroex-generated outputs before relying on them or saving them into tasks, reports, KPIs, SOPs, forms, checklists, or follow-ups."] },
      { title: "No Professional Advice", body: ["Vaeroex does not provide legal, medical, financial, tax, insurance, employment, compliance, safety, or regulated professional advice."] },
      { title: "No Guarantee", body: ["Vaeroex recommendations are not guarantees of business performance, revenue, compliance, or operational improvement."] },
      { title: "Manager Responsibility", body: ["Managers and owners remain responsible for decisions, implementation, review, and follow-through."] },
      { title: "Sensitive Data", body: ["Sensitive or regulated data should not be uploaded unless appropriate legal, security, and compliance controls exist and Vaeroex explicitly supports that use."] }
    ]
  },
  "sensitive-data-policy": {
    id: "sensitive-data-policy",
    title: "Sensitive Data Policy",
    summary: "What not to upload or enter into Vaeroex unless proper controls exist.",
    href: "/sensitive-data-policy",
    updated: LEGAL_DOCUMENT_VERSIONS.sensitiveData,
    sections: [
      { title: "Designed Use", body: ["Vaeroex is designed for operational business records, not regulated sensitive records."] },
      { title: "Do Not Upload or Enter", body: ["Do not upload or enter patient data, PHI/ePHI, medical record numbers, insurance IDs, Social Security numbers, payment card numbers, government IDs, highly sensitive personal data, or regulated health, legal, financial, or employment data unless appropriate legal, security, and compliance requirements are in place and Vaeroex explicitly supports that use."] },
      { title: "Customer Responsibility", body: ["Customers are responsible for understanding the laws, contracts, policies, and compliance obligations that apply to their business data."] },
      { title: "Where This Matters", body: ["This policy applies to setup, forms, files, reports, support requests, Ask Vaeroex, CRM records, SOPs, issues, checklists, and any other place where users enter business information."] }
    ]
  },
  "subscription-billing-terms": {
    id: "subscription-billing-terms",
    title: "Subscription and Billing Terms",
    summary: "How Vaeroex subscription access works with the billing provider.",
    href: "/subscription-billing-terms",
    updated: "2026-06-19",
    sections: [
      { title: "Single Plan", body: ["Vaeroex currently offers one customer-facing plan: Vaeroex, Operations Intelligence Platform, $399/month, Everything Included."] },
      { title: "External Billing", body: ["Squarespace or another payment provider handles checkout, payment collection, renewals, taxes, discounts, and promotions."] },
      { title: "Access Matching", body: ["Customers should create their Vaeroex account with the same email used during checkout so subscription access can be matched."] },
      { title: "Access Changes", body: ["Canceled, expired, or past-due subscriptions may be routed to the billing-required flow unless access is manually unlocked by Vaeroex."] }
    ]
  },
  "data-retention": {
    id: "data-retention",
    title: "Data Retention Notice",
    summary: "General notice about how long Vaeroex may retain operational records.",
    href: "/data-retention",
    updated: "2026-06-19",
    sections: [
      { title: "Retention Purpose", body: ["Vaeroex may retain account, workspace, support, billing, usage, audit, and security records as needed to operate the platform, resolve issues, enforce agreements, and comply with applicable obligations."] },
      { title: "Customer Records", body: ["Workspace owners should decide what business records to keep, archive, or delete according to their own policies and legal obligations."] },
      { title: "Backups and Logs", body: ["Deleted records may remain in backups or operational logs for a limited period depending on infrastructure and support needs."] }
    ]
  },
  "human-review": {
    id: "human-review",
    title: "Human Review Notice",
    summary: "Vaeroex helps identify signals, but people remain responsible for decisions.",
    href: "/human-review",
    updated: "2026-06-19",
    sections: [
      { title: "Review Before Use", body: ["Vaeroex outputs should be reviewed by a qualified person before they are used for important business actions."] },
      { title: "Approval Before Saving", body: ["When Vaeroex drafts reports, SOPs, forms, checklists, KPIs, or follow-ups, users should confirm the output before saving or implementing it."] },
      { title: "Professional Review", body: ["For legal, medical, financial, tax, insurance, employment, compliance, safety, or regulated decisions, customers should involve qualified professionals."] }
    ]
  }
};

export const trustSections = [
  ["Workspace Isolation", "Vaeroex is designed around workspace-scoped access so customers only work inside workspaces where they are active members."],
  ["Role-Based Access", "Workspace roles help owners control who can view, create, edit, approve, or manage operational records."],
  ["Admin Security", "Internal admin tools are restricted to emails listed in Vaeroex admin configuration and should be used only for support and owner/admin operations."],
  ["Authentication", "Vaeroex uses Supabase Auth for account access and session management."],
  ["Data Storage", "Workspace records are stored in Supabase Postgres with Row Level Security policies designed to enforce tenant separation."],
  ["File Security", "Files are stored by workspace and should be used for business records that are appropriate for Vaeroex."],
  ["Vaeroex Safety", "Vaeroex outputs require human review before users rely on recommendations or save generated records."],
  ["Human Review", "Owners and managers remain responsible for decisions, implementation, and follow-through."],
  ["Audit Logging", "Admin, support, usage, and workspace events are designed to be logged where applicable for review and troubleshooting."],
  ["Demo Workspace Isolation", "Demo workspaces are sample business environments and should remain separate from real customer data."],
  ["Customer Data Responsibilities", "Customers remain responsible for the information they enter, workspace roles they assign, and compliance obligations that apply to their business."],
  ["Security Contact", "Security or trust questions can be sent through Vaeroex support."]
] as const;

export const releaseNotes = [
  {
    date: "June 2026",
    title: "Operations Intelligence Platform foundation",
    type: "Feature added",
    body: "Vaeroex now includes workspace setup, dashboard intelligence, KPIs, CRM, files, reports, SOPs, checklists, follow-ups, and Vaeroex recommendations."
  },
  {
    date: "June 2026",
    title: "Single Vaeroex plan",
    type: "Improvement",
    body: "Customer-facing pricing has been simplified to one Vaeroex plan with everything included."
  },
  {
    date: "June 2026",
    title: "Workspace isolation and security guardrails",
    type: "Security update",
    body: "Workspace-scoped access, role checks, support request safety, and security regression checks were added to reduce accidental data exposure."
  },
  {
    date: "June 2026",
    title: "Help, trust, and legal-safety framework",
    type: "Feature added",
    body: "Vaeroex added Help Center, Trust Center, policy pages, human-review notices, and legal acceptance logging."
  }
];
