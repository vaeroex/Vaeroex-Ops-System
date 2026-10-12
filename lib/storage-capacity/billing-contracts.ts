export type CapacityBillingAddress = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
};

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
  taxIncludedCents?: number;
  renewalDate: string;
  expiresAt: string;
  cancellationEffect: string;
  checkoutTerms: string;
  termsVersion: string;
};

export type CapacityPaymentSession = {
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
  currency: "usd";
  renewalDate: string;
};

export type CapacityRecoveryQuote = {
  subscriptionId: string;
  invoiceId: string;
  packs: number;
  amountDueTodayCents: number;
  currency: "usd";
  taxIncludedCents: number;
  periodStart: string;
  periodEnd: string;
  renewalDate: string;
  cancelAtPeriodEnd: boolean;
  cancellationEffect: string;
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
