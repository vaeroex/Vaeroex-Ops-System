export const INQUIRY_CATEGORIES = {
  "drug-discovery": "Drug Discovery Intelligence walkthrough",
  "executive-intelligence": "Executive Intelligence",
  "custom-business-systems": "Custom Business Systems",
  "website-development": "Website Development / Enhancement",
  general: "General Inquiry",
  support: "Support Request",
  billing: "Billing or Subscription",
  partnership: "Strategic Partnership",
} as const;
export type InquiryKey = keyof typeof INQUIRY_CATEGORIES;
export function inquiryCategory(key?: string) {
  return key && Object.prototype.hasOwnProperty.call(INQUIRY_CATEGORIES, key)
    ? INQUIRY_CATEGORIES[key as InquiryKey]
    : INQUIRY_CATEGORIES.general;
}
export function isProjectInquiry(category: string) {
  return (
    category === INQUIRY_CATEGORIES["custom-business-systems"] ||
    category === INQUIRY_CATEGORIES["website-development"]
  );
}
export type ContactFormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};
