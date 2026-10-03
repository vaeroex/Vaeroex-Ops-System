import type { SquareOrderResponseOperation } from "@/lib/integrations/providers/square/order-responses";
import {
  squarePhase2B2B2Order,
  squarePhase2B2B2ParserInput,
  squarePhase2B2B2SecondOrder
} from "@/lib/integrations/providers/square/fixtures/phase-2b2b2";
import type { SquarePhase2B2AParserInputOverrides } from "@/lib/integrations/providers/square/fixtures/phase-2b2a";

export const SQUARE_PHASE_2B2B3_SYNTHETIC_TENDER_IDS = Object.freeze({
  card: "SQ2B2B3TENDERCARD001",
  cash: "SQ2B2B3TENDERCASH001",
  thirdPartyCard: "SQ2B2B3TENDERTHIRD001",
  giftCard: "SQ2B2B3TENDERGIFT001",
  noSale: "SQ2B2B3TENDERNOSALE01",
  bankAccount: "SQ2B2B3TENDERBANK001",
  wallet: "SQ2B2B3TENDERWALLET01",
  buyNowPayLater: "SQ2B2B3TENDERBNPL001",
  squareAccount: "SQ2B2B3TENDERSQACCT1",
  other: "SQ2B2B3TENDEROTHER01",
  canadianCash: "SQ2B2B3TENDERCADCASH"
} as const);

export const SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS = Object.freeze({
  card: "SQ2B2B3PAYMENTCARD001",
  giftCard: "SQ2B2B3PAYMENTGIFT001",
  shared: "SQ2B2B3PAYMENTSHARED01",
  canadian: "SQ2B2B3PAYMENTCAD001"
} as const);

export const SQUARE_PHASE_2B2B3_SYNTHETIC_CANARIES = Object.freeze({
  transactionId: "SQ2B2B3TRANSACTIONCANARY",
  note: "sq2b2b3-tender-note-canary",
  processingFee: "sq2b2b3-processing-fee-canary",
  customerId: "SQ2B2B3CUSTOMERCANARY",
  panLike: "SQ2B2B3PANLIKECANARY",
  bin: "SQ2B2B3BINCANARY",
  lastFour: "SQ2B2B3LASTFOURCANARY",
  fingerprint: "sq2b2b3-card-fingerprint-canary",
  cardBrand: "SQ2B2B3CARDBRANDCANARY",
  expiration: "SQ2B2B3EXPIRATIONCANARY",
  entryMethod: "SQ2B2B3ENTRYMETHODCANARY",
  verification: "SQ2B2B3VERIFICATIONCANARY",
  bankAccount: "SQ2B2B3BANKACCOUNTCANARY",
  cash: "SQ2B2B3CASHDETAILCANARY",
  giftCard: "SQ2B2B3GIFTCARDCANARY",
  wallet: "SQ2B2B3WALLETCANARY",
  buyNowPayLater: "SQ2B2B3BNPLCANARY",
  squareAccount: "SQ2B2B3SQUAREACCOUNTCANARY",
  recipient: "SQ2B2B3RECIPIENTCANARY",
  freeText: "sq2b2b3-free-text-canary",
  providerKey: "sq2b2b3-provider-key-canary"
} as const);

export function squarePhase2B2B3ParserInput(
  response: unknown,
  operation: SquareOrderResponseOperation = "retrieve_order",
  overrides: SquarePhase2B2AParserInputOverrides = {}
) {
  return squarePhase2B2B2ParserInput(response, operation, overrides);
}

export function squarePhase2B2B3Tender(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const canary = SQUARE_PHASE_2B2B3_SYNTHETIC_CANARIES;
  return {
    id: SQUARE_PHASE_2B2B3_SYNTHETIC_TENDER_IDS.card,
    location_id: "SQ2B2ALOC001",
    transaction_id: canary.transactionId,
    created_at: "2026-08-19T16:20:21.123Z",
    note: canary.note,
    amount_money: { amount: 650, currency: "USD" },
    tip_money: { amount: 150, currency: "USD" },
    processing_fee_money: {
      amount: 20,
      currency: "USD",
      canary: canary.processingFee
    },
    customer_id: canary.customerId,
    type: "CARD",
    card_details: {
      status: canary.verification,
      card: {
        number: canary.panLike,
        bin: canary.bin,
        last_4: canary.lastFour,
        fingerprint: canary.fingerprint,
        card_brand: canary.cardBrand,
        exp_month: canary.expiration,
        exp_year: canary.expiration
      },
      entry_method: canary.entryMethod,
      verification_results: canary.verification
    },
    cash_details: {
      buyer_tendered_money: { amount: 700, currency: "USD" },
      change_back_money: { amount: 50, currency: "USD" },
      canary: canary.cash
    },
    bank_account_details: { canary: canary.bankAccount },
    buy_now_pay_later_details: { canary: canary.buyNowPayLater },
    square_account_details: { canary: canary.squareAccount },
    gift_card_details: { canary: canary.giftCard },
    wallet_details: { canary: canary.wallet },
    additional_recipients: [
      {
        location_id: canary.recipient,
        description: canary.freeText,
        amount_money: { amount: 1, currency: "USD" }
      }
    ],
    payment_id: SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS.card,
    future_provider_text: canary.freeText,
    ...overrides
  };
}

