export const categories = {
  accounting: "Accounting & bookkeeping",
  sales: "POS & sales",
  inventory: "Inventory & manufacturing",
  time: "Time tracking & project work",
  orders: "E-commerce orders",
  data: "Spreadsheets & custom data"
} as const;

export type Category = keyof typeof categories;
export const providerCategories = {
  square: ["sales"],
  quickbooks: ["accounting"],
  loyverse: ["sales"],
  "zoho-books": ["accounting"],
  "wix-orders": ["orders"],
  xero: ["accounting"],
  harvest: ["time"],
  "zoho-inventory": ["inventory"],
  clockify: ["time"],
  toggl: ["time"],
  katana: ["inventory"],
  "google-sheets": ["data"],
  "square-sandbox": ["sales"]
} as const satisfies Record<string, readonly Category[]>;
export type CatalogProvider = keyof typeof providerCategories;
export type CatalogEntry = { id: CatalogProvider; name: string; searchText: string };

// Match every word, regardless of case or punctuation. Search is capability-based,
// so a provider's broader product suite does not imply extra connector access.
const words = (text: string) => text.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
export function matchesSearch(entry: CatalogEntry, query: string) {
  const text = words([entry.name, entry.searchText, ...providerCategories[entry.id].map(category => categories[category])].join(" ")).join(" ");
  return words(query).every(word => text.includes(word));
}
export function inCategory(entry: CatalogEntry, category: Category | "all") {
  return category === "all" || (providerCategories[entry.id] as readonly Category[]).includes(category);
}
