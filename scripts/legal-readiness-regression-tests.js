const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const legalContent = read("lib/legal/content.ts");
const legalDocumentPage = read("components/legal/LegalDocumentPage.tsx");
const trustCenterPage = read("components/legal/TrustCenterPage.tsx");
const checkoutLegalPage = read("app/checkout/legal/page.tsx");
const checkoutAcceptance = read("lib/legal/pre-checkout-acceptance.ts");
const appHelp = read("app/app/help/page.tsx");
const readme = read("README.md");
const knownLimitations = read("docs/known-limitations.md");
const legalTrustNotes = read("docs/legal-trust-management.md");

const customerVisibleLegal = [
  legalContent,
  legalDocumentPage,
  trustCenterPage,
  checkoutLegalPage,
  appHelp
].join("\n");

assert.doesNotMatch(
  customerVisibleLegal,
  /draft policy|drafted for|placeholder provisions|should be finalized|before broad commercial launch|before commercial launch|future counsel|counsel review|attorney review/i,
  "customer-visible legal and trust surfaces must not contain launch/counsel placeholder language"
);

assert.match(legalContent, /title: "Limitation of Liability"[\s\S]+indirect, incidental, special, exemplary, consequential, or punitive damages/, "Terms must include approved limitation-of-liability structure");
assert.match(legalContent, /loss of profits, revenue, business opportunities, goodwill, data, or business interruption/, "Terms must include approved excluded loss categories");
assert.match(legalContent, /twelve months immediately preceding the event giving rise to the claim/, "Terms must include approved twelve-month liability cap");
assert.match(legalContent, /contract, tort, negligence, strict liability, statute, or any other theory/, "Terms must apply liability limits across legal theories");

assert.match(legalContent, /title: "Customer Indemnification"[\s\S]+Customer Data or other content/, "Terms must include Customer Data indemnification coverage");
assert.match(legalContent, /violation of these Terms or applicable law/, "Terms must include legal/terms violation indemnification coverage");
assert.match(legalContent, /Acceptable Use Policy/, "Terms must incorporate Acceptable Use Policy obligations");
assert.match(legalContent, /may not settle any claim[\s\S]+without Vaeroex's prior written consent/, "Terms must include defense and settlement control language");

assert.match(legalContent, /title: "Customer Data Rights"[\s\S]+Customers retain ownership of Customer Data/, "Terms must preserve customer ownership of Customer Data");
assert.match(legalContent, /rights, permissions, authorizations, licenses, and lawful bases/, "Terms must require customer authority/lawful basis for submitted data");
assert.match(legalContent, /only the limited rights necessary to host, store, process, transmit, secure, maintain, support, and provide the Services/, "Terms must limit Vaeroex data rights to service operation");
assert.doesNotMatch(legalContent, /model training|train (?:our|Vaeroex|AI)|training data/i, "Terms must not add model-training rights");

assert.match(legalContent, /Service Provider Categories/, "Privacy Policy must use category-level service-provider disclosure");
assert.match(legalContent, /cloud infrastructure and hosting, data storage, authentication, security, communications, payment processing, artificial-intelligence processing/, "Privacy Policy must disclose actual provider categories");
assert.match(legalContent, /does not publicly map individual infrastructure vendors to backend functions/, "Privacy Policy must avoid unnecessary vendor-to-function mapping");
assert.match(legalContent, /necessary cookies[\s\S]+authentication[\s\S]+workspace selection[\s\S]+bot protection/, "Privacy Policy must disclose necessary cookies/session/security technologies");
assert.match(legalContent, /browser local storage[\s\S]+theme selection/, "Privacy Policy must disclose local storage usage");
assert.match(legalContent, /session storage[\s\S]+dismissed notices or unsent draft workspace prompts/, "Privacy Policy must disclose session storage usage");
assert.match(legalContent, /does not currently claim use of cross-site advertising cookies or third-party advertising tracking/, "Privacy Policy must not claim unsupported ad tracking");
assert.doesNotMatch(legalContent, /Subprocessors list should|analytics details should/i, "Privacy Policy must not contain subprocessor or analytics placeholders");

assert.match(trustCenterPage, /trustSection\("Infrastructure & Security"\)/, "Trust Center must render the approved Infrastructure & Security section");
assert.match(legalContent, /cloud infrastructure providers that maintain independent security and compliance programs, including applicable SOC 2 Type II and ISO 27001 certifications and attestations/, "Trust Center must attribute SOC 2 Type II and ISO 27001 to infrastructure providers");
assert.doesNotMatch([trustCenterPage, legalContent].join("\n"), /does not currently claim HIPAA compliance|GDPR certification|GDPR certified|enterprise compliance certification for Vaeroex itself/i, "Trust Center must not restore the removed negative compliance disclaimer");
assert.doesNotMatch(trustCenterPage, /Vaeroex is (?:SOC 2|ISO 27001|HIPAA)/, "Trust Center must not claim Vaeroex certification or HIPAA compliance");
assert.match(trustCenterPage, /does not currently claim malware scanning, DLP scanning, file sandboxing, or regulated-data detection/, "Trust Center must not claim unsupported scanning/DLP capabilities");

assert.match(checkoutLegalPage, /Terms of Service, Privacy Policy, Subscription and Billing Terms/, "pre-checkout UI must identify primary accepted terms");
assert.match(checkoutLegalPage, /incorporated responsible-use, AI, sensitive-data, data-retention, and human-review policies/, "pre-checkout UI must identify incorporated policies without separate checkboxes");
assert.match(checkoutLegalPage, /payment method will be charged each billing period unless cancellation is scheduled/, "pre-checkout UI must disclose recurring payment authorization");
assert.match(checkoutAcceptance, /"terms"[\s\S]+"privacy"[\s\S]+"subscription-billing-terms"[\s\S]+"refund-policy"/, "pre-checkout acceptance set must include primary subscription policies");
assert.match(checkoutAcceptance, /"acceptable-use"[\s\S]+"ai-disclaimer"[\s\S]+"sensitive-data-policy"[\s\S]+"data-retention"[\s\S]+"human-review"/, "pre-checkout acceptance set must include incorporated supporting policies");

assert.doesNotMatch(readme, /\$399/, "current README must not contain obsolete $399 pricing");
assert.doesNotMatch(readme, /Live Stripe webhook payloads still need to be verified|Stripe products, prices, webhooks, and portal settings still need production configuration/, "current README must not claim completed Stripe validation is still pending");
assert.match(knownLimitations, /production-verified for the Customer #1 billing remediation baseline/, "known limitations must reflect completed Customer #1 billing verification");
assert.match(legalTrustNotes, /public\.checkout_legal_acceptances/, "legal trust notes must document the pre-checkout acceptance ledger");

process.stdout.write("Legal readiness regressions passed.\n");
