import type { Route } from "next";
import { VAEROEX_COMPANY_ADDRESS_SINGLE_LINE, VAEROEX_CONTACT_EMAILS } from "@/lib/contact/emails";

export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-08-20",
  privacy: "2026-10-12.sheets1",
  aiDisclaimer: "2026-08-20",
  acceptableUse: "2026-08-20",
  refundPolicy: "2026-08-20",
  sensitiveData: "2026-08-20",
  subscriptionBillingTerms: "2026-10-12.1",
  dataRetention: "2026-10-12.sheets1",
  workspaceCapacity: "storage-capacity-v1",
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
  | "workspace-capacity-terms"
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
  { href: "/workspace-capacity-terms", label: "Workspace Capacity Terms" },
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
      { title: "Google Sheets access and use", body: ["Connecting Google Sheets grants the spreadsheets.readonly scope. Google grants read access to spreadsheets available to your Google account; Vaeroex uses the spreadsheet URL you supply. It reads spreadsheet and tab details, headings, selected preview columns, and columns in your approved mapping. Vaeroex cannot edit or delete your Google spreadsheet and does not request Google Drive access.", "Approved business metrics, import history, and source references are stored in your workspace. They support Performance, Business Health, Intelligence, briefings, saved analyses, and requested Vaeroex conversations. When you approve a recommendation as a Business Note, its source-derived content may also become Business Memory. Relevant context can be included in other analyses you request, including analysis of an uploaded file. Do not connect patient information, PHI/ePHI, Social Security numbers, medical record numbers, insurance IDs, or other prohibited sensitive data."] },
      { title: "Google data and service providers", body: ["Vaeroex uses Vercel for application processing, Supabase for workspace data and authentication, and Google services for the authorized Sheets connection. Requested analysis and Business Memory indexing can send relevant Google-derived business data to OpenAI. Google-derived context is restricted to the verified OpenAI project; it is not routed to NVIDIA. Google Cloud retains the separate deletion journal, which contains record identifiers, counts, hashes, and signed deletion instructions rather than spreadsheet values or model prompts.", "Vaeroex does not sell Google user data, use it for advertising, or use it to train generalized models. OpenAI API data sharing is disabled for the verified project. Vaeroex requests that Responses output not be stored by OpenAI (store:false). This is not Zero Data Retention: OpenAI standard abuse-monitoring logs may contain inputs and outputs for up to 30 days, with longer retention for legal or safety exceptions. Model prompt caches may persist for up to 24 hours. Processor retention is separate from deletion of Vaeroex records.", "Google-derived data is used and transferred for the disclosed features with your consent, or where necessary for security or legal obligations. Human access is limited to documented consent for specific support data, permitted anonymized internal operations, security investigation, or legal obligations. Vaeroex follows the Google API Services User Data Policy and Google Workspace API User Data and Developer Policy, including their Limited Use restrictions. These restrictions also apply to derived data."] },
      { title: "Google Sheets retention and deletion", body: ["While connected, imported reporting history is available for up to 13 calendar months from its first import. Disconnect shortens the deadline to 30 days after disconnection, capped by the original 13-month deadline. Refreshing, copying, or reconnecting does not restart the clock. Identified Google-derived copies and analyses inherit the earliest applicable deadline. At expiry, the affected content becomes unavailable; support processes physical deletion on the next business day.", "Disconnect stops refresh and requests Google token revocation; it does not immediately delete reporting history. You can request earlier deletion at support@vaeroex.com. We verify your authority and the exact workspace, connection, and identified copies before execution. See the Data Retention Notice for request steps, response targets, mixed records, backups, and processor limits. The periods are Vaeroex business choices, not requirements or approvals from Google."] },
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
      { title: "Base Plan", body: ["The Vaeroex Executive Intelligence base subscription is $250/month and includes the product's standard features and allowances. Optional workspace capacity is purchased explicitly and billed separately under the Workspace Capacity Terms."] },
      { title: "Vaeroex Checkout", body: ["Vaeroex subscriptions are purchased through Vaeroex checkout, the Vaeroex Direct Website, or official Vaeroex sales channels. Promotions, discounts, and special offers may be available through those same Vaeroex channels."] },
      { title: "Access Matching", body: ["Customers should create their Vaeroex account with the same email used for Vaeroex checkout so subscription access can be matched."] },
      { title: "Manage Billing and Cancellation", body: [`Customers may manage and cancel an eligible subscription through Manage billing in the Stripe Customer Portal. ${VAEROEX_CONTACT_EMAILS.billing} remains available for billing assistance.`] },
      { title: "Renewal and Cancellation Timing", body: ["Vaeroex subscriptions renew automatically unless cancellation is scheduled. A scheduled cancellation prevents the next renewal and takes effect at the end of the current paid billing period, based on the billing provider's actual period-end timestamp. Access continues through that paid period."] },
      { title: "Refunds and Unused Time", body: ["All purchases and subscription payments are final and non-refundable, except where a refund is required by applicable law. Cancellation does not provide a prorated refund, credit, or refund for unused time in the current paid billing period."] },
      { title: "Access Changes", body: ["Once the current paid billing period ends, a canceled subscription may be routed to the billing-required flow unless access is manually unlocked by Vaeroex. Expired or past-due subscriptions may also be routed to that flow."] },
      { title: "Optional Workspace Capacity", body: ["Capacity purchases are separate from the base subscription. Canceling or failing to renew a capacity purchase does not cancel base-plan access or delete existing originals. Only new uploads that exceed the resulting workspace allowance are blocked. Owners manage capacity purchases in Settings → Usage & Storage; the Workspace Capacity Terms describe that allowance and purchase consent."] },
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
      { title: "Uploaded-File Trash", body: ["New deletions of uploaded originals use a 30-day recoverable Trash period unless an authorized user explicitly confirms permanent deletion sooner. All retained originals, including archived files and Trash, continue to use uploaded-file bytes and file slots until physical deletion is confirmed. Historical deleted originals present before this policy took effect remain protected from permanent deletion pending advance notice and a recovery/export window. The Workspace Capacity Terms describe file retention, separate business records, and capacity behavior."] },
      { title: "Google Sheets reporting history", body: ["Google-derived history is available for up to 13 calendar months from first import while connected. After disconnect, it is available for up to 30 days, ending sooner if the first-import deadline arrives first. Refreshes, copies, and reconnects do not extend the original clock. Identified derivatives inherit the earliest source deadline. Expired content is excluded from normal access immediately and is physically purged during the next business-day support run. Connection details and sync-count history also expire after the disconnection period.", "Approval of a mapping includes this retention policy. Existing connections must be approved again before new imports. Historical imports and mixed analyses without complete source tracking require an exact support review before physical deletion; missing source links are not treated as proof that a record is unrelated. An identified mixed analysis may be removed in full after the required scope approval. Unrelated source records are preserved. When an uploaded file contains a separate expired analysis, access to that file may be temporarily held until the derived analysis is removed; the original file is preserved."] },
      { title: "Request Google Sheets deletion", body: ["Email support@vaeroex.com from your workspace account with the workspace name, the Google Sheets connection name, and whether you want one connection and its identified copies deleted. Mention any saved analyses, notes, conversations, exports, or manually copied records that you know contain the data. Do not email spreadsheet contents, passwords, access tokens, or client secrets.", "Isaac at isaac@vaeroex.com is the accountable operator and monitors the inbox each business day. We acknowledge requests within two business days and target completion of active-system deletion within 30 calendar days of receipt. We verify requester authority before execution, obtain the workspace owner’s approval of the specific scope, and explain blockers promptly. A delayed response or a pending request is not evidence that deletion has completed.", "The process stops affected imports, checks exact records and identified downstream copies, and prevents older in-flight analysis from writing the data back. It preserves unrelated data and reports unresolved manual copies, mixed dependencies, or storage cleanup instead of declaring success. Ask support about a delayed request or an incorrect scope. Removing access in your Google Account stops future authorized reads but does not itself erase Vaeroex history. Deletion in Vaeroex does not delete the original Google spreadsheet or copies you exported outside Vaeroex."] },
      { title: "Google data in backups and deletion records", body: ["Active-system deletion does not immediately rewrite existing infrastructure backups. The current database service uses daily backups under its Pro plan, with a documented seven-day backup access window; point-in-time recovery is not enabled. This is not a guarantee that every infrastructure or separately retained backup copy is erased at that boundary. Database backups do not include Storage object bytes. Backup copies are not used for normal application access. Before a restored environment can serve users or run background jobs, independently retained signed deletion instructions must be reconciled and replayed. An incomplete or conflicting replay keeps that environment closed.", "The deletion journal retains identifiers, content hashes, scope counts, approvals, and completion or reconciliation receipts to prevent resurrection after a restore; it does not retain spreadsheet values or model prompts. Restricted security and accounting records may remain where needed without the deleted content. We do not claim that all backup media or all third-party processor records are immediately erased."] },
      { title: "Google data sent to OpenAI", body: ["For requested features, relevant Google-derived context and memory-indexing inputs may be sent to the verified OpenAI project. Responses use store:false and API data sharing is disabled. Standard abuse-monitoring retention may be up to 30 days, with legal or safety exceptions, and prompt caching may last up to 24 hours. This is not Zero Data Retention. Removing a Vaeroex record does not retroactively remove these processor records; OpenAI’s retention controls apply separately."] },
      { title: "Backups and Logs", body: ["Deleted records may remain in backups or operational logs for a limited period depending on infrastructure and support needs."] }
    ]
  },
  "workspace-capacity-terms": {
    id: "workspace-capacity-terms",
    title: "Workspace Capacity Terms",
    summary: "Included uploaded-file capacity, optional recurring packs, and recoverable file deletion for each workspace.",
    href: "/workspace-capacity-terms",
    updated: LEGAL_DOCUMENT_VERSIONS.workspaceCapacity,
    sections: [
      { title: "Independent Included Allowance", body: ["Each workspace independently includes 15 GB of uploaded-original storage and 500 retained-file slots. Allowances are not pooled across workspaces or businesses. One GB means 1,000,000,000 bytes; an individual original may be up to 25 MiB (26,214,400 bytes)."] },
      { title: "What Uses Capacity", body: ["Active originals, archived originals, recoverable Trash, and protected historical Trash use both storage bytes and file slots until permanent deletion is confirmed. Missing originals do not consume uploaded-file capacity. Uploads in progress reserve capacity before admission. Synced plug-in data, chats, saved analyses, extracted text, derived database records, and infrastructure backups are outside this paid uploaded-file quota. Their separate service and processing limits still apply."] },
      { title: "Explicit Recurring Purchase", body: ["A workspace owner may explicitly buy one or more recurring capacity packs for that workspace. Each pack adds 10 GB and 500 retained-file slots for exactly $5 USD for the first payment and $5 USD each month after that, including applicable tax. No additional tax or processing fee is added to that advertised price. The self-service purchase limit is 10 committed packs. Each subscription counts once while it can renew or has a paid period that has not ended or been fully refunded. This includes unpaid or refunded renewable subscriptions and disputed paid periods that could regain capacity; disputed periods reserve their packs until the period ends. A fully refunded subscription stops counting after renewal is canceled unless another qualifying paid period remains. Only currently paid, undisputed capacity increases the allowance, up to 115 GB and 5,500 slots including the base allowance. Owners may need to resolve existing renewals or wait for a committed period to end before buying additional packs. Larger needs require a separately qualified plan; buying storage does not raise unrelated processing or plug-in limits.", "Before payment confirmation, the review shows the workspace, number of packs, new total allowance, recurring price, exact amount due immediately, exact renewal date, and cancellation effect. Each purchase has its own monthly renewal schedule. Existing purchases keep their renewal dates, and scheduled cancellations are excluded from the future recurring-charge total. Vaeroex does not automatically buy more packs or charge usage overages when the workspace fills."] },
      { title: "Billing Address and Included Tax", body: ["The workspace owner supplies a billing address so Stripe can determine any tax included in the advertised price. Vaeroex sends the address to Stripe for billing and tax calculation; it is not saved in Vaeroex workspace records. The purchase cannot proceed unless the exact tax-inclusive amount and renewal date have been confirmed. Card details are entered in Stripe's secure embedded fields and transmitted directly to Stripe."] },
      { title: "Confirmation and Renewal", body: ["Purchases require explicit recurring-payment consent, including authorization for Stripe to save the payment method for these monthly renewals, followed by confirmation using Stripe's secure embedded payment fields. Preparing a review or an unpaid invoice does not authorize a charge or grant capacity. Capacity is granted automatically only after the payment provider confirms a successful attributed payment. A return URL does not prove payment. The capacity subscription renews automatically at the disclosed rate until its renewal is canceled.", "An owner may explicitly resolve a failed renewal by reviewing and paying the existing invoice for its displayed capacity period. That payment does not buy additional packs or restart a canceled renewal. The review shows whether any future renewal remains scheduled, the exact invoice amount, and the paid period before payment confirmation."] },
      { title: "Cancellation, Failed Payment, and Refund Effects", body: ["An owner can cancel a capacity subscription's renewal from Settings → Usage & Storage. Canceling renewal retains capacity until the end of the paid period and prevents the next capacity charge. A failed renewal does not create a new paid period. Existing originals remain accessible and retained, and retained originals may still be restored above the reduced allowance; only new uploads that exceed it are blocked.", "The Refund Policy applies. Cancellation does not itself provide a prorated refund or unused-time credit. A partial refund does not change that invoice's capacity; a full refund permanently revokes capacity for that invoice period. An active or lost payment dispute withdraws the affected invoice period's capacity. If a dispute is won or an inquiry is closed, reconciliation restores capacity for any unrefunded, currently paid period. These capacity effects do not delete existing files."] },
      { title: "Trash and Permanent Deletion", body: ["A new deletion moves an original to recoverable Trash for 30 days. The original continues to use bytes and a file slot. Authorized users can restore or download it during that period, or explicitly confirm permanent deletion sooner. After the retention period it is eligible for permanent deletion. Bytes and the file slot are released after physical deletion is confirmed; pending or retried deletion remains visible as retained usage.", "Historical deleted originals present before this retention policy took effect remain protected from permanent deletion pending advance notice and a recovery/export window. They may be restored or downloaded while retained. Deleting an original does not silently delete saved analyses, imported business records, chats, or other separately retained records; those have their own deletion controls and applicable retention rules."] },
      { title: "Existing Customers and Service Access", body: ["The included allowance applies separately to existing and new workspaces. Existing originals are not automatically deleted because an allowance is exceeded, a capacity purchase is canceled, or a capacity payment fails. File viewing, download, search, export, restoration, and ordinary workspace use remain subject to existing access permissions and separate service limits. This does not extend or replace the base subscription's access terms."] },
      { title: "Relationship to Other Terms", body: ["These terms supplement the Terms of Service, Subscription and Billing Terms, Refund Policy, and Data Retention Notice for uploaded-file capacity. The base subscription and optional capacity purchases are distinct. A workspace owner accepts this capacity terms version during the specific capacity purchase; viewing storage usage does not authorize a purchase."] }
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
  ["Workspace Isolation", "Workspace records, files, and analyses are restricted by workspace membership and role. Choose the active workspace and check who has access before sharing information."],
  ["Infrastructure & Security", "Vaeroex uses cloud infrastructure providers that maintain independent security and compliance programs, including applicable SOC 2 Type II and ISO 27001 certifications and attestations. Those credentials belong to the providers; they are not a certification of Vaeroex itself. Vaeroex also applies workspace access controls and automated security tests."],
  ["Secure Data Handling", "Encrypted connections, private file access, sign-in controls, and bot protection help protect customer information. Leaked-password protection is used where supported. No online service can guarantee absolute security."],
  ["Evidence-Backed Intelligence", "Supported business findings link to the information used to produce them. Check the source, date, and reporting period. A citation helps you inspect a claim; it does not guarantee that the source or interpretation is correct."],
  ["Deterministic Business Intelligence", "VSI uses safeguards to help prevent hallucinated figures and keep business answers grounded in supporting information. Accurate, up-to-date records matter. When information is missing, Vaeroex identifies what is needed."],
  ["Explainable Executive Reasoning", "VSI helps explain what the evidence supports and where information is missing. When evidence is insufficient, Vaeroex holds back unsupported conclusions and identifies what additional information is needed. Review sources and limitations before acting."],
  ["Source Content Safeguards", "Uploaded text is treated as information to review. Safeguards help prevent instructions hidden in a file from changing system behavior or authorizing changes to business records."],
  ["Leadership Control", "Recommendations are drafts for review. You decide what to do, and authorized users confirm before generated records are created or changed."],
  ["Current Information Controls", "Archive and deletion controls help manage what information is used in current analysis. Saved analyses are historical copies and do not automatically update when a source changes. Restore and retention rules still apply; see the Data Retention notice."],
  ["Accountability Records", "Selected account, administration, billing, policy-acceptance, and support events are recorded to help investigate problems. These records are not a complete record of every action."],
  ["Reviewing Important Answers", "VSI helps you make informed decisions with supporting evidence and clear limitations. Answers can still be incomplete or inaccurate, so review important conclusions before acting. Our Privacy Policy explains how your information is handled."],
  ["Sensitive Data Boundaries", "Do not enter patient data, PHI/ePHI, medical record numbers, insurance IDs, Social Security numbers, payment card numbers, government IDs, or other prohibited sensitive records into workspace content. See the Sensitive Data Policy before uploading or connecting information."],
  ["Customer Responsibility", "Keep source information current, assign workspace roles carefully, and review recommendations before important business action. You remain responsible for your data and decisions."],
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