function primaryTenders() {
  const ids = SQUARE_PHASE_2B2B3_SYNTHETIC_TENDER_IDS;
  const payments = SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS;
  return [
    squarePhase2B2B3Tender(),
    squarePhase2B2B3Tender({
      id: ids.cash,
      created_at: "2026-08-19T16:20:22Z",
      type: "CASH",
      amount_money: { amount: 300, currency: "USD" },
      tip_money: { amount: 0, currency: "USD" },
      payment_id: null
    }),
    squarePhase2B2B3Tender({
      id: ids.thirdPartyCard,
      created_at: "2026-08-19T16:20:23Z",
      type: "THIRD_PARTY_CARD",
      amount_money: { amount: -50, currency: "USD" },
      tip_money: null,
      payment_id: payments.shared
    }),
    squarePhase2B2B3Tender({
      id: ids.giftCard,
      created_at: "2026-08-19T16:20:24Z",
      type: "SQUARE_GIFT_CARD",
      amount_money: { amount: 100, currency: "USD" },
      tip_money: {},
      payment_id: payments.giftCard
    }),
    squarePhase2B2B3Tender({
      id: ids.noSale,
      created_at: "2026-08-19T16:20:25Z",
      type: "NO_SALE",
      amount_money: null,
      tip_money: null,
      payment_id: null
    }),
    squarePhase2B2B3Tender({
      id: ids.bankAccount,
      created_at: "2026-08-19T16:20:26Z",
      type: "BANK_ACCOUNT",
      amount_money: { amount: 75, currency: "USD" },
      tip_money: null,
      payment_id: null
    }),
    squarePhase2B2B3Tender({
      id: ids.wallet,
      created_at: "2026-08-19T16:20:27Z",
      type: "WALLET",
      amount_money: { amount: 80, currency: "USD" },
      tip_money: { amount: 5, currency: "USD" },
      payment_id: null
    }),
    squarePhase2B2B3Tender({
      id: ids.buyNowPayLater,
      created_at: "2026-08-19T16:20:28Z",
      type: "BUY_NOW_PAY_LATER",
      amount_money: { amount: 120, currency: "USD" },
      tip_money: null,
      payment_id: null
    }),
    squarePhase2B2B3Tender({
      id: ids.squareAccount,
      created_at: "2026-08-19T16:20:29Z",
      type: "SQUARE_ACCOUNT",
      amount_money: { amount: 90, currency: "USD" },
      tip_money: null,
      payment_id: null
    }),
    squarePhase2B2B3Tender({
      id: ids.other,
      created_at: "2026-08-19T16:20:30Z",
      type: "OTHER",
      amount_money: { amount: 40, currency: "USD" },
      tip_money: null,
      payment_id: payments.shared
    })
  ];
}

export function squarePhase2B2B3Order(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B2B2Order({
    tenders: primaryTenders(),
    ...overrides
  });
}

export function squarePhase2B2B3SecondOrder(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  return squarePhase2B2B2SecondOrder({
    tenders: [
      squarePhase2B2B3Tender({
        id: SQUARE_PHASE_2B2B3_SYNTHETIC_TENDER_IDS.canadianCash,
        location_id: "SQ2B2ALOC002",
        created_at: "2026-08-18T21:15:00.500Z",
        type: "CASH",
        amount_money: { amount: -475, currency: "CAD" },
        tip_money: { amount: 0, currency: "CAD" },
        payment_id: SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS.canadian
      })
    ],
    ...overrides
  });
}

function orderWithoutTenders() {
  const order: Record<string, unknown> = { ...squarePhase2B2B2Order() };
  delete order.tenders;
  return order;
}

function orderWithSparseTenderFields(useNull: boolean) {
  const tender: Record<string, unknown> = { type: "OTHER" };
  if (useNull) {
    tender.id = null;
    tender.location_id = null;
    tender.created_at = null;
    tender.amount_money = null;
    tender.tip_money = null;
    tender.payment_id = null;
  }
  return squarePhase2B2B2Order({ tenders: [tender] });
}

export const SQUARE_PHASE_2B2B3_ORDER_FIXTURES = Object.freeze({
  retrieve: Object.freeze({ order: squarePhase2B2B3Order() }),
  batch: Object.freeze({
    orders: [squarePhase2B2B3SecondOrder(), squarePhase2B2B3Order()]
  }),
  search: Object.freeze({
    orders: [squarePhase2B2B3SecondOrder(), squarePhase2B2B3Order()],
    cursor: "sq2b2b3OrderCursor001=="
  }),
  emptyTenders: Object.freeze({
    order: squarePhase2B2B2Order({ tenders: [] })
  }),
  nullTenders: Object.freeze({
    order: squarePhase2B2B2Order({ tenders: null })
  }),
  missingTenders: Object.freeze({ order: orderWithoutTenders() }),
  nullTenderFields: Object.freeze({
    order: orderWithSparseTenderFields(true)
  }),
  missingTenderFields: Object.freeze({
    order: orderWithSparseTenderFields(false)
  })
});
