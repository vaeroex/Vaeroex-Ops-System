export type CapacityQuote = {
  quoteId: string;
  workspaceId: string;
  packs: number;
  currentPacks: number;
  totalPacks: number;
  totalBytes: number;
  totalFiles: number;
  currency: "usd";
  monthlyCents: number;
  existingMonthlyCents: number;
  amountDueTodayCents: number;
  renewalDate: string;
  expiresAt: string;
  cancellationEffect: string;
  checkoutTerms: string;
  termsVersion: string;
};

export type WorkspaceCapacityBilling = {
  purchasesEnabled: boolean;
  mode: "test" | "live" | "unavailable";
  maxPacks: number;
  committedPacks: number;
  subscriptions: Array<{
    id: string;
    packs: number;
    status: string;
    paidThrough: string | null;
    cancelAtPeriodEnd: boolean;
    monthlyCents: number;
  }>;
};
