import { z } from "zod";
import { addCanonicalDecimals, negateCanonicalDecimal } from "@/lib/integrations/deterministic/decimal";
import { CanonicalDecimalSchema } from "@/lib/integrations/contracts/primitives";
import { QboMinimizedSourceRecordSchema } from "@/lib/integrations/providers/qbo/contracts";

export const QBO_JOURNAL_ACCOUNTING_VERSION = "qbo_journal_accounting_v2" as const;
export const JournalCategorySchema = z.enum(["revenue", "cost_of_goods_sold", "labor", "other_operating_costs", "balance_sheet"]);
export type JournalCategory = z.infer<typeof JournalCategorySchema>;
export const QBO_JOURNAL_REGISTRY_V2 = Object.freeze({
  version: QBO_JOURNAL_ACCOUNTING_VERSION,
  basis: "accrual", currencyMode: "single_currency", missingCategory: "unavailable",
  originalProfitFact: false, reportsAdditive: false, liveLedgerComplete: false,
  measures: ["revenue", "cost_of_goods_sold", "labor", "other_operating_costs"] as const
});
export type JournalPosting = { lineId: string; accountRef: string; category: Exclude<JournalCategory, "balance_sheet">; amount: string };
const balanceTypes = new Set(["Bank", "Accounts Receivable", "Other Current Asset", "Fixed Asset", "Other Asset", "Accounts Payable", "Credit Card", "Other Current Liability", "Long Term Liability", "Equity"]);
export function journalCategoryMatchesAccount(category: JournalCategory, accountType: string) {
  return category === "revenue" ? accountType === "Income" : category === "cost_of_goods_sold" ? accountType === "Cost of Goods Sold"
    : category === "balance_sheet" ? balanceTypes.has(accountType) : accountType === "Expense";
}
/** Pure parity mapper. Native admission independently repeats these checks against current validated source heads. */
export function mapQboJournalPostingsV2(raw: unknown, currency: string,
  accounts: ReadonlyMap<string, { category: JournalCategory; accountType: string }>): JournalPosting[] {
  const record = QboMinimizedSourceRecordSchema.parse(raw);
  const fail = (): never => { throw new Error("qbo_journal_semantics_unproven"); };
  const e = record.accountingEvidence;
  if (record.recordType !== "JournalEntry" || record.status !== "active" || record.minimizationVersion !== "qbo_minimizer_v2"
    || record.provider.sourceEnvironment !== "production" || record.accounting.sourceCurrency !== currency
    || (record.accounting.homeCurrency !== null && record.accounting.homeCurrency !== currency)
    || (record.accounting.exchangeRate !== null && record.accounting.exchangeRate !== "1")
    || !record.temporal.postingDate || !e || e.sparse || e.hasDiscountDetail || e.hasTaxLines
    || e.hasTaxDetail || (e.totalTax !== null && e.totalTax.amount !== "0")
    || (e.globalTaxCalculation !== null && !["TaxExcluded", "NotApplicable"].includes(e.globalTaxCalculation))) fail();
  const ids = new Set<string>(), balance: string[] = [], postings: JournalPosting[] = [];
  for (const line of record.lines) {
    const le = line.accountingEvidence;
    if (!line.lineId || ids.has(line.lineId) || line.detailType !== "JournalEntryLineDetail" || !line.amount
      || line.amount.currency !== currency || line.amount.amount.startsWith("-") || !line.accountRef
      || !["credit", "debit"].includes(line.postingType ?? "") || !le || le.accountReferenceKind !== "account_ref"
      || le.hasDiscountDetail || le.hasGroupDetail || le.hasTaxDetail || le.taxInclusiveAmount !== null || le.taxCodeRef !== null) fail();
    ids.add(line.lineId!);
    const account = accounts.get(line.accountRef!.value);
    if (!account || !journalCategoryMatchesAccount(account.category, account.accountType)) fail();
    const creditAmount = line.postingType === "credit" ? line.amount!.amount : negateCanonicalDecimal(line.amount!.amount);
    balance.push(creditAmount);
    if (account!.category !== "balance_sheet") postings.push({ lineId: line.lineId!, accountRef: line.accountRef!.value,
      category: account!.category, amount: account!.category === "revenue" ? creditAmount : negateCanonicalDecimal(creditAmount) });
  }
  if (balance.length < 2 || addCanonicalDecimals(balance) !== "0") fail();
  return postings;
}
export function calculateQboJournalPeriodV2(postings: readonly Pick<JournalPosting, "category" | "amount">[]) {
  const totals = Object.fromEntries(QBO_JOURNAL_REGISTRY_V2.measures.map(category => {
    const values = postings.filter(p => p.category === category).map(p => CanonicalDecimalSchema.parse(p.amount));
    if (!values.length) throw new Error("qbo_journal_category_missing");
    return [category, addCanonicalDecimals(values)];
  })) as Record<Exclude<JournalCategory, "balance_sheet">, string>;
  return { recognizedRevenue: totals.revenue, costOfGoodsSold: totals.cost_of_goods_sold, labor: totals.labor,
    otherOperatingCosts: totals.other_operating_costs,
    operatingProfit: addCanonicalDecimals([totals.revenue, ...[totals.cost_of_goods_sold, totals.labor, totals.other_operating_costs].map(negateCanonicalDecimal)]) };
}
