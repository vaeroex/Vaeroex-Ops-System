import { expandFactTimes, type FactTimeGroup } from "./fact-time";

type Source = Readonly<{ ref: string; binding: string; provider?: string; facts: readonly string[];
  factTimes?: readonly FactTimeGroup[]; salesInvoiceFactGroups?: readonly (readonly number[])[] }>;
export class InvoiceSelectionMetadataError extends Error { constructor() { super("invoice_selection_metadata_invalid"); } }
export type InvoiceSelection = Readonly<{ ref: string; binding: string; eligible: readonly number[]; reviewFirst: readonly (readonly number[])[] }>;

/** Narrow question intent, not a business-truth classifier. Mixed/purchase
 * questions retain ordinary fact selection. Never infer intent from sources. */
export function requestsSalesInvoiceEvidence(question: string): boolean {
  if (/\b(?:purchases?|payables?|purchase[ -]bills?|supplier[ -]invoices?)\b/i.test(question)) return false;
  return /\b(?:sales[ -]invoices?|customer[ -]invoices?|receivables?|billing\s*(?:\/|and)\s*collections)\b/i.test(question);
}

/** Index groups are issued from parsed Xero invoice/bill count markers. They
 * select a role, never a nonzero amount. All canonical facts remain available.
 * Review order is advisory date-label relevance, not measurement alignment,
 * entity correspondence, complete coverage or calculation authority. */
export function invoiceSelections(sources: readonly Source[], question: string): InvoiceSelection[] {
  if (!requestsSalesInvoiceEvidence(question)) return [];
  const peerDates = new Set(sources.filter(source => source.provider !== "xero")
    .flatMap(source => source.factTimes?.filter(time => time.basis === "sheet_row_date").map(time => time.date) || []));
  return sources.filter(source => source.provider === "xero").map(source => {
    const groups = source.salesInvoiceFactGroups ?? [], seen = new Set<number>();
    if (!Array.isArray(groups)) throw new InvoiceSelectionMetadataError();
    let times: ReturnType<typeof expandFactTimes> | null = null;
    try { times = source.factTimes ? expandFactTimes(source.factTimes, source.facts.length) : null; }
    catch { throw new InvoiceSelectionMetadataError(); }
    const ranked = groups.map(group => {
      if (!Array.isArray(group) || !group.length || new Set(group).size !== group.length || group.some(index => !Number.isSafeInteger(index) || index < 0 || index >= source.facts.length || index > 1999 || seen.has(index))) throw new InvoiceSelectionMetadataError();
      group.forEach(index => seen.add(index));
      const dates = [...new Set(group.map(index => times?.[index]?.date ?? null))];
      if (dates.length !== 1) throw new InvoiceSelectionMetadataError();
      return { indexes: [...group], date: dates[0] };
    }).sort((a, b) => Number(Boolean(b.date && peerDates.has(b.date))) - Number(Boolean(a.date && peerDates.has(a.date)))
      || (b.date || "").localeCompare(a.date || "") || a.indexes[0] - b.indexes[0]);
    return { ref: source.ref, binding: source.binding, eligible: [...seen].sort((a,b) => a-b), reviewFirst: ranked.slice(0, 3).map(group => group.indexes) };
  });
}
