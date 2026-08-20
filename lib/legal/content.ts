import type { Route } from "next";
import { VAEROEX_COMPANY_ADDRESS_SINGLE_LINE, VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";

export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-08-20",
  privacy: "2026-08-20",
  aiDisclaimer: "2026-08-20",
  acceptableUse: "2026-08-20",
  refundPolicy: "2026-08-20",
  sensitiveData: "2026-08-20",
  subscriptionBillingTerms: "2026-08-20",
  dataRetention: "2026-08-20",
  humanReview: "2026-08-20"
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
  { href: "/ai-disclaimer", label: "AI Disclaimer" },
  { href: "/subscription-billing-terms", label: "Subscription Billing Terms" },
  { href: "/sensitive-data-policy", label: "Sensitive Data Policy" },
  { href: "/data-retention", label: "Data Retention" },
  { href: "/human-review", label: "Human Review" },
  { href: "/contact", label: "Contact" }
];

export const legalDocuments: Record<LegalDocumentId, LegalDocument> = {
  terms: {
    id: "terms",
    title: "Terms of Service",
    summary: "Plain-English terms for using Executive Intelligence by Vaeroex.",
    href: "/terms",
    updated: LEGAL_DOCUMENT_VERSIONS.terms,
    sections: [
      {
        title: "Acceptance of Terms",
        body: [
          "By creating an account, accessing a workspace, purchasing a subscription, or using Vaeroex, you agree to these Terms of Service and the policies incorporated or referenced by these Terms.",
          "If you use Vaeroex on behalf of a company, you represent that you have authority to accept these terms for that company."
        ]
      },
      {
        title: "Incorporated Policies",
        body: [
          "These Terms incorporate the Privacy Policy, Subscription and Billing Terms, Refund Policy, Acceptable Use Policy, Vaeroex Disclaimer, Sensitive Data Policy, Data Retention Notice, and Human Review Notice where those policies apply to your use of the Services.",
          "If a supporting policy addresses a specific subject, that policy applies together with these Terms unless Vaeroex provides a written agreement that says otherwise."
        ]
      },
      {
        title: "Description of Service",
        body: [
          "Vaeroex LLC builds intelligence systems, including Executive Intelligence, its flagship evidence-backed platform.",
          "Executive Intelligence may include Business Health, KPI records, Intelligence, Explain Finding, Evidence, Business Memory, Saved Analyses, and evidence-backed recommendations."
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
          "Customers control the records, files, roles, and workspace activity they enter into Vaeroex.",
          "Workspace owners and admins are responsible for inviting the right users, choosing appropriate access roles, and reviewing workspace activity."
        ]
      },
      {
        title: "Subscription and Billing",
        body: [
          "Vaeroex subscriptions are available through the Vaeroex Direct Website and official Vaeroex sales channels.",
          "Customers should use the same email for purchase and account creation so Vaeroex subscription access can be matched correctly."
        ]
      },
      {
        title: "Cancellation",
        body: [
          `Customers may cancel through Manage billing in the Stripe Customer Portal. ${VAEROEX_CONTACT_EMAILS.billing} remains available for billing assistance.`,
          "Cancellation prevents the next renewal and takes effect at the end of the current paid billing period, as determined by the billing provider's actual period-end timestamp. Access continues through that paid period."
        ]
      },
      {
        title: "Refunds",
        body: [
          "All purchases and subscription payments are final and non-refundable, except where a refund is required by applicable law.",
          "Cancellation does not provide a prorated refund, credit, or refund for unused time in the current paid billing period.",
          "Promotions, discounts, and special offers may be available through the Vaeroex Direct Website or official Vaeroex sales channels."
        ]
      },
      {
        title: "Subscription Pricing",
        body: [
          "Your subscription price will not increase while your subscription remains continuously active. If Vaeroex lowers the applicable subscription price, active subscribers will receive the lower price for future renewals.",
          "If you cancel and later resubscribe, your new subscription will be subject to the pricing available at the time you resubscribe. A price reduction does not provide a retroactive refund or credit for billing periods already paid."
        ]
      },
      {
        title: "Customer Data Rights",
        body: [
          "Customers retain ownership of Customer Data, including the business records, files, prompts, instructions, and other content they submit to or maintain in a Vaeroex workspace.",
          "Customer represents that it has all rights, permissions, authorizations, licenses, and lawful bases necessary to provide Customer Data to Vaeroex and to permit Vaeroex to process that information through the Services.",
          "Customer is responsible for determining whether information may lawfully be submitted to Vaeroex, including whether sensitive, regulated, confidential, personal, or third-party information is appropriate for the Services.",
          "Customer grants Vaeroex only the limited rights necessary to host, store, process, transmit, secure, maintain, support, and provide the Services, including generating requested analyses and maintaining workspace functionality."
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
          "Vaeroex recommendations, predictive insights, decision-support outputs, and business-memory summaries are advisory support outputs.",
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
          "Customers should review outputs carefully before using them for important decisions."
        ]
      },
      {
        title: "Limitation of Liability",
        body: [
          "To the maximum extent permitted by applicable law, Vaeroex will not be liable for any indirect, incidental, special, exemplary, consequential, or punitive damages.",
          "To the maximum extent permitted by applicable law, Vaeroex will not be liable for loss of profits, revenue, business opportunities, goodwill, data, or business interruption.",
          "To the maximum extent permitted by applicable law, Vaeroex's aggregate liability for all claims arising out of or relating to the Services or these Terms will not exceed the amounts actually paid by the Customer to Vaeroex during the twelve months immediately preceding the event giving rise to the claim.",
          "These limitations apply whether a claim is based in contract, tort, negligence, strict liability, statute, or any other theory, subject to any limitations imposed by applicable law."
        ]
      },
      {
        title: "Customer Indemnification",
        body: [
          "Customer will defend, indemnify, and hold harmless Vaeroex from and against third-party claims, damages, liabilities, losses, costs, and expenses arising from Customer Data or other content provided by Customer.",
          "Customer's indemnification obligations also apply to third-party claims arising from Customer's violation of these Terms or applicable law; infringement or violation of third-party intellectual-property, privacy, confidentiality, or other rights; violation of the Acceptable Use Policy; or unlawful customer decisions or actions involving use of the Services.",
          "Vaeroex will provide reasonable notice of covered claims and reasonable cooperation, at Customer's expense, where legally permitted. Customer may control the defense and settlement of covered claims, but may not settle any claim in a way that imposes liability, admission, or obligation on Vaeroex without Vaeroex's prior written consent."
        ]
      },
      {
        title: "Governing Law and Disputes",
        body: [
          "These Terms are governed and interpreted according to applicable law and any governing-law terms stated in a separate written agreement between Vaeroex and the Customer.",
          "The parties will attempt to resolve disputes in good faith before pursuing formal remedies, unless immediate action is needed to protect accounts, data, security, intellectual property, payment rights, or legal compliance.",
          "These Terms do not add an arbitration requirement, class-action waiver, venue provision, opt-out procedure, or other dispute term unless Vaeroex and the Customer separately agree to one in writing."
        ]
      },
      {
        title: "Termination",
        body: [
          "Vaeroex may suspend or terminate access if a customer violates these terms, fails to pay, misuses the platform, or creates security or legal risk.",
          "Customers may schedule cancellation through Manage billing in the Stripe Customer Portal. A scheduled cancellation ends access at the close of the current paid billing period and prevents renewal for the next billing period."
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
        body: [
          `Questions about these terms can be sent to ${VAEROEX_CONTACT_EMAILS.support} or through the Vaeroex support page.`,
          `Company mailing address: ${VAEROEX_COMPANY_ADDRESS_SINGLE_LINE}.`
        ]
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
      { title: "Workspace Data", body: ["Workspace data may include business records, KPI records, source evidence, saved analyses, historical service records, and workspace settings."] },
      { title: "Uploaded Files", body: ["Uploaded files may be stored and processed so Vaeroex can provide Evidence, structured imports, analysis, and historical business context."] },
      { title: "Usage Data", body: ["Vaeroex may collect usage data such as feature activity, analysis activity, timestamps, user agent, and operational logs. IP address may be processed where available for security, audit, abuse prevention, or platform operation."] },
      { title: "Payment Data", body: ["Payment and subscription checkout are handled through Vaeroex checkout and official Vaeroex sales channels. Vaeroex may process subscription status, customer email, order identifiers, and related billing metadata, but it does not need full payment card details to operate the workspace."] },
      { title: "How We Use Information", body: ["Vaeroex uses information to provide the platform, maintain workspace access, produce requested intelligence, support users, improve reliability, investigate issues, protect the service, and communicate about account or support matters."] },
      { title: "Vaeroex Processing Notice", body: ["When users request supported Vaeroex analyses, recommendations, summaries, or file analysis, relevant workspace context may be sent to configured AI service providers to generate the requested output. Users should not submit sensitive or regulated data unless proper controls exist."] },
      { title: "How We Share Information", body: ["Vaeroex may share information with service providers used to host, operate, process, secure, support, or improve the platform. Vaeroex may also disclose information when required by law or to protect the platform, customers, rights, safety, and legal compliance."] },
      { title: "Service Provider Categories", body: ["Vaeroex may use service providers for cloud infrastructure and hosting, data storage, authentication, security, communications, payment processing, artificial-intelligence processing, customer support, logging, reliability, and performance monitoring.", "Vaeroex limits service-provider access to information needed for the provider to perform services for Vaeroex and does not publicly map individual infrastructure vendors to backend functions unless required by law or a specific disclosure obligation."] },
      { title: "Data Security", body: ["Vaeroex is designed with workspace-scoped access and role-aware controls. No service can guarantee absolute security, and customers remain responsible for account access, workspace roles, and the data they choose to enter."] },
      { title: "Data Retention", body: ["Vaeroex may retain account, workspace, support, billing, usage, and audit records as needed to operate the service, comply with legal obligations, resolve disputes, and enforce agreements."] },
      { title: "Customer Controls", body: [`Workspace owners and admins can manage workspace records, access roles, and some settings inside the app. Additional data requests can be sent to ${VAEROEX_CONTACT_EMAILS.support}.`] },
      { title: "Cookies and Browser Storage", body: ["Vaeroex uses necessary cookies and similar session technologies for authentication, account sessions, workspace selection, security, bot protection, and platform operation.", "Vaeroex may use browser local storage for user interface preferences such as theme selection, and session storage for temporary application state such as dismissed notices or unsent draft workspace prompts.", "Vaeroex may process operational logs, usage events, and performance information to maintain reliability, security, and support. Vaeroex does not currently claim use of cross-site advertising cookies or third-party advertising tracking in the Production application."] },
      { title: "Children's Privacy", body: ["Vaeroex is intended for business use and is not directed to children."] },
      { title: "Changes to Privacy Policy", body: ["Vaeroex may update this policy as the platform evolves. Material updates may require users to review and accept updated terms."] },
      {
        title: "Contact",
        body: [
          `Privacy questions can be sent to ${VAEROEX_CONTACT_EMAILS.support}.`,
          `Company mailing address: ${VAEROEX_COMPANY_ADDRESS_SINGLE_LINE}.`
        ]
      }
    ]
  },
  "acceptable-use": {
    id: "acceptable-use",
    title: "Acceptable Use Policy",
    summary: "Rules for safe, lawful, and responsible use of Vaeroex.",
    href: "/acceptable-use",
    updated: LEGAL_DOCUMENT_VERSIONS.acceptableUse,
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
    updated: LEGAL_DOCUMENT_VERSIONS.refundPolicy,
    sections: [
      { title: "Vaeroex Subscription", body: [`Vaeroex subscriptions are purchased through the Vaeroex Direct Website or official Vaeroex sales channels. Customers may manage and cancel an eligible subscription through Manage billing in the Stripe Customer Portal. ${VAEROEX_CONTACT_EMAILS.billing} remains available for billing assistance.`] },
      { title: "Automatic Renewal", body: ["Vaeroex subscriptions renew automatically unless cancellation is scheduled before the next renewal. A scheduled cancellation prevents renewal for the next billing period."] },
      { title: "Cancellation Timing and Access", body: ["Cancellation takes effect at the end of the current paid billing period, based on the billing provider's actual period-end timestamp. Customers retain access through that paid period."] },
      { title: "Final and Non-Refundable Payments", body: ["All purchases and subscription payments are final and non-refundable, except where a refund is required by applicable law."] },
      { title: "No Prorated Refunds or Credits", body: ["Cancellation does not provide a prorated refund, credit, or refund for unused time in the current paid billing period."] },
      { title: "Promotions", body: [`Promotions, discounts, and special offers may be available through the Vaeroex Direct Website or official Vaeroex sales channels. ${VAEROEX_CONTACT_EMAILS.billing} can help customers with questions about eligible offers.`] },
      { title: "Subscription Pricing", body: ["Your subscription price will not increase while your subscription remains continuously active. If Vaeroex lowers the applicable subscription price, active subscribers will receive the lower price for future renewals.", "If you cancel and later resubscribe, your new subscription will be subject to the pricing available at the time you resubscribe. A price reduction does not provide a retroactive refund or credit for billing periods already paid."] }
    ]
  },
  "ai-disclaimer": {
    id: "ai-disclaimer",
    title: "Vaeroex Disclaimer",
    summary: "How to use Vaeroex-generated recommendations and executive analysis safely.",
    href: "/ai-disclaimer",
    updated: LEGAL_DOCUMENT_VERSIONS.aiDisclaimer,
    sections: [
      { title: "Executive Intelligence Support", body: ["Executive Intelligence uses advanced reasoning systems to support analysis, executive decision support, recommendations, and focused explanations."] },
      { title: "Possible Errors", body: ["Outputs may be incomplete, inaccurate, outdated, or unsuitable for a specific business situation."] },
      { title: "Human Review Required", body: ["Users must review Vaeroex-generated analysis before relying on it for important decisions or saving it into business records."] },
      { title: "No Professional Advice", body: ["Vaeroex does not provide legal, medical, financial, tax, insurance, employment, compliance, safety, or regulated professional advice."] },
      { title: "No Guarantee", body: ["Vaeroex recommendations are not guarantees of business performance, revenue, compliance, or operational improvement."] },
      { title: "Customer Responsibility", body: ["Customers remain responsible for decisions, implementation, review, and follow-through."] },
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
      { title: "Where This Matters", body: ["This policy applies to setup, Evidence, Saved Analyses, support requests, Search, Intelligence, KPIs, and any other place where users enter business information."] }
    ]
  },
  "subscription-billing-terms": {
    id: "subscription-billing-terms",
    title: "Subscription and Billing Terms",
    summary: "How Vaeroex subscription access, billing requests, and promotions work.",
    href: "/subscription-billing-terms",
    updated: LEGAL_DOCUMENT_VERSIONS.subscriptionBillingTerms,
    sections: [
      { title: "Single Plan", body: ["Vaeroex currently offers one customer-facing plan: Vaeroex Executive Intelligence, $500/month, Everything Included."] },
      { title: "Vaeroex Checkout", body: ["Vaeroex subscriptions are purchased through Vaeroex checkout, the Vaeroex Direct Website, or official Vaeroex sales channels. Promotions, discounts, and special offers may be available through those same Vaeroex channels."] },
      { title: "Access Matching", body: ["Customers should create their Vaeroex account with the same email used for Vaeroex checkout so subscription access can be matched."] },
      { title: "Manage Billing and Cancellation", body: [`Customers may manage and cancel an eligible subscription through Manage billing in the Stripe Customer Portal. ${VAEROEX_CONTACT_EMAILS.billing} remains available for billing assistance.`] },
      { title: "Renewal and Cancellation Timing", body: ["Vaeroex subscriptions renew automatically unless cancellation is scheduled. A scheduled cancellation prevents the next renewal and takes effect at the end of the current paid billing period, based on the billing provider's actual period-end timestamp. Access continues through that paid period."] },
      { title: "Refunds and Unused Time", body: ["All purchases and subscription payments are final and non-refundable, except where a refund is required by applicable law. Cancellation does not provide a prorated refund, credit, or refund for unused time in the current paid billing period."] },
      { title: "Access Changes", body: ["Once the current paid billing period ends, a canceled subscription may be routed to the billing-required flow unless access is manually unlocked by Vaeroex. Expired or past-due subscriptions may also be routed to that flow."] },
      { title: "Subscription Pricing", body: ["Your subscription price will not increase while your subscription remains continuously active. If Vaeroex lowers the applicable subscription price, active subscribers will receive the lower price for future renewals.", "If you cancel and later resubscribe, your new subscription will be subject to the pricing available at the time you resubscribe. A price reduction does not provide a retroactive refund or credit for billing periods already paid."] }
    ]
  },
  "data-retention": {
    id: "data-retention",
    title: "Data Retention Notice",
    summary: "General notice about how long Vaeroex may retain operational records.",
    href: "/data-retention",
    updated: LEGAL_DOCUMENT_VERSIONS.dataRetention,
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
    updated: LEGAL_DOCUMENT_VERSIONS.humanReview,
    sections: [
      { title: "Review Before Use", body: ["Vaeroex outputs should be reviewed by a qualified person before they are used for important business actions."] },
      { title: "Approval Before Saving", body: ["When Vaeroex produces recommendations, explanations, or other supporting analysis, users should confirm the output before saving or implementing it."] },
      { title: "Professional Review", body: ["For legal, medical, financial, tax, insurance, employment, compliance, safety, or regulated decisions, customers should involve qualified professionals."] }
    ]
  }
};

export const trustSections = [
  ["Workspace Isolation", "Customer records, files, and analyses are kept within the authorized workspace and protected by role-aware access controls."],
  ["Infrastructure & Security", "Vaeroex is built on established cloud infrastructure providers that maintain independent security and compliance programs, including applicable SOC 2 Type II and ISO 27001 certifications and attestations. Vaeroex applies additional application-level security controls on top of this infrastructure, including workspace isolation, role-based authorization, private data access controls, secure authentication, and automated security testing."],
  ["Secure Data Handling", "Vaeroex uses encrypted connections, private file access, secure authentication, Turnstile bot protection, leaked-password protection where supported, and managed cloud protections to help safeguard customer information."],
  ["Evidence-Backed Intelligence", "Supporting information remains connected to its source so leadership can inspect what each conclusion is based on."],
  ["Deterministic Business Intelligence", "Business facts, KPI values, and Business Health calculations remain separate from executive interpretation."],
  ["Explainable Executive Reasoning", "Vaeroex presents supported interpretation with citations, confidence, freshness, and limitations instead of hiding uncertainty."],
  ["Source Content Safeguards", "Information inside uploaded files is treated as business content to evaluate, not as authority to change system behavior or customer records."],
  ["Leadership Control", "Recommendations remain advisory. Authorized users review important conclusions and remain responsible for business decisions and actions."],
  ["Current Information Controls", "Archived or deleted information is excluded from current intelligence while supported restore and retention behavior remains available."],
  ["Accountability Records", "Selected security-sensitive, administrative, billing, legal-acceptance, and support activity is recorded to support review and investigation."],
  ["Advanced Reasoning Boundaries", "Executive interpretation is produced through protected service connections. It may still be incomplete or inaccurate and requires human review."],
  ["Sensitive Data Boundaries", "Vaeroex is not intended for unrestricted regulated sensitive data such as PHI/ePHI, Social Security numbers, payment card numbers, government IDs, or highly sensitive personal records unless appropriate controls exist."],
  ["Customer Responsibility", "Customers remain responsible for the information they upload, workspace roles they assign, legal obligations that apply to their data, and final decisions they make."],
  ["Security Contact", `Security or trust questions can be sent to ${VAEROEX_CONTACT_EMAILS.support}.`]
] as const;

export const releaseNotes = [
  {
    date: "June 2026",
    title: "Executive Intelligence foundation",
    type: "Feature added",
    body: "Vaeroex now includes the Executive Intelligence foundation: workspace setup, Business Health, KPIs, Evidence, Intelligence, Business Memory, and Saved Analyses."
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
