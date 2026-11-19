export const INQUIRY_CATEGORIES = {
  "drug-discovery": "Drug Discovery walkthrough",
  "research-partnership": "Research partnership",
  "custom-software": "Custom software inquiry",
} as const;

export type InquiryKey = keyof typeof INQUIRY_CATEGORIES;

export function inquiryCategory(key?: string | string[]) {
  if (key === undefined || key === "general") return INQUIRY_CATEGORIES["drug-discovery"];
  if (key === "custom-business-systems") return INQUIRY_CATEGORIES["custom-software"];
  if (key === "partnership") return INQUIRY_CATEGORIES["research-partnership"];
  if (typeof key === "string" && Object.prototype.hasOwnProperty.call(INQUIRY_CATEGORIES, key)) {
    return INQUIRY_CATEGORIES[key as InquiryKey];
  }
}

export function isProjectInquiry(category: string) {
  return category === INQUIRY_CATEGORIES["custom-software"];
}

export type ContactFormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};
