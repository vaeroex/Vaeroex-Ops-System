export const VAEROEX_CONTACT_EMAILS = {
  general: "hq@vaeroex.com",
  demo: "hq@vaeroex.com",
  careers: "careers@vaeroex.com",
  support: "support@vaeroex.com",
  billing: "billing@vaeroex.com",
  partners: "partners@vaeroex.com"
} as const;

export const VAEROEX_MAILTO_LINKS = {
  general: `mailto:${VAEROEX_CONTACT_EMAILS.general}`,
  demo: `mailto:${VAEROEX_CONTACT_EMAILS.demo}`,
  careers: `mailto:${VAEROEX_CONTACT_EMAILS.careers}`,
  support: `mailto:${VAEROEX_CONTACT_EMAILS.support}`,
  billing: `mailto:${VAEROEX_CONTACT_EMAILS.billing}`,
  partners: `mailto:${VAEROEX_CONTACT_EMAILS.partners}`
} as const;

export const VAEROEX_COMPANY_ADDRESS_LINES = [
  "Vaeroex LLC",
  "5319 University Dr, Unit 762",
  "Irvine, CA 92612",
  "United States"
] as const;

export const VAEROEX_COMPANY_ADDRESS_SINGLE_LINE = "Vaeroex LLC, 5319 University Dr, Unit 762, Irvine, CA 92612, United States";

export const VAEROEX_FOOTER_LOCATION = "Vaeroex LLC • Irvine, California • United States";
